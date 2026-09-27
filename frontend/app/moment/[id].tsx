import { Ionicons } from "@/src/ui/icons";
import { TranslationIcon } from "@/src/ui/TranslationIcon";
import { useExclusiveVoicePlayer } from "@/src/hooks/use-exclusive-voice-player";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "@/src/components/layout/KeyboardAvoidingView";
import { SafeAreaView } from "@/src/components/layout/SafeAreaView";

import { ActionSheetPopup, QuickAction, SheetHighlight, SheetRow } from "@/src/components/ActionSheetPopup";
import { Avatar } from "@/src/components/Avatar";
import { FlagIcon } from "@/src/components/FlagIcon";
import { BackButton } from "@/src/components/BackButton";
import { VipBadge } from "@/src/components/Badges";
import { LikersRow } from "@/src/components/LikersRow";
import { MomentActionsMenu, MomentAction } from "@/src/components/MomentActionsMenu";
import { RoomMomentCard } from "@/src/components/RoomMomentCard";
import { Visibility, VisibilityModal } from "@/src/components/VisibilityModal";
import { VoiceBubble } from "@/src/components/VoiceBubble";
import { countryToCode } from "@/src/constants/countries";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, radius, shadow, spacing, ThemeColors } from "@/src/theme";
import { api, assetUrl, Moment, MomentComment } from "@/src/utils/api";
import { timeAgo } from "@/src/utils/time";

export default function MomentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [moment, setMoment] = useState<Moment | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((rootId: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });
  }, []);

  // Split flat comments into roots + replies keyed by root id (Twitter-style
  // thread grouping). Replies inherit `root_id` from their parent; roots have
  // no `reply_to`.
  const { rootComments, repliesByRoot } = useMemo(() => {
    const all = (moment?.comments || []) as MomentComment[];
    const roots = all.filter((c) => !c.reply_to);
    const map = new Map<string, MomentComment[]>();
    for (const c of all) {
      if (c.reply_to) {
        const key = c.root_id || c.reply_to;
        const arr = map.get(key) || [];
        arr.push(c);
        map.set(key, arr);
      }
    }
    return { rootComments: roots, repliesByRoot: map };
  }, [moment?.comments]);

  const likeComment = useCallback(
    async (commentId: string) => {
      if (!moment) return;
      // Optimistic toggle
      const target = (moment.comments || []).find((c) => c.id === commentId);
      const wasLiked = !!target?.liked_by_me;
      setMoment((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          comments: (prev.comments || []).map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  liked_by_me: !wasLiked,
                  like_count: Math.max(0, (c.like_count || 0) + (wasLiked ? -1 : 1)),
                }
              : c,
          ),
        };
      });
      try {
        Haptics.selectionAsync();
        await api.post<{ liked: boolean; like_count: number }>(
          `/moments/${id}/comments/${commentId}/like`,
        );
      } catch {
        // Revert on failure
        setMoment((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            comments: (prev.comments || []).map((c) =>
              c.id === commentId
                ? {
                    ...c,
                    liked_by_me: wasLiked,
                    like_count: Math.max(0, (c.like_count || 0) + (wasLiked ? 1 : -1)),
                  }
                : c,
            ),
          };
        });
      }
    },
    [id, moment],
  );
  const [translation, setTranslation] = useState<string | null>(null);
  const [showAuthorBar, setShowAuthorBar] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [visibilityModalVisible, setVisibilityModalVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number }>({
    top: 70,
    right: 16,
  });
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  // ── Long-press context sheet (same style as chat) for post + comments ────
  const postRef = useRef<View>(null);
  const commentRefs = useRef<Record<string, View | null>>({});
  const composerRef = useRef<TextInput>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | { kind: "post"; anchor: { x: number; y: number; width: number; height: number } }
    | {
        kind: "comment";
        anchor: { x: number; y: number; width: number; height: number };
        comment: MomentComment;
      }
    | null
  >(null);

  const measure = (
    node: View | null,
    cb: (a: { x: number; y: number; width: number; height: number }) => void,
  ) => {
    if (!node) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    (node as unknown as {
      measureInWindow?: (
        f: (x: number, y: number, w: number, h: number) => void,
      ) => void;
    }).measureInWindow?.((x, y, width, height) => {
      cb({ x, y, width, height });
    });
  };

  const openPostMenu = () =>
    measure(postRef.current, (anchor) => setCtxMenu({ kind: "post", anchor }));
  const openCommentMenu = (comment: MomentComment) =>
    measure(commentRefs.current[comment.id], (anchor) =>
      setCtxMenu({ kind: "comment", anchor, comment }),
    );

  const translateText = async (text?: string | null) => {
    if (!text) return;
    try {
      const res = await api.post<{ translated: string }>("/ai/translate", { text });
      if (Platform.OS === "web") window.alert(`Translation\n${res.translated}`);
      else Alert.alert("Translation", res.translated);
    } catch {
      if (Platform.OS === "web") window.alert("Translation failed. Please try again.");
      else Alert.alert("Translate", "Translation failed. Please try again.");
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await api.delete(`/moments/${id}/comments/${commentId}`);
      setMoment((prev) =>
        prev
          ? {
              ...prev,
              comments: (prev.comments || []).filter(
                (c) => c.id !== commentId && c.reply_to !== commentId,
              ),
              comment_count: Math.max(0, (prev.comment_count || 1) - 1),
            }
          : prev,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    } catch {
      Alert.alert("Delete", "Couldn't delete this comment.");
    }
  };

  const onCtxSelect = async (actionId: string) => {
    const menu = ctxMenu;
    setCtxMenu(null);
    if (!menu || !moment) return;
    if (menu.kind === "post") {
      const text = moment.text || "";
      switch (actionId) {
        case "copy":
          if (text) await Clipboard.setStringAsync(text);
          break;
        case "translate":
          translatePost();
          break;
        case "share":
          try {
            await Share.share({ message: text || "Check out this moment" });
          } catch {
            /* user cancelled */
          }
          break;
        case "save":
          toggleSave();
          break;
        case "report":
          await api.post(`/moments/${moment.id}/report`, {}).catch(() => {});
          Alert.alert("Reported", "Thanks — we'll review this post.");
          break;
        case "delete":
          Alert.alert("Delete moment", "Delete this post permanently?", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                try {
                  await api.delete(`/moments/${moment.id}`);
                  router.back();
                } catch {
                  Alert.alert("Delete", "Couldn't delete this post.");
                }
              },
            },
          ]);
          break;
      }
      return;
    }
    // comment menu
    const c = menu.comment;
    switch (actionId) {
      case "reply":
        setReplyTo({ id: c.id, name: c.author?.name || "comment" });
        composerRef.current?.focus?.();
        break;
      case "copy":
        if (c.text) await Clipboard.setStringAsync(c.text);
        break;
      case "translate":
        translateText(c.text);
        break;
      case "like":
        likeComment(c.id);
        break;
      case "report":
        Alert.alert("Reported", "Thanks — we'll review this comment.");
        break;
      case "delete":
        Alert.alert("Delete comment", "Delete your comment?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteComment(c.id),
          },
        ]);
        break;
    }
  };

  // Build the quick-actions + list rows for whichever surface was pressed.
  const ctxConfig = React.useMemo((): {
    quick: QuickAction[];
    rows: SheetRow[];
    highlight: SheetHighlight;
  } | null => {
    if (!ctxMenu) return null;
    if (ctxMenu.kind === "post") {
      const quick: QuickAction[] = [
        { id: "copy", icon: "copy-outline" },
        { id: "translate", icon: "language-outline" },
        { id: "share", icon: "arrow-redo-outline" },
        { id: "save", icon: moment?.saved ? "bookmark" : "bookmark-outline", active: moment?.saved },
      ];
      const rows: SheetRow[] = [{ id: "report", icon: "flag-outline", label: "Report" }];
      if (moment?.is_mine)
        rows.push({ id: "delete", icon: "trash-outline", label: "Delete", danger: true });
      return { quick, rows, highlight: { kind: "text", text: moment?.text || "Post" } };
    }
    const c = ctxMenu.comment;
    const quick: QuickAction[] = [
      { id: "reply", icon: "arrow-undo-outline" },
      { id: "copy", icon: "copy-outline" },
      { id: "translate", icon: "language-outline" },
      { id: "like", icon: c.liked_by_me ? "heart" : "heart-outline", active: c.liked_by_me },
    ];
    const rows: SheetRow[] = [{ id: "report", icon: "flag-outline", label: "Report" }];
    if (c.author?.id && c.author.id === user?.id)
      rows.push({ id: "delete", icon: "trash-outline", label: "Delete", danger: true });
    const highlight: SheetHighlight = c.audio_url
      ? { kind: "voice", durationMs: c.audio_duration_ms }
      : { kind: "text", text: c.text };
    return { quick, rows, highlight };
  }, [ctxMenu, moment, user]);


  const handleMenuAction = async (action: MomentAction) => {
    if (!moment) return;
    try {
      switch (action) {
        case "delete":
          await api.delete(`/moments/${moment.id}`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
          break;
        case "pin_to_profile":
          await api.post(`/moments/${moment.id}/pin`, {});
          Haptics.selectionAsync();
          load();
          break;
        case "modify_visibility":
          setVisibilityModalVisible(true);
          break;
        case "add_to_favorites":
        case "upvote":
        case "dislike_post":
        case "dislike_author":
          Haptics.selectionAsync();
          break;
        case "report":
          await api.post(`/moments/${moment.id}/report`, {});
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
      }
    } catch {
      /* silently ignore — non-critical menu action */
    }
  };

  const translatePost = async () => {
    if (translation) {
      setTranslation(null);
      return;
    }
    if (!moment?.text || translating) return;
    setTranslating(true);
    try {
      const result = await api.post<{ translated: string }>("/ai/translate", {
        text: moment.text,
        target_language: user?.native_language || "en",
      });
      setTranslation(result.translated);
    } catch (e) {
      Alert.alert(
        "Translate",
        e instanceof Error ? e.message : "Translation failed. Try again.",
      );
    } finally {
      setTranslating(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const data = await api.get<Moment>(`/moments/${id}`);
      setMoment(data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Fire-and-forget view registration — backend ignores self-views so the
  // counter reflects real audience only.
  useEffect(() => {
    if (!id) return;
    api.post(`/moments/${id}/view`, {}).catch(() => {});
  }, [id]);

  const toggleLike = async () => {
    if (!moment) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMoment({
      ...moment,
      liked_by_me: !moment.liked_by_me,
      like_count: moment.like_count + (moment.liked_by_me ? -1 : 1),
    });
    try {
      await api.post(`/moments/${id}/like`);
    } catch {
      load();
    }
  };

  const toggleSave = async () => {
    if (!moment) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMoment({ ...moment, saved: !moment.saved });
    try {
      await api.post(`/moments/${id}/bookmark`);
    } catch {
      load();
    }
  };

  const voteOnPoll = async (optionIndex: number) => {
    if (!moment?.poll) return;
    // Optimistic — mirror the tab feed's flip so the poll bar animates instantly.
    const wasIdx = moment.poll.my_vote;
    if (wasIdx === optionIndex) return;
    const opts = moment.poll.options.map((o, i) => {
      let v = o.votes;
      if (wasIdx === i) v = Math.max(0, v - 1);
      if (i === optionIndex) v = v + 1;
      return { ...o, votes: v };
    });
    const total =
      wasIdx == null ? (moment.poll.total_votes || 0) + 1 : moment.poll.total_votes;
    setMoment({
      ...moment,
      poll: { ...moment.poll, options: opts, total_votes: total, my_vote: optionIndex },
    });
    try {
      const updated = await api.post<Moment>(`/moments/${id}/vote`, {
        option_index: optionIndex,
      });
      // Preserve the existing comments array from local state — the vote
      // endpoint returns the moment without its comments.
      setMoment((prev) => (prev ? { ...updated, comments: prev.comments } : updated));
    } catch {
      load();
    }
  };

  // ── Voice comment recording ─────────────────────────────────────────────
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recState, setRecState] = useState<"idle" | "recording" | "stopped">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [recBars, setRecBars] = useState<number[]>([]);
  const [sendingVoice, setSendingVoice] = useState(false);
  const recStateRef = useRef(recState);
  recStateRef.current = recState;

  useEffect(() => {
    if (recState !== "recording") return;
    const t = setInterval(() => setRecSeconds((v) => v + 1), 1000);
    const w = setInterval(
      () => setRecBars((prev) => [...prev.slice(-13), 4 + Math.round(Math.random() * 12)]),
      150,
    );
    return () => {
      clearInterval(t);
      clearInterval(w);
    };
  }, [recState]);

  const startRec = async () => {
    try {
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted) perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Microphone", "Microphone permission is needed for voice comments.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecSeconds(0);
      setRecBars([]);
      setRecState("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      Alert.alert("Microphone", "Could not start recording. Try again.");
    }
  };

  const stopRec = async () => {
    try {
      await recorder.stop();
    } catch {
      /* already stopped */
    }
    setRecState("stopped");
  };

  const cancelRec = async () => {
    try {
      await recorder.stop();
    } catch {
      /* noop */
    }
    setRecState("idle");
    setRecSeconds(0);
    setRecBars([]);
  };

  const encodeAudio = async (uri: string): Promise<string> => {
    if (Platform.OS === "web") {
      const blob = await fetch(uri).then((r) => r.blob());
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  };

  const sendVoiceComment = async () => {
    if (sendingVoice) return;
    setSendingVoice(true);
    const durationMs = Math.max(recSeconds * 1000, 1000);
    try {
      if (recStateRef.current === "recording") await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording");
      const base64 = await encodeAudio(uri);
      if (!base64) throw new Error("Empty recording");
      const newComment = await api.post<MomentComment>(`/moments/${id}/comments`, {
        audio_base64: base64,
        audio_mime: Platform.OS === "web" ? "audio/webm" : "audio/m4a",
        audio_duration_ms: durationMs,
        reply_to: replyTo?.id,
      });
      setMoment((prev) =>
        prev
          ? {
              ...prev,
              comments: [...(prev.comments || []), newComment],
              comment_count: prev.comment_count + 1,
            }
          : prev,
      );
      setReplyTo(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert(
        "Voice comment",
        e instanceof Error ? e.message : "Could not send. Try again.",
      );
    } finally {
      setSendingVoice(false);
      setRecState("idle");
      setRecSeconds(0);
      setRecBars([]);
    }
  };

  const joinRoom = async (roomId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.post(`/rooms/${roomId}/join`);
      router.push(`/room/${roomId}`);
    } catch {
      Alert.alert("Room ended", "This voice room is no longer live.");
      load();
    }
  };

  const comment = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const newComment = await api.post<MomentComment>(
        `/moments/${id}/comments`,
        { text, reply_to: replyTo?.id },
      );
      setMoment((prev) =>
        prev
          ? {
              ...prev,
              comments: [...(prev.comments || []), newComment],
              comment_count: prev.comment_count + 1,
            }
          : prev,
      );
      setDraft("");
      setReplyTo(null);
    } finally {
      setPosting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="moment-detail-screen">
      <View style={styles.header}>
        <BackButton testID="moment-detail-back-btn" />
        {showAuthorBar && moment?.author ? (
          <Pressable
            testID="moment-detail-header-author"
            style={styles.headerAuthor}
            onPress={() =>
              moment.author?.id && router.push(`/user/${moment.author.id}`)
            }
          >
            <Avatar
              name={moment.author.name}
              url={moment.author.avatar_url}
              size={30}
              frame={moment.author.active_frame}
            />
            <Text style={styles.headerAuthorName} numberOfLines={1}>
              {moment.author.name}
            </Text>
            {moment.author.is_vip ? (
              <VipBadge small tier={moment.author.vip_tier} />
            ) : null}
          </Pressable>
        ) : (
          <Text style={styles.headerTitle}>Moment</Text>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "web" ? undefined : "translate-with-padding"}
      >
        {loading || !moment ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.brand} />
          </View>
        ) : (
          <FlatList
            testID="moment-comment-list"
            style={{ flex: 1, minHeight: 0 }}
            keyboardShouldPersistTaps="handled"
            data={rootComments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onScroll={(e) =>
              setShowAuthorBar(e.nativeEvent.contentOffset.y > 56)
            }
            scrollEventThrottle={16}
            ListHeaderComponent={
              <View style={styles.momentCard}>
                <View style={styles.authorRow}>
                <Pressable
                  testID="moment-detail-author-avatar"
                  onPress={() =>
                    moment.author?.id && router.push(`/user/${moment.author.id}`)
                  }
                >
                  <Avatar
                    name={moment.author?.name}
                    url={moment.author?.avatar_url}
                    size={44}
                    flagCode={countryToCode(moment.author?.country)}
                    online={moment.author?.is_online}
                    frame={moment.author?.active_frame}
                    inVoiceRoom={!!moment.author?.in_voice_room}
                  />
                </Pressable>
                  <View style={{ flex: 1 }}>
                    <View
                      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                    >
                      <Text style={styles.authorName}>
                        {moment.author?.name}
                      </Text>
                      {moment.author?.is_vip ? (
                        <VipBadge small tier={moment.author?.vip_tier} />
                      ) : null}
                    </View>
                    {/* Same native → learning language pair the author shows on
                        their profile and in the moments list. */}
                    <View style={styles.langRow}>
                      <FlagIcon code={moment.author?.native_language} size={13} />
                      <Ionicons
                        name="arrow-forward"
                        size={9}
                        color={colors.onSurfaceSecondary}
                      />
                      {(moment.author?.learning_languages?.length
                        ? moment.author.learning_languages
                        : moment.author?.learning_language
                          ? [moment.author.learning_language]
                          : []
                      )
                        .slice(0, 3)
                        .map((c: string) => (
                          <FlagIcon key={c} code={c} size={13} />
                        ))}
                    </View>
                    <Text style={styles.time}>
                      {timeAgo(moment.created_at)}
                      {moment.is_mine && moment.visibility && moment.visibility !== "public"
                        ? ` · ${moment.visibility === "friends" ? "Friends only" : "Only you"}`
                        : ""}
                    </Text>
                  </View>
                  {moment.is_mine ? (
                    <View style={styles.viewCountWrap} testID="moment-view-count">
                      <Ionicons
                        name="eye-outline"
                        size={17}
                        color={colors.onSurfaceSecondary}
                      />
                      <Text style={styles.viewCountText}>
                        {moment.view_count || 0}
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    testID="moment-menu-btn"
                    onPress={(e) => {
                      // Anchor menu near the tapped position (right side of the
                      // screen, at the button's Y). Fallback constants keep it
                      // stable if we can't read the native event.
                      const y =
                        (e.nativeEvent as unknown as { pageY?: number })?.pageY ??
                        70;
                      setMenuAnchor({ top: y + 10, right: 16 });
                      setMenuVisible(true);
                    }}
                    hitSlop={8}
                    style={styles.menuBtn}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={20}
                      color={colors.onSurfaceSecondary}
                    />
                  </Pressable>
                </View>
                {/* Content order: voice → image/room → text → poll */}
                {moment.audio_url ? (
                  <View style={styles.postVoiceWrap} testID="moment-detail-audio">
                    <VoiceBubble
                      audioId={moment.audio_url.split("/").pop() as string}
                      durationMs={moment.audio_duration_ms}
                    />
                  </View>
                ) : null}
                {moment.room ? (
                  <>
                    <Pressable
                      ref={postRef}
                      onLongPress={openPostMenu}
                      delayLongPress={250}
                    >
                      <Text style={styles.momentText}>{moment.text}</Text>
                    </Pressable>
                    <RoomMomentCard
                      testID="moment-detail-room-card"
                      room={moment.room}
                      onPress={() => joinRoom(moment.room!.id)}
                    />
                  </>
                ) : (
                  <>
                    {moment.image_url ? (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: "/photo-viewer",
                            params: {
                              uri: assetUrl(moment.image_url)!,
                              mediaId: (moment.image_url || "").split("/").pop() as string,
                              momentId: moment.id,
                              likeCount: String(moment.like_count),
                              commentCount: String(moment.comment_count),
                              liked: moment.liked_by_me ? "1" : "0",
                            },
                          })
                        }
                      >
                        <Image
                          testID="moment-detail-image"
                          source={{ uri: assetUrl(moment.image_url)! }}
                          style={styles.momentImage}
                          contentFit="cover"
                          transition={150}
                        />
                      </Pressable>
                    ) : null}
                    <Pressable
                      ref={postRef}
                      onLongPress={openPostMenu}
                      delayLongPress={250}
                    >
                      <Text style={styles.momentText}>{moment.text}</Text>
                    </Pressable>
                  </>
                )}
                {translation ? (
                  <View style={styles.translationBlock} testID="moment-detail-translation">
                    <Ionicons name="language" size={13} color={colors.brand} />
                    <Text style={styles.translationText}>{translation}</Text>
                  </View>
                ) : null}
                {moment.poll ? (
                  <View style={styles.pollWrap} testID="moment-detail-poll">
                    {moment.poll.options.map((opt, idx) => {
                      const total = moment.poll?.total_votes || 0;
                      const pct = total > 0 ? (opt.votes / total) * 100 : 0;
                      const mine = moment.poll?.my_vote === idx;
                      return (
                        <Pressable
                          key={idx}
                          testID={`moment-detail-poll-option-${idx}`}
                          onPress={() => voteOnPoll(idx)}
                          style={[
                            styles.pollOption,
                            mine && { borderColor: colors.brand, borderWidth: 1.5 },
                          ]}
                        >
                          <View
                            style={[
                              styles.pollFill,
                              {
                                width: `${pct}%`,
                                backgroundColor: mine
                                  ? colors.brandTertiary
                                  : colors.surfaceSecondary,
                              },
                            ]}
                          />
                          <View style={styles.pollOptionInner}>
                            <Text style={styles.pollOptionText} numberOfLines={2}>
                              {opt.text}
                            </Text>
                            <Text style={styles.pollOptionPct}>
                              {total > 0 ? `${Math.round(pct)}%` : ""}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    <Text style={styles.pollTotal}>
                      {moment.poll.total_votes || 0} vote
                      {(moment.poll.total_votes || 0) === 1 ? "" : "s"}
                    </Text>
                  </View>
                ) : null}
                {moment.tags && moment.tags.length > 0 ? (
                  <View style={styles.tagRow}>
                    {moment.tags.map((t) => (
                      <View key={t} testID={`moment-detail-tag-${t}`} style={styles.tagChip}>
                        <Text style={styles.tagChipText}>#{t}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <View style={styles.actionRow}>
                  <Pressable
                    testID="moment-detail-like-btn"
                    style={styles.actionBtn}
                    onPress={toggleLike}
                  >
                    <Ionicons
                      name={moment.liked_by_me ? "heart" : "heart-outline"}
                      size={22}
                      color={moment.liked_by_me ? colors.error : colors.onSurfaceSecondary}
                    />
                    <Text style={styles.actionText}>{moment.like_count}</Text>
                  </Pressable>
                  <View style={styles.actionBtn}>
                    <Ionicons
                      name="chatbubble-outline"
                      size={20}
                      color={colors.onSurfaceSecondary}
                    />
                    <Text style={styles.actionText}>{moment.comment_count}</Text>
                  </View>
                  {moment.text ? (
                    <Pressable
                      testID="moment-detail-translate-btn"
                      style={styles.actionBtn}
                      onPress={translatePost}
                    >
                      {translating ? (
                        <ActivityIndicator size="small" color={colors.brand} />
                      ) : (
                        <TranslationIcon
                          testID="moment-detail-translate-icon"
                          size={19}
                          color={translation ? colors.brand : colors.onSurfaceSecondary}
                        />
                      )}
                    </Pressable>
                  ) : null}
                  <Pressable
                    testID="moment-detail-save-btn"
                    style={[styles.actionBtn, { marginLeft: "auto" }]}
                    onPress={toggleSave}
                  >
                    <Ionicons
                      name={moment.saved ? "bookmark" : "bookmark-outline"}
                      size={19}
                      color={moment.saved ? colors.brand : colors.onSurfaceSecondary}
                    />
                  </Pressable>
                </View>
                <LikersRow
                  momentId={moment.id}
                  likeCount={moment.like_count}
                  likers={moment.likers}
                />
                <View style={styles.postDivider} />
                <Text style={styles.commentsTitle}>
                  Comments({moment.comment_count || 0})
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.noComments}>
                No comments yet — be the first!
              </Text>
            }
            renderItem={({ item }) => {
              const replies = repliesByRoot.get(item.id) || [];
              const expanded = expandedRoots.has(item.id);
              const totalReplies = item.reply_count ?? replies.length;
              return (
                <View testID={`thread-${item.id}`}>
                  {/* Root comment */}
                  <View style={styles.threadRootRow}>
                    <View style={styles.threadAvatarCol}>
                      <Pressable
                        testID={`comment-author-avatar-${item.id}`}
                        onPress={() =>
                          item.author?.id && router.push(`/user/${item.author.id}`)
                        }
                      >
                        <Avatar
                          name={item.author?.name}
                          url={item.author?.avatar_url}
                          size={38}
                          flagCode={countryToCode(item.author?.country)}
                          online={item.author?.is_online}
                        />
                      </Pressable>
                      {expanded && replies.length > 0 ? (
                        <View style={styles.threadLine} />
                      ) : null}
                    </View>
                    <View style={styles.commentBody}>
                      <Text style={styles.commentAuthor}>
                        {item.author?.name}
                      </Text>
                      <View style={styles.commentMsgRow}>
                        <Pressable
                          testID={`comment-bubble-${item.id}`}
                          style={{ flexShrink: 1, minWidth: 0 }}
                          ref={(n) => {
                            commentRefs.current[item.id] = n as View | null;
                          }}
                          onLongPress={() => openCommentMenu(item)}
                          delayLongPress={250}
                        >
                          {item.audio_url ? (
                            <View
                              style={styles.commentVoiceWrap}
                              testID={`comment-audio-${item.id}`}
                            >
                              <VoiceBubble
                                audioId={item.audio_url.split("/").pop() as string}
                                durationMs={item.audio_duration_ms}
                              />
                            </View>
                          ) : (
                            <View style={styles.commentTextWrap}>
                              <Text style={styles.commentText}>{item.text}</Text>
                            </View>
                          )}
                        </Pressable>
                        <Pressable
                          testID={`comment-translate-btn-${item.id}`}
                          onPress={() => translateText(item.text)}
                          disabled={!item.text}
                          accessibilityLabel="Translate comment"
                          hitSlop={11}
                          style={[styles.transIconWrap, !item.text && styles.transIconDisabled]}
                        >
                          <TranslationIcon testID={`comment-translate-icon-${item.id}`} size={13} color={colors.onBrand} />
                        </Pressable>
                      </View>
                      <View style={styles.commentBottomRow}>
                        <Text style={styles.commentTime}>
                          {timeAgo(item.created_at)}
                        </Text>
                        <Pressable
                          testID={`comment-reply-btn-${item.id}`}
                          onPress={() =>
                            setReplyTo({
                              id: item.id,
                              name: item.author?.name || "comment",
                            })
                          }
                          hitSlop={6}
                          style={styles.commentAction}
                        >
                          <Ionicons
                            name="chatbubble-outline"
                            size={14}
                            color={colors.onSurfaceSecondary}
                          />
                          <Text style={styles.commentActionText}>Reply</Text>
                        </Pressable>
                        <Pressable
                          testID={`comment-like-btn-${item.id}`}
                          onPress={() => likeComment(item.id)}
                          hitSlop={6}
                          style={styles.commentAction}
                        >
                          <Ionicons
                            name={item.liked_by_me ? "heart" : "heart-outline"}
                            size={15}
                            color={
                              item.liked_by_me ? colors.error : colors.onSurfaceSecondary
                            }
                          />
                          {(item.like_count || 0) > 0 ? (
                            <Text
                              style={[
                                styles.commentActionText,
                                item.liked_by_me && { color: colors.error },
                              ]}
                            >
                              {item.like_count}
                            </Text>
                          ) : null}
                        </Pressable>
                      </View>
                      {totalReplies > 0 ? (
                        <Pressable
                          testID={`comment-toggle-replies-${item.id}`}
                          onPress={() => toggleExpand(item.id)}
                          style={styles.toggleRepliesRow}
                          hitSlop={6}
                        >
                          <View style={styles.toggleRepliesDash} />
                          <Text style={styles.toggleRepliesText}>
                            {expanded
                              ? "Hide replies"
                              : `View ${totalReplies} ${totalReplies === 1 ? "reply" : "replies"}`}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  {/* Nested replies — indented, matching root comment layout */}
                  {expanded
                    ? replies.map((r) => (
                        <View key={r.id} style={styles.replyRowWrap}>
                          <View style={styles.threadAvatarCol}>
                            <Pressable
                              onPress={() =>
                                r.author?.id && router.push(`/user/${r.author.id}`)
                              }
                            >
                              <Avatar
                                name={r.author?.name}
                                url={r.author?.avatar_url}
                                size={32}
                                flagCode={countryToCode(r.author?.country)}
                                online={r.author?.is_online}
                              />
                            </Pressable>
                          </View>
                          <View style={styles.commentBody}>
                            <Text style={styles.commentAuthor}>
                              {r.author?.name}
                            </Text>
                            {r.reply_to_author &&
                            r.reply_to_author !== item.author?.name ? (
                              <Text style={styles.replyingToText}>
                                Replying to{" "}
                                <Text style={{ color: colors.brand }}>
                                  @{r.reply_to_author}
                                </Text>
                              </Text>
                            ) : null}
                            <View style={styles.commentMsgRow}>
                              <Pressable
                                testID={`comment-bubble-${r.id}`}
                                style={{ flexShrink: 1, minWidth: 0 }}
                                ref={(n) => {
                                  commentRefs.current[r.id] = n as View | null;
                                }}
                                onLongPress={() => openCommentMenu(r)}
                                delayLongPress={250}
                              >
                                {r.audio_url ? (
                                  <View style={styles.commentVoiceWrap}>
                                    <VoiceBubble
                                      audioId={r.audio_url.split("/").pop() as string}
                                      durationMs={r.audio_duration_ms}
                                    />
                                  </View>
                                ) : (
                                  <View style={styles.commentTextWrap}>
                                    <Text style={styles.commentText}>{r.text}</Text>
                                  </View>
                                )}
                              </Pressable>
                              <Pressable
                                testID={`comment-translate-btn-${r.id}`}
                                onPress={() => translateText(r.text)}
                                disabled={!r.text}
                                accessibilityLabel="Translate reply"
                                hitSlop={11}
                                style={[styles.transIconWrap, !r.text && styles.transIconDisabled]}
                              >
                                <TranslationIcon testID={`comment-translate-icon-${r.id}`} size={13} color={colors.onBrand} />
                              </Pressable>
                            </View>
                            <View style={styles.commentBottomRow}>
                              <Text style={styles.commentTime}>
                                {timeAgo(r.created_at)}
                              </Text>
                              <Pressable
                                testID={`comment-reply-btn-${r.id}`}
                                onPress={() =>
                                  setReplyTo({
                                    id: r.id,
                                    name: r.author?.name || "comment",
                                  })
                                }
                                hitSlop={6}
                                style={styles.commentAction}
                              >
                                <Ionicons
                                  name="chatbubble-outline"
                                  size={13}
                                  color={colors.onSurfaceSecondary}
                                />
                                <Text style={styles.commentActionText}>Reply</Text>
                              </Pressable>
                              <Pressable
                                testID={`comment-like-btn-${r.id}`}
                                onPress={() => likeComment(r.id)}
                                hitSlop={6}
                                style={styles.commentAction}
                              >
                                <Ionicons
                                  name={r.liked_by_me ? "heart" : "heart-outline"}
                                  size={14}
                                  color={
                                    r.liked_by_me ? colors.error : colors.onSurfaceSecondary
                                  }
                                />
                                {(r.like_count || 0) > 0 ? (
                                  <Text
                                    style={[
                                      styles.commentActionText,
                                      r.liked_by_me && { color: colors.error },
                                    ]}
                                  >
                                    {r.like_count}
                                  </Text>
                                ) : null}
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      ))
                    : null}
                </View>
              );
            }}
          />
        )}

        {replyTo && (
          <View style={styles.replyBanner} testID="reply-banner">
            <Ionicons name="return-down-forward" size={16} color={colors.brand} />
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to {replyTo.name}
            </Text>
            <Pressable
              testID="reply-cancel-btn"
              onPress={() => setReplyTo(null)}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>
        )}

        {recState !== "idle" ? (
          <View style={styles.inputRow} testID="voice-comment-bar">
            <Pressable
              testID="voice-comment-cancel"
              style={styles.recCancelBtn}
              onPress={cancelRec}
              hitSlop={8}
            >
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
            {recState === "recording" ? (
              <View style={styles.recPill}>
                <Pressable testID="voice-comment-pause" onPress={stopRec} hitSlop={8}>
                  <Ionicons name="pause" size={20} color="#FFFFFF" />
                </Pressable>
                <View style={styles.recBarsRow}>
                  {recBars.map((h, i) => (
                    <View key={i} style={[styles.recBar, { height: h }]} />
                  ))}
                </View>
                <Text style={styles.recTime}>
                  {Math.floor(recSeconds / 60)}:
                  {(recSeconds % 60).toString().padStart(2, "0")}
                </Text>
              </View>
            ) : (
              <RecPreviewPill
                uri={recorder.uri}
                seconds={recSeconds}
                bars={recBars}
              />
            )}
            <Pressable
              testID="voice-comment-send"
              style={[styles.recSendBtn, sendingVoice && { opacity: 0.5 }]}
              onPress={sendVoiceComment}
              disabled={sendingVoice}
            >
              {sendingVoice ? (
                <ActivityIndicator size="small" color={colors.onBrand} />
              ) : (
                <Ionicons name="send" size={18} color={colors.onBrand} />
              )}
            </Pressable>
          </View>
        ) : (
          <View testID="comment-composer-row" style={styles.inputRow}>
            <TextInput
              ref={composerRef}
              testID="comment-input"
              style={styles.input}
              placeholder={
                replyTo ? `Reply to ${replyTo.name}...` : "Add comment..."
              }
              placeholderTextColor={colors.onSurfaceSecondary}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            {!draft.trim() && (
              <Pressable
                testID="voice-comment-mic"
                onPress={startRec}
                hitSlop={8}
                style={styles.micBtn}
              >
                <Ionicons name="mic" size={22} color={colors.brand} />
              </Pressable>
            )}
            {draft.trim().length > 0 && (
              <Pressable
                testID="comment-send-btn"
                onPress={comment}
                style={[styles.sendBtn, posting && { opacity: 0.4 }]}
                disabled={posting}
              >
                <Ionicons name="send" size={18} color={colors.onBrand} />
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
      <MomentActionsMenu
        visible={menuVisible}
        isOwner={!!moment?.is_mine}
        anchorTop={menuAnchor.top}
        anchorRight={menuAnchor.right}
        onClose={() => setMenuVisible(false)}
        onAction={handleMenuAction}
      />
      <VisibilityModal
        visible={visibilityModalVisible}
        current={(moment?.visibility as Visibility) || "public"}
        onClose={() => setVisibilityModalVisible(false)}
        onSelect={async (v) => {
          if (!moment) return;
          try {
            await api.patch(`/moments/${moment.id}/visibility`, { visibility: v });
            await load();
          } catch {
            /* keep modal open on error via caller */
          }
        }}
      />
      {ctxConfig && (
        <ActionSheetPopup
          visible
          anchor={ctxMenu?.anchor || null}
          align="left"
          highlight={ctxConfig.highlight}
          quick={ctxConfig.quick}
          rows={ctxConfig.rows}
          onClose={() => setCtxMenu(null)}
          onSelect={onCtxSelect}
        />
      )}
    </SafeAreaView>
  );
}

/** Preview pill after recording stops: play/pause + bars + duration. */
function RecPreviewPill({
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
      style={[pillStyles.pill, { backgroundColor: themeColors.brand }]}
      testID="voice-comment-preview"
    >
      <Pressable testID="voice-comment-play" onPress={toggle} hitSlop={8}>
        <Ionicons name={status.playing ? "pause" : "play"} size={20} color="#FFFFFF" />
      </Pressable>
      <View style={pillStyles.bars}>
        {bars.map((h, i) => (
          <View key={i} style={[pillStyles.bar, { height: h }]} />
        ))}
      </View>
      <Text style={pillStyles.time}>
        {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
      </Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  postVoiceWrap: {
    backgroundColor: colors.bubbleMine,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    alignSelf: "flex-start",
    minWidth: 210,
    marginBottom: spacing.sm,
  },
  commentVoiceWrap: {
    backgroundColor: colors.bubbleMine,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    alignSelf: "flex-start",
    minWidth: 190,
    marginTop: 2,
  },
  // Same soft circular chip as the chat composer / title-bar call icon.
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
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
  recTime: {
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.onSurface,
  },
  headerAuthor: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerAuthorName: {
    fontFamily: fonts.displaySemi,
    fontSize: 16,
    color: colors.onSurface,
    flexShrink: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 90,
  },
  momentCard: {
    // No card container — post content sits directly on the surface. The
    // Comments section is separated by a horizontal divider band, matching
    // the reference "Details" layout.
    paddingTop: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  postDivider: {
    height: 8,
    backgroundColor: colors.surfaceSecondary,
    marginHorizontal: -spacing.lg,
    marginVertical: spacing.md,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
  },
  authorName: {
    fontFamily: fonts.displaySemi,
    fontSize: 15,
    color: colors.onSurface,
  },
  time: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
  },
  viewCountWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  viewCountText: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: colors.onSurfaceSecondary,
  },
  menuBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  momentText: {
    fontFamily: fonts.text,
    fontSize: 16,
    lineHeight: 24,
    color: colors.onSurface,
  },
  translationBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  translationText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: colors.onBrandTertiary,
  },
  momentImage: {
    width: "100%",
    height: 240,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    marginTop: spacing.sm,
  },
  pollWrap: {
    gap: 8,
    marginTop: spacing.sm,
  },
  pollOption: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  pollFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  pollOptionInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pollOptionText: {
    flex: 1,
    fontFamily: fonts.textSemi,
    fontSize: 14,
    color: colors.onSurface,
  },
  pollOptionPct: {
    fontFamily: fonts.textBold,
    fontSize: 13,
    color: colors.brand,
    marginLeft: 8,
  },
  pollTotal: {
    fontFamily: fonts.textSemi,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.sm,
  },
  tagChip: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagChipText: {
    fontFamily: fonts.textBold,
    fontSize: 12,
    color: colors.onBrandTertiary,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    marginTop: 4,
    minHeight: 24,
  },
  actionGroupLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 32,
  },
  actionText: {
    fontFamily: fonts.textSemi,
    fontSize: 14,
    color: colors.onSurfaceSecondary,
  },
  commentsTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.onSurface,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  noComments: {
    fontFamily: fonts.text,
    fontSize: 14,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  commentRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  replyRow: {
    marginLeft: spacing.xl + spacing.sm,
  },
  // -- Threaded (Twitter-style) comment styles --
  threadRootRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  threadAvatarCol: {
    width: 38,
    alignItems: "center",
    position: "relative",
  },
  threadLine: {
    position: "absolute",
    top: 44,
    bottom: -8,
    left: 18,
    width: 2,
    backgroundColor: colors.divider,
    borderRadius: 1,
  },
  threadLineFull: {
    position: "absolute",
    top: 0,
    bottom: -8,
    left: 18,
    width: 2,
    backgroundColor: colors.divider,
    borderRadius: 1,
  },
  threadElbow: {
    position: "absolute",
    top: 0,
    left: 18,
    width: 18,
    height: 22,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.divider,
    borderBottomLeftRadius: 12,
  },
  replyRowWrap: {
    flexDirection: "row",
    gap: spacing.md,
    marginLeft: spacing.xl + spacing.sm,
    paddingBottom: spacing.md,
  },
  commentActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.md,
    marginTop: 4,
    position: "absolute",
    right: 0,
    bottom: spacing.sm,
  },
  commentMsgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },
  commentTextWrap: {
    flexShrink: 1,
  },
  commentBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: 4,
  },
  commentBottomActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  commentActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    alignSelf: "center",
    paddingLeft: spacing.sm,
  },
  commentActionIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    padding: 4,
  },
  transIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  transIconDisabled: { opacity: 0.4 },
  commentTime: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
  },
  commentAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  commentActionText: {
    fontFamily: fonts.textSemi,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
  },
  toggleRepliesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  toggleRepliesDash: {
    width: 24,
    height: 2,
    backgroundColor: colors.border,
    borderRadius: 1,
  },
  toggleRepliesText: {
    fontFamily: fonts.textBold,
    fontSize: 12,
    color: colors.brand,
  },
  replyingToText: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
    marginTop: 1,
  },
  // -- legacy (kept in case other components reference) --
  replyTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  replyTagText: {
    fontFamily: fonts.textSemi,
    fontSize: 11,
    color: colors.brand,
  },
  replyBtnText: {
    fontFamily: fonts.textBold,
    fontSize: 12,
    color: colors.brand,
    marginTop: 2,
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.brandTertiary,
  },
  replyBannerText: {
    flex: 1,
    fontFamily: fonts.textSemi,
    fontSize: 13,
    color: colors.onBrandTertiary,
  },
  commentBody: {
    flex: 1,
    gap: spacing.xs,
  },
  commentAuthor: {
    fontFamily: fonts.textSemi,
    fontSize: 14,
    color: colors.onSurfaceSecondary,
  },
  commentText: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 21,
    color: colors.onSurface,
  },
  inputRow: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    fontFamily: fonts.text,
    fontSize: 15,
    color: colors.onSurface,
    maxHeight: 100,
    minHeight: 40,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
