/**
 * Transport — the low-level request engine every backend call goes through.
 *
 * Design rules (each one fixes a real failure seen on installed APKs):
 *
 *  1. NO CONCURRENCY GATE. The previous 4-slot queue caused head-of-line
 *     blocking: one slow call on a flaky mobile link parked every other
 *     request behind it (requests measured at 60–240 s). Each request now owns
 *     its own AbortController deadline from the moment it is created, so a
 *     request can never wait "outside" a timeout — OkHttp's own dispatcher
 *     queue is covered by the same abort.
 *  2. SHORT, BOUNDED RETRIES for idempotent methods only (GET/HEAD/PUT/PATCH/
 *     DELETE): 3 attempts at 10 s / 12 s / 15 s with 0.4 s / 1.2 s backoff —
 *     worst case ≈ 39 s, typical recovery from a dropped packet < 2 s.
 *     POST is never replayed (no duplicate messages, accounts or payments).
 *  3. "IS THIS REALLY OUR API?" CHECK. A dead or wrong deployment still answers
 *     HTTP — Emergent's edge replies `400 text/plain "Application not found"`,
 *     Cloudflare replies with an HTML 502/503/504 page and a captive Wi-Fi
 *     portal replies with an HTML 200. None of those are our FastAPI (which
 *     always speaks JSON), so they are classified as `not-running` instead of
 *     being mistaken for a live server or surfaced as a bogus "Request failed
 *     (400)" on the login screen.
 *  4. CANDIDATE FAILOVER: if the address baked into the build does not answer,
 *     the other known addresses (manual override, app config, last known good)
 *     get one quick attempt each; whichever answers is remembered.
 */

import {
  ApiError,
  deviceHasInternet,
  makeNetError,
  type NetFailureKind,
} from "@/src/utils/net-diagnostics";

import {
  addressCandidates,
  currentAddress,
  rememberWorkingAddress,
  setActiveAddress,
} from "./server-address";

/** Methods that are safe to send again after a transport-level failure. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE"]);
const RETRY_TIMEOUTS_MS = [10000, 12000, 15000];
const RETRY_BACKOFF_MS = [400, 1200];
/** POST bodies can be large (voice notes, images) on slow mobile uplinks. */
const SINGLE_ATTEMPT_TIMEOUT_MS = 30000;
/** One quick try per fallback address after the primary is exhausted. */
const FAILOVER_TIMEOUT_MS = 8000;
/** Gateway statuses worth retrying (the origin was momentarily unavailable). */
const TRANSIENT_GATEWAY = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Auth token + telemetry bridge (kept out of React so `send` stays callable
// from plain modules).
// ---------------------------------------------------------------------------

let authToken: string | null = null;
export const setAuthToken = (token: string | null) => {
  authToken = token;
};
export const getAuthToken = () => authToken;

let reportFailure: (kind?: NetFailureKind) => void = () => {};
let reportSuccess: () => void = () => {};
export const bindNetworkTelemetry = (
  failure: (kind?: NetFailureKind) => void,
  success: () => void,
) => {
  reportFailure = failure;
  reportSuccess = success;
};

export interface RequestOptions {
  signal?: AbortSignal;
  /** Override the attempt count (1 = fail fast, e.g. cold-start restore). */
  attempts?: number;
  /** Override the per-attempt deadline in ms. */
  timeoutMs?: number;
  /** @deprecated kept for source compatibility — there is no queue anymore. */
  jumpQueue?: boolean;
}

export interface AttemptFailure {
  kind: NetFailureKind;
  errorName?: string;
  errorMessage?: string;
  status?: number;
  baseUrl: string;
}

/** Last transport failure, surfaced by the Connection check screen. */
let lastFailure: AttemptFailure | null = null;
export const lastTransportFailure = () => lastFailure;

const buildUrl = (baseUrl: string, path: string, attempt: number): string => {
  const url = `${baseUrl}/api${path}`;
  if (attempt === 0) return url;
  // Cache-buster on retries so no proxy/CDN can replay the failed response.
  return `${url}${url.includes("?") ? "&" : "?"}_r=${Date.now()}`;
};

const headersFor = (hasBody: boolean): Record<string, string> => {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
};

const isJson = (res: Response): boolean =>
  (res.headers.get("content-type") ?? "").toLowerCase().includes("json");

/** First line of a non-API body, for honest diagnostics ("Application not found"). */
const snippet = async (res: Response): Promise<string> => {
  try {
    const text = (await res.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, 80);
  } catch {
    return "";
  }
};

type AttemptResult =
  | { type: "api"; response: Response }
  | { type: "fail"; failure: AttemptFailure; transient: boolean };

/** One fetch with its own hard deadline. Never throws except on caller abort. */
const attempt = async (
  method: string,
  baseUrl: string,
  path: string,
  body: unknown,
  attemptIndex: number,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<AttemptResult> => {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(buildUrl(baseUrl, path, attemptIndex), {
      method,
      signal: controller.signal,
      headers: headersFor(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Our FastAPI always answers JSON (success AND errors). Anything else on
    // an error status is an edge/gateway/portal page: the app is not running
    // at this address (or the phone is behind a captive portal).
    if (!response.ok && !isJson(response)) {
      const text = await snippet(response);
      return {
        type: "fail",
        transient: TRANSIENT_GATEWAY.has(response.status),
        failure: {
          kind: "not-running",
          status: response.status,
          baseUrl,
          errorName: `HTTP ${response.status}`,
          errorMessage: text || `HTTP ${response.status}`,
        },
      };
    }
    return { type: "api", response };
  } catch (err) {
    if (external?.aborted) {
      // Caller cancelled on purpose — propagate quietly, never retry.
      throw err instanceof Error ? err : new Error("Request cancelled");
    }
    let kind: NetFailureKind = "unreachable";
    if (timedOut) {
      kind = "timeout";
    } else {
      // React Native collapses every transport error into
      // "Network request failed", so ask the OS whether the device is offline.
      const online = await deviceHasInternet();
      kind = online === false ? "offline" : "unreachable";
    }
    return {
      type: "fail",
      transient: true,
      failure: {
        kind,
        baseUrl,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onExternalAbort);
  }
};

/** Turn a response from OUR API into data or an ApiError("http"). */
const finish = async <T>(response: Response, baseUrl: string): Promise<T> => {
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") detail = data.detail;
      else if (Array.isArray(data?.detail) && data.detail[0]?.msg) detail = String(data.detail[0].msg);
    } catch {
      // keep the default detail
    }
    throw new ApiError(detail, "http", { status: response.status, baseUrl });
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // A 200 that is not JSON is a captive portal / proxy page, not our API.
    throw new ApiError(
      "The network returned an unexpected page instead of the app server. If you're on public Wi-Fi, open your browser to sign in to it, then try again.",
      "not-running",
      { status: response.status, baseUrl },
    );
  }
};

const runRequest = async <T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> => {
  const upper = method.toUpperCase();
  const idempotent = IDEMPOTENT_METHODS.has(upper);
  const attempts = Math.max(1, options?.attempts ?? (idempotent ? RETRY_TIMEOUTS_MS.length : 1));

  const primary = currentAddress();
  const fallbacks = addressCandidates()
    .map((c) => c.url)
    .filter((u) => u !== primary);

  if (!primary && fallbacks.length === 0) {
    lastFailure = { kind: "no-backend-url", baseUrl: "" };
    reportFailure("no-backend-url");
    throw makeNetError("no-backend-url");
  }

  let failure: AttemptFailure | null = null;

  const succeed = async (response: Response, baseUrl: string): Promise<T> => {
    if (baseUrl !== primary) setActiveAddress(baseUrl);
    rememberWorkingAddress(baseUrl);
    lastFailure = null;
    reportSuccess();
    return finish<T>(response, baseUrl);
  };

  // 1) The primary address, with bounded retries for idempotent calls.
  if (primary) {
    for (let i = 0; i < attempts; i += 1) {
      const timeoutMs =
        options?.timeoutMs ??
        (attempts > 1 ? (RETRY_TIMEOUTS_MS[i] ?? RETRY_TIMEOUTS_MS[RETRY_TIMEOUTS_MS.length - 1]) : SINGLE_ATTEMPT_TIMEOUT_MS);
      const result = await attempt(upper, primary, path, body, i, timeoutMs, options?.signal);
      if (result.type === "api") return succeed(result.response, primary);
      failure = result.failure;
      // A permanent "app not found" will not heal in a second — stop retrying.
      if (!result.transient) break;
      if (i < attempts - 1) await sleep(RETRY_BACKOFF_MS[i] ?? 1200);
    }
  }

  // 2) Fallback addresses. Idempotent calls always; a POST only when the edge
  //    proved the request never reached a backend (`not-running`), so a
  //    side effect can never be duplicated.
  const mayFailOver = idempotent || failure?.kind === "not-running" || !primary;
  if (mayFailOver) {
    for (const baseUrl of fallbacks) {
      const result = await attempt(
        upper,
        baseUrl,
        path,
        body,
        0,
        options?.timeoutMs ?? FAILOVER_TIMEOUT_MS,
        options?.signal,
      );
      if (result.type === "api") return succeed(result.response, baseUrl);
      failure = failure ?? result.failure;
    }
  }

  const resolved: AttemptFailure = failure ?? { kind: "unreachable", baseUrl: primary };
  lastFailure = resolved;
  reportFailure(resolved.kind);
  throw makeNetError(resolved.kind, resolved.baseUrl, resolved.status, resolved.errorMessage);
};

export const send = runRequest;

export interface HealthProbe {
  ok: boolean;
  status?: number;
  latencyMs: number;
  baseUrl: string;
  errorName?: string;
  errorMessage?: string;
  timedOut?: boolean;
  /** `not-running` = something answered, but it is not this app's API. */
  kind?: NetFailureKind;
}

/** `true` only for the exact health payload our FastAPI returns. */
const isOurHealth = (data: unknown): boolean => {
  if (!data || typeof data !== "object") return false;
  const d = data as { status?: unknown; message?: unknown };
  return d.status === "ok" || d.message === "Mello API";
};

/** Probe a single address's `/api/health`. Never throws. */
export const probeAddress = async (baseUrl: string, timeoutMs = 10000): Promise<HealthProbe> => {
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/health?_r=${Date.now()}`, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const raw = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (res.ok && isOurHealth(parsed)) {
      return { ok: true, status: res.status, latencyMs, baseUrl };
    }
    const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      ok: false,
      status: res.status,
      latencyMs,
      baseUrl,
      kind: "not-running",
      errorName: `HTTP ${res.status}`,
      errorMessage: text || `HTTP ${res.status}`,
    };
  } catch (err) {
    const online = timedOut ? true : await deviceHasInternet();
    return {
      ok: false,
      latencyMs: Date.now() - started,
      baseUrl,
      timedOut,
      kind: timedOut ? "timeout" : online === false ? "offline" : "unreachable",
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Reachability probe used by the boot gate, the outage recovery poll and the
 * Connection check screen. Walks every candidate address, returns the first
 * that is really OUR API, and pins it.
 */
export const probeServer = async (timeoutMs = 10000): Promise<HealthProbe> => {
  const primary = currentAddress();
  const rest = addressCandidates()
    .map((c) => c.url)
    .filter((u) => u !== primary);
  const addresses = primary ? [primary, ...rest] : rest;
  if (addresses.length === 0) {
    return { ok: false, latencyMs: 0, baseUrl: "", errorName: "no-backend-url", kind: "no-backend-url" };
  }
  let first: HealthProbe | null = null;
  for (const baseUrl of addresses) {
    const result = await probeAddress(baseUrl, timeoutMs);
    if (result.ok) {
      setActiveAddress(baseUrl);
      rememberWorkingAddress(baseUrl);
      lastFailure = null;
      return result;
    }
    // Report the PRIMARY address's failure — that's the one the user needs
    // to hear about, not the last fallback we happened to try.
    first = first ?? result;
  }
  const failed = first ?? { ok: false, latencyMs: 0, baseUrl: addresses[0] };
  lastFailure = {
    kind: failed.kind ?? "unreachable",
    baseUrl: failed.baseUrl,
    status: failed.status,
    errorName: failed.errorName,
    errorMessage: failed.errorMessage,
  };
  return failed;
};
