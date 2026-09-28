import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { api, getAuthToken, setAuthToken, User } from "@/src/utils/api";
import {
  cleanWebSessionId,
  currentWebUrl,
  extractSessionId,
  openGoogleAuth,
} from "@/src/utils/googleAuth";
import { registerForPush } from "@/src/utils/push";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "auth_token";
// Migration only: remove the old browsing flag without deleting user data.
const LEGACY_GUEST_KEY = "guest_browsing_v1";

// A `session_id` is single-use. Several sources can surface the same one
// (auth-session result, hot deep link, cold-start URL, re-mount), so the
// exchange is deduplicated synchronously here, before any network call.
const consumedSessionIds = new Set<string>();
const inflightExchanges = new Map<string, Promise<User>>();

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Human-readable reason the last Google sign-in attempt failed (cleared on the next attempt). */
  googleError: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, name: string) => Promise<User>;
  googleLogin: (sessionId: string) => Promise<User>;
  /**
   * Full Google flow. Resolves with the user on mobile; resolves `null` when
   * the user genuinely cancelled, or on web (the page navigates away and the
   * callback is processed on the next mount).
   */
  signInWithGoogle: () => Promise<User | null>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const sessionVersion = useRef(0);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback((write: () => Promise<void>) => {
    const pending = persistence.current.catch(() => {}).then(write);
    persistence.current = pending;
    return pending;
  }, []);
  // Filled in below once `googleLogin` exists; lets the mount effect and the
  // hot-link listener share one exchange path without re-subscribing.
  const completeGoogleRef = useRef<(url: string | null) => Promise<User | null>>(
    async () => null,
  );

  useEffect(() => {
    let active = true;
    const version = sessionVersion.current;
    const isCurrent = () => active && version === sessionVersion.current;
    const restore = async () => {
      try {
        await storage.removeItem(LEGACY_GUEST_KEY);
        // A fresh Google callback (web `#session_id=…`, or a mobile cold start
        // via deep link) must be processed BEFORE any stored session.
        const callbackUrl =
          Platform.OS === "web" ? currentWebUrl() : await Linking.getInitialURL();
        if (extractSessionId(callbackUrl)) {
          try {
            const signedIn = await completeGoogleRef.current(callbackUrl);
            if (signedIn) return;
          } catch {
            // Fall through to the stored-token path; the error is surfaced via googleError.
          }
          if (!isCurrent()) return;
        }
        const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
        if (!isCurrent()) return;
        if (token) {
          setAuthToken(token);
          // Fail fast on a cold start: retrying here would keep the splash
          // screen up for a minute when the server is unreachable. One 12s
          // attempt is enough — the stored token is preserved unless the
          // server actually rejects it (401/403), so the user simply lands on
          // the login screen and the offline banner explains why.
          const me = await api.get<User>("/auth/me", { attempts: 1, timeoutMs: 12000 });
          if (!isCurrent()) return;
          if (me.is_guest) {
            setAuthToken(null);
            await persist(async () => {
              if (isCurrent()) await storage.secureRemove(TOKEN_KEY);
            });
            return;
          }
          setUser(me);
          registerForPush();
        }
      } catch (error) {
        if (!isCurrent()) return;
        setAuthToken(null);
        const status = (error as { status?: number } | null)?.status;
        // A temporary outage must not erase a saved, potentially valid session.
        if (status === 401 || status === 403) {
          await persist(async () => {
            if (isCurrent()) await storage.secureRemove(TOKEN_KEY);
          });
        }
      } finally {
        // The Google callback path bumps the session version on success, so
        // don't gate on `isCurrent()` here — a stuck splash is worse than a
        // redundant `setLoading(false)`.
        if (active) setLoading(false);
      }
    };
    restore();
    return () => { active = false; };
  }, [persist]);

  const applyAuth = useCallback(
    async (resp: { token: string; user: User }, version: number) => {
      if (resp.user.is_guest) {
        throw new Error("Guest access is no longer available. Please create an account.");
      }
      const assertCurrent = () => {
        if (version !== sessionVersion.current) {
          throw new Error("Sign-in was cancelled because the session changed.");
        }
      };
      assertCurrent();
      await persist(async () => {
        assertCurrent();
        await storage.secureSet(TOKEN_KEY, resp.token);
        await storage.removeItem(LEGACY_GUEST_KEY);
      });
      assertCurrent();
      setAuthToken(resp.token);
      setUser(resp.user);
      registerForPush();
    },
    [persist],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const version = ++sessionVersion.current;
      setLoading(false);
      const resp = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
      await applyAuth(resp, version);
      return resp.user;
    },
    [applyAuth],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const version = ++sessionVersion.current;
      setLoading(false);
      const resp = await api.post<{ token: string; user: User }>("/auth/register", { email, password, name });
      await applyAuth(resp, version);
      return resp.user;
    },
    [applyAuth],
  );

  const exchangeGoogleSession = useCallback(
    async (sessionId: string, opts?: { keepLoading?: boolean }) => {
      const version = ++sessionVersion.current;
      // On a cold start / web redirect we keep the splash up so the entry
      // gate doesn't flash the welcome screen mid-exchange.
      if (!opts?.keepLoading) setLoading(false);
      // Body field MUST be `session_id` (never a session_token). The backend
      // performs the single Emergent lookup and returns our own JWT.
      const resp = await api.post<{ token: string; user: User }>("/auth/session", {
        session_id: sessionId,
      });
      await applyAuth(resp, version);
      return resp.user;
    },
    [applyAuth],
  );

  const googleLogin = useCallback(
    (sessionId: string) => exchangeGoogleSession(sessionId),
    [exchangeGoogleSession],
  );

  const humanizeGoogleError = (error: unknown) => {
    const raw = error instanceof Error ? error.message : "";
    if (/banned|suspended/i.test(raw)) return "This account has been suspended.";
    if (/invalid or expired/i.test(raw)) return "Google sign-in expired. Please try again.";
    if (/unreachable|network|failed to fetch|502/i.test(raw)) {
      return "Can't reach the sign-in service. Check your connection and try again.";
    }
    return "Google sign-in didn't complete. Please try again.";
  };

  /**
   * Turn a callback URL into a signed-in user. Deduplicates the one-time
   * `session_id` across every source that may surface it; concurrent callers
   * for the same id share one in-flight exchange.
   */
  const completeGoogleSignIn = useCallback(
    async (url: string | null, opts?: { keepLoading?: boolean }): Promise<User | null> => {
      const sessionId = extractSessionId(url);
      if (!sessionId) return null;
      const pending = inflightExchanges.get(sessionId);
      if (pending) return pending;
      if (consumedSessionIds.has(sessionId)) return null;
      consumedSessionIds.add(sessionId);
      setGoogleError(null);
      const run = (async () => {
        try {
          const signedIn = await exchangeGoogleSession(sessionId, opts);
          cleanWebSessionId();
          return signedIn;
        } catch (error) {
          setGoogleError(humanizeGoogleError(error));
          throw error;
        } finally {
          inflightExchanges.delete(sessionId);
        }
      })();
      inflightExchanges.set(sessionId, run);
      return run;
    },
    [exchangeGoogleSession],
  );
  completeGoogleRef.current = (url) => completeGoogleSignIn(url, { keepLoading: true });

  // Hot deep links (app already running) — co-equal with the auth-session
  // result on Android, where Custom Tabs often report "dismiss" on success.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (!extractSessionId(url)) return;
      completeGoogleSignIn(url).catch(() => {});
    });
    return () => subscription.remove();
  }, [completeGoogleSignIn]);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setGoogleError(null);
    const opened = await openGoogleAuth();
    if (Platform.OS === "web") return null; // page is navigating away
    if (opened.cancelled || !opened.url) return null;
    return completeGoogleSignIn(opened.url);
  }, [completeGoogleSignIn]);

  const logout = useCallback(async () => {
    sessionVersion.current += 1;
    setAuthToken(null);
    setUser(null);
    setLoading(false);
    await persist(async () => {
      await storage.secureRemove(TOKEN_KEY);
      await storage.removeItem(LEGACY_GUEST_KEY);
    });
  }, [persist]);

  const setAuthenticatedUser = useCallback((next: User) => {
    // Ignore a previous screen's late response after the session was ended.
    if (getAuthToken() && !next.is_guest) setUser(next);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        googleError,
        login,
        register,
        googleLogin,
        signInWithGoogle,
        logout,
        setUser: setAuthenticatedUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
