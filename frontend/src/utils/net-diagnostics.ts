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
  } catch {
    const kind: NetFailureKind = timedOut
      ? "timeout"
      : (await deviceHasInternet()) === false
        ? "offline"
        : "unreachable";
    return { ok: false, latencyMs: Date.now() - started, kind, detail: messageFor(kind, baseUrl) };
  } finally {
    clearTimeout(timer);
  }
};
