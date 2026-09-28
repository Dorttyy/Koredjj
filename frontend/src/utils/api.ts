/**
 * Public backend client.
 *
 * The connection engine itself now lives in `src/net/` (address resolution +
 * transport). This module is the stable, app-facing surface: the `api` verbs,
 * the URL helpers and every response type. Keeping the surface unchanged means
 * the rebuilt engine reached all 273 call sites across the app without
 * touching a single screen.
 *
 * - WHERE we connect  -> src/net/server-address.ts
 * - HOW we connect    -> src/net/transport.ts (deadlines, retries, failover)
 * - WHY it failed     -> src/utils/net-diagnostics.ts (classification + copy)
 */

import {
  currentAddress,
  currentAddressSource,
  getManualAddress,
  hydrateServerAddress,
  normalizeAddress,
  setManualAddress,
  type AddressSource,
} from "@/src/net/server-address";
import {
  bindNetworkTelemetry,
  getAuthToken,
  lastTransportFailure,
  probeAddress,
  probeServer,
  send,
  setAuthToken,
  type HealthProbe,
  type RequestOptions,
} from "@/src/net/transport";

/** Base URL every request, socket and media asset is built from ("" when the
 *  build has no server address at all). */
export const getApiUrl = (): string => currentAddress();

export {
  bindNetworkTelemetry,
  currentAddressSource,
  getAuthToken,
  getManualAddress,
  hydrateServerAddress,
  lastTransportFailure,
  normalizeAddress,
  probeAddress,
  probeServer,
  setAuthToken,
  setManualAddress,
};
export type { AddressSource, HealthProbe, RequestOptions };

export const wsUrl = (): string =>
  `${getApiUrl().replace(/^http/, "ws")}/api/ws?token=${getAuthToken()}`;

// Room-based signaling socket for the Pro classroom (WebRTC + in-call chat).
export const proRtcUrl = (room: string): string =>
  `${getApiUrl().replace(/^http/, "ws")}/api/pro/rtc/${room}?token=${getAuthToken()}`;

export const api = {
  get: <T>(path: string, options?: RequestOptions) => send<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => send<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => send<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => send<T>("PATCH", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => send<T>("DELETE", path, undefined, options),
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
