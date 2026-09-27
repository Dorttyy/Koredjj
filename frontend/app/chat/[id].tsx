import * as Clipboard from "expo-clipboard";
import { Ionicons, MaterialCommunityIcons } from "@/src/ui/icons";
import { TranslationIcon } from "@/src/ui/TranslationIcon";
import { genderColors } from "@/src/theme";
import { useExclusiveVoicePlayer } from "@/src/hooks/use-exclusive-voice-player";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Speech from "expo-speech";
import { useLocalSearchParams, useRouter } from "expo-router";
import dayjs from "dayjs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "@/src/components/layout/KeyboardAvoidingView";
import { StatusBar } from "expo-status-bar";

import { Avatar } from "@/src/components/Avatar";
import { BackButton } from "@/src/components/BackButton";
import { BoundedSheet } from "@/src/components/layout/BoundedSheet";
import { requestTranslation, translatedTextStyle } from "@/src/utils/translation";
import { TranslationLanguagePicker } from "@/src/components/TranslationLanguagePicker";
import { TRANSLATION_NAMES } from "@/src/constants/translation-languages";
import { MessageReactionBadges } from "@/src/components/MessageReactionBadges";
import { IconChip } from "@/src/components/IconChip";
import { MessageReactionsPopup, MsgMenuAction } from "@/src/components/MessageReactionsPopup";
import { RoomMomentCard } from "@/src/components/RoomMomentCard";
import { VoiceBubble } from "@/src/components/VoiceBubble";
import { countryToCode } from "@/src/constants/countries";
import { langName } from "@/src/constants/languages";
import { useAuth } from "@/src/context/AuthContext";
import { useCall } from "@/src/context/CallContext";
import { useTheme } from "@/src/context/ThemeContext";
import { useChatSocket } from "@/src/hooks/use-chat-socket";
import { fonts, radius, spacing, ThemeColors } from "@/src/theme";
import { AppTitle } from "@/src/ui/AppTitle";
import { premiumThemeColors } from "@/src/premium/theme";
import { api, audioUrl, Conversation, Message, mediaUrl, User } from "@/src/utils/api";
import { SafeAreaView, useSafeAreaInsets } from "@/src/components/layout/SafeAreaView";

/** RN-web's Alert.alert is a no-op — use window.alert on web so users always see feedback. */
const notify = (title: string, message: string) => {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

const zodiacFor = (birthday?: string | null): string => {
  if (!birthday) return "";
  const parts = birthday.split("-");
  if (parts.length < 3) return "";
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!m || !d) return "";
  const table: [string, number, number][] = [
    ["Capricorn", 1, 19], ["Aquarius", 2, 18], ["Pisces", 3, 20],
    ["Aries", 4, 19], ["Taurus", 5, 20], ["Gemini", 6, 20],
    ["Cancer", 7, 22], ["Leo", 8, 22], ["Virgo", 9, 22],
    ["Libra", 10, 22], ["Scorpio", 11, 21], ["Sagittarius", 12, 21],
    ["Capricorn", 12, 31],
  ];
  const [name, , maxDay] = table[m - 1];
  return d <= maxDay ? name : table[m % 12][0];
};

const dateSeparator = (iso: string): string => {
  const d = dayjs(iso);
  const now = dayjs();
  const t = d.format("HH:mm");
  if (d.isSame(now, "day")) return t;
  if (d.isSame(now.subtract(1, "day"), "day")) return `Yesterday ${t}`;
  return `${d.format("MMM D")} ${t}`;
};

const sameDay = (a?: string, b?: string): boolean =>
  !!a && !!b && dayjs(a).isSame(dayjs(b), "day");

// Compact voice-length label for reply quotes, e.g. 7s -> 07"
const replyDur = (ms?: number | null): string => {
  const s = Math.max(1, Math.round((ms || 0) / 1000));
  return `${s.toString().padStart(2, "0")}"`;
};

// Animated stickers — Google Noto animated emoji (reliable, free, animated GIF).
const STICKERS = [
  "1f602", "1f60d", "1f618", "1f970", "1f923", "1f622",
  "1f62d", "1f621", "1f60e", "1f914", "1f44d", "1f44f",
  "1f64f", "1f389", "1f525", "1f973", "1f60a", "1f634",
  "1f929", "1f97a", "1f44b", "1f92f", "1f631", "1f60b",
];

const stickerUrl = (cp: string): string =>
  `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.gif`;

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const QUICK_EMOJIS = [
  "😊", "😂", "❤️", "👍", "🙏", "😍", "🎉", "😅",
  "🤔", "😢", "🔥", "✨", "🥰", "😎", "👋", "🙌",
  "💯", "😘", "🤗", "😴", "🎂", "☕", "🌟", "😇",
];

const QUICK_TEMPLATES = [
  "Hi! How are you? 😊",
  "Nice to meet you!",
  "Where are you from?",
  "Let's practice languages together!",
  "What are your hobbies?",
  "Sorry, I was busy earlier 🙏",
  "Have a great day! 🌟",
];

const TOPIC_PROMPTS = [
  "How has the internet changed the way we work?",
  "Do you prefer to watch movies alone or with others?",
  "Do you think all information on the internet is true?",
  "Do you like traveling? Where would you go next?",
  "What's a food from your country I should try?",
  "What are you learning these days?",
  "Tell me about a festival in your country.",
  "What's your favorite way to relax?",
];

const CHAT_GIFTS = [
  { key: "rose", name: "Rose", emoji: "🌹", coins: 10 },
  { key: "heart", name: "Heart", emoji: "💖", coins: 20 },
  { key: "star", name: "Star", emoji: "⭐", coins: 30 },
  { key: "crown", name: "Crown", emoji: "👑", coins: 100 },
  { key: "diamond", name: "Diamond", emoji: "💎", coins: 200 },
];

const EMOJI_GRID = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
  "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰",
  "😘", "😗", "😙", "😚", "😋", "😛", "😜", "🤪",
  "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟",
  "😢", "😭", "😤", "😠", "😡", "🤯", "😳", "🥺",
  "😴", "🤗", "🤔", "🤭", "🤫", "🙄", "😬", "😰",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "🤝",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔",
  "🔥", "✨", "🎉", "🎊", "💯", "⭐", "🌟", "💫",
];

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { id, premium } = useLocalSearchParams<{ id: string; premium?: string }>();
  const router = useRouter();
  const { user, setUser } = useAuth();
  const { colors: themeColors } = useTheme();
  // When the chat is opened from the Premium Club, render the exact same
  // screen in the royal-purple + gold palette so the experience feels premium.
  const isPremium = premium === "1";
  const colors = isPremium ? premiumThemeColors : themeColors;
  const { startCall } = useCall();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [fullPartner, setFullPartner] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [trExpanded, setTrExpanded] = useState<Record<string, boolean>>({});
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [translating, setTranslating] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<
    Record<string, { corrected: string; explanation: string }>
  >({});
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [draftFixing, setDraftFixing] = useState(false);
  const [draftHint, setDraftHint] = useState<string | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording" | "stopped">("idle");
  const recStateRef = useRef<"idle" | "recording" | "stopped">("idle");
  recStateRef.current = recState;
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recBars, setRecBars] = useState<number[]>([]);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<
    null | "attach" | "emoji" | "phrases" | "gift" | "translate"
  >(null);
  const [emojiTab, setEmojiTab] = useState<"emoji" | "sticker">("emoji");
  const [phraseTab, setPhraseTab] = useState<"used" | "topics">("used");
  const [customPhrases, setCustomPhrases] = useState<string[]>([]);
  const [giftTab, setGiftTab] = useState<"gift" | "vip" | "card">("gift");
  const [selectedGift, setSelectedGift] = useState<string | null>(null);
  const [trTo, setTrTo] = useState<string>("en");
  const [trInput, setTrInput] = useState("");
  const [trResult, setTrResult] = useState<string | null>(null);
  const [trLoading, setTrLoading] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);
  const [trMoreLanguages, setTrMoreLanguages] = useState(false);
  // Reaction popup state — anchor is measured on long press so we can point
  // the picker to the exact bubble on-screen (Instagram-style).
  const [reactionMsg, setReactionMsg] = useState<Message | null>(null);
  const [reactionAnchor, setReactionAnchor] = useState<
    { x: number; y: number; width: number; height: number } | null
  >(null);
  const bubbleRefs = useRef<Record<string, View | null>>({});
  // Multi-select mode (from the message action sheet).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Manual correction composer (user hand-corrects a message — HelloTalk style).
  const [correctingMsg, setCorrectingMsg] = useState<Message | null>(null);
  const [correctDraft, setCorrectDraft] = useState("");
  const [correctNote, setCorrectNote] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);
  // Paid Practice + Gift Gate: coin/gift-gated conversations.
  const [practice, setPractice] = useState<{
    is_paid_partner: boolean;
    rate: number;
    unlocked: boolean;
    expires_at: string | null;
    is_gift_gate?: boolean;
    gift_min?: number;
    gift_unlocked?: boolean;
  } | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  // Partner's last-read timestamp — drives the "Seen"/"Sent" receipt.
  const [partnerReadAt, setPartnerReadAt] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  // Keeps the list pinned to the newest message. True until the reader
  // scrolls up to browse history, so we never yank them back down.
  const stickToEnd = useRef(true);
  const bubblePressActive = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const [conv, msgs] = await Promise.all([
          api.get<Conversation>(`/chats/${id}`),
          api.get<Message[]>(`/chats/${id}/messages`),
        ]);
        if (!active) return;
        setConversation(conv);
        setPartnerReadAt(conv?.partner_read_at ?? null);
        setMessages(msgs);
        if (conv?.partner?.id) {
          api
            .get<User>(`/users/${conv.partner.id}`)
            .then((p) => active && setFullPartner(p))
            .catch(() => {});
          api
            .get<{
              is_paid_partner: boolean;
              rate: number;
              unlocked: boolean;
              expires_at: string | null;
              is_gift_gate?: boolean;
              gift_min?: number;
              gift_unlocked?: boolean;
            }>(`/practice/status/${conv.partner.id}`)
            .then((s) => active && setPractice(s))
            .catch(() => {});
        }
        api.post(`/chats/${id}/read`).catch(() => {});
      } catch {
        // auth not ready or network error — will retry on next focus
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [id, user]);

  useChatSocket(
    useCallback(
      (event) => {
        if (event.type === "new_message" && event.conversation_id === id && event.message) {
          const msg = event.message as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          );
          api.post(`/chats/${id}/read`).catch(() => {});
        }
        if (
          event.type === "messages_read" &&
          event.conversation_id === id &&
          event.read_at
        ) {
          setPartnerReadAt((prev) =>
            !prev || event.read_at! > prev ? event.read_at! : prev,
          );
        }
        if (
          event.type === "message_reaction" &&
          event.conversation_id === id &&
          event.message
        ) {
          const updated = event.message as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, reactions: updated.reactions } : m)),
          );
        }
        if (
          event.type === "messages_deleted" &&
          event.conversation_id === id &&
          Array.isArray(event.ids)
        ) {
          const ids = event.ids as string[];
          setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
        }
        if (
          event.type === "message_update" &&
          event.conversation_id === id &&
          event.message
        ) {
          const updated = event.message as Message;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? { ...m, pinned: updated.pinned, manual_correction: updated.manual_correction, transcript: updated.transcript }
                : m,
            ),
          );
        }
      },
      [id],
    ),
  );

  // Open reaction picker anchored to the tapped bubble.
  const openReactionPopup = (msg: Message) => {
    const node = bubbleRefs.current[msg.id];
    if (!node) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // measureInWindow gives screen-space coordinates → perfect for a fullscreen Modal.
    (node as any).measureInWindow?.(
      (x: number, y: number, width: number, height: number) => {
        setReactionAnchor({ x, y, width, height });
        setReactionMsg(msg);
      },
    );
  };

  const myReactionFor = (msg: Message): string | undefined => {
    if (!user) return undefined;
    return msg.reactions?.find((r) => r.user_ids.includes(user.id))?.emoji;
  };

  const toggleReaction = async (emoji: string) => {
    if (!reactionMsg) return;
    const target = reactionMsg;
    setReactionMsg(null);
    setReactionAnchor(null);
    // Optimistic update so the bubble reacts instantly.
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== target.id) return m;
        const uid = user?.id || "";
        const currentEmoji = m.reactions?.find((r) => r.user_ids.includes(uid))?.emoji;
        const cleared = (m.reactions || [])
          .map((r) => ({ ...r, user_ids: r.user_ids.filter((x) => x !== uid), count: r.user_ids.filter((x) => x !== uid).length }))
          .filter((r) => r.count > 0);
        if (currentEmoji === emoji) {
          return { ...m, reactions: cleared };
        }
        const existing = cleared.find((r) => r.emoji === emoji);
        const next = existing
          ? cleared.map((r) =>
              r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, uid], count: r.count + 1 } : r,
            )
          : [...cleared, { emoji, user_ids: [uid], count: 1 }];
        return { ...m, reactions: next };
      }),
    );
    try {
      await api.post(`/chats/${id}/messages/${target.id}/react`, { emoji });
    } catch (e) {
      notify("Reaction", e instanceof Error ? e.message : "Could not save reaction. Please retry.");
      // Reconcile with saved server state after a failed optimistic update.
      try {
        const msgs = await api.get<Message[]>(`/chats/${id}/messages`);
        setMessages(msgs);
      } catch {}
    }
  };

  const patchMessage = (msgId: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...patch } : m)));
  };

  const readAloud = (msg: Message) => {
    const text = (msg.transcript || msg.text || "").trim();
    if (!text) return;
    Speech.stop();
    Speech.speak(text, { rate: 0.95 });
    Haptics.selectionAsync().catch(() => {});
  };

  const transcribeVoice = async (msg: Message) => {
    if (!msg.audio_id || transcribing) return;
    if (msg.transcript) {
      // Keep the transcript cached when collapsed; expanding never retranscribes.
      setTrExpanded(prev => ({ ...prev, [msg.id]: !(prev[msg.id] ?? true) }));
      return;
    }
    setTranscribing(msg.id);
    try {
      const res = await api.post<{ text: string }>("/ai/transcribe", {
        audio_id: msg.audio_id,
      });
      patchMessage(msg.id, { transcript: res.text || "(no speech detected)" });
      setTrExpanded(prev => ({ ...prev, [msg.id]: true }));
      Haptics.selectionAsync().catch(() => {});
    } catch (e) {
      notify(
        "Voice to text",
        e instanceof Error ? e.message : "Could not transcribe this voice message.",
      );
    } finally {
      setTranscribing(null);
    }
  };

  const toggleSave = async (msg: Message, kind: "saved" | "practice") => {
    if (!user) return;
    const field = kind === "practice" ? "practice_by" : "saved_by";
    const list = (msg[field] as string[]) || [];
    const active = list.includes(user.id);
    // Optimistic update.
    patchMessage(msg.id, {
      [field]: active ? list.filter((x) => x !== user.id) : [...list, user.id],
    } as Partial<Message>);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try {
      await api.post(`/chats/${id}/messages/${msg.id}/save`, { kind });
    } catch {
      // Revert on failure.
      patchMessage(msg.id, { [field]: list } as Partial<Message>);
    }
  };

  const togglePin = async (msg: Message) => {
    const next = !msg.pinned;
    patchMessage(msg.id, { pinned: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const res = await api.post<Message>(`/chats/${id}/messages/${msg.id}/pin`);
      patchMessage(msg.id, { pinned: res.pinned });
    } catch {
      patchMessage(msg.id, { pinned: msg.pinned });
    }
  };

  // Latest pinned message, surfaced in the banner below the header.
  const pinnedMsg = useMemo(
    () => [...messages].reverse().find((m) => m.pinned),
    [messages],
  );

  const scrollToMessage = (msgId: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx >= 0) {
      stickToEnd.current = false;
      try {
        listRef.current?.scrollToIndex({
          index: idx,
          animated: true,
          viewPosition: 0.4,
        });
      } catch {
        /* handled by onScrollToIndexFailed */
      }
    }
  };

  const openManualCorrection = (msg: Message) => {
    setCorrectingMsg(msg);
    setCorrectDraft(msg.manual_correction?.corrected || msg.text || "");
    setCorrectNote(msg.manual_correction?.note || "");
  };

  const submitManualCorrection = async () => {
    if (!correctingMsg) return;
    const corrected = correctDraft.trim();
    if (!corrected) return;
    setSavingCorrection(true);
    try {
      const res = await api.post<Message>(
        `/chats/${id}/messages/${correctingMsg.id}/correction`,
        { corrected, note: correctNote.trim() || undefined },
      );
      patchMessage(correctingMsg.id, { manual_correction: res.manual_correction });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCorrectingMsg(null);
      setCorrectDraft("");
      setCorrectNote("");
    } catch (e) {
      notify("Correction", e instanceof Error ? e.message : "Could not save correction.");
    } finally {
      setSavingCorrection(false);
    }
  };

  const enterSelectMode = (msg: Message) => {
    setSelectMode(true);
    setSelectedIds([msg.id]);
    setPanel(null);
  };

  const addPhrase = () => {
    const text = draft.trim();
    if (!text) {
      notify("Add a phrase", "Type a phrase in the message box first, then tap Add a phrase.");
      return;
    }
    setCustomPhrases((prev) => (prev.includes(text) ? prev : [text, ...prev]));
    Haptics.selectionAsync().catch(() => {});
  };

  const sendGiftMessage = async () => {
    const gift = CHAT_GIFTS.find((g) => g.key === selectedGift);
    if (!gift || sending) return;
    const myCoins = user?.coins ?? 0;
    const goBuy = (msg: string) =>
      Alert.alert("Not enough coins", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Buy coins", onPress: () => router.push("/coins") },
      ]);
    if (myCoins < gift.coins) {
      goBuy(`This gift costs ${gift.coins} coins. You have ${myCoins}.`);
      return;
    }
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const res = await api.post<{
        ok: boolean;
        message: Message;
        coins: number;
        unlocked: boolean;
      }>(`/chats/${id}/gift`, { gift_id: gift.key });
      stickToEnd.current = true;
      setMessages((prev) => [...prev, res.message]);
      if (user) setUser({ ...user, coins: res.coins });
      if (res.unlocked) {
        setPractice((p) => (p ? { ...p, gift_unlocked: true } : p));
      }
      setPanel(null);
      setSelectedGift(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 402) goBuy(err.message);
      else notify("Gift", err.message || "Could not send the gift.");
    } finally {
      setSending(false);
    }
  };

  const runPanelTranslate = async () => {
    const text = trInput;
    if (!text.trim() || trLoading) return;
    setTrLoading(true);
    setTrError(null);
    setTrResult(null);
    try {
      const res = await requestTranslation({
        text,
        target_language: trTo,
      });
      setTrResult(res.translated);
    } catch (e) {
      setTrError(e instanceof Error ? e.message : "Translation failed. Please retry.");
    } finally {
      setTrLoading(false);
    }
  };

  const toggleSelect = (msgId: string) => {
    setSelectedIds((prev) =>
      prev.includes(msgId) ? prev.filter((x) => x !== msgId) : [...prev, msgId],
    );
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };

  const copySelected = async () => {
    const texts = messages
      .filter((m) => selectedIds.includes(m.id) && m.text)
      .map((m) => m.text);
    if (texts.length) {
      await Clipboard.setStringAsync(texts.join("\n"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    exitSelectMode();
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const ids = [...selectedIds];
    const doDelete = async () => {
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      exitSelectMode();
      try {
        await api.post(`/chats/${id}/messages/delete`, { ids });
      } catch {
        // best-effort; reload on failure
        try {
          const msgs = await api.get<Message[]>(`/chats/${id}/messages`);
          setMessages(msgs);
        } catch {}
      }
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete messages", `Delete ${ids.length} message(s)?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const aiImgBusy = useRef(false);

  const aiVocabFromImage = async (msg: Message) => {
    if (aiImgBusy.current) return;
    if (!msg.image_id) {
      notify("AI Vocab", "This works on photos — stickers aren't supported.");
      return;
    }
    aiImgBusy.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const res = await api.post<{ words: { word: string; translation: string }[] }>(
        "/ai/image-vocab",
        { media_id: msg.image_id },
      );
      if (!res.words.length) {
        notify("AI Vocab", "Couldn't find clear objects to name in this photo.");
      } else {
        notify(
          "AI Vocab",
          res.words.map((w) => `• ${w.word} — ${w.translation}`).join("\n"),
        );
      }
    } catch (e) {
      notify(
        "AI Vocab",
        e instanceof Error ? e.message : "AI is unavailable right now.",
      );
    } finally {
      aiImgBusy.current = false;
    }
  };

  const extractTextFromImage = async (msg: Message) => {
    if (!msg.image_id || aiImgBusy.current) return;
    aiImgBusy.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const res = await api.post<{ text: string; translation: string }>(
        "/ai/image-text",
        { media_id: msg.image_id, target_language: user?.native_language },
      );
      if (!res.text) {
        notify("Extract text", "No readable text found in this photo.");
      } else {
        notify(
          "Extract text & translate",
          `${res.text}\n\n→ ${res.translation || "(no translation)"}`,
        );
      }
    } catch (e) {
      notify(
        "Extract text",
        e instanceof Error ? e.message : "AI is unavailable right now.",
      );
    } finally {
      aiImgBusy.current = false;
    }
  };

  const handleMsgAction = async (action: MsgMenuAction) => {
    if (!reactionMsg) return;
    const target = reactionMsg;
    setReactionMsg(null);
    setReactionAnchor(null);
    switch (action) {
      case "reply": {
        setReplyTarget(target);
        break;
      }
      case "copy":
        if (target.text) {
          await Clipboard.setStringAsync(target.text);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else if (target.type === "image" && target.image_id) {
          await Clipboard.setStringAsync(mediaUrl(target.image_id));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        break;
      case "aiVocab":
        aiVocabFromImage(target);
        break;
      case "extractText":
        extractTextFromImage(target);
        break;
      case "readAloud":
        readAloud(target);
        break;
      case "save":
        toggleSave(target, "saved");
        break;
      case "translate":
        translate(target);
        break;
      case "aiCorrect":
        correctMessage(target);
        break;
      case "correct":
        openManualCorrection(target);
        break;
      case "practice":
        toggleSave(target, "practice");
        break;
      case "pin":
        togglePin(target);
        break;
      case "multiSelect":
        enterSelectMode(target);
        break;
      case "recall":
        recallMessage(target);
        break;
      case "transcription":
        transcribeVoice(target);
        break;
      case "share":
        try {
          const shareBody =
            target.type === "voice" && target.audio_id
              ? `Voice message: ${audioUrl(target.audio_id)}`
              : target.type === "image" && target.image_id
                ? `Photo: ${mediaUrl(target.image_id)}`
                : target.text || "";
          if (shareBody) {
            await Share.share({ message: shareBody });
          }
        } catch {
          /* user dismissed the share sheet */
        }
        break;
      case "delete":
        deleteSelectedById([target.id]);
        break;
    }
  };

  const recallMessage = (msg: Message) => {
    const doRecall = async () => {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      try {
        await api.post(`/chats/${id}/messages/delete`, { ids: [msg.id] });
      } catch {}
    };
    if (Platform.OS === "web") {
      doRecall();
    } else {
      Alert.alert("Recall message", "Recall (unsend) this message for everyone?", [
        { text: "Cancel", style: "cancel" },
        { text: "Recall", style: "destructive", onPress: doRecall },
      ]);
    }
  };

  const deleteSelectedById = (ids: string[]) => {
    const doDelete = async () => {
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      try {
        await api.post(`/chats/${id}/messages/delete`, { ids });
      } catch {}
    };
    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Delete message", "Delete this message?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  useEffect(() => {
    if (messages.length > 0 && stickToEnd.current) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    if (recState !== "recording") return;
    const t = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    const w = setInterval(
      () =>
        setRecBars((prev) => [
          ...prev.slice(-13),
          4 + Math.round(Math.random() * 12),
        ]),
      150,
    );
    return () => {
      clearInterval(t);
      clearInterval(w);
    };
  }, [recState]);

  const sendSticker = async (cp: string) => {
    setPanel(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const msg = await api.post<Message>(`/chats/${id}/sticker`, {
        sticker: cp,
      });
      stickToEnd.current = true;
      setMessages((prev) => [...prev, msg]);
      setReplyTarget(null);
    } catch {
      notify("Sticker", "Couldn't send sticker. Try again.");
    }
  };

  const send = async () => {    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const msg = await api.post<Message>(`/chats/${id}/messages`, {
        text,
        reply_to_id: replyTarget?.id,
      });
      stickToEnd.current = true;
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      setReplyTarget(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 402) {
        const msg = err.message || "";
        if (msg.startsWith("gift_gate:")) {
          // Recipient requires a gift before chatting — open the gift panel.
          setPractice((p) =>
            p ? { ...p, is_gift_gate: true, gift_unlocked: false } : p,
          );
          setPanel("gift");
          notify("Gift required", msg.replace("gift_gate:", ""));
        } else {
          // Partner is a paid-practice partner — reflect the lock and prompt.
          setPractice((p) =>
            p ? { ...p, is_paid_partner: true, unlocked: false } : p,
          );
          handleUnlock();
        }
      } else {
        notify("Message", err.message || "Could not send the message.");
      }
    } finally {
      setSending(false);
    }
  };

  // Paid Practice: buy a 24h unlock (coins) for this partner.
  const handleUnlock = async () => {
    const pid = conversation?.partner?.id;
    if (!pid || unlocking) return;
    const rate = practice?.rate ?? 50;
    const myCoins = user?.coins ?? 0;
    const goBuy = (msg: string) =>
      Alert.alert("Not enough coins", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Buy coins", onPress: () => router.push("/coins") },
      ]);
    if (myCoins < rate) {
      goBuy(
        `You need ${rate} coins to unlock practice with ${conversation?.partner?.name || "this partner"}.`,
      );
      return;
    }
    setUnlocking(true);
    try {
      const res = await api.post<{
        ok: boolean;
        expires_at: string;
        coins: number;
      }>(`/practice/unlock/${pid}`);
      setPractice((p) =>
        p ? { ...p, unlocked: true, expires_at: res.expires_at } : p,
      );
      if (user) setUser({ ...user, coins: res.coins });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 402) goBuy(err.message);
      else notify("Unlock failed", err.message || "Please try again.");
    } finally {
      setUnlocking(false);
    }
  };

  const startRecording = async () => {
    try {
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted) {
        perm = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!perm.granted) {
        if (Platform.OS !== "web" && !perm.canAskAgain) {
          Alert.alert(
            "Microphone",
            "Microphone access is disabled. Enable it in Settings to send voice messages.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          notify(
            "Microphone",
            "Microphone permission is needed to record voice messages. Please allow microphone access and try again.",
          );
        }
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordSeconds(0);
      setRecBars([]);
      setRecState("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setRecState("idle");
      notify(
        "Microphone",
        "Could not start recording. Make sure a microphone is available and allowed, then try again.",
      );
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
    } catch {
      // already stopped
    }
    setRecState("stopped");
  };

  const cancelRecording = async () => {
    try {
      await recorder.stop();
    } catch {
      // already stopped
    }
    setRecState("idle");
    setRecordSeconds(0);
    setRecBars([]);
  };

  const encodeAudio = async (uri: string): Promise<string> => {
    if (Platform.OS === "web") {
      const blob = await fetch(uri).then((r) => r.blob());
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  };

  const sendVoice = async () => {
    const durationMs = recordSeconds * 1000;
    setRecState("idle");
    setRecBars([]);
    setUploadingVoice(true);
    try {
      if (recStateRef.current === "recording") {
        try {
          await recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording");
      const base64 = await encodeAudio(uri);
      const mime = Platform.OS === "web" ? "audio/webm" : "audio/m4a";
      const msg = await api.post<Message>(`/chats/${id}/voice`, {
        audio_base64: base64,
        mime,
        duration_ms: Math.max(durationMs, 1000),
        reply_to_id: replyTarget?.id,
      });
      stickToEnd.current = true;
      setMessages((prev) => [...prev, msg]);
      setReplyTarget(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      notify("Voice message", "Could not send the voice message. Try again.");
    } finally {
      setUploadingVoice(false);
    }
  };

  const pickImage = async () => {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!current.granted) {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            "Photos",
            "Photo access is disabled. Enable it in Settings to share photos.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert("Photos", "Photo access is needed to share images in chat.");
        }
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    setUploadingImage(true);
    try {
      const msg = await api.post<Message>(`/chats/${id}/image`, {
        image_base64: asset.base64,
        mime: asset.mimeType || "image/jpeg",
      });
      stickToEnd.current = true;
      setMessages((prev) => [...prev, msg]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      notify("Photo", "Could not send the photo. Try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const translate = async (msg: Message) => {
    // Once fetched, the translation is cached — tapping again just toggles the
    // expanded/collapsed view (via the chevron) instead of re-fetching.
    if (translations[msg.id]) {
      setTrExpanded((prev) => ({
        ...prev,
        [msg.id]: !(prev[msg.id] ?? true),
      }));
      return;
    }
    setTranslating(msg.id);
    try {
      const result = await requestTranslation({
        text: msg.transcript || msg.text,
        target_language: user?.native_language || "en",
      });
      setTranslations((prev) => ({ ...prev, [msg.id]: result.translated }));
      setTrExpanded((prev) => ({ ...prev, [msg.id]: true }));
    } catch (e) {
      notify(
        "Translate",
        e instanceof Error ? e.message : "Translation failed. Try again.",
      );
    } finally {
      setTranslating(null);
    }
  };

  const correctMessage = async (msg: Message) => {
    if (corrections[msg.id]) {
      setCorrections((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }
    setCorrecting(msg.id);
    try {
      const res = await api.post<{ corrected: string; explanation: string }>(
        "/ai/correct",
        { text: msg.text },
      );
      setCorrections((prev) => ({ ...prev, [msg.id]: res }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      notify(
        "Correction",
        e instanceof Error ? e.message : "Correction failed. Try again.",
      );
    } finally {
      setCorrecting(null);
    }
  };

  const fixDraft = async () => {
    const text = draft.trim();
    if (!text || draftFixing) return;
    setDraftFixing(true);
    try {
      const res = await api.post<{ corrected: string; explanation: string }>(
        "/ai/correct",
        { text },
      );
      if (res.corrected && res.corrected !== text) {
        setDraft(res.corrected);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setDraftHint(res.explanation || "Looks perfect!");
      setTimeout(() => setDraftHint(null), 6000);
    } catch (e) {
      notify(
        "AI Check",
        e instanceof Error ? e.message : "Could not check the text. Try again.",
      );
    } finally {
      setDraftFixing(false);
    }
  };

  const partner = conversation?.partner;
  const isGroup = !!conversation?.is_group;

  const momentsHidden = !!(
    partner?.id && (user?.hidden_moment_users || []).includes(partner.id)
  );
  const isBlocked = !!(
    partner?.id && (user?.blocked_users || []).includes(partner.id)
  );
  // Paid Practice gate: partner charges coins and I haven't unlocked yet.
  const practiceLocked = !isGroup && !!practice?.is_paid_partner && !practice.unlocked;
  // Gift gate: partner requires a gift before I can message them.
  const giftLocked = !isGroup && !!practice?.is_gift_gate && !practice.gift_unlocked;
  // Combined input lock — either gate blocks the composer.
  const inputLocked = practiceLocked || giftLocked;
  // Index of my most-recent message — the only one that shows a read receipt.
  const lastMineIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].sender_id === user?.id && messages[i].type !== "system") {
        return i;
      }
    }
    return -1;
  }, [messages, user?.id]);

  const toggleMuteChat = async () => {
    try {
      const res = await api.post<{ muted: boolean }>(`/chats/${id}/mute`);
      setConversation((prev) => (prev ? { ...prev, muted: res.muted } : prev));
    } catch {
      // ignore
    }
  };

  const toggleHideMoments = async () => {
    if (!partner?.id) return;
    try {
      const res = await api.post<{ hidden: boolean }>(
        `/users/${partner.id}/hide-moments`,
      );
      if (user) {
        const list = user.hidden_moment_users || [];
        setUser({
          ...user,
          hidden_moment_users: res.hidden
            ? [...list, partner.id]
            : list.filter((x) => x !== partner.id),
        });
      }
    } catch {
      // ignore
    }
  };

  const toggleBlock = () => {
    if (!partner?.id) return;
    const doToggle = async () => {
      try {
        const res = await api.post<{ blocked: boolean }>(
          `/users/${partner.id}/block`,
        );
        if (user) {
          const list = user.blocked_users || [];
          setUser({
            ...user,
            blocked_users: res.blocked
              ? [...list, partner.id]
              : list.filter((x) => x !== partner.id),
          });
        }
        setMenuOpen(false);
      } catch {
        // ignore
      }
    };
    if (isBlocked) {
      doToggle();
    } else {
      Alert.alert(
        "Block user",
        `${partner.name} won't be able to message you anymore.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Block", style: "destructive", onPress: doToggle },
        ],
      );
    }
  };

  const clearHistory = () => {
    Alert.alert("Clear chat history", "All messages will be deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/chats/${id}/messages`);
            setMessages([]);
            setMenuOpen(false);
          } catch {
            // ignore
          }
        },
      },
    ]);
  };

  const info = fullPartner || partner;
  const chips: { icon?: IconName; iconColor?: string; label: string }[] = [];
  if (info) {
    const z = zodiacFor(info.birthday);
    if (z) chips.push({ icon: "planet", iconColor: "#0E9AE0", label: z });
    if (info.blood_type)
      chips.push({ icon: "water", iconColor: "#EF4444", label: info.blood_type });
    if (info.mbti) chips.push({ label: info.mbti });
    (info.interests || []).slice(0, 6).forEach((i: string) => chips.push({ label: i }));
    if (info.hometown) chips.push({ label: info.hometown });
    if (info.places_to_go) chips.push({ label: info.places_to_go });
  }

  const partnerCard = partner ? (
    <Pressable
      testID="chat-intro-card"
      style={styles.partnerCard}
      onPress={() => router.push(`/user/${partner.id}`)}
    >
      <View style={styles.partnerTop}>
        <Avatar
          name={partner.name}
          url={partner.avatar_url}
          size={56}
          flagCode={countryToCode(partner.country)}
          online={partner.is_online}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.partnerNameRow}>
            <Text style={styles.partnerName} numberOfLines={1}>
              {partner.name}
            </Text>
            {partner.gender ? (
              <View
                style={[
                  styles.genderPill,
                  { backgroundColor: partner.gender === "female" ? genderColors.femaleBackground : genderColors.maleBackground },
                ]}
              >
                <Ionicons
                  name={partner.gender === "female" ? "female" : "male"}
                  size={11}
                  color="#FFFFFF"
                />
                {partner.age ? (
                  <Text style={[styles.genderPillText, { color: partner.gender === "female" ? genderColors.female : genderColors.male }]}>{partner.age}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={styles.partnerSub}>
            Native {langName(partner.native_language)} · Learning{" "}
            {langName(partner.learning_language)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
      </View>
      {partner.bio ? (
        <Text style={styles.partnerBio} numberOfLines={2}>
          {partner.bio}
        </Text>
      ) : null}
      {chips.length > 0 ? (
        <View style={styles.chipsWrap}>
          {chips.map((c, i) => (
            <View key={`${c.label}-${i}`} style={styles.introChip}>
              {c.icon ? (
                <Ionicons name={c.icon} size={12} color={c.iconColor} />
              ) : null}
              <Text style={styles.introChipText}>{c.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="chat-screen">
      {isPremium && <StatusBar style="light" />}
      <View style={styles.header}>
        <BackButton testID="chat-back-btn" />
        {isGroup && (
          <>
            <Pressable
              testID="chat-group-header"
              style={styles.headerInfo}
              onPress={() => router.push(`/group-settings/${id}`)}
            >
              <AppTitle variant="conversation" testID="chat-header-name" style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
                {conversation?.name}
              </AppTitle>
              <Text style={styles.headerStatus}>
                Group members ({conversation?.member_count || 0})
              </Text>
            </Pressable>
            <IconChip
              testID="chat-group-menu-btn"
              tint="brand"
              icon="ellipsis-horizontal"
              size={20}
              onPress={() => router.push(`/group-settings/${id}`)}
            />
          </>
        )}
        {partner && (
          <>
            <Pressable
              testID="chat-partner-header"
              style={styles.headerInfo}
              onPress={() => router.push(`/user/${partner.id}`)}
            >
              <AppTitle variant="conversation" testID="chat-header-name" style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
                {partner.name}
              </AppTitle>
              <Text style={styles.headerStatus}>
                {partner.is_online ? "Active now" : "Offline"}
              </Text>
            </Pressable>
            <IconChip
              testID="chat-call-btn"
              tint="brand"
              icon="call"
              size={19}
              onPress={() => startCall(partner)}
            />
            <IconChip
              testID="chat-menu-btn"
              tint="brand"
              icon="ellipsis-horizontal"
              size={20}
              onPress={() => setMenuOpen(true)}
            />
          </>
        )}
      </View>

      {pinnedMsg && !selectMode && (
        <Pressable
          testID="pinned-bar"
          style={styles.pinnedBar}
          onPress={() => scrollToMessage(pinnedMsg.id)}
        >
          <MaterialCommunityIcons
            name="pin"
            size={16}
            color={colors.brand}
            style={{ transform: [{ rotate: "45deg" }] }}
          />
          <View style={styles.pinnedBody}>
            <Text style={styles.pinnedTitle}>Pinned message</Text>
            <Text style={styles.pinnedText} numberOfLines={1}>
              {pinnedMsg.type === "voice"
                ? "Voice message"
                : pinnedMsg.type === "image"
                  ? "Photo"
                  : pinnedMsg.text}
            </Text>
          </View>
          <Pressable
            testID="pinned-unpin"
            onPress={() => togglePin(pinnedMsg)}
            hitSlop={10}
          >
            <Ionicons name="close" size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
        </Pressable>
      )}

      {selectMode && (
        <View style={styles.selectBar} testID="chat-select-bar">
          <Pressable testID="select-cancel" onPress={exitSelectMode} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.selectCount}>{selectedIds.length} selected</Text>
          <Pressable testID="select-copy" style={styles.selectAction} onPress={copySelected}>
            <Ionicons name="copy-outline" size={20} color={colors.brand} />
            <Text style={styles.selectActionText}>Copy</Text>
          </Pressable>
          <Pressable testID="select-delete" style={styles.selectAction} onPress={deleteSelected}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
            <Text style={[styles.selectActionText, { color: colors.error }]}>Delete</Text>
          </Pressable>
        </View>
      )}

      <Modal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable
            style={[styles.menuCard, { paddingBottom: spacing.xxl + insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>{partner?.name}</Text>
              <Pressable
                testID="chat-menu-close-btn"
                onPress={() => setMenuOpen(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={24} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
            <Pressable
              testID="chat-menu-profile"
              style={styles.menuRow}
              onPress={() => {
                setMenuOpen(false);
                if (partner?.id) router.push(`/user/${partner.id}`);
              }}
            >
              <Ionicons name="person-circle-outline" size={22} color={colors.brand} />
              <Text style={styles.menuText}>View profile</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceSecondary} />
            </Pressable>
            <Pressable
              testID="chat-menu-mute"
              style={styles.menuRow}
              onPress={toggleMuteChat}
            >
              <Ionicons
                name={conversation?.muted ? "notifications-off" : "notifications-outline"}
                size={21}
                color={colors.brand}
              />
              <Text style={styles.menuText}>
                {conversation?.muted ? "Unmute notifications" : "Mute notifications"}
              </Text>
              <View style={[styles.menuToggle, conversation?.muted && styles.menuToggleOn]}>
                <View style={[styles.menuThumb, conversation?.muted && styles.menuThumbOn]} />
              </View>
            </Pressable>
            <Pressable
              testID="chat-menu-hide-moments"
              style={styles.menuRow}
              onPress={toggleHideMoments}
            >
              <Ionicons
                name={momentsHidden ? "eye-off" : "eye-off-outline"}
                size={21}
                color={colors.brand}
              />
              <Text style={styles.menuText}>
                {momentsHidden ? "Show their Moments" : "Hide their Moments"}
              </Text>
              <View style={[styles.menuToggle, momentsHidden && styles.menuToggleOn]}>
                <View style={[styles.menuThumb, momentsHidden && styles.menuThumbOn]} />
              </View>
            </Pressable>
            <Pressable
              testID="chat-menu-clear"
              style={styles.menuRow}
              onPress={clearHistory}
            >
              <Ionicons name="trash-outline" size={21} color={colors.brand} />
              <Text style={styles.menuText}>Clear chat history</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceSecondary} />
            </Pressable>
            <Pressable
              testID="chat-menu-block"
              style={styles.menuRow}
              onPress={toggleBlock}
            >
              <Ionicons name="ban" size={21} color={colors.error} />
              <Text style={[styles.menuText, { color: colors.error }]}>
                {isBlocked ? "Unblock user" : "Block user"}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceSecondary} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "web" ? undefined : "translate-with-padding"}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.brand} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            testID="chat-message-list"
            style={{ flex: 1, minHeight: 0 }}
            keyboardShouldPersistTaps="handled"
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            ListHeaderComponent={partnerCard}
            onScrollToIndexFailed={(info) => {
              // Row not measured yet — approximate, then retry once.
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: true,
              });
            }}
            onContentSizeChange={() => {
              // Fires whenever bubbles/avatars/images finish measuring, so
              // the chat reliably opens pinned to the newest message.
              if (stickToEnd.current && !bubblePressActive.current && !reactionMsg) {
                listRef.current?.scrollToEnd({ animated: false });
              }
            }}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } =
                e.nativeEvent;
              const distanceFromBottom =
                contentSize.height -
                layoutMeasurement.height -
                contentOffset.y;
              // Reading history? Stop auto-snapping until back near the end.
              stickToEnd.current = distanceFromBottom < 120;
            }}
            scrollEventThrottle={32}
            ListEmptyComponent={
              <View style={styles.center}>
                <Ionicons name="hand-left-outline" size={48} color={colors.borderStrong} />
                <Text style={styles.emptyText}>
                  Say hello to {partner?.name?.split(" ")[0]}!
                </Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === user?.id;
              const translated = translations[item.id];
              const trOpen = !!translated && (trExpanded[item.id] ?? true);
              const hasTranscript = !!item.transcript;
              const voiceShown = hasTranscript && (trExpanded[item.id] ?? true);
              const correction = corrections[item.id];
              const isVoice = item.type === "voice" && item.audio_id;
              const isImage = item.type === "image" && item.image_id;
              const isRoomShare = item.type === "room" && item.room;
              const isCall = item.type === "call";
              const isSticker = item.type === "sticker" && item.sticker;
              const prev = messages[index - 1];
              // Centered time separator (HelloTalk style): shown at the start of
              // the thread, on a new day, or when there is a noticeable gap
              // (>= 5 min) since the previous message. The time is NEVER shown
              // inside the bubbles — only in these centered separators.
              const gapMins = prev
                ? dayjs(item.created_at).diff(dayjs(prev.created_at), "minute")
                : Infinity;
              const showTimeSep =
                !prev ||
                !sameDay(prev.created_at, item.created_at) ||
                gapMins >= 5;
              // Avatar grouping (WhatsApp/HelloTalk style): the partner's avatar
              // is shown only on the FIRST message of a consecutive run from the
              // same sender. Subsequent messages in that run leave a spacer so
              // the bubbles stay aligned. A time separator or a switch of sender
              // starts a fresh group and shows the avatar again.
              const showAvatar =
                !mine &&
                (!prev || prev.sender_id !== item.sender_id || showTimeSep);
              // Only the most recent partner (received) message gets the side
              // translate / transcribe affordance — matches HelloTalk's UX
              // where the icon lives next to the newest incoming reply.
              const isLastPartnerMsg = (() => {
                if (mine) return false;
                for (let i = messages.length - 1; i > index; i -= 1) {
                  if (messages[i].sender_id !== user?.id) return false;
                }
                return true;
              })();
              const setBubbleRef = (node: View | null) => {
                bubbleRefs.current[item.id] = node;
              };
              const openReactions = () => openReactionPopup(item);
              const selected = selectedIds.includes(item.id);
              const onBubblePress = () => {
                if (selectMode) {
                  toggleSelect(item.id);
                  return;
                }
                if (!isImage) {
                  // Tap any message to translate it into your native language
                  // (tap again to hide the translation). Voice notes are
                  // transcribed first so there is text to translate.
                  if (isVoice && !item.transcript) {
                    transcribeVoice(item);
                  } else if (item.transcript || item.text) {
                    translate(item);
                  }
                  return;
                }
                if (isImage && item.image_id) {
                  // Tap opens the full-screen photo viewer (long-press keeps
                  // the AI action sheet).
                  router.push({
                    pathname: "/photo-viewer",
                    params: {
                      uri: mediaUrl(item.image_id),
                      mediaId: item.image_id,
                      cid: String(id),
                      mid: item.id,
                      saved: (item.saved_by || []).includes(user?.id || "")
                        ? "1"
                        : "0",
                    },
                  });
                }
              };
              // Incoming special messages (calls, stickers) follow the same
              // avatar grouping as text bubbles: the partner's avatar shows on
              // the FIRST message of a consecutive run and a spacer keeps the
              // rest aligned. Outgoing ones simply hug the right edge.
              const withAvatarRow = (content: React.ReactNode) =>
                mine ? (
                  <View style={styles.specialRowMine}>{content}</View>
                ) : (
                  <View style={styles.specialRowTheirs}>
                    {showAvatar ? (
                      <View style={styles.avatarWrap}>
                        <Avatar
                          name={(isGroup ? item.sender?.name : partner?.name) || ""}
                          url={
                            isGroup ? item.sender?.avatar_url : partner?.avatar_url
                          }
                          size={40}
                          flagCode={countryToCode(
                            isGroup ? item.sender?.country : partner?.country,
                          )}
                        />
                      </View>
                    ) : (
                      <View style={styles.avatarSpacer} />
                    )}
                    {content}
                  </View>
                );
              return (
                <>
                  {showTimeSep && (
                    <Text style={styles.dateSep}>
                      {dateSeparator(item.created_at)}
                    </Text>
                  )}
                  {item.type === "system" ? (
                    <Text style={styles.systemMsg} testID={`system-msg-${item.id}`}>
                      {item.text}
                    </Text>
                  ) : isSticker ? (
                    withAvatarRow(
                      <Pressable
                        ref={setBubbleRef}
                        testID={`chat-sticker-bubble-${item.id}`}
                        onPress={() =>
                          selectMode ? toggleSelect(item.id) : openReactions()
                        }
                        onLongPress={openReactions}
                        onPressIn={() => { bubblePressActive.current = true; }}
                        onPressOut={() => { bubblePressActive.current = false; }}
                        delayLongPress={220}
                        style={[
                          styles.stickerMsg,
                          selected && styles.bubbleSelected,
                          !!item.reactions?.length && styles.reactedBubble,
                        ]}
                      >
                        <Image
                          source={{ uri: stickerUrl(item.sticker!) }}
                          style={styles.stickerMsgImg}
                          contentFit="contain"
                        />
                        <MessageReactionBadges messageId={item.id} reactions={item.reactions} mine={mine} />
                      </Pressable>,
                    )
                  ) : isCall ? (
                    withAvatarRow(
                      <View style={styles.callRow}>
                        <View style={styles.callCard}>
                        <View
                          style={[
                            styles.callIconWrap,
                            item.call_status === "missed" && styles.callIconMissed,
                          ]}
                        >
                          <Ionicons
                            name={
                              item.call_status === "missed"
                                ? "call"
                                : mine
                                  ? "call-outline"
                                  : "call"
                            }
                            size={18}
                            color={
                              item.call_status === "missed"
                                ? colors.error
                                : colors.brand
                            }
                          />
                        </View>
                        <View style={styles.callBody}>
                          <Text style={styles.callTitle}>
                            {item.text || "Voice Call"}
                          </Text>
                          <Text
                            style={[
                              styles.callStatus,
                              item.call_status === "missed" && {
                                color: colors.error,
                              },
                            ]}
                          >
                            {item.call_status === "missed"
                              ? mine
                                ? "Call cancelled"
                                : "Missed call"
                              : item.duration_ms
                                ? `${Math.floor(item.duration_ms / 60000)}:${Math.floor(
                                    (item.duration_ms % 60000) / 1000,
                                  )
                                    .toString()
                                    .padStart(2, "0")}`
                                : mine
                                  ? "Outgoing call"
                                  : "Incoming call"}
                          </Text>
                        </View>
                      </View>
                    </View>,
                    )
                  ) : isRoomShare ? (
                    <View style={styles.roomShareRow}>
                      <Pressable
                        ref={setBubbleRef}
                        testID={`chat-room-bubble-${item.id}`}
                        onLongPress={openReactions}
                        onPressIn={() => { bubblePressActive.current = true; }}
                        onPressOut={() => { bubblePressActive.current = false; }}
                        delayLongPress={220}
                        style={[styles.roomShareBubble, !!item.reactions?.length && styles.reactedBubble]}
                      >
                        {item.text ? (
                          <Text style={styles.roomShareCaption}>{item.text}</Text>
                        ) : null}
                        <RoomMomentCard
                          testID={`room-share-${item.id}`}
                          room={item.room!}
                          onPress={() => {
                            if (item.room?.id && item.room?.is_live) {
                              router.push(`/room/${item.room.id}`);
                            }
                          }}
                        />
                        <MessageReactionBadges messageId={item.id} reactions={item.reactions} mine={mine} />
                      </Pressable>
                    </View>
                  ) : (
                  <View
                    style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}
                  >
                    {!mine &&
                      (showAvatar ? (
                        <View style={styles.avatarWrap}>
                          <Avatar
                            name={(isGroup ? item.sender?.name : partner?.name) || ""}
                            url={isGroup ? item.sender?.avatar_url : partner?.avatar_url}
                            size={40}
                            flagCode={countryToCode(
                              isGroup ? item.sender?.country : partner?.country,
                            )}
                          />
                        </View>
                      ) : (
                        <View style={styles.avatarSpacer} />
                      ))}
                    <Pressable
                      ref={setBubbleRef}
                      testID={`chat-message-bubble-${item.type || "text"}-${item.id}`}
                      onLongPress={openReactions}
                      onPressIn={() => { bubblePressActive.current = true; }}
                      onPressOut={() => { bubblePressActive.current = false; }}
                      onPress={onBubblePress}
                      delayLongPress={220}
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleTheirs,
                        selected && styles.bubbleSelected,
                        !!item.reactions?.length && styles.reactedBubble,
                      ]}
                    >
                    {item.reply_to && (
                      <View style={styles.replyQuote}>
                        <View style={styles.replyBar} />
                        <View style={styles.replyBody}>
                          <Text style={styles.replyName} numberOfLines={1}>
                            {item.reply_to.author_id === user?.id
                              ? "You"
                              : item.reply_to.author_name}
                          </Text>
                          {item.reply_to.type === "voice" ? (
                            <View style={styles.replyVoiceRow}>
                              <Ionicons
                                name="volume-medium"
                                size={15}
                                color={colors.onSurface}
                              />
                              <Text style={styles.replyPreview}>
                                {replyDur(item.reply_to.duration_ms)}
                              </Text>
                            </View>
                          ) : (
                            <Text style={styles.replyPreview} numberOfLines={1}>
                              {item.reply_to.type === "image"
                                ? "Photo"
                                : item.reply_to.preview}
                            </Text>
                          )}
                        </View>
                      </View>
                    )}
                    {isVoice ? (
                      <VoiceBubble
                        testID={`voice-bubble-${item.id}`}
                        audioId={item.audio_id!}
                        durationMs={item.duration_ms}
                        mine={mine}
                        colors={isPremium ? colors : undefined}
                      />
                    ) : isImage ? (
                      <Image
                        testID={`image-bubble-${item.id}`}
                        source={{ uri: mediaUrl(item.image_id!) }}
                        style={styles.imageBubble}
                        contentFit="cover"
                        transition={150}
                      />
                    ) : (
                      <View style={translated ? styles.origUnderline : undefined}>
                        <Text
                          style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                        >
                          {item.text}
                        </Text>
                      </View>
                    )}
                    {voiceShown ? (
                      <View style={styles.voiceTranscriptBox}>
                        <Text style={styles.bubbleText}>{item.transcript}</Text>
                      </View>
                    ) : null}
                    {trOpen && (
                      <View style={styles.aiTransBox}>
                        <Text style={styles.aiLabel}>AI</Text>
                        <Text testID={`message-translation-${item.id}`} style={[styles.aiTransText, translatedTextStyle(translated)]}>{translated}</Text>
                      </View>
                    )}
                    {correction && (
                      <View style={styles.correctionBox}>
                        <View style={styles.correctionHeader}>
                          <Ionicons
                            name="school"
                            size={12}
                            color={colors.success}
                          />
                          <Text
                            style={[
                              styles.correctionLabel,
                              mine && { color: colors.onSurfaceSecondary },
                            ]}
                          >
                            Corrected
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.correctionText,
                            mine && styles.bubbleTextMine,
                          ]}
                        >
                          {correction.corrected === item.text
                            ? "✓ No mistakes found"
                            : correction.corrected}
                        </Text>
                        {correction.explanation ? (
                          <Text
                            style={[
                              styles.correctionExplain,
                              mine && { color: colors.onSurfaceSecondary },
                            ]}
                          >
                            {correction.explanation}
                          </Text>
                        ) : null}
                      </View>
                    )}
                    {item.manual_correction && (
                      <View style={styles.manualBox}>
                        <View style={styles.correctionHeader}>
                          <Ionicons
                            name="create"
                            size={12}
                            color={colors.brand}
                          />
                          <Text
                            style={[
                              styles.manualLabel,
                              mine && { color: colors.brand },
                            ]}
                          >
                            Correction · {item.manual_correction.by_name}
                          </Text>
                        </View>
                        <Text
                          style={[styles.manualText, mine && styles.bubbleTextMine]}
                        >
                          {item.manual_correction.corrected}
                        </Text>
                        {item.manual_correction.note ? (
                          <Text
                            style={[
                              styles.correctionExplain,
                              mine && { color: colors.onSurfaceSecondary },
                            ]}
                          >
                            {item.manual_correction.note}
                          </Text>
                        ) : null}
                      </View>
                    )}
                    {item.pinned && (
                      <View style={styles.bubbleFooter}>
                        <MaterialCommunityIcons
                          name="pin"
                          size={12}
                          color={colors.brand}
                          style={{ transform: [{ rotate: "45deg" }] }}
                        />
                      </View>
                    )}
                    <MessageReactionBadges messageId={item.id} reactions={item.reactions} mine={mine} />
                  </Pressable>
                    {!mine && !selectMode && (isVoice || (!isImage && !!item.text && (isLastPartnerMsg || !!translated))) &&
                      (isVoice ? (
                        hasTranscript ? (
                          <View style={styles.trCtrlV}>
                            {voiceShown && <>
                            <Pressable
                              testID={`side-speak-btn-${item.id}`}
                              style={styles.trBtn}
                              onPress={() => readAloud(item)}
                              hitSlop={6}
                            >
                              <Ionicons
                                name="volume-high"
                                size={17}
                                color={colors.onSurfaceSecondary}
                              />
                            </Pressable>
                            <Pressable
                              testID={`side-translate-btn-${item.id}`}
                              style={styles.trBtn}
                              onPress={() => translate(item)}
                              hitSlop={6}
                            >
                              {translating === item.id ? (
                                <ActivityIndicator
                                  size="small"
                                  color={colors.brand}
                                />
                              ) : (
                                <TranslationIcon testID={`side-translate-icon-${item.id}`} size={17}
                                  color={translated ? colors.brand : colors.onSurfaceSecondary} />
                              )}
                            </Pressable>
                            </>}
                            <Pressable
                              testID={`side-collapse-btn-${item.id}`}
                              accessibilityLabel={voiceShown ? "Collapse voice translation" : "Expand voice translation"}
                              accessibilityState={{ expanded: voiceShown }}
                              style={styles.trBtn}
                              onPress={() =>
                                setTrExpanded((p) => ({
                                  ...p,
                                  [item.id]: !(p[item.id] ?? true),
                                }))
                              }
                              hitSlop={6}
                            >
                              <Ionicons
                                name={voiceShown ? "chevron-up" : "chevron-down"}
                                size={17}
                                color={colors.onSurfaceSecondary}
                              />
                            </Pressable>
                          </View>
                        ) : (
                          <View style={styles.sideCol}>
                            <Pressable
                              testID={`transcribe-btn-${item.id}`}
                              style={styles.sideBtn}
                              onPress={() => transcribeVoice(item)}
                              hitSlop={6}
                            >
                              {transcribing === item.id ? (
                                <ActivityIndicator
                                  size="small"
                                  color={colors.brand}
                                />
                              ) : (
                                <View style={styles.micWrap}>
                                  <Ionicons
                                    name="mic"
                                    size={17}
                                    color={colors.onSurface}
                                  />
                                  <Text style={styles.micA}>A</Text>
                                </View>
                              )}
                            </Pressable>
                          </View>
                        )
                      ) : translated ? (
                        <View style={trOpen ? styles.trCtrlV : styles.trCtrlH}>
                          {trOpen ? (
                            <>
                              <Pressable
                                testID={`side-speak-btn-${item.id}`}
                                style={styles.trBtn}
                                onPress={() => readAloud(item)}
                                hitSlop={6}
                              >
                                <Ionicons name="volume-high" size={17} color={colors.onSurfaceSecondary} />
                              </Pressable>
                              <Pressable
                                testID={`side-collapse-btn-${item.id}`}
                                style={styles.trBtn}
                                onPress={() => translate(item)}
                                hitSlop={6}
                              >
                                <Ionicons name="chevron-up" size={17} color={colors.onSurfaceSecondary} />
                              </Pressable>
                            </>
                          ) : (
                            <>
                              <Pressable
                                testID={`side-expand-btn-${item.id}`}
                                style={styles.trBtn}
                                onPress={() => translate(item)}
                                hitSlop={6}
                              >
                                <Ionicons name="chevron-down" size={17} color={colors.onSurfaceSecondary} />
                              </Pressable>
                              <Pressable
                                testID={`side-speak-btn-${item.id}`}
                                style={styles.trBtn}
                                onPress={() => readAloud(item)}
                                hitSlop={6}
                              >
                                <Ionicons name="volume-high" size={17} color={colors.onSurfaceSecondary} />
                              </Pressable>
                            </>
                          )}
                        </View>
                      ) : (
                        <View style={styles.sideCol}>
                          <Pressable
                            testID={`side-translate-btn-${item.id}`}
                            style={styles.sideBtn}
                            onPress={() => translate(item)}
                            hitSlop={6}
                          >
                            {translating === item.id ? (
                              <ActivityIndicator size="small" color={colors.brand} />
                            ) : (
                              <TranslationIcon testID={`side-translate-icon-${item.id}`} color={colors.onSurface} />
                            )}
                          </Pressable>
                        </View>
                      ))}
                  </View>
                  )}
                  {mine &&
                    index === lastMineIndex &&
                    item.type !== "system" && (
                      <View style={styles.receiptRow} testID={`receipt-${item.id}`}>
                        <Ionicons
                          name={
                            partnerReadAt && partnerReadAt >= item.created_at
                              ? "checkmark-done"
                              : "checkmark"
                          }
                          size={13}
                          color={
                            partnerReadAt && partnerReadAt >= item.created_at
                              ? colors.brand
                              : colors.onSurfaceSecondary
                          }
                        />
                        <Text style={styles.receiptText}>
                          {partnerReadAt && partnerReadAt >= item.created_at
                            ? "Seen"
                            : "Sent"}
                        </Text>
                      </View>
                    )}
                </>
              );
            }}
          />
        )}

        {recState !== "idle" ? (
          <View style={styles.recordingBar} testID="recording-bar">
            <Pressable
              testID="recording-cancel-btn"
              onPress={cancelRecording}
              style={styles.recCancelBtn}
              hitSlop={8}
            >
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
            {recState === "recording" ? (
              <View style={styles.recPill}>
                <Pressable
                  testID="recording-pause-btn"
                  onPress={stopRecording}
                  hitSlop={8}
                >
                  <Ionicons name="pause" size={20} color="#FFFFFF" />
                </Pressable>
                <View style={styles.recBarsRow}>
                  {recBars.map((h, i) => (
                    <View key={i} style={[styles.recBar, { height: h }]} />
                  ))}
                </View>
                <Text style={styles.recPillTime}>
                  {Math.floor(recordSeconds / 60)}:
                  {(recordSeconds % 60).toString().padStart(2, "0")}
                </Text>
              </View>
            ) : (
              <ChatRecPreviewPill
                uri={recorder.uri}
                seconds={recordSeconds}
                bars={recBars}
              />
            )}
            <Pressable
              testID="recording-send-btn"
              onPress={sendVoice}
              style={[styles.recSendBtn, uploadingVoice && { opacity: 0.5 }]}
              disabled={uploadingVoice}
            >
              {uploadingVoice ? (
                <ActivityIndicator size="small" color={colors.onBrand} />
              ) : (
                <Ionicons name="send" size={18} color={colors.onBrand} />
              )}
            </Pressable>
          </View>
        ) : (
          <>
            {draftHint && (
              <View style={styles.hintBar} testID="draft-hint-bar">
                <Ionicons name="sparkles" size={14} color={colors.brand} />
                <Text style={styles.hintText}>{draftHint}</Text>
                <Pressable onPress={() => setDraftHint(null)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.onSurfaceSecondary} />
                </Pressable>
              </View>
            )}
            {replyTarget && (
              <View style={styles.replyBanner} testID="reply-banner">
                <View style={styles.replyBannerBar} />
                <View style={styles.replyBannerBody}>
                  <Text style={styles.replyBannerTitle} numberOfLines={1}>
                    Reply to{" "}
                    <Text style={styles.replyBannerName}>
                      {replyTarget.sender_id === user?.id
                        ? "You"
                        : partner?.name || ""}
                    </Text>
                  </Text>
                  <Text style={styles.replyBannerPreview} numberOfLines={1}>
                    {replyTarget.type === "voice"
                      ? "Voice message"
                      : replyTarget.type === "image"
                        ? "Photo"
                        : replyTarget.text}
                  </Text>
                </View>
                <Pressable
                  testID="reply-banner-close"
                  onPress={() => setReplyTarget(null)}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>
            )}
          <ScrollView testID="chat-composer-scroll" style={{ flexGrow: 0, flexShrink: 0, maxHeight: "70%" }} contentContainerStyle={styles.inputArea} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {practiceLocked && (
              <View style={styles.practiceBar} testID="practice-unlock-bar">
                <View style={styles.practiceIconWrap}>
                  <Ionicons name="lock-closed" size={16} color="#B45309" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.practiceTitle} numberOfLines={1}>
                    Paid practice with {partner?.name || "this partner"}
                  </Text>
                  <Text style={styles.practiceSub} numberOfLines={2}>
                    Unlock 24h of chat for {practice?.rate ?? 50} coins · You have{" "}
                    {user?.coins ?? 0}
                  </Text>
                </View>
                <Pressable
                  testID="practice-unlock-btn"
                  onPress={handleUnlock}
                  disabled={unlocking}
                  style={[styles.practiceBtn, unlocking && { opacity: 0.5 }]}
                >
                  {unlocking ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.practiceBtnText}>
                      Unlock · {practice?.rate ?? 50}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
            {giftLocked && (
              <View style={styles.practiceBar} testID="gift-unlock-bar">
                <View style={styles.practiceIconWrap}>
                  <Ionicons name="gift" size={16} color="#B45309" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.practiceTitle} numberOfLines={1}>
                    Send a gift to chat with {partner?.name || "this partner"}
                  </Text>
                  <Text style={styles.practiceSub} numberOfLines={2}>
                    Gift {practice?.gift_min ?? 20}+ coins to unlock messaging ·
                    You have {user?.coins ?? 0}
                  </Text>
                </View>
                <Pressable
                  testID="gift-unlock-btn"
                  onPress={() => setPanel("gift")}
                  style={styles.practiceBtn}
                >
                  <Text style={styles.practiceBtnText}>Send gift</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.inputRow}>
              <View style={styles.inputPill}>
                <TextInput
                  testID="chat-message-input"
                  style={styles.input}
                  placeholder={
                    giftLocked
                      ? "Send a gift to start chatting…"
                      : practiceLocked
                        ? "Unlock to start practicing…"
                        : "Type a message..."
                  }
                  placeholderTextColor={colors.onSurfaceSecondary}
                  selectionColor={colors.brand}
                  value={draft}
                  onChangeText={setDraft}
                  onFocus={() => setPanel(null)}
                  editable={!inputLocked}
                  multiline
                />
              </View>
              {inputLocked ? (
                <Pressable
                  testID="chat-locked-btn"
                  onPress={giftLocked ? () => setPanel("gift") : handleUnlock}
                  style={styles.sendBtn}
                  disabled={unlocking}
                >
                  <Ionicons
                    name={giftLocked ? "gift" : "lock-closed"}
                    size={18}
                    color={colors.onBrand}
                  />
                </Pressable>
              ) : draft.trim() ? (
                <Pressable
                  testID="chat-send-btn"
                  onPress={send}
                  style={[styles.sendBtn, sending && { opacity: 0.4 }]}
                  disabled={sending}
                >
                  <Ionicons name="send" size={18} color={colors.onBrand} />
                </Pressable>
              ) : (
                <Pressable
                  testID="chat-record-btn"
                  onPress={startRecording}
                  style={[styles.micBtn, uploadingVoice && { opacity: 0.4 }]}
                  disabled={uploadingVoice}
                  hitSlop={6}
                >
                  {uploadingVoice ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <Ionicons name="mic" size={22} color={colors.brand} />
                  )}
                </Pressable>
              )}
            </View>
            <View style={styles.toolbarRow}>
              <Pressable
                testID="chat-add-btn"
                onPress={() => setPanel((p) => (p === "attach" ? null : "attach"))}
                style={styles.toolIcon}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={26}
                  color={panel === "attach" ? colors.brand : colors.onSurface}
                />
              </Pressable>
              <Pressable
                testID="chat-media-btn"
                onPress={pickImage}
                style={[styles.toolIcon, uploadingImage && { opacity: 0.4 }]}
                disabled={uploadingImage}
              >
                {uploadingImage ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Ionicons name="image-outline" size={24} color={colors.onSurface} />
                )}
              </Pressable>
              <Pressable
                testID="tool-emoji"
                onPress={() => setPanel((p) => (p === "emoji" ? null : "emoji"))}
                style={styles.toolIcon}
              >
                <Ionicons
                  name="happy-outline"
                  size={24}
                  color={panel === "emoji" ? colors.brand : colors.onSurface}
                />
              </Pressable>
              <Pressable
                testID="tool-gift"
                onPress={() => setPanel((p) => (p === "gift" ? null : "gift"))}
                style={styles.toolIcon}
              >
                <Ionicons
                  name="gift-outline"
                  size={24}
                  color={panel === "gift" ? colors.brand : colors.onSurface}
                />
              </Pressable>
              <Pressable
                testID="tool-translate"
                onPress={() => setPanel((p) => (p === "translate" ? null : "translate"))}
                style={styles.toolIcon}
              >
                <TranslationIcon testID="tool-translate-icon" size={24}
                  color={panel === "translate" ? colors.brand : colors.onSurface} />
              </Pressable>
              <Pressable
                testID="tool-templates"
                onPress={() => setPanel((p) => (p === "phrases" ? null : "phrases"))}
                style={styles.toolIcon}
              >
                <Ionicons
                  name="chatbubble-ellipses"
                  size={24}
                  color={panel === "phrases" ? colors.brand : colors.onSurface}
                />
              </Pressable>
            </View>
            {panel === "emoji" && (
              <View style={styles.emojiPanelWrap}>
                <View style={styles.emojiTabs}>
                  <Pressable
                    testID="emoji-tab-emoji"
                    style={[
                      styles.emojiTab,
                      emojiTab === "emoji" && styles.emojiTabActive,
                    ]}
                    onPress={() => setEmojiTab("emoji")}
                  >
                    <Ionicons
                      name="happy-outline"
                      size={20}
                      color={emojiTab === "emoji" ? colors.brand : colors.onSurfaceSecondary}
                    />
                    <Text
                      style={[
                        styles.emojiTabText,
                        emojiTab === "emoji" && { color: colors.brand },
                      ]}
                    >
                      Emoji
                    </Text>
                  </Pressable>
                  <Pressable
                    testID="emoji-tab-sticker"
                    style={[
                      styles.emojiTab,
                      emojiTab === "sticker" && styles.emojiTabActive,
                    ]}
                    onPress={() => setEmojiTab("sticker")}
                  >
                    <MaterialCommunityIcons
                      name="sticker-emoji"
                      size={20}
                      color={emojiTab === "sticker" ? colors.brand : colors.onSurfaceSecondary}
                    />
                    <Text
                      style={[
                        styles.emojiTabText,
                        emojiTab === "sticker" && { color: colors.brand },
                      ]}
                    >
                      Stickers
                    </Text>
                  </Pressable>
                </View>
                {emojiTab === "emoji" ? (
                  <ScrollView
                    style={styles.emojiGridWrap}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.emojiGrid}>
                      {EMOJI_GRID.map((e, i) => (
                        <Pressable
                          key={`${e}-${i}`}
                          testID={`emoji-${e}`}
                          style={styles.emojiGridItem}
                          onPress={() => setDraft((d) => d + e)}
                        >
                          <Text style={styles.emojiGridText}>{e}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <ScrollView
                    style={styles.stickerPanel}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.stickerGrid}>
                      {STICKERS.map((cp) => (
                        <Pressable
                          key={cp}
                          testID={`sticker-${cp}`}
                          style={styles.stickerItem}
                          onPress={() => sendSticker(cp)}
                        >
                          <Image
                            source={{ uri: stickerUrl(cp) }}
                            style={styles.stickerImg}
                            contentFit="contain"
                          />
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>
            )}
            {panel === "phrases" && (
              <View style={styles.phrasesPanel}>
                <View style={styles.phraseTabs}>
                  <Pressable
                    testID="phrase-tab-used"
                    style={[styles.phraseTab, phraseTab === "used" && styles.phraseTabActive]}
                    onPress={() => setPhraseTab("used")}
                  >
                    <Text style={[styles.phraseTabText, phraseTab === "used" && styles.phraseTabTextActive]}>
                      Most Used
                    </Text>
                  </Pressable>
                  <Pressable
                    testID="phrase-tab-topics"
                    style={[styles.phraseTab, phraseTab === "topics" && styles.phraseTabActive]}
                    onPress={() => setPhraseTab("topics")}
                  >
                    <Text style={[styles.phraseTabText, phraseTab === "topics" && styles.phraseTabTextActive]}>
                      Topics
                    </Text>
                  </Pressable>
                </View>
                <ScrollView
                  style={styles.phraseList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {(phraseTab === "used"
                    ? [...customPhrases, ...QUICK_TEMPLATES]
                    : TOPIC_PROMPTS
                  ).map((t, i) => (
                    <Pressable
                      key={`${t}-${i}`}
                      testID="phrase-item"
                      style={styles.phrasePill}
                      onPress={() => {
                        setDraft(t);
                        setPanel(null);
                      }}
                    >
                      <Text style={styles.phrasePillText}>{t}</Text>
                    </Pressable>
                  ))}
                  {phraseTab === "used" && (
                    <Pressable testID="phrase-add" style={styles.addPhraseBtn} onPress={addPhrase}>
                      <Ionicons name="add" size={16} color={colors.brand} />
                      <Text style={styles.addPhraseText}>Add a phrase</Text>
                    </Pressable>
                  )}
                </ScrollView>
              </View>
            )}
            {panel === "gift" && (
              <View style={styles.giftPanel}>
                <View style={styles.giftTabs}>
                  {(["gift", "vip", "card"] as const).map((t) => (
                    <Pressable
                      key={t}
                      testID={`gift-tab-${t}`}
                      style={[styles.giftTab, giftTab === t && styles.giftTabActive]}
                      onPress={() => setGiftTab(t)}
                    >
                      <Text style={[styles.giftTabText, giftTab === t && styles.giftTabTextActive]}>
                        {t === "gift" ? "Gift" : t === "vip" ? "VIP" : "Card"}
                      </Text>
                    </Pressable>
                  ))}
                  <View style={styles.coinPill}>
                    <Ionicons name="cash" size={13} color="#F59E0B" />
                    <Text style={styles.coinText}>{user?.coins ?? 0}</Text>
                  </View>
                </View>
                <ScrollView
                  style={styles.giftGridWrap}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.giftGrid}>
                    {CHAT_GIFTS.map((g) => (
                      <Pressable
                        key={g.key}
                        testID={`gift-${g.key}`}
                        style={[styles.giftItem, selectedGift === g.key && styles.giftItemActive]}
                        onPress={() => setSelectedGift(g.key)}
                      >
                        <Text style={styles.giftEmoji}>{g.emoji}</Text>
                        <Text style={styles.giftName} numberOfLines={1}>{g.name}</Text>
                        <View style={styles.giftCoinRow}>
                          <Ionicons name="cash" size={11} color="#F59E0B" />
                          <Text style={styles.giftCoins}>{g.coins}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <Pressable
                  testID="gift-send"
                  style={[styles.giftSendBtn, !selectedGift && { opacity: 0.4 }]}
                  onPress={sendGiftMessage}
                  disabled={!selectedGift}
                >
                  <Text style={styles.giftSendText}>Send</Text>
                </Pressable>
              </View>
            )}
            {panel === "translate" && (
              <View style={styles.translatePanel}>
                <View style={styles.translateHeaderRow}>
                  <Text testID="chat-translation-target" style={[styles.translateTitle, { flexShrink: 1 }]}>{TRANSLATION_NAMES[trTo] || trTo}</Text>
                  <View style={styles.langChips}>
                    {["en", "es", "pt", "fr", "ja"].map((lng) => (
                      <Pressable
                        key={lng}
                        testID={`tr-lang-${lng}`}
                        style={[styles.langChip, trTo === lng && styles.langChipActive]}
                        disabled={trLoading}
                        onPress={() => { setTrTo(lng); setTrResult(null); setTrError(null); }}
                      >
                        <Text style={[styles.langChipText, trTo === lng && styles.langChipTextActive]}>
                          {lng.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Pressable testID="tr-more-languages" disabled={trLoading}
                  onPress={() => setTrMoreLanguages(value => !value)}
                  style={{ minHeight: 44, justifyContent: "center" }}>
                  <Text style={styles.translateUseHint}>{trMoreLanguages ? "Hide language search" : "More languages"}</Text>
                </Pressable>
                {trMoreLanguages && <TranslationLanguagePicker prefix="chat-translation-language" value={trTo}
                  disabled={trLoading} onChange={value => { setTrTo(value); setTrResult(null); setTrError(null); setTrMoreLanguages(false); }} />}
                <View style={styles.translateInputRow}>
                  <TextInput
                    testID="tr-input"
                    style={styles.translateInput}
                    placeholder="Enter the text you wish to translate"
                    placeholderTextColor={colors.onSurfaceSecondary}
                    selectionColor={colors.brand}
                    value={trInput}
                    onChangeText={setTrInput}
                    multiline
                  />
                  <Pressable
                    testID="tr-run"
                    style={styles.translateRunBtn}
                    onPress={runPanelTranslate}
                    disabled={trLoading || !trInput.trim()}
                  >
                    {trLoading ? (
                      <ActivityIndicator size="small" color={colors.onBrand} />
                    ) : (
                      <Ionicons name="arrow-forward" size={18} color={colors.onBrand} />
                    )}
                  </Pressable>
                </View>
                {trError && <Text testID="chat-translation-error" accessibilityRole="alert"
                  style={[styles.translateUseHint, { color: colors.error }]}>{trError}</Text>}
                {trResult ? (
                  <Pressable
                    testID="tr-result"
                    style={styles.translateResult}
                    onPress={() => {
                      setDraft((d) => (d ? d + " " : "") + trResult);
                      setPanel(null);
                    }}
                  >
                    <Text testID="tr-result-text" style={[styles.translateResultText, translatedTextStyle(trResult)]}>{trResult}</Text>
                    <Text style={styles.translateUseHint}>Tap to use →</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
            {panel === "attach" && (
              <View style={styles.attachPanel}>
                <Pressable
                  testID="attach-photo"
                  style={styles.attachItem}
                  onPress={() => {
                    setPanel(null);
                    pickImage();
                  }}
                >
                  <View style={[styles.attachIcon, { backgroundColor: "#3B82F6" }]}>
                    <Ionicons name="image" size={24} color="#FFFFFF" />
                  </View>
                  <Text style={styles.attachLabel}>Photo</Text>
                </Pressable>
                <Pressable
                  testID="attach-call"
                  style={styles.attachItem}
                  onPress={() => {
                    setPanel(null);
                    if (partner) startCall(partner);
                  }}
                >
                  <View style={[styles.attachIcon, { backgroundColor: "#22C55E" }]}>
                    <Ionicons name="call" size={22} color="#FFFFFF" />
                  </View>
                  <Text style={styles.attachLabel}>Voice Call</Text>
                </Pressable>
                <Pressable
                  testID="attach-gift"
                  style={styles.attachItem}
                  onPress={() => {
                    setPanel(null);
                    router.push("/market");
                  }}
                >
                  <View style={[styles.attachIcon, { backgroundColor: "#F59E0B" }]}>
                    <Ionicons name="gift" size={22} color="#FFFFFF" />
                  </View>
                  <Text style={styles.attachLabel}>Gift</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
          </>
        )}
      </KeyboardAvoidingView>
      <MessageReactionsPopup
        visible={!!reactionMsg}
        anchor={reactionAnchor}
        mine={reactionMsg ? reactionMsg.sender_id === user?.id : false}
        hasText={!!reactionMsg?.text && reactionMsg?.type !== "voice" && reactionMsg?.type !== "image" && reactionMsg?.type !== "sticker"}
        isVoice={reactionMsg?.type === "voice"}
        isImage={reactionMsg?.type === "image" || reactionMsg?.type === "sticker"}
        messageText={reactionMsg?.text}
        voiceDurationMs={reactionMsg?.duration_ms ?? null}
        imageUri={
          reactionMsg?.type === "image" && reactionMsg?.image_id
            ? mediaUrl(reactionMsg.image_id)
            : reactionMsg?.type === "sticker" && reactionMsg?.sticker
              ? stickerUrl(reactionMsg.sticker)
              : undefined
        }
        currentReaction={reactionMsg ? myReactionFor(reactionMsg) : undefined}
        pinned={!!reactionMsg?.pinned}
        saved={!!(reactionMsg?.saved_by || []).includes(user?.id || "")}
        practiced={!!(reactionMsg?.practice_by || []).includes(user?.id || "")}
        hasManualCorrection={!!reactionMsg?.manual_correction}
        onClose={() => {
          setReactionMsg(null);
          setReactionAnchor(null);
        }}
        onReact={toggleReaction}
        onAction={handleMsgAction}
      />

      <Modal
        visible={!!correctingMsg}
        transparent
        animationType="slide"
        onRequestClose={() => setCorrectingMsg(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setCorrectingMsg(null)} />
          <BoundedSheet testID="chat-correction-sheet" style={[styles.modalCard, { paddingBottom: spacing.xl + insets.bottom }]}>
            <View style={styles.menuHeader}>
              <Text style={styles.modalTitle}>Correction</Text>
              <Pressable testID="correction-close" onPress={() => setCorrectingMsg(null)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
            {correctingMsg?.text ? (
              <Text style={styles.modalOriginal} numberOfLines={3}>
                {correctingMsg.text}
              </Text>
            ) : null}
            <TextInput
              testID="correction-input"
              style={styles.modalInput}
              placeholder="Write the corrected version..."
              placeholderTextColor={colors.onSurfaceSecondary}
              selectionColor={colors.brand}
              value={correctDraft}
              onChangeText={setCorrectDraft}
              multiline
            />
            <TextInput
              testID="correction-note-input"
              style={[styles.modalInput, { minHeight: 40 }]}
              placeholder="Add a note (optional)"
              placeholderTextColor={colors.onSurfaceSecondary}
              selectionColor={colors.brand}
              value={correctNote}
              onChangeText={setCorrectNote}
              multiline
            />
            <Pressable
              testID="correction-save"
              style={[styles.modalSaveBtn, savingCorrection && { opacity: 0.5 }]}
              onPress={submitManualCorrection}
              disabled={savingCorrection}
            >
              {savingCorrection ? (
                <ActivityIndicator size="small" color={colors.onBrand} />
              ) : (
                <Text style={styles.modalSaveText}>Save correction</Text>
              )}
            </Pressable>
          </BoundedSheet>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerInfo: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      justifyContent: "center",
    },
    headerName: {
      fontFamily: fonts.displaySemi,
      fontSize: 18,
      lineHeight: 24,
      color: colors.onSurface,
    },
    headerStatus: {
      fontFamily: fonts.text,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
      marginTop: 1,
    },
    headerIconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    headerLang: {
      fontFamily: fonts.text,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
    },
    callBtn: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: colors.success,
      alignItems: "center",
      justifyContent: "center",
    },
    menuBtn: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: spacing.xs,
    },
    menuBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15, 23, 42, 0.45)",
      justifyContent: "flex-end",
    },
    menuCard: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.xs,
    },
    menuHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.sm,
    },
    menuTitle: {
      fontFamily: fonts.display,
      fontSize: 19,
      color: colors.onSurface,
    },
    menuRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    menuText: {
      flex: 1,
      fontFamily: fonts.textSemi,
      fontSize: 15,
      color: colors.onSurface,
    },
    menuToggle: {
      width: 40,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.borderStrong,
      padding: 2,
      justifyContent: "center",
    },
    menuToggleOn: {
      backgroundColor: colors.brand,
    },
    menuThumb: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: "#FFFFFF",
    },
    menuThumbOn: {
      alignSelf: "flex-end",
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      minHeight: 200,
    },
    emptyText: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.onSurfaceSecondary,
    },
    messageList: {
      padding: spacing.lg,
      gap: spacing.sm,
      flexGrow: 1,
    },
    partnerCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    partnerTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    partnerNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    partnerName: {
      fontFamily: fonts.displaySemi,
      fontSize: 18,
      color: colors.onSurface,
      flexShrink: 1,
    },
    genderPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    genderPillText: {
      fontFamily: fonts.textBold,
      fontSize: 11,
      color: "#FFFFFF",
    },
    partnerSub: {
      fontFamily: fonts.text,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
      marginTop: 2,
    },
    partnerBio: {
      fontFamily: fonts.text,
      fontSize: 14,
      lineHeight: 20,
      color: colors.onSurface,
    },
    chipsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs + 2,
    },
    introChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 5,
    },
    introChipText: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.onSurfaceTertiary,
    },
    systemMsg: {
      textAlign: "center",
      fontFamily: fonts.text,
      fontSize: 12.5,
      color: colors.onSurfaceSecondary,
      paddingHorizontal: spacing.xl,
      paddingVertical: 6,
      lineHeight: 18,
    },
    dateSep: {
      alignSelf: "center",
      fontFamily: fonts.text,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
      marginVertical: spacing.sm,
    },
    bubbleRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      width: "100%",
    },
    rowMine: {
      justifyContent: "flex-end",
    },
    rowTheirs: {
      justifyContent: "flex-start",
    },
    bubble: {
      maxWidth: "72%",
      flexShrink: 1,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      gap: spacing.xs,
    },
    bubbleMine: {
      backgroundColor: colors.bubbleMine,
    },
    bubbleTheirs: {
      backgroundColor: colors.bubbleTheirs,
    },
    avatarSpacer: {
      width: 40,
    },
    callRow: {
      marginVertical: spacing.sm,
      maxWidth: "86%",
    },
    // Outgoing rows hug the right edge; incoming rows start where the partner's
    // bubbles start (avatar column width + row gap) so call cards, stickers and
    // text bubbles all share one clean alignment on each side.
    callRowMine: {
      alignSelf: "flex-end",
    },
    callRowTheirs: {
      alignSelf: "flex-start",
      marginLeft: 40 + spacing.sm,
    },
    // Wrapper rows that give calls/stickers the same avatar column + grouping
    // as text bubbles (avatar on the first of a run, spacer for the rest).
    specialRowTheirs: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      alignSelf: "flex-start",
      maxWidth: "100%",
    },
    specialRowMine: {
      alignSelf: "flex-end",
      maxWidth: "100%",
    },
    stickerMsg: {
      paddingVertical: 2,
    },
    stickerMsgImg: {
      width: 120,
      height: 120,
    },
    stickerPanel: {
      maxHeight: 240,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    stickerGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
    },
    stickerItem: {
      width: "23%",
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    stickerImg: {
      width: "84%",
      height: "84%",
    },
    callCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.lg,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
      minWidth: 170,
      maxWidth: "100%",
      flexShrink: 1,
    },
    callIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.brandTertiary,
    },
    callIconMissed: {
      backgroundColor: "rgba(239,68,68,0.12)",
    },
    callBody: {
      gap: 1,
    },
    callTitle: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.onSurface,
    },
    callStatus: {
      fontFamily: fonts.text,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
    },
    avatarWrap: {
      alignSelf: "flex-start",
      marginTop: 2,
    },
    pinnedBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pinnedBody: {
      flex: 1,
    },
    pinnedTitle: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.brand,
    },
    pinnedText: {
      fontFamily: fonts.text,
      fontSize: 13,
      color: colors.onSurfaceSecondary,
      marginTop: 1,
    },
    bubbleText: {
      fontFamily: fonts.text,
      fontSize: 16,
      lineHeight: 22,
      color: colors.onBubbleTheirs,
    },
    bubbleTextMine: {
      color: colors.onBubbleMine,
    },
    origUnderline: {
      alignSelf: "flex-start",
      borderBottomWidth: 1.5,
      borderBottomColor: colors.borderStrong,
      borderStyle: "dotted",
      paddingBottom: 2,
    },
    aiTransBox: {
      marginTop: 6,
      gap: 1,
    },
    voiceTranscriptBox: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    aiLabel: {
      fontFamily: fonts.textSemi,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
    },
    aiTransText: {
      fontFamily: fonts.text,
      fontSize: 16,
      lineHeight: 22,
      color: colors.onBubbleTheirs,
    },
    replyQuote: {
      flexDirection: "row",
      borderRadius: radius.sm,
      overflow: "hidden",
      backgroundColor: colors.surface,
      marginBottom: 5,
    },
    replyBar: {
      width: 3,
      backgroundColor: colors.brand,
    },
    replyBody: {
      flex: 1,
      paddingVertical: 5,
      paddingHorizontal: 8,
      gap: 1,
    },
    replyName: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: colors.brand,
    },
    replyPreview: {
      fontFamily: fonts.text,
      fontSize: 14,
      lineHeight: 19,
      color: colors.onSurface,
    },
    replyVoiceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    sideStack: {
      alignItems: "center",
      gap: 8,
    },
    trCtrlV: {
      alignSelf: "center",
      justifyContent: "center",
      alignItems: "center",
      marginLeft: 6,
      gap: 4,
    },
    trCtrlH: {
      flexDirection: "row",
      alignSelf: "center",
      alignItems: "center",
      marginLeft: 6,
      gap: 8,
    },
    trBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    replyBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    replyBannerBar: {
      width: 3,
      alignSelf: "stretch",
      borderRadius: 2,
      backgroundColor: colors.brand,
    },
    replyBannerBody: {
      flex: 1,
      gap: 1,
    },
    replyBannerTitle: {
      fontFamily: fonts.text,
      fontSize: 14,
      color: colors.onSurface,
    },
    replyBannerName: {
      fontFamily: fonts.textBold,
      color: colors.onSurface,
    },
    replyBannerPreview: {
      fontFamily: fonts.text,
      fontSize: 13,
      color: colors.onSurfaceSecondary,
    },
    imageBubble: {
      width: 210,
      height: 210,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceTertiary,
    },
    translationBox: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.xs + 2,
    },
    translationText: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      lineHeight: 20,
      color: colors.brand,
    },
    bubbleFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    receiptRow: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-end",
      gap: 3,
      marginTop: 2,
      marginRight: spacing.xs,
      marginBottom: 2,
    },
    receiptText: {
      fontFamily: fonts.text,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
    },
    bubbleActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    correctionBox: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.xs + 2,
      gap: 2,
    },
    correctionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    correctionLabel: {
      fontFamily: fonts.textBold,
      fontSize: 10,
      color: colors.success,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    correctionText: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      lineHeight: 20,
      color: colors.success,
    },
    correctionExplain: {
      fontFamily: fonts.text,
      fontSize: 12,
      lineHeight: 17,
      color: colors.onSurfaceSecondary,
      fontStyle: "italic",
    },
    bubbleSelected: {
      borderWidth: 2,
      borderColor: colors.brand,
    },
    sideCol: {
      justifyContent: "center",
      alignSelf: "center",
      marginLeft: 6,
    },
    sideBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    sideBtnActive: {
      backgroundColor: colors.brandTertiary,
    },
    micWrap: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    micA: {
      fontFamily: fonts.textBold,
      fontSize: 9,
      color: colors.onSurface,
      marginTop: 1,
      marginLeft: -1,
    },
    manualBox: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.xs + 2,
      gap: 2,
    },
    manualLabel: {
      fontFamily: fonts.textBold,
      fontSize: 10,
      color: colors.brand,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    manualText: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      lineHeight: 20,
      color: colors.brand,
    },
    selectBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    selectCount: {
      flex: 1,
      fontFamily: fonts.displaySemi,
      fontSize: 16,
      color: colors.onSurface,
    },
    selectAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    selectActionText: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.brand,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15,23,42,0.45)",
      justifyContent: "flex-end",
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.xl,
      gap: spacing.md,
    },
    modalTitle: {
      fontFamily: fonts.display,
      fontSize: 19,
      color: colors.onSurface,
    },
    modalOriginal: {
      fontFamily: fonts.text,
      fontSize: 13,
      color: colors.onSurfaceSecondary,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.sm,
      padding: spacing.sm + 2,
    },
    modalInput: {
      fontFamily: fonts.text,
      fontSize: 15,
      color: colors.onSurface,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      minHeight: 52,
      textAlignVertical: "top",
    },
    modalSaveBtn: {
      backgroundColor: colors.brand,
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      alignItems: "center",
    },
    modalSaveText: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onBrand,
    },
    hintBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.brandTertiary,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    hintText: {
      flex: 1,
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.brand,
    },
    bubbleTime: {
      fontFamily: fonts.text,
      fontSize: 10,
      color: colors.onSurfaceSecondary,
    },
    bubbleTimeMine: {
      color: colors.onSurfaceSecondary,
    },
    roomShareRow: {
      alignSelf: "stretch",
      paddingHorizontal: spacing.md,
      marginVertical: 4,
    },
    roomShareBubble: {
      // Full width — the RoomMomentCard is styled identically to the moments
      // feed card, so it should occupy the same visual footprint whether it's
      // seen in a chat message or a moment.
      alignSelf: "stretch",
      padding: 0,
      borderRadius: radius.md,
      gap: 4,
    },
    roomShareCaption: {
      fontFamily: fonts.text,
      fontSize: 14,
      color: colors.onSurface,
      marginBottom: 6,
    },
    reactedBubble: { marginBottom: 22, overflow: "visible" },
    reactionBadgeRow: {
      flexDirection: "row",
      gap: 4,
      marginTop: -6,
      marginBottom: 2,
      alignSelf: "flex-start",
    },
    reactionBadgeMine: {
      alignSelf: "flex-end",
      marginRight: 4,
    },
    reactionBadgeTheirs: {
      alignSelf: "flex-start",
      marginLeft: 4,
    },
    reactionBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 3,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    reactionBadgeEmoji: {
      fontSize: 13,
    },
    reactionBadgeCount: {
      fontFamily: fonts.textSemi,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
    },
    recordingBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    recCancelBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    recPill: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.brand,
      borderRadius: 24,
      height: 46,
      paddingHorizontal: 16,
      gap: 10,
    },
    recBarsRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 2.5,
    },
    recBar: {
      width: 2.5,
      borderRadius: 2,
      backgroundColor: "rgba(255,255,255,0.85)",
    },
    recPillTime: {
      fontFamily: fonts.textSemi,
      fontSize: 13.5,
      color: "#FFFFFF",
    },
    recSendBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    inputArea: {
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    practiceBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: "#FEF3C7",
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    practiceIconWrap: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: "#FDE68A",
      alignItems: "center",
      justifyContent: "center",
    },
    practiceTitle: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: "#92400E",
    },
    practiceSub: {
      fontFamily: fonts.text,
      fontSize: 11.5,
      color: "#B45309",
      marginTop: 1,
    },
    practiceBtn: {
      backgroundColor: "#D97706",
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minWidth: 84,
      alignItems: "center",
      justifyContent: "center",
    },
    practiceBtnText: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: "#FFFFFF",
    },
    inputPill: {
      flex: 1,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 20,
      paddingHorizontal: spacing.lg,
      minHeight: 40,
      justifyContent: "center",
    },
    inlineActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    // Voice-record button in the composer. Mirrors the soft circular chip
    // used by the call icon in the chat title-bar (IconChip tint="brand"):
    // light brand-tinted circle + brand-coloured glyph, sized like sendBtn.
    micBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.brandTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    emojiBar: {
      maxHeight: 52,
      marginBottom: spacing.sm,
    },
    emojiBarContent: {
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    emojiItem: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
    },
    emojiText: {
      fontSize: 22,
    },
    templatePanel: {
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    templateItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    templateText: {
      flex: 1,
      fontFamily: fonts.text,
      fontSize: 14,
      color: colors.onSurface,
    },
    attachPanel: {
      flexDirection: "row",
      gap: spacing.xl,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      marginBottom: spacing.xs,
    },
    attachItem: {
      alignItems: "center",
      gap: spacing.xs + 2,
    },
    attachIcon: {
      width: 52,
      height: 52,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    attachLabel: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
    },
    toolbarRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
    },
    toolIcon: {
      width: 44,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    toolBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.brandTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      fontFamily: fonts.text,
      fontSize: 15,
      color: colors.onSurface,
      maxHeight: 110,
      paddingVertical: Platform.OS === "web" ? 8 : 6,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    emojiPanelWrap: {
      marginBottom: spacing.sm,
    },
    emojiTabs: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    emojiTab: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceSecondary,
    },
    emojiTabActive: {
      backgroundColor: colors.brandTertiary,
    },
    emojiTabText: {
      fontFamily: fonts.textBold,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
    },
    emojiGridWrap: {
      maxHeight: 220,
      marginBottom: spacing.sm,
    },
    emojiGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    emojiGridItem: {
      width: `${100 / 8}%`,
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emojiGridText: {
      fontSize: 26,
    },
    phrasesPanel: {
      maxHeight: 260,
      marginBottom: spacing.sm,
    },
    phraseTabs: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    phraseTab: {
      paddingVertical: 8,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
    },
    phraseTabActive: {
      backgroundColor: colors.brandTertiary,
    },
    phraseTabText: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.onSurfaceSecondary,
    },
    phraseTabTextActive: {
      color: colors.brand,
    },
    phraseList: {
      maxHeight: 210,
    },
    phrasePill: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    phrasePillText: {
      fontFamily: fonts.text,
      fontSize: 14.5,
      color: colors.onSurface,
    },
    addPhraseBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      alignSelf: "center",
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: 4,
      marginBottom: spacing.md,
    },
    addPhraseText: {
      fontFamily: fonts.textSemi,
      fontSize: 13,
      color: colors.brand,
    },
    giftPanel: {
      maxHeight: 300,
      marginBottom: spacing.sm,
    },
    giftTabs: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    giftTab: {
      paddingVertical: 7,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
    },
    giftTabActive: {
      backgroundColor: colors.brandTertiary,
    },
    giftTabText: {
      fontFamily: fonts.textSemi,
      fontSize: 13,
      color: colors.onSurfaceSecondary,
    },
    giftTabTextActive: {
      color: colors.brand,
    },
    coinPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginLeft: "auto",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 5,
    },
    coinText: {
      fontFamily: fonts.textBold,
      fontSize: 12,
      color: colors.onSurface,
    },
    giftGridWrap: {
      maxHeight: 200,
    },
    giftGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    giftItem: {
      width: `${100 / 4}%`,
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    giftItemActive: {
      borderColor: colors.brand,
      backgroundColor: colors.brandTertiary,
    },
    giftEmoji: {
      fontSize: 30,
    },
    giftName: {
      fontFamily: fonts.textSemi,
      fontSize: 11,
      color: colors.onSurface,
      marginTop: 2,
    },
    giftCoinRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      marginTop: 1,
    },
    giftCoins: {
      fontFamily: fonts.textSemi,
      fontSize: 10,
      color: colors.onSurfaceSecondary,
    },
    giftSendBtn: {
      backgroundColor: colors.brand,
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      alignItems: "center",
      marginTop: spacing.sm,
    },
    giftSendText: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onBrand,
    },
    translatePanel: {
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    translateHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    translateTitle: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.onSurfaceSecondary,
    },
    langChips: {
      flexDirection: "row",
      flexShrink: 1,
      flexWrap: "wrap",
      gap: 6,
    },
    langChip: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
    },
    langChipActive: {
      backgroundColor: colors.brand,
    },
    langChipText: {
      fontFamily: fonts.textBold,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
    },
    langChipTextActive: {
      color: colors.onBrand,
    },
    translateInputRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
    },
    translateInput: {
      flex: 1,
      fontFamily: fonts.text,
      fontSize: 15,
      color: colors.onSurface,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      minHeight: 44,
      maxHeight: 100,
    },
    translateRunBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    translateResult: {
      backgroundColor: colors.brandTertiary,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 4,
    },
    translateResultText: {
      fontFamily: fonts.textSemi,
      fontSize: 15,
      color: colors.brand,
    },
    translateUseHint: {
      fontFamily: fonts.text,
      fontSize: 11,
      color: colors.onSurfaceSecondary,
      alignSelf: "flex-end",
    },
  });


/**
 * Preview pill shown after the user pauses recording — mirrors the moment
 * detail screen's RecPreviewPill so both surfaces share the same voice-record
 * experience: purple pill with a play/pause on the left, animated waveform
 * bars in the middle and the duration on the right.
 */
function ChatRecPreviewPill({
  uri,
  seconds,
  bars,
}: {
  uri: string | null | undefined;
  seconds: number;
  bars: number[];
}) {
  const { colors: themeColors } = useTheme();
  const { status, toggle } = useExclusiveVoicePlayer(uri || null);
  return (
    <View
      style={[recPillStyles.pill, { backgroundColor: themeColors.brand }]}
      testID="recording-preview-pill"
    >
      <Pressable
        testID="recording-preview-play"
        onPress={toggle}
        hitSlop={8}
      >
        <Ionicons
          name={status.playing ? "pause" : "play"}
          size={20}
          color="#FFFFFF"
        />
      </Pressable>
      <View style={recPillStyles.bars}>
        {bars.map((h, i) => (
          <View key={i} style={[recPillStyles.bar, { height: h }]} />
        ))}
      </View>
      <Text style={recPillStyles.time}>
        {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
      </Text>
    </View>
  );
}

const recPillStyles = StyleSheet.create({
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    height: 46,
    paddingHorizontal: 16,
    gap: 10,
  },
  bars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2.5,
  },
  bar: {
    width: 2.5,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  time: {
    fontFamily: fonts.textSemi,
    fontSize: 13.5,
    color: "#FFFFFF",
  },
});
