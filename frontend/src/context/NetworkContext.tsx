/**
 * NetworkContext — app-wide connectivity awareness that distinguishes
 * "the phone has no internet" from "the server this build points at is not
 * answering". Those two are completely different problems and must never share
 * the same message: telling a user with full signal to "check your connection"
 * hides a broken/missing deployment (the classic symptom of an installed APK
 * built before the backend was deployed).
 *
 * Sources of truth
 *  - Device reachability: `expo-network` (`deviceHasInternet()` + a live
 *    `addNetworkStateListener` subscription on native, `online`/`offline`
 *    window events on web) — this alone decides `device-offline`.
 *  - Server reachability: outcomes reported by `src/utils/api.ts` plus an
 *    unauthenticated `GET /api/health` probe.
 *
 * `status` is therefore one of:
 *   "online"        — server answered (or nothing has failed yet)
 *   "device-offline" — the OS says there is no internet
 *   "server-down"   — device online, but the backend host is unreachable
 *   "no-server-url" — this build carries no backend address at all
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import * as Network from "expo-network";
import { getApiUrl } from "@/src/utils/api";
import { deviceHasInternet, type NetFailureKind } from "@/src/utils/net-diagnostics";

export type NetworkStatus =
  | "online"
  | "device-offline"
  | "server-down"
  | "no-server-url";

interface NetworkState {
  /** Back-compatible flag: false for ANY non-online status. */
  isOnline: boolean;
  /** Precise reason, so the UI can show honest copy. */
  status: NetworkStatus;
  /** Backend address baked into this build ("" when missing). */
  baseUrl: string;
  /** Force an immediate re-probe. */
  retry: () => Promise<void>;
  /**
   * API layer calls this on a fetch/network failure. `kind` carries what the
   * transport already worked out, so we never have to guess.
   */
  reportFailure: (kind?: NetFailureKind) => void;
  /** API layer calls this after any successful response to recover. */
  reportSuccess: () => void;
}

const NetworkContext = createContext<NetworkState | null>(null);

// Cached callable that the api.ts layer imports to report request outcomes
// without needing React state.
let externalReportFailure: (kind?: NetFailureKind) => void = () => {};
let externalReportSuccess: () => void = () => {};
export const netTelemetry = {
  reportFailure: (kind?: NetFailureKind) => externalReportFailure(kind),
  reportSuccess: () => externalReportSuccess(),
};

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = useState<NetworkStatus>("online");
  const [baseUrl, setBaseUrl] = useState<string>(() => getApiUrl());
  // Consecutive failures trigger the outage flip — a single 5xx shouldn't.
  const failureRun = useRef(0);

  const goOnline = useCallback(() => {
    failureRun.current = 0;
    setStatus("online");
  }, []);

  /**
   * Decide between "device-offline" and "server-down" by asking the OS, so we
   * never blame the user's connection for a dead/undeployed backend.
   */
  const classifyOutage = useCallback(async (hint?: NetFailureKind) => {
    if (hint === "no-backend-url") {
      setStatus("no-server-url");
      return;
    }
    if (hint === "offline") {
      setStatus("device-offline");
      return;
    }
    const online = await deviceHasInternet();
    setStatus(online === false ? "device-offline" : "server-down");
  }, []);

  const probe = useCallback(async () => {
    const url = getApiUrl();
    setBaseUrl(url);
    if (!url && Platform.OS !== "web") {
      // A native build with no server address can never recover by retrying —
      // report it as a build/publish problem instead of a flaky network.
      setStatus("no-server-url");
      return;
    }
    // `/api/health` is unauthenticated, so reachability is measured without
    // depending on a valid session.
    const targetUrl = url ? `${url}/api/health` : "/api/health";
    try {
      // Small race-safe timeout so an unreachable host doesn't hang forever (12s for mobile latency).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      // Any HTTP answer (even 401/404) proves the host is reachable.
      if (res.status >= 200 && res.status < 500) {
        goOnline();
      } else {
        failureRun.current += 1;
        if (failureRun.current >= 3) await classifyOutage();
      }
    } catch {
      failureRun.current += 1;
      if (failureRun.current >= 3) await classifyOutage();
    }
  }, [classifyOutage, goOnline]);

  const reportFailure = useCallback(
    (kind?: NetFailureKind) => {
      setBaseUrl(getApiUrl());
      // A missing server address is deterministic, not flaky: surface at once.
      if (kind === "no-backend-url") {
        setStatus("no-server-url");
        return;
      }
      failureRun.current += 1;
      // Three back-to-back failures = confidently in an outage.
      if (failureRun.current >= 3) void classifyOutage(kind);
    },
    [classifyOutage],
  );

  const reportSuccess = useCallback(() => {
    goOnline();
  }, [goOnline]);

  // Wire the module-level bridge so api.ts can call in without a hook.
  useEffect(() => {
    externalReportFailure = reportFailure;
    externalReportSuccess = reportSuccess;
    return () => {
      externalReportFailure = () => {};
      externalReportSuccess = () => {};
    };
  }, [reportFailure, reportSuccess]);

  // Web: subscribe to navigator.online / offline
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (navigator.onLine === false) setStatus("device-offline");
    const onOffline = () => setStatus("device-offline");
    const onOnline = () => goOnline();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [goOnline]);

  // Native: react to real radio changes immediately instead of waiting for
  // three failed requests. Airplane mode / lost Wi-Fi is then reported as a
  // device problem, and regaining a link clears the banner right away.
  useEffect(() => {
    if (Platform.OS === "web") return;
    let sub: { remove: () => void } | undefined;
    try {
      sub = Network.addNetworkStateListener((event) => {
        const connected =
          event.isConnected !== false && event.isInternetReachable !== false;
        if (!connected) {
          setStatus("device-offline");
          return;
        }
        // Link is back: clear a device-offline banner and re-check the server.
        failureRun.current = 0;
        setStatus((prev) => (prev === "device-offline" ? "online" : prev));
        void probe();
      });
    } catch {
      // Listener unsupported on this platform build — polling still recovers.
    }
    return () => sub?.remove();
  }, [probe]);

  // While in an outage, poll every 5s to recover quickly. A build with no
  // server address is excluded: retrying cannot fix a missing URL.
  useEffect(() => {
    if (status === "online" || status === "no-server-url") return;
    const id = setInterval(probe, 5000);
    return () => clearInterval(id);
  }, [status, probe]);

  const retry = useCallback(async () => {
    await probe();
  }, [probe]);

  return (
    <NetworkContext.Provider
      value={{
        isOnline: status === "online",
        status,
        baseUrl,
        retry,
        reportFailure,
        reportSuccess,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = (): NetworkState => {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
};
