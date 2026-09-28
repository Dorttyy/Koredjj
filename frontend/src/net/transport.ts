/**
 * Transport — the rebuilt low-level request engine.
 *
 * Everything the app sends to the backend goes through `send()`. Compared with
 * the previous single `fetch` call it adds the four things that were missing
 * when an installed APK could not reach the server:
 *
 *  1. CONCURRENCY CAP (see ./queue) so Android's 5-calls-per-host OkHttp
 *     dispatcher can never park a request outside our own deadline.
 *  2. PER-ATTEMPT DEADLINES + RETRY for idempotent methods, so one dropped
 *     packet during a Wi-Fi/cellular hand-off is retried instead of being
 *     reported as an outage. POST is never repeated (no duplicate accounts).
 *  3. FRESH-CONNECTION RETRY: a retry adds a cache-buster and asks for the
 *     connection to be closed, so a poisoned pooled/keep-alive socket (a very
 *     common cause of "worked once, then every call hangs") cannot be reused.
 *  4. CANDIDATE FAILOVER: if the address baked into the build never answers,
 *     the next candidate (manual override, last known good, app config) is
 *     tried, and whichever answers is remembered.
 *
 * Failures are classified honestly: a device that is really offline, a server
 * that is unreachable, a timeout, and a build with no address at all are four
 * different problems and must never share one message.
 */

import {
  ApiError,
  deviceHasInternet,
  makeNetError,
  type NetFailureKind,
} from "@/src/utils/net-diagnostics";

import { withSlot } from "./queue";
import {
  addressCandidates,
  currentAddress,
  rememberWorkingAddress,
  setActiveAddress,
} from "./server-address";

/** Methods that are safe to send again after a transport-level failure. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE"]);
/** Pause before each retry — mobile hand-offs recover well under a second. */
const RETRY_BACKOFF_MS = [600, 1600];
/** Per-attempt deadline: fail fast and retry rather than burn one long wait. */
const RETRY_TIMEOUTS_MS = [15000, 20000, 25000];
const SINGLE_ATTEMPT_TIMEOUT_MS = 30000;

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
  /**
   * Override the attempt count. Use 1 for calls that must fail fast — e.g. the
   * cold-start session restore, where retries would hold the splash screen.
   */
  attempts?: number;
  /** Override the per-attempt deadline in ms. */
  timeoutMs?: number;
  /** Skip the concurrency gate (used by the health probe so a saturated
   *  queue can never make the app look offline). */
  jumpQueue?: boolean;
}

export interface AttemptFailure {
  kind: NetFailureKind;
  errorName?: string;
  errorMessage?: string;
  baseUrl: string;
}

/** Last transport failure, surfaced by the Connection check screen. */
let lastFailure: AttemptFailure | null = null;
export const lastTransportFailure = () => lastFailure;

const buildUrl = (baseUrl: string, path: string, attempt: number): string => {
  const url = `${baseUrl}/api${path}`;
  if (attempt === 0) return url;
  // Cache-buster on retries: guarantees a brand-new request line so no proxy,
  // CDN or pooled connection can replay the failed one.
  return `${url}${url.includes("?") ? "&" : "?"}_r=${Date.now()}`;
};

const headersFor = (attempt: number, hasBody: boolean): Record<string, string> => {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  // Force a fresh TCP/TLS connection on retries so a half-dead pooled socket
  // (which fails silently until it times out) cannot be reused.
  if (attempt > 0) {
    headers.Connection = "close";
    headers["Cache-Control"] = "no-cache";
  }
  return headers;
};

interface RawResult {
  response?: Response;
  failure?: AttemptFailure;
}

/** One single fetch with its own hard deadline. Never throws. */
const attemptFetch = async (
  method: string,
  baseUrl: string,
  path: string,
  body: unknown,
  attempt: number,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<RawResult> => {
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
    const response = await fetch(buildUrl(baseUrl, path, attempt), {
      method,
      signal: controller.signal,
      headers: headersFor(attempt, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { response };
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
      // "Network request failed", so ask the OS whether the device is really
      // offline before choosing a message.
      const online = await deviceHasInternet();
      kind = online === false ? "offline" : "unreachable";
    }
    return {
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

const runRequest = async <T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> => {
  const upper = method.toUpperCase();
  const retryable = IDEMPOTENT_METHODS.has(upper);
  const attempts = Math.max(
    1,
    options?.attempts ?? (retryable ? RETRY_BACKOFF_MS.length + 1 : 1),
  );

  // Addresses to try. Only idempotent calls fail over to another candidate —
  // replaying a POST against a second host could duplicate a side effect.
  const candidates = retryable ? addressCandidates() : [];
  const primary = currentAddress();
  const addresses = primary
    ? [primary, ...candidates.map((c) => c.url).filter((u) => u !== primary)]
    : candidates.map((c) => c.url);

  if (addresses.length === 0) {
    lastFailure = { kind: "no-backend-url", baseUrl: "" };
    reportFailure("no-backend-url");
    throw makeNetError("no-backend-url");
  }

  let failure: AttemptFailure | null = null;

  for (let addressIndex = 0; addressIndex < addresses.length; addressIndex += 1) {
    const baseUrl = addresses[addressIndex];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeoutMs =
        options?.timeoutMs ??
        (attempts > 1
          ? (RETRY_TIMEOUTS_MS[attempt] ?? SINGLE_ATTEMPT_TIMEOUT_MS)
          : SINGLE_ATTEMPT_TIMEOUT_MS);
      const task = () =>
        attemptFetch(upper, baseUrl, path, body, attempt, timeoutMs, options?.signal);
      const { response, failure: attemptError } = options?.jumpQueue
        ? await task()
        : await withSlot(task);

      if (response) {
        // Any HTTP answer proves this address is alive — pin it and clear the
        // outage state before the status code is even looked at.
        if (baseUrl !== primary) setActiveAddress(baseUrl);
        rememberWorkingAddress(baseUrl);
        lastFailure = null;
        reportSuccess();
        if (!response.ok) {
          let detail = `Request failed (${response.status})`;
          try {
            const data = await response.json();
            if (typeof data.detail === "string") detail = data.detail;
          } catch {
            // keep the default detail
          }
          throw new ApiError(detail, "http", { status: response.status, baseUrl });
        }
        return (await response.json()) as T;
      }

      failure = attemptError ?? failure;
      const moreAttempts = attempt < attempts - 1;
      if (moreAttempts) await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
    }
    // This address is exhausted; try the next candidate (if any).
  }

  const resolved: AttemptFailure = failure ?? {
    kind: "unreachable",
    baseUrl: addresses[0],
  };
  lastFailure = resolved;
  // Only a fully exhausted request counts as an outage, so a single flaky
  // packet can no longer paint the whole app as disconnected.
  reportFailure(resolved.kind);
  throw makeNetError(resolved.kind, resolved.baseUrl);
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
}

/**
 * Unauthenticated reachability probe used by the connection gate, the offline
 * banner's recovery poll and the Connection check screen. Walks every
 * candidate address and returns the first that answers, remembering it.
 */
export const probeServer = async (timeoutMs = 12000): Promise<HealthProbe> => {
  const primary = currentAddress();
  const rest = addressCandidates()
    .map((c) => c.url)
    .filter((u) => u !== primary);
  const addresses = primary ? [primary, ...rest] : rest;
  if (addresses.length === 0) {
    return { ok: false, latencyMs: 0, baseUrl: "", errorName: "no-backend-url" };
  }
  let last: HealthProbe | null = null;
  for (const baseUrl of addresses) {
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
      // Even 401/404 proves the host is reachable.
      const ok = res.status >= 200 && res.status < 500;
      if (ok) {
        setActiveAddress(baseUrl);
        rememberWorkingAddress(baseUrl);
        lastFailure = null;
        return { ok: true, status: res.status, latencyMs: Date.now() - started, baseUrl };
      }
      last = { ok: false, status: res.status, latencyMs: Date.now() - started, baseUrl };
    } catch (err) {
      last = {
        ok: false,
        latencyMs: Date.now() - started,
        baseUrl,
        timedOut,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return last ?? { ok: false, latencyMs: 0, baseUrl: addresses[0] };
};
