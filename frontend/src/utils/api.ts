import { Platform } from "react-native";
import Constants from "expo-constants";
import {
  ApiError,
  deviceHasInternet,
  makeNetError,
  type NetFailureKind,
} from "@/src/utils/net-diagnostics";

/**
 * Single source of truth for the backend base URL (REST + WebSockets + assets).
 *
 * Resolution order on native (standalone APK / IPA / dev client):
 *   1. `process.env.EXPO_PUBLIC_BACKEND_URL` — inlined into the JS bundle at
 *      build time. The publish pipeline rewrites this to the deployed
 *      `https://<app>.emergent.host` URL, so production builds get it for free.
 *   2. `Constants.expoConfig.extra.backendUrl` — the same value carried through
 *      `app.config.js`, as a backup for runtimes where the inlined env var was
 *      stripped (older manifests, OTA updates).
 *
 * NEVER hardcode a fallback here. Preview/dev hosts are ephemeral (they change
 * on every workspace fork and go away when the workspace sleeps); an installed
 * APK baked with one can never reach a server, which surfaces as the classic
 * "Can't reach the server" on a real device. An empty string is returned
 * instead so the failure is reported honestly as a misconfigured build.
 * Loopback/LAN hosts are ignored on native for the same reason — a phone can
 * never reach the build machine's localhost.
 */
export const getApiUrl = (): string => {
  // On web, always use window.location.origin so browser preview / subdomains / proxies never fail
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  const candidates = [
    process.env.EXPO_PUBLIC_BACKEND_URL,
    Constants.expoConfig?.extra?.backendUrl,
    (Constants as any).manifest?.extra?.backendUrl,
    (Constants as any).manifest2?.extra?.expoClient?.extra?.backendUrl,
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (!value) continue;
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(:|\/|$)/i.test(value)) {
      continue;
    }
    return value.replace(/\/+$/, "");
  }
  return "";
};

let authToken: string | null = null;

// Bridge to NetworkContext so we can flip offline state on network-level
// failures without turning `request()` into a hook consumer. Set from
// `NetworkProvider`; noop before boot.
let netFailureReporter: (kind?: NetFailureKind) => void = () => {};
let netSuccessReporter: () => void = () => {};
export const bindNetworkTelemetry = (
  failure: (kind?: NetFailureKind) => void,
  success: () => void,
) => {
  netFailureReporter = failure;
  netSuccessReporter = success;
};

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

export const wsUrl = (): string =>
  `${getApiUrl().replace(/^http/, "ws")}/api/ws?token=${authToken}`;

// Room-based signaling socket for the Pro classroom (WebRTC + in-call chat).
export const proRtcUrl = (room: string): string =>
  `${getApiUrl().replace(/^http/, "ws")}/api/pro/rtc/${room}?token=${authToken}`;

/**
 * Methods that are safe to send again after a transport failure. A retried
 * POST could create a duplicate message/room/payment, so POST is never
 * repeated automatically — the screens that need it retry explicitly.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE"]);
/** Pause before each retry (mobile hand-offs recover in well under a second). */
const RETRY_BACKOFF_MS = [700, 1800];
/**
 * Per-attempt deadline. Retryable calls fail fast and try again instead of
 * burning one long 30s window, which is what made a single dropped packet look
 * like "the server is down". POST keeps the single long window because it may
 * be uploading.
 */
const RETRY_TIMEOUTS_MS = [15000, 20000, 25000];
const SINGLE_ATTEMPT_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  signal?: AbortSignal;
  /**
   * Override the attempt count. Use 1 for calls that must fail fast — e.g. the
   * cold-start session restore, where three retries would hold the splash
   * screen for a minute before the user ever reaches the login form.
   */
  attempts?: number;
  /** Override the per-attempt deadline in ms. */
  timeoutMs?: number;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const baseUrl = getApiUrl();
  if (!baseUrl) {
    // No server address in this build — a configuration problem, not a
    // connectivity problem. Say so instead of blaming the user's network.
    netFailureReporter("no-backend-url");
    throw makeNetError("no-backend-url");
  }
  const retryable = IDEMPOTENT_METHODS.has(method.toUpperCase());
  const attempts = Math.max(
    1,
    options?.attempts ?? (retryable ? RETRY_BACKOFF_MS.length + 1 : 1),
  );
  const external = options?.signal;
  let lastKind: NetFailureKind = "unreachable";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Hard network timeout so a stalled connection (common on flaky mobile
    // networks / unreachable host) can NEVER leave the UI hanging forever on a
    // spinner. Without this, fetch() waits indefinitely.
    const timeoutMs =
      options?.timeoutMs ??
      (attempts > 1
        ? (RETRY_TIMEOUTS_MS[attempt] ?? SINGLE_ATTEMPT_TIMEOUT_MS)
        : SINGLE_ATTEMPT_TIMEOUT_MS);
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
    let res: Response | null = null;
    try {
      res = await fetch(`${baseUrl}/api${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // Fetch throws only for network-level failures (DNS, offline, TLS,
      // refused) or an abort (our timeout, or the caller's own signal).
      // Caller-initiated cancellation must propagate quietly and never retry.
      if (external?.aborted) {
        throw err instanceof Error ? err : new Error("Request cancelled");
      }
      if (timedOut) {
        lastKind = "timeout";
      } else {
        // RN reports every transport error as "Network request failed", so ask
        // the OS whether the device is actually offline before choosing the
        // message. The same verdict is handed to NetworkContext so the offline
        // banner can say "can't reach the server" instead of "no network".
        const online = await deviceHasInternet();
        lastKind = online === false ? "offline" : "unreachable";
      }
      const isLastAttempt = attempt === attempts - 1;
      if (!isLastAttempt) {
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
        continue;
      }
      // Only a fully exhausted request counts as an outage, so one flaky
      // packet can no longer paint the whole app as disconnected.
      netFailureReporter(lastKind);
      throw makeNetError(lastKind, baseUrl);
    } finally {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternalAbort);
    }
    if (!res) continue; // unreachable; keeps the compiler happy after `continue`
    // Server reachable — clear any lingering offline state.
    netSuccessReporter();
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (typeof data.detail === "string") detail = data.detail;
      } catch {
        // keep default detail
      }
      throw new ApiError(detail, "http", { status: res.status, baseUrl });
    }
    return res.json();
  }
  netFailureReporter(lastKind);
  throw makeNetError(lastKind, baseUrl);
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

export interface User {
  id: string;
  email?: string;
  name: string;
  bio?: string | null;
  country?: string | null;
  avatar_url?: string | null;
  native_language?: string | null;
  learning_language?: string | null;
  proficiency?: string | null;
  proficiencies?: Record<string, string>;
  teach_languages?: string[];
  learning_languages?: string[];
  age?: number | null;
  interests?: string[];
  gender?: "male" | "female" | null;
  username?: string | null;
  username_changed_at?: string | null;
  is_vip?: boolean;
  is_admin?: boolean;
  is_guest?: boolean;
  vip_tier?: "weekly" | "monthly" | "lifetime" | null;
  active_badge?: { id: string; emoji: string; expires_at?: string | null } | null;
  active_frame?: { id: string; color: string; colors?: string[] | null; animated?: boolean; expires_at?: string | null } | null;
  coins?: number;
  privacy?: Record<string, boolean>;
  hidden_moment_users?: string[];
  blocked_users?: string[];
  in_voice_room?: { room_id: string; name?: string; title?: string; language?: string } | null;
  boosted?: boolean;
  is_online?: boolean;
  followers_count?: number;
  following_count?: number;
  is_following?: boolean;
  follows_me?: boolean;
  streak_count?: number;
  profile_views?: number;
  created_at?: string | null;
  places_to_go?: string | null;
  mbti?: string | null;
  blood_type?: string | null;
  hometown?: string | null;
  occupation?: string | null;
  school?: string | null;
  birthday?: string | null;
  cover_url?: string | null;
  voice_bio_id?: string | null;
  voice_bio_duration_ms?: number | null;
  paid_practice?: boolean;
  practice_rate?: number;
  gift_gate?: boolean;
  gift_gate_min?: number;
}

export interface Visitor extends User {
  visited_at: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  user_ids: string[];
}

export interface ManualCorrection {
  corrected: string;
  note?: string | null;
  by: string;
  by_name: string;
  at: string;
}

export interface ReplyPreview {
  id: string;
  author_id: string;
  author_name: string;
  type?: "text" | "voice" | "image" | "room" | "call" | "sticker" | "system";
  sender?: User | null;
  preview: string;
  duration_ms?: number | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  type?: "text" | "voice" | "image" | "room" | "call" | "sticker" | "system";
  sender?: User | null;
  audio_id?: string | null;
  image_id?: string | null;
  duration_ms?: number | null;
  room_id?: string | null;
  room?: RoomCardInfo | null;
  reactions?: MessageReaction[];
  pinned?: boolean;
  manual_correction?: ManualCorrection | null;
  transcript?: string | null;
  saved_by?: string[];
  practice_by?: string[];
  reply_to?: ReplyPreview | null;
  call_status?: "missed" | "outgoing" | "incoming" | "answered" | null;
  sticker?: string | null;
  created_at: string;
}

export interface ChatMessagePreview {
  text: string;
  sender_id: string;
  created_at: string;
  type?: Message["type"] | "gift";
  call_status?: Message["call_status"];
  duration_ms?: number | null;
  room_id?: string | null;
}

export interface Conversation {
  id: string;
  partner: User | null;
  is_group?: boolean;
  name?: string | null;
  owner_id?: string | null;
  member_count?: number;
  member_ids?: string[];
  members_preview?: User[];
  last_message: ChatMessagePreview | null;
  unread: number;
  muted?: boolean;
  partner_read_at?: string | null;
  updated_at: string;
}

export interface RoomCardInfo {
  id: string;
  title?: string;
  topic?: string | null;
  mode?: "chat" | "music";
  language?: string;
  languages?: string[];
  is_private?: boolean;
  background?: number | null;
  member_count?: number;
  members_preview?: User[];
  host?: User | null;
  created_at?: string;
  is_live: boolean;
}

export interface MomentPollOption {
  text: string;
  votes: number;
}

export interface MomentPoll {
  question?: string | null;
  options: MomentPollOption[];
  total_votes: number;
  my_vote: number | null;
}

export interface Moment {
  id: string;
  author: User | null;
  text: string;
  image_url?: string | null;
  audio_url?: string | null;
  audio_duration_ms?: number | null;
  boosted?: boolean;
  room?: RoomCardInfo | null;
  tags?: string[];
  poll?: MomentPoll | null;
  like_count: number;
  liked_by_me: boolean;
  likers?: User[];
  comment_count: number;
  view_count?: number;
  is_mine?: boolean;
  pinned?: boolean;
  saved?: boolean;
  visibility?: "public" | "friends" | "private";
  created_at: string;
  comments?: MomentComment[];
}

export interface MarketItem {
  id: string;
  type: "vip" | "badge" | "frame";
  name: string;
  emoji: string;
  price: number;
  duration_days: number | null;
  color?: string;
  colors?: string[];
  animated?: boolean;
  desc: string;
  active: boolean;
}

export interface AppNotification {
  id: string;
  type: "like" | "comment" | "reply" | "follow" | "visit" | "announcement";
  moment_id: string | null;
  text: string | null;
  read: boolean;
  created_at: string;
  actor: User | null;
  moment_preview?: {
    text?: string | null;
    image_url?: string | null;
    audio_url?: string | null;
    audio_duration_ms?: number | null;
  } | null;
}

export interface MomentComment {
  id: string;
  author: User | null;
  text: string;
  audio_url?: string | null;
  audio_duration_ms?: number | null;
  reply_to?: string | null;
  reply_to_author?: string | null;
  root_id?: string | null;
  like_count?: number;
  liked_by_me?: boolean;
  reply_count?: number;
  created_at: string;
}

export interface RoomMember extends User {
  stage_invited?: boolean;
  is_moderator?: boolean;
  moderator_invited?: boolean;
  role: "host" | "speaker" | "listener";
  mic_on: boolean;
  hand_raised: boolean;
}

export interface GiftedMember extends User {
  coins: number;
}

export interface RoomPomodoro {
  phase: "focus" | "break";
  focus_min: number;
  break_min: number;
  running: boolean;
  remaining_sec?: number | null;
  ends_at?: string | null;
}

export interface RoomTimeBudget {
  used_seconds: number;
  remaining_seconds: number | null;
  active_rooms: number;
  deadline_at: string | null;
}

export interface RoomTimeAllowance {
  date: string;
  timezone: string;
  resets_at: string;
  server_time: string;
  is_unlimited: boolean;
  limit_seconds: number | null;
  host: RoomTimeBudget;
  listener: RoomTimeBudget;
}

export interface Room {
  moderators?: string[];
  moderator_members?: User[];
  host_present?: boolean;
  id: string;
  title: string;
  language: string;
  languages?: string[];
  topic?: string | null;
  mode?: "chat" | "music" | "study";
  is_private?: boolean;
  background?: number | null;
  announcement?: string | null;
  host: User | null;
  host_level?: number;
  is_live?: boolean;
  members?: RoomMember[];
  members_preview?: User[];
  member_count: number;
  chat_muted?: boolean;
  pomodoro?: RoomPomodoro | null;
  most_gifted?: GiftedMember[];
  top_gifters?: GiftedMember[];
  created_at: string;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  sender: User | null;
  text: string;
  type?: "text" | "system" | "gift";
  gift?: { emoji: string; name: string; to: string } | null;
  created_at: string;
}

export interface RoomGift {
  id: string;
  emoji: string;
  name: string;
  price: number;
}

export const audioUrl = (audioId: string): string =>
  `${getApiUrl()}/api/audio/${audioId}`;

export const mediaUrl = (mediaId: string): string =>
  `${getApiUrl()}/api/media/${mediaId}`;

/** Resolve relative asset paths (e.g. "/api/media/<id>" avatars) to absolute URLs. */
export const assetUrl = (u?: string | null): string | null =>
  !u ? null : u.startsWith("http") || u.startsWith("data:") ? u : `${getApiUrl()}${u}`;
