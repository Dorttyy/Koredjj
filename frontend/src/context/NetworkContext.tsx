/**
 * NetworkContext — app-wide online/offline awareness.
 *
 * Web: subscribes to browser `online` / `offline` events + trusts
 * `navigator.onLine` at mount.
 * Native (Expo Go / development build): assumes online but flips to offline
 * on API failure heuristics reported by `src/utils/api.ts` and periodically
 * probes `/api/auth/me` (silently) to recover.
 *
 * The exported `useNetwork` hook returns `{ isOnline, retry }` — `retry` is
 * a manual re-probe that screens' Refresh buttons can call.
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
import { getApiUrl } from "@/src/utils/api";

interface NetworkState {
  isOnline: boolean;
  /** Force an immediate re-probe. */
  retry: () => Promise<void>;
  /** API layer calls this on any fetch/network failure to mark us offline. */
  reportFailure: () => void;
  /** API layer calls this after any successful response to recover. */
  reportSuccess: () => void;
}

const NetworkContext = createContext<NetworkState | null>(null);

// Cached callable that the api.ts layer imports to report request outcomes
// without needing React state.
let externalReportFailure: () => void = () => {};
let externalReportSuccess: () => void = () => {};
export const netTelemetry = {
  reportFailure: () => externalReportFailure(),
  reportSuccess: () => externalReportSuccess(),
};

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isOnline, setIsOnline] = useState(true);
  // Consecutive failures trigger the offline flip — a single 5xx shouldn't.
  const failureRun = useRef(0);

  const probe = useCallback(async () => {
    const baseUrl = getApiUrl();
    if (!baseUrl && Platform.OS !== "web") {
      // Cannot probe without a valid host URL on native; avoid false offline flag.
      return;
    }
    const targetUrl = baseUrl ? `${baseUrl}/api/auth/me` : "/api/auth/me";
    try {
      // Small race-safe timeout so an unreachable host doesn't hang forever.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      // 200 (authed) or 401 (unauthed) both prove the server is reachable.
      if (res.status === 200 || res.status === 401) {
        failureRun.current = 0;
        setIsOnline(true);
      } else {
        failureRun.current += 1;
        if (failureRun.current >= 3) setIsOnline(false);
      }
    } catch {
      failureRun.current += 1;
      if (failureRun.current >= 3) setIsOnline(false);
    }
  }, []);

  const reportFailure = useCallback(() => {
    failureRun.current += 1;
    // Three back-to-back failures = confidently offline.
    if (failureRun.current >= 3) setIsOnline(false);
  }, []);

  const reportSuccess = useCallback(() => {
    failureRun.current = 0;
    setIsOnline(true);
  }, []);

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
    setIsOnline(navigator.onLine);
    const onOffline = () => setIsOnline(false);
    const onOnline = () => {
      setIsOnline(true);
      failureRun.current = 0;
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Native + web fallback: while offline, poll every 5s to recover quickly.
  useEffect(() => {
    if (isOnline) return;
    const id = setInterval(probe, 5000);
    return () => clearInterval(id);
  }, [isOnline, probe]);

  const retry = useCallback(async () => {
    await probe();
  }, [probe]);

  return (
    <NetworkContext.Provider
      value={{ isOnline, retry, reportFailure, reportSuccess }}
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
