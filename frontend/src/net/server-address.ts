/**
 * Server address resolution — the single source of truth for WHERE the app
 * talks to the backend.
 *
 * Rebuilt from scratch because the previous version could only ever use the
 * one address baked into the binary at build time. If that address is
 * unreachable from a particular phone (DNS filtering, a VPN, an operator
 * blocking the CDN in front of it, or simply a stale build) the app had no way
 * out and every screen failed with "can't reach the server".
 *
 * Resolution order (first candidate that actually answers wins):
 *   1. A manual address the user typed into the Connection check screen —
 *      persisted, so it survives restarts. This is the escape hatch that makes
 *      a blocked/incorrect host recoverable WITHOUT a new build.
 *   2. `process.env.EXPO_PUBLIC_BACKEND_URL` — inlined into the JS bundle at
 *      build time; the publish pipeline rewrites it to the deployed
 *      `https://<app>.emergent.host` URL.
 *   3. `Constants.expoConfig.extra.backendUrl` (and the older manifest
 *      shapes) — the same value carried through app.config.js, for runtimes
 *      where the inlined env var was stripped.
 *   4. On web only: `window.location.origin`.
 *
 * NEVER hardcode a fallback host here. Preview/dev hosts are ephemeral and an
 * installed app baked with one can never reach a server.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

const MANUAL_KEY = "server_address_override_v1";
const LAST_GOOD_KEY = "server_address_last_good_v1";

/** Hosts a phone can never reach — refused on native so we fail honestly. */
const UNREACHABLE_ON_DEVICE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(:|\/|$)/i;

export type AddressSource =
  | "manual"
  | "last-good"
  | "build-env"
  | "app-config"
  | "web-origin"
  | "none";

export interface AddressCandidate {
  url: string;
  source: AddressSource;
}

/** Trim, drop trailing slashes, and force a scheme so `host.tld` also works. */
export const normalizeAddress = (raw?: string | null): string => {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  // Inner whitespace is NOT stripped: silently turning "not a url" into
  // "https://notaurl" would accept obvious typos as a server address.
  return withScheme.replace(/\/+$/, "");
};

/**
 * A real `scheme://host[:port][/path]` that a phone could actually reach.
 * Loopback/LAN hosts are refused on native because a device can never reach
 * the build machine's localhost.
 */
const ADDRESS_SHAPE = /^https?:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{2,5})?(?:\/[a-z0-9._~%/-]*)?$/i;

/** Installed (release) builds only ever talk HTTPS — cleartext is disabled in
 *  app.json, so an `http://` address could never work there anyway. */
const requiresHttps = (): boolean =>
  Platform.OS !== "web" && !(typeof __DEV__ !== "undefined" && __DEV__);

export const isUsableAddress = (url: string): boolean => {
  if (!url) return false;
  if (Platform.OS !== "web" && UNREACHABLE_ON_DEVICE.test(url)) return false;
  if (requiresHttps() && !/^https:\/\//i.test(url)) return false;
  return ADDRESS_SHAPE.test(url);
};

const configAddress = (): string => {
  const extras = [
    Constants.expoConfig?.extra?.backendUrl,
    (Constants as { manifest?: { extra?: { backendUrl?: string } } }).manifest?.extra?.backendUrl,
    (Constants as { manifest2?: { extra?: { expoClient?: { extra?: { backendUrl?: string } } } } })
      .manifest2?.extra?.expoClient?.extra?.backendUrl,
  ];
  for (const extra of extras) {
    const url = normalizeAddress(typeof extra === "string" ? extra : "");
    if (isUsableAddress(url)) return url;
  }
  return "";
};

/**
 * Optional backup addresses shipped in app.json (`expo.extra.fallbackBackendUrls`).
 * The permanent deployed URL is listed there so that even if the publish
 * pipeline ever fails to inject EXPO_PUBLIC_BACKEND_URL (or injects a host
 * that later disappears), an installed build still finds its server.
 */
const fallbackAddresses = (): string[] => {
  const raw = (Constants.expoConfig?.extra as { fallbackBackendUrls?: unknown } | undefined)
    ?.fallbackBackendUrls;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return list
    .map((u) => normalizeAddress(typeof u === "string" ? u : ""))
    .filter((u) => isUsableAddress(u));
};

// Synchronous mirrors of the persisted values. Storage is async but callers
// (fetch wrappers, WebSocket URL builders) must stay synchronous, so the
// values are hydrated once at boot by `hydrateServerAddress()`.
let manualAddress = "";
let lastGoodAddress = "";
let activeAddress = "";

/** Every address worth trying, best first, de-duplicated. */
export const addressCandidates = (): AddressCandidate[] => {
  const out: AddressCandidate[] = [];
  const push = (url: string, source: AddressSource) => {
    const normalized = normalizeAddress(url);
    if (!isUsableAddress(normalized)) return;
    if (out.some((c) => c.url === normalized)) return;
    out.push({ url: normalized, source });
  };
  push(manualAddress, "manual");
  // The build-time address outranks the remembered one: a freshly published
  // build must never be pinned to a host that merely worked in the past.
  // `last-good` stays in the list so it can still rescue a build whose baked
  // address has gone away.
  push(process.env.EXPO_PUBLIC_BACKEND_URL ?? "", "build-env");
  push(configAddress(), "app-config");
  for (const url of fallbackAddresses()) push(url, "app-config");
  push(lastGoodAddress, "last-good");
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    push(window.location.origin, "web-origin");
  }
  return out;
};

/** The address requests use right now ("" when this build has none). */
export const currentAddress = (): string => {
  if (activeAddress) return activeAddress;
  const [first] = addressCandidates();
  return first?.url ?? "";
};

export const currentAddressSource = (): AddressSource => {
  const active = currentAddress();
  if (!active) return "none";
  return addressCandidates().find((c) => c.url === active)?.source ?? "build-env";
};

/** Pin the address that just answered so later launches start with a winner. */
export const rememberWorkingAddress = (url: string): void => {
  const normalized = normalizeAddress(url);
  if (!isUsableAddress(normalized)) return;
  activeAddress = normalized;
  if (lastGoodAddress === normalized) return;
  lastGoodAddress = normalized;
  void storage.setItem(LAST_GOOD_KEY, normalized).catch(() => {});
};

/** Make `url` the address requests use right now (no persistence). */
export const setActiveAddress = (url: string): void => {
  const normalized = normalizeAddress(url);
  if (isUsableAddress(normalized)) activeAddress = normalized;
};

export const getManualAddress = (): string => manualAddress;

/** Save (or clear with "") the user-typed address and make it active at once. */
export const setManualAddress = async (raw: string | null): Promise<string> => {
  const normalized = normalizeAddress(raw);
  if (!normalized) {
    manualAddress = "";
    activeAddress = "";
    await storage.removeItem(MANUAL_KEY).catch(() => {});
    return "";
  }
  if (!isUsableAddress(normalized)) {
    throw new Error(
      "That server address doesn't look valid. Use a secure https:// address, e.g. https://my-app.emergent.host",
    );
  }
  manualAddress = normalized;
  activeAddress = normalized;
  await storage.setItem(MANUAL_KEY, normalized).catch(() => {});
  return normalized;
};

/** Load the persisted addresses. Safe to call more than once. */
export const hydrateServerAddress = async (): Promise<void> => {
  try {
    const [manual, lastGood] = await Promise.all([
      storage.getItem<string | null>(MANUAL_KEY, null),
      storage.getItem<string | null>(LAST_GOOD_KEY, null),
    ]);
    const normalizedManual = normalizeAddress(typeof manual === "string" ? manual : "");
    const normalizedLastGood = normalizeAddress(typeof lastGood === "string" ? lastGood : "");
    if (isUsableAddress(normalizedManual)) manualAddress = normalizedManual;
    if (isUsableAddress(normalizedLastGood)) lastGoodAddress = normalizedLastGood;
  } catch {
    // Storage unavailable — the build-time address still works.
  }
};
