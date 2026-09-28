/**
 * NetworkContext — the React face of the rebuilt connection layer.
 *
 * Responsibilities
 *  1. BOOTSTRAP: on cold start it loads any saved server address and probes
 *     the backend ONCE before the app starts hammering it. The result is what
 *     gates the WebSocket, so a socket can never occupy one of Android's five
 *     per-host OkHttp slots while HTTP is still broken.
 *  2. CLASSIFY: it never says "no network connection" unless the OS confirms
 *     the device is offline. A reachable phone with an unreachable backend is
 *     reported as `server-down`, and a build with no address at all as
 *     `no-server-url` — three different problems, three different messages.
 *  3. RECOVER: while in an outage it re-probes every 5s (which also walks the
 *     other candidate addresses), and on native it reacts to real radio
 *     changes instantly instead of waiting for requests to fail.
 *
 * Sources of truth: `expo-network` for the device, `src/net/transport`'s
 * probe + request outcomes for the server.
 */

import * as Network from "expo-network";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import { getApiUrl, hydrateServerAddress, probeServer } from "@/src/utils/api";
import { deviceHasInternet, type NetFailureKind } from "@/src/utils/net-diagnostics";

export type NetworkStatus =
  /** First probe still running — never show an outage banner yet. */
  | "connecting"
  | "online"
  | "device-offline"
  | "server-down"
  | "no-server-url";

interface NetworkState {
  /** Back-compatible flag: false only for a CONFIRMED outage. */
  isOnline: boolean;
  /** Precise reason, so the UI can show honest copy. */
  status: NetworkStatus;
  /** Server address currently in use ("" when the build has none). */
  baseUrl: string;
  /** True once the backend has answered at least once this session. */
  ready: boolean;
  /** Force an immediate re-probe (also re-tries every candidate address). */
  retry: () => Promise<boolean>;
  /** Transport layer reports a fully exhausted request. */
  reportFailure: (kind?: NetFailureKind) => void;
  /** Transport layer reports any successful response. */
  reportSuccess: () => void;
}

const NetworkContext = createContext<NetworkState | null>(null);

/**
 * How many exhausted requests must fail before declaring an outage. The
 * transport already retries every idempotent call three times across every
 * candidate address before it reports once, so two reports mean the connection
 * is genuinely gone — not a single dropped packet.
 */
const FAILURE_THRESHOLD = 2;

// Module-level bridge so `src/net/transport` can report outcomes without being
// a hook consumer. Rebound by the provider on mount.
let externalReportFailure: (kind?: NetFailureKind) => void = () => {};
let externalReportSuccess: () => void = () => {};
export const netTelemetry = {
  reportFailure: (kind?: NetFailureKind) => externalReportFailure(kind),
  reportSuccess: () => externalReportSuccess(),
};

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = useState<NetworkStatus>("connecting");
  const [baseUrl, setBaseUrl] = useState<string>(() => getApiUrl());
  const [ready, setReady] = useState(false);
  const failureRun = useRef(0);

  const goOnline = useCallback(() => {
    failureRun.current = 0;
    setBaseUrl(getApiUrl());
    setReady(true);
    setStatus("online");
  }, []);

  /**
   * Decide between "device offline" and "server unreachable" by asking the OS,
   * so we never blame the user's connection for a dead backend.
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

  /** Probe every candidate address; the first that answers wins. */
  const probe = useCallback(async (): Promise<boolean> => {
    const result = await probeServer(12000);
    setBaseUrl(getApiUrl());
    if (result.ok) {
      goOnline();
      return true;
    }
    if (!result.baseUrl) {
      setStatus("no-server-url");
      return false;
    }
    failureRun.current += 1;
    if (failureRun.current >= FAILURE_THRESHOLD || !ready) await classifyOutage();
    return false;
  }, [classifyOutage, goOnline, ready]);

  const reportFailure = useCallback(
    (kind?: NetFailureKind) => {
      setBaseUrl(getApiUrl());
      // A missing address is deterministic, not flaky — surface it at once.
      if (kind === "no-backend-url") {
        setStatus("no-server-url");
        return;
      }
      failureRun.current += 1;
      if (failureRun.current >= FAILURE_THRESHOLD) void classifyOutage(kind);
    },
    [classifyOutage],
  );

  const reportSuccess = useCallback(() => {
    goOnline();
  }, [goOnline]);

  // Wire the module bridge so the transport can call in without a hook.
  useEffect(() => {
    externalReportFailure = reportFailure;
    externalReportSuccess = reportSuccess;
    return () => {
      externalReportFailure = () => {};
      externalReportSuccess = () => {};
    };
  }, [reportFailure, reportSuccess]);

  // BOOTSTRAP: load the saved address, then probe once before anything else
  // starts making requests.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      await hydrateServerAddress();
      if (cancelled) return;
      setBaseUrl(getApiUrl());
      await probe();
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once: `probe` is stable enough and re-running the
    // bootstrap on every identity change would re-probe needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Web: subscribe to navigator online/offline.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const initial = setTimeout(() => {
      if (navigator.onLine === false) setStatus("device-offline");
    }, 0);
    const onOffline = () => setStatus("device-offline");
    const onOnline = () => {
      failureRun.current = 0;
      void probe();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [probe]);

  // Native: react to real radio changes immediately instead of waiting for
  // requests to fail. Airplane mode / lost Wi-Fi is then reported as a device
  // problem, and regaining a link re-probes at once.
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
        failureRun.current = 0;
        void probe();
      });
    } catch {
      // Listener unsupported on this build — the 5s poll still recovers.
    }
    return () => sub?.remove();
  }, [probe]);

  // While in an outage, poll every 5s to recover quickly. A build with no
  // address at all is excluded: retrying cannot invent a server.
  useEffect(() => {
    if (status === "online" || status === "connecting" || status === "no-server-url") return;
    const id = setInterval(() => void probe(), 5000);
    return () => clearInterval(id);
  }, [status, probe]);

  const retry = useCallback(async () => probe(), [probe]);

  return (
    <NetworkContext.Provider
      value={{
        // "connecting" must not paint the app as offline during boot.
        isOnline: status === "online" || status === "connecting",
        status,
        baseUrl,
        ready,
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
