/**
 * Network failure classification + backend health probing.
 *
 * Why this exists: React Native's `fetch` collapses every transport level
 * problem (DNS failure, connection refused, TLS error, no route to host) into a
 * single `TypeError: Network request failed`. Showing "Check your connection"
 * for all of them is wrong and actively misleading — a standalone APK built
 * against a backend URL that is not deployed is a *server configuration*
 * problem, not a user connectivity problem.
 *
 * This module must NOT import `src/utils/api.ts` (api.ts imports from here).
 */

import { Platform } from "react-native";
import * as Network from "expo-network";

export type NetFailureKind =
  /** The bundle carries no backend base URL at all (bad/stale build). */
  | "no-backend-url"
  /** The device itself has no internet (airplane mode, no data, captive Wi-Fi). */
  | "offline"
  /** Host answered too slowly / not at all inside our deadline. */
  | "timeout"
  /** Device is online but the host could not be reached (DNS, refused, TLS). */
  | "unreachable";

export class ApiError extends Error {
  kind: NetFailureKind | "http";
  status?: number;
  baseUrl?: string;

  constructor(
    message: string,
    kind: NetFailureKind | "http",
    extra?: { status?: number; baseUrl?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = extra?.status;
    this.baseUrl = extra?.baseUrl;
  }
}

export const hostOf = (url?: string | null): string => {
  if (!url) return "unknown host";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
};

/**
 * `true` when the host can only ever exist on the build machine / workspace:
 * an Emergent preview host, an Expo tunnel, a loopback address or a bare LAN
 * IP. An installed APK/IPA baked with one of these can never reach a server
 * from a real phone, so the failure must be reported as a build/deploy
 * configuration problem instead of blaming the user's mobile data.
 */
export const isEphemeralHost = (url?: string | null): boolean => {
  const host = hostOf(url).toLowerCase();
  if (!host || host === "unknown host") return false;
  return (
    /\.preview\.emergentagent\.com(:\d+)?$/.test(host) ||
    /\.ngrok(-free)?\.(app|io|dev)(:\d+)?$/.test(host) ||
    /\.exp\.direct(:\d+)?$/.test(host) ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(:\d+)?$/.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)
  );
};

/**
 * `true` = device believes it has internet, `false` = definitely offline,
 * `null` = could not determine (never treat `null` as offline).
 */
export const deviceHasInternet = async (): Promise<boolean | null> => {
  if (Platform.OS === "web") {
    return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : null;
  }
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    return null;
  }
};

/** User-facing copy per failure kind — honest about server vs. connection. */
export const messageFor = (kind: NetFailureKind, baseUrl?: string): string => {
  switch (kind) {
    case "no-backend-url":
      return "This app build has no server address configured. Please re-publish the app and install the new build.";
    case "offline":
      return "You're offline. Turn on Wi-Fi or mobile data and try again.";
    case "timeout":
      return "The server is taking too long to respond. Please try again.";
    case "unreachable":
    default:
      // A standalone build baked with a workspace-only host is a publish
      // problem, not a connectivity problem — say so exactly.
      if (Platform.OS !== "web" && isEphemeralHost(baseUrl)) {
        return `This build was made with a temporary preview server address (${hostOf(baseUrl)}), which a phone can never reach. Deploy the app first, then install a fresh build.`;
      }
      return `Can't reach the server (${hostOf(baseUrl)}). It may be down or not deployed yet — please try again shortly.`;
  }
};

export const makeNetError = (kind: NetFailureKind, baseUrl?: string): ApiError =>
  new ApiError(messageFor(kind, baseUrl), kind, { baseUrl });

export interface HealthResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  kind?: NetFailureKind;
  detail?: string;
  /** Raw transport error, kept verbatim for the connection-check screen. */
  errorName?: string;
  errorMessage?: string;
}

/**
 * Hit the unauthenticated `/api/health` endpoint. Used by the offline banner's
 * recovery probe and by the developer diagnostics screen.
 */
export const checkBackendHealth = async (
  baseUrl: string,
  timeoutMs = 10000,
): Promise<HealthResult> => {
  const started = Date.now();
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, kind: "no-backend-url", detail: messageFor("no-backend-url") };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - started };
  } catch (err) {
    const kind: NetFailureKind = timedOut
      ? "timeout"
      : (await deviceHasInternet()) === false
        ? "offline"
        : "unreachable";
    return {
      ok: false,
      latencyMs: Date.now() - started,
      kind,
      detail: messageFor(kind, baseUrl),
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
};

export interface ProbeResult {
  label: string;
  url: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  /** Short body excerpt — only used for the Cloudflare trace control probe. */
  body?: string;
  errorName?: string;
  errorMessage?: string;
  timedOut?: boolean;
}

/**
 * Raw single-URL probe used by the in-app connection check.
 *
 * Reports the verbatim error so an installed build can explain ITSELF instead
 * of us having to guess: pairing our own host with neutral control URLs is the
 * only way to tell "this phone has no working internet" apart from "this phone
 * cannot reach *our* host" (VPN, DNS filtering, carrier/ISP block, captive
 * portal) without attaching a debugger to the user's device.
 */
export const probeUrl = async (
  label: string,
  url: string,
  timeoutMs = 12000,
): Promise<ProbeResult> => {
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    let body: string | undefined;
    try {
      body = (await res.text()).slice(0, 400);
    } catch {
      body = undefined;
    }
    return {
      label,
      url,
      ok: res.status >= 200 && res.status < 500,
      status: res.status,
      latencyMs: Date.now() - started,
      body,
    };
  } catch (err) {
    return {
      label,
      url,
      ok: false,
      latencyMs: Date.now() - started,
      timedOut,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Neutral endpoints that prove whether the device has *any* working internet. */
export const CONTROL_PROBES: { label: string; url: string }[] = [
  // Tiny 204, no payload, reachable worldwide — "is there internet at all?"
  { label: "Internet (Google 204)", url: "https://clients3.google.com/generate_204" },
  // Returns the client IP + Cloudflare colo. Our backend sits behind
  // Cloudflare, so if this fails while Google works, the block is specific to
  // Cloudflare (VPN / ISP / DNS filtering) rather than to our server.
  { label: "Cloudflare edge", url: "https://www.cloudflare.com/cdn-cgi/trace" },
];

export interface NetworkSnapshot {
  type: string;
  isConnected: string;
  isInternetReachable: string;
}

/** Human-readable OS network state for the connection-check screen. */
export const networkSnapshot = async (): Promise<NetworkSnapshot> => {
  if (Platform.OS === "web") {
    return {
      type: "browser",
      isConnected:
        typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
          ? String(navigator.onLine)
          : "unknown",
      isInternetReachable: "unknown",
    };
  }
  try {
    const state = await Network.getNetworkStateAsync();
    return {
      type: String(state.type ?? "unknown"),
      isConnected: String(state.isConnected ?? "unknown"),
      isInternetReachable: String(state.isInternetReachable ?? "unknown"),
    };
  } catch (err) {
    return {
      type: `unavailable (${err instanceof Error ? err.name : "error"})`,
      isConnected: "unknown",
      isInternetReachable: "unknown",
    };
  }
};

