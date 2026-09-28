import { Ionicons } from "@/src/ui/icons";
import dayjs from "dayjs";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "@/src/components/layout/SafeAreaView";
import { AppLogo } from "@/src/components/AppLogo";

import { Avatar } from "@/src/components/Avatar";
import { GenderBadge, VipBadge } from "@/src/components/Badges";
import { FlagIcon } from "@/src/components/FlagIcon";
import { IconChip } from "@/src/components/IconChip";
import { countryToCode } from "@/src/constants/countries";
import { langName } from "@/src/constants/languages";
import { useAuth } from "@/src/context/AuthContext";
import { useNotifications } from "@/src/context/NotificationsContext";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, radius, shadow, spacing, ThemeColors } from "@/src/theme";
import { AppTitle } from "@/src/ui/AppTitle";
import { api, User, Visitor } from "@/src/utils/api";
import {
  getPushPermissionStatus,
  PushPermissionStatus,
  requestPushPermissionFromSettings,
} from "@/src/utils/push";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const FEATURES: {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  route: string;
}[] = [
  { key: "connect", label: "Connect", icon: "people", color: "#0E9AE0", route: "/(tabs)/connect" },
  { key: "moments", label: "Moments", icon: "planet", color: "#0E9AE0", route: "/(tabs)/moments" },
  { key: "voice", label: "Voice Rooms", icon: "mic", color: "#0EA5E9", route: "/(tabs)/voice" },
  { key: "chats", label: "Chats", icon: "chatbubbles", color: "#EC4899", route: "/(tabs)/chats" },
  { key: "market", label: "Marketplace", icon: "bag-handle", color: "#F59E0B", route: "/market" },
  { key: "wallet", label: "Wallet", icon: "wallet", color: "#F5B700", route: "/coins" },
  { key: "search", label: "Search", icon: "search", color: "#06B6D4", route: "/search" },
  { key: "visitors", label: "Visitors", icon: "eye", color: "#EF4444", route: "/visitors" },
  { key: "saved", label: "Saved", icon: "bookmark", color: "#38B6F1", route: "/saved-moments" },
  { key: "leaderboard", label: "Leaderboard", icon: "podium", color: "#F97316", route: "/leaderboard" },
  { key: "alerts", label: "Notifications", icon: "notifications", color: "#6366F1", route: "/notifications" },
];

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const { colors, mode, toggleMode } = useTheme();
  const { momentsUnread, profileUnread } = useNotifications();
  const router = useRouter();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus>("undetermined");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [visitorCount, setVisitorCount] = useState<number | null>(null);
  const [recentVisitors, setRecentVisitors] = useState<Visitor[]>([]);
  const [visitorsLocked, setVisitorsLocked] = useState(false);
  const [momentsCount, setMomentsCount] = useState<number | null>(null);
  const [privacy, setPrivacy] = useState<Record<string, boolean>>(
    user?.privacy || {},
  );
  const [social, setSocial] = useState<{
    followers: number;
    following: number;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Note: we intentionally do NOT call markProfileRead() here. The
      // Me-tab dot and the "Notifications" grid badge are only cleared when
      // the user actually opens the unified /notifications feed and reads
      // the detail (see notifications.tsx -> markAllRead()). Clearing on
      // mere tab visit would zero the badge before the user ever sees it.
      api
        .get<{ count: number; visitors: Visitor[]; vip_required: boolean }>(
          "/users/me/visitors",
        )
        .then((d) => {
          setVisitorCount(d.count);
          setRecentVisitors(d.visitors.slice(0, 4));
          setVisitorsLocked(d.vip_required);
        })
        .catch(() => {});
      api
        .get<{ count: number }>("/moments/mine/count")
        .then((d) => setMomentsCount(d.count))
        .catch(() => {});
      api
        .get<User>("/auth/me")
        .then((u) => {
          setUser(u);
          if (u.privacy) setPrivacy(u.privacy);
          if (u.id) {
            api
              .get<User>(`/users/${u.id}`)
              .then((d) =>
                setSocial({
                  followers: d.followers_count ?? 0,
                  following: d.following_count ?? 0,
                }),
              )
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, [setUser]),
  );

  const refreshPushStatus = useCallback(() => {
    getPushPermissionStatus().then(setPushStatus).catch(() => {});
  }, []);

  const enableNotifications = async () => {
    const status = await requestPushPermissionFromSettings();
    setPushStatus(status);
  };

  useEffect(() => {
    if (settingsOpen) refreshPushStatus();
  }, [settingsOpen, refreshPushStatus]);

  if (!user) return null;

  const daysMember = user.created_at
    ? Math.max(1, dayjs().diff(dayjs(user.created_at), "day") + 1)
    : 1;

  const openEdit = () => router.push("/edit-profile");
  const upgradeVip = () => router.push("/market");

  const togglePrivacy = async (key: string) => {
    const next = { ...privacy, [key]: !(privacy[key] ?? true) };
    setPrivacy(next);
    try {
      const updated = await api.put<User>("/users/me", { privacy: next });
      setUser(updated);
    } catch {
      setPrivacy(privacy);
    }
  };

  const onShare = async () => {
    try {
      await Share.share({
        message:
          "I'm learning languages on Mello — chat with native speakers, get AI translations and make friends worldwide. Join me!",
      });
    } catch {
      // dismissed
    }
  };

  const pickAvatar = async () => {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!current.granted) {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            "Photos",
            "Photo access is disabled. Enable it in Settings to set a profile photo.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert(
            "Photos",
            "Photo access is needed to set your profile photo.",
          );
        }
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    setUploadingAvatar(true);
    try {
      const updated = await api.post<User>("/users/me/avatar", {
        image_base64: asset.base64,
        mime: asset.mimeType || "image/jpeg",
      });
      setUser(updated);
    } catch {
      Alert.alert("Photo", "Could not update your photo. Try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const doLogout = async () => {
    setSettingsOpen(false);
    await logout();
    router.replace("/");
  };

  const learningNames =
    (user.learning_languages?.length
      ? user.learning_languages
      : user.learning_language
        ? [user.learning_language]
        : []
    )
      .map((c) => langName(c))
      .join(", ") || "Not set";

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top"]}
      testID="profile-screen"
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <Pressable style={styles.coinPill} testID="profile-coin-pill" onPress={() => router.push("/coins")}>
            <View style={styles.coinDot}>
              <Text style={styles.coinDotText}>HT</Text>
            </View>
            <Text style={styles.coinCount}>{user.coins ?? 0}</Text>
          </Pressable>
          <IconChip
            testID="profile-shop-btn"
            tint="brand"
            mci="storefront"
            size={18}
            onPress={() => router.push("/categories")}
          />
          <IconChip
            testID="profile-merch-btn"
            tint="brand"
            icon="bag-handle"
            size={17}
            onPress={() => router.push("/store")}
          />
        </View>
        <View style={styles.topActions}>
          <IconChip
            testID="share-btn"
            tint="brand"
            icon="share-social"
            size={17}
            onPress={onShare}
          />
          <IconChip
            testID="settings-btn"
            tint="brand"
            icon="settings-sharp"
            size={18}
            onPress={() => setSettingsOpen(true)}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {!user.is_vip && (
          <Pressable testID="promo-banner" onPress={upgradeVip}>
            <LinearGradient
              colors={["#16A34A", "#065F46"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.promoBanner}
            >
              <Ionicons name="diamond" size={16} color="#FDE68A" />
              <Text style={styles.promoText}>VIP 30% OFF · 3 Days Only</Text>
              <View style={styles.promoViewBtn}>
                <Text style={styles.promoViewText}>View</Text>
              </View>
            </LinearGradient>
          </Pressable>
        )}

        {/* Profile header */}
        <Pressable
          testID="profile-header-card"
          style={styles.headerCard}
          onPress={openEdit}
        >
          <View>
            <Avatar
              name={user.name}
              url={user.avatar_url}
              size={64}
              flagCode={countryToCode(user.country)}
              frame={user.active_frame}
            />
            <Pressable
              testID="avatar-edit-btn"
              style={styles.avatarEditBtn}
              onPress={pickAvatar}
              disabled={uploadingAvatar}
            >
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color={colors.onBrand} />
              ) : (
                <Ionicons name="camera" size={12} color={colors.onBrand} />
              )}
            </Pressable>
          </View>

          <View style={styles.headerInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              <GenderBadge gender={user.gender} />
              {user.is_vip && <VipBadge tier={user.vip_tier} />}
            </View>
            <Pressable testID="username-row" style={styles.usernamePill} onPress={openEdit}>
              <Text style={styles.usernameText}>
                @{user.username || "set username"}
              </Text>
              <Ionicons
                name="copy-outline"
                size={11}
                color={colors.onSurfaceSecondary}
              />
            </Pressable>
            <View style={styles.followRow}>
              <Pressable
                testID="profile-following-stat"
                style={styles.followItem}
                onPress={() => router.push("/follows?tab=following")}
              >
                <Text style={styles.followNum}>{social?.following ?? 0}</Text>
                <Text style={styles.followLabel}>Following</Text>
              </Pressable>
              <Pressable
                testID="profile-followers-stat"
                style={styles.followItem}
                onPress={() => router.push("/follows?tab=followers")}
              >
                <Text style={styles.followNum}>{social?.followers ?? 0}</Text>
                <Text style={styles.followLabel}>Followers</Text>
              </Pressable>
            </View>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.onSurfaceSecondary}
          />
        </Pressable>

        {/* Streak + Visitors */}
        <View style={styles.duoRow}>
          <View style={styles.duoCard} testID="profile-streak-stat">
            <Ionicons name="flame" size={22} color={colors.warning} />
            <View>
              <Text style={styles.duoValue}>{user.streak_count ?? 0}</Text>
              <Text style={styles.duoLabel}>Day Streak</Text>
            </View>
          </View>
          <Pressable
            testID="profile-visitors-stat"
            style={styles.duoCard}
            onPress={() => router.push("/visitors")}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.duoValue}>{visitorCount ?? 0}</Text>
              <Text style={styles.duoLabel}>Visitors</Text>
            </View>
            {visitorsLocked ? (
              <View style={styles.visitorStack} testID="profile-visitor-stack">
                {[0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.visitorAvatarWrap,
                      { marginLeft: i === 0 ? 0 : -10, zIndex: 4 - i },
                    ]}
                  >
                    <View style={styles.visitorLockedCircle}>
                      <Ionicons
                        name="person"
                        size={12}
                        color={colors.onSurfaceSecondary}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : recentVisitors.length > 0 ? (
              <View style={styles.visitorStack} testID="profile-visitor-stack">
                {recentVisitors.map((v, i) => (
                  <View
                    key={v.id}
                    style={[
                      styles.visitorAvatarWrap,
                      { marginLeft: i === 0 ? 0 : -10, zIndex: 4 - i },
                    ]}
                  >
                    <Avatar name={v.name} url={v.avatar_url} size={26} />
                  </View>
                ))}
              </View>
            ) : (
              <Ionicons name="eye" size={22} color={colors.brand} />
            )}
          </Pressable>
        </View>

        {/* Moments */}
        <Pressable
          testID="profile-moments-row"
          style={styles.momentsCard}
          onPress={() => router.push("/(tabs)/moments")}
        >
          <View style={[styles.momentsIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="planet" size={20} color={colors.brand} />
          </View>
          <Text style={styles.momentsTitle}>Moments</Text>
          <Text style={styles.momentsCount}>{momentsCount ?? 0}</Text>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.onSurfaceSecondary}
          />
        </Pressable>

        {/* VIP comparison / member banner */}
        {user.is_vip ? (
          <View style={styles.vipMemberCard} testID="vip-status-banner">
            <Ionicons name="diamond" size={20} color="#B45309" />
            <Text style={styles.vipMemberText}>
              You&apos;re a VIP member — unlimited translations, 3 learning
              languages & VIP badge
            </Text>
          </View>
        ) : (
          <View style={styles.vipCard} testID="vip-features-card">
            <View style={styles.vipHeaderRow}>
              <View style={styles.vipHeaderLeft}>
                <Ionicons name="ribbon" size={18} color="#B45309" />
                <Text style={styles.vipHeaderTitle}>VIP Features</Text>
              </View>
              <Text style={styles.vipCol}>Free</Text>
              <Text style={[styles.vipCol, styles.vipColHi]}>VIP</Text>
            </View>
            {[
              { label: "Unlimited Translations", free: "5/day", vip: "∞" },
              { label: "Unlock Visitors page", free: "—", vip: "✓" },
              { label: "Search nearby Users", free: "—", vip: "✓" },
            ].map((r) => (
              <View key={r.label} style={styles.vipRow}>
                <Text style={styles.vipFeatureLabel}>{r.label}</Text>
                <Text style={styles.vipFreeVal}>{r.free}</Text>
                <Text style={styles.vipVipVal}>{r.vip}</Text>
              </View>
            ))}
            <Pressable testID="vip-upgrade-btn" onPress={upgradeVip}>
              <LinearGradient
                colors={["#F59E0B", "#EF4444"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.unlockBtn}
              >
                <Text style={styles.unlockText}>Unlock 30% OFF</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {/* Feature grid */}
        <View style={styles.gridCard}>
          {FEATURES.map((f) => {
            const badgeCount =
              f.key === "alerts" ? momentsUnread + profileUnread : 0;
            return (
              <Pressable
                key={f.key}
                testID={`feature-${f.key}`}
                style={styles.gridItem}
                onPress={() => router.push(f.route as never)}
              >
                <View style={[styles.gridIcon, { backgroundColor: f.color }]}>
                  <Ionicons name={f.icon} size={20} color="#FFFFFF" />
                  {badgeCount > 0 && (
                    <View style={styles.gridBadge}>
                      <Text style={styles.gridBadgeText}>
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.gridLabel} numberOfLines={1}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Learning points */}
        <Text style={styles.groupLabel}>Learning Points</Text>
        <View style={styles.section}>
          <View style={styles.lpTopRow}>
            <View style={styles.lpTopItem}>
              <Ionicons name="calendar" size={16} color={colors.success} />
              <Text style={styles.lpTopText}>Joined for {daysMember} days</Text>
            </View>
            <View style={styles.lpTopItem}>
              <Text style={styles.lpCoin}>🪙</Text>
              <Text style={styles.lpTopText}>{user.coins ?? 0} Coins</Text>
            </View>
          </View>
          <View style={styles.lpStatsRow}>
            {[
              { icon: "flame" as IconName, color: colors.warning, value: user.streak_count ?? 0 },
              { icon: "planet" as IconName, color: "#0E9AE0", value: momentsCount ?? 0 },
              { icon: "people" as IconName, color: colors.brand, value: social?.followers ?? 0 },
              { icon: "person-add" as IconName, color: colors.success, value: social?.following ?? 0 },
              { icon: "eye" as IconName, color: colors.error, value: visitorCount ?? 0 },
            ].map((s, i) => (
              <View key={i} style={styles.lpStatCell}>
                <Ionicons name={s.icon} size={20} color={s.color} />
                <Text style={styles.lpStatValue}>{s.value}</Text>
              </View>
            ))}
          </View>
          <Pressable
            testID="lp-history-btn"
            onPress={() => router.push("/follows?tab=followers")}
          >
            <LinearGradient
              colors={[colors.brand, "#6366F1"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.historyBtn}
            >
              <Text style={styles.historyText}>View Community</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Invite friends */}
        <View style={styles.section}>
          <Text style={styles.inviteTitle}>Invite Friends</Text>
          <Text style={styles.inviteSub}>Share the link with your friends</Text>
          <Pressable testID="invite-share-btn" onPress={onShare}>
            <View style={styles.shareBtn}>
              <Ionicons name="share-social" size={18} color={colors.onBrand} />
              <Text style={styles.shareText}>Share</Text>
            </View>
          </Pressable>
        </View>

        <Pressable
          testID="how-it-works"
          style={styles.howRow}
          onPress={() => setSettingsOpen(true)}
        >
          <Text style={styles.howText}>Settings & Privacy</Text>
        </Pressable>
      </ScrollView>

      {/* ── Settings Modal ── */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <SafeAreaView style={styles.modalScreen} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <Pressable
              testID="settings-close-btn"
              onPress={() => setSettingsOpen(false)}
              style={styles.iconBtn}
            >
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
            <AppTitle variant="navigation" testID="settings-header-title" style={styles.modalTitle}>Settings</AppTitle>
            <View style={styles.iconBtn} />
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.groupLabel}>Appearance</Text>
            <View style={styles.section}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Ionicons name="moon" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Dark mode</Text>
                  <Text style={styles.settingSub}>
                    {mode === "dark"
                      ? "On — easy on the eyes"
                      : "Off — bright & friendly"}
                  </Text>
                </View>
                <View style={styles.modeToggle}>
                  <Pressable
                    testID="mode-light-btn"
                    onPress={() => mode === "dark" && toggleMode()}
                    style={[
                      styles.modeOpt,
                      mode === "light" && styles.modeOptActive,
                    ]}
                  >
                    <Ionicons
                      name="sunny"
                      size={16}
                      color={
                        mode === "light"
                          ? colors.onBrand
                          : colors.onSurfaceSecondary
                      }
                    />
                  </Pressable>
                  <Pressable
                    testID="mode-dark-btn"
                    onPress={() => mode === "light" && toggleMode()}
                    style={[
                      styles.modeOpt,
                      mode === "dark" && styles.modeOptActive,
                    ]}
                  >
                    <Ionicons
                      name="moon"
                      size={16}
                      color={
                        mode === "dark"
                          ? colors.onBrand
                          : colors.onSurfaceSecondary
                      }
                    />
                  </Pressable>
                </View>
              </View>
            </View>

            <Text style={styles.groupLabel}>Notifications</Text>
            <View style={styles.section}>
              <Pressable
                testID="settings-push-notifications"
                style={styles.settingRow}
                onPress={enableNotifications}
                disabled={pushStatus === "granted" || pushStatus === "unsupported"}
              >
                <View style={styles.settingIcon}>
                  <Ionicons name="notifications" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Push notifications</Text>
                  <Text style={styles.settingSub}>
                    {pushStatus === "granted"
                      ? "On — messages, followers & moment activity"
                      : pushStatus === "unsupported"
                        ? "Not available in this preview"
                        : pushStatus === "denied"
                          ? "Off — tap to enable in Settings"
                          : "Off — tap to enable"}
                  </Text>
                </View>
                {pushStatus === "granted" ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                ) : pushStatus !== "unsupported" ? (
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.onSurfaceSecondary}
                  />
                ) : null}
              </Pressable>
            </View>

            <Text style={styles.groupLabel}>Privacy</Text>
            <View style={styles.section}>
              {(
                [
                  { key: "show_online", label: "Show online status", icon: "radio-button-on" },
                  { key: "show_age", label: "Show my age", icon: "calendar" },
                  { key: "show_gender", label: "Show my gender", icon: "male-female" },
                  { key: "show_country", label: "Show my country & flag", icon: "flag" },
                  { key: "show_interests", label: "Show my interests", icon: "heart" },
                ] as const
              ).map((opt, idx, arr) => {
                const on = privacy[opt.key] ?? true;
                return (
                  <React.Fragment key={opt.key}>
                    <Pressable
                      testID={`privacy-${opt.key}`}
                      style={styles.settingRow}
                      onPress={() => togglePrivacy(opt.key)}
                    >
                      <View style={styles.settingIcon}>
                        <Ionicons name={opt.icon} size={16} color={colors.brand} />
                      </View>
                      <Text style={[styles.settingTitle, { flex: 1 }]}>
                        {opt.label}
                      </Text>
                      <View style={[styles.toggleTrack, on && styles.toggleTrackOn]}>
                        <View
                          style={[styles.toggleThumb, on && styles.toggleThumbOn]}
                        />
                      </View>
                    </Pressable>
                    {idx < arr.length - 1 && <View style={styles.settingDivider} />}
                  </React.Fragment>
                );
              })}
            </View>

            <Text style={styles.groupLabel}>Profile</Text>
            <View style={styles.section}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Ionicons name="language" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Native language</Text>
                  <Text style={styles.settingSub}>
                    {langName(user.native_language)}
                  </Text>
                </View>
                <FlagIcon code={user.native_language} size={22} />
              </View>
              <View style={styles.settingDivider} />
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Ionicons name="school" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Learning</Text>
                  <Text style={styles.settingSub}>
                    {learningNames}
                    {user.proficiency ? ` · ${user.proficiency}` : ""}
                  </Text>
                </View>
              </View>
              <View style={styles.settingDivider} />
              <Pressable
                testID="settings-edit-profile"
                style={styles.settingRow}
                onPress={() => {
                  setSettingsOpen(false);
                  setTimeout(openEdit, 250);
                }}
              >
                <View style={styles.settingIcon}>
                  <Ionicons name="create" size={18} color={colors.brand} />
                </View>
                <Text style={[styles.settingTitle, { flex: 1 }]}>
                  Edit profile & languages
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.onSurfaceSecondary}
                />
              </Pressable>
            </View>

            <Text style={styles.groupLabel}>About</Text>
            <View style={styles.section}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <AppLogo size={28} testID="settings-app-logo" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text testID="settings-app-name" style={styles.settingTitle}>Mello</Text>
                  <Text style={styles.settingSub}>
                    Version 1.2 · Language exchange, AI tools, voice rooms & calls
                  </Text>
                </View>
              </View>
              <View style={styles.settingDivider} />
              {/* Reachable in release builds on purpose: an installed app has
                  no console, so this is the only way a user can tell us what
                  their phone actually sees when the server seems unreachable. */}
              <Pressable
                testID="settings-connection-check"
                style={styles.settingRow}
                onPress={() => {
                  setSettingsOpen(false);
                  setTimeout(() => router.push("/connection-check"), 250);
                }}
              >
                <View style={styles.settingIcon}>
                  <Ionicons name="pulse" size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Connection check</Text>
                  <Text style={styles.settingSub}>
                    Test the server, see why it fails, copy a report
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.onSurfaceSecondary}
                />
              </Pressable>
            </View>

            <Pressable testID="logout-btn" style={styles.logoutBtn} onPress={doLogout}>
              <Ionicons name="log-out-outline" size={20} color={colors.error} />
              <Text style={styles.logoutText}>Log Out</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surfaceSecondary,
    },
    scroll: {
      padding: spacing.lg,
      paddingBottom: spacing.xxxl,
      gap: spacing.md,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    topLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    shopBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    coinPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      ...shadow.card,
    },
    coinDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "#F59E0B",
      alignItems: "center",
      justifyContent: "center",
    },
    coinDotText: {
      fontFamily: fonts.textBold,
      fontSize: 9,
      color: "#FFFFFF",
    },
    coinCount: {
      fontFamily: fonts.textBold,
      fontSize: 14,
      color: colors.onSurface,
      marginRight: 4,
    },
    topActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    iconChip: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    promoBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    promoText: {
      flex: 1,
      fontFamily: fonts.textBold,
      fontSize: 14,
      color: "#FFFFFF",
    },
    promoViewBtn: {
      backgroundColor: "#FFFFFF",
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: 5,
    },
    promoViewText: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: "#065F46",
    },
    headerCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    avatarEditBtn: {
      position: "absolute",
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.brand,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.surface,
    },
    headerInfo: {
      flex: 1,
      gap: 4,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    name: {
      fontFamily: fonts.display,
      fontSize: 20,
      color: colors.onSurface,
      flexShrink: 1,
    },
    usernamePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    usernameText: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
    },
    followRow: {
      flexDirection: "row",
      gap: spacing.xl,
      marginTop: 2,
    },
    followItem: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 4,
    },
    followNum: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onSurface,
    },
    followLabel: {
      fontFamily: fonts.text,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
    },
    duoRow: {
      flexDirection: "row",
      gap: spacing.md,
    },
    duoCard: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    duoValue: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.onSurface,
    },
    duoLabel: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
    },
    momentsCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    visitorStack: {
      flexDirection: "row",
      alignItems: "center",
    },
    visitorAvatarWrap: {
      borderRadius: 15,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    visitorLockedCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.surfaceTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    momentsIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    momentsTitle: {
      flex: 1,
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onSurface,
    },
    momentsCount: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onSurfaceSecondary,
    },
    vipMemberCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: "#FEF3C7",
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    vipMemberText: {
      flex: 1,
      fontFamily: fonts.textSemi,
      fontSize: 13,
      color: "#92400E",
    },
    vipCard: {
      backgroundColor: "#FEF9EC",
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: "#FCD34D",
    },
    vipHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.xs,
    },
    vipHeaderLeft: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    vipHeaderTitle: {
      fontFamily: fonts.display,
      fontSize: 16,
      color: "#065F46",
    },
    vipCol: {
      width: 70,
      textAlign: "center",
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: "#B45309",
    },
    vipColHi: {
      color: "#065F46",
    },
    vipRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    vipFeatureLabel: {
      flex: 1,
      fontFamily: fonts.textSemi,
      fontSize: 13,
      color: "#065F46",
    },
    vipFreeVal: {
      width: 70,
      textAlign: "center",
      fontFamily: fonts.text,
      fontSize: 13,
      color: "#B45309",
    },
    vipVipVal: {
      width: 70,
      textAlign: "center",
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: "#065F46",
    },
    unlockBtn: {
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      alignItems: "center",
      marginTop: spacing.sm,
    },
    unlockText: {
      fontFamily: fonts.textBold,
      fontSize: 16,
      color: "#FFFFFF",
    },
    gridCard: {
      flexDirection: "row",
      flexWrap: "wrap",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      ...shadow.card,
    },
    gridItem: {
      width: "25%",
      alignItems: "center",
      gap: 6,
      paddingVertical: spacing.md,
    },
    gridIcon: {
      width: 46,
      height: 46,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    gridBadge: {
      position: "absolute",
      top: -4,
      right: -4,
      minWidth: 17,
      height: 17,
      borderRadius: 9,
      paddingHorizontal: 3,
      backgroundColor: "#EF4444",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    gridBadgeText: {
      fontFamily: fonts.textBold,
      fontSize: 9,
      color: "#FFFFFF",
    },
    gridLabel: {
      fontFamily: fonts.textSemi,
      fontSize: 11,
      color: colors.onSurface,
      textAlign: "center",
    },
    groupLabel: {
      fontFamily: fonts.textBold,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginTop: spacing.sm,
      marginBottom: -spacing.xs,
    },
    section: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadow.card,
    },
    lpTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    lpTopItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    lpCoin: {
      fontSize: 14,
    },
    lpTopText: {
      fontFamily: fonts.textBold,
      fontSize: 14,
      color: colors.onSurface,
    },
    lpStatsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: spacing.md,
    },
    lpStatCell: {
      alignItems: "center",
      gap: 4,
      flex: 1,
    },
    lpStatValue: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onSurface,
    },
    historyBtn: {
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      alignItems: "center",
      marginTop: spacing.xs,
    },
    historyText: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: "#FFFFFF",
    },
    inviteTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.onSurface,
      textAlign: "center",
    },
    inviteSub: {
      fontFamily: fonts.text,
      fontSize: 13,
      color: colors.onSurfaceSecondary,
      textAlign: "center",
    },
    shareBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.brand,
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      marginTop: spacing.xs,
    },
    shareText: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onBrand,
    },
    howRow: {
      alignItems: "center",
      paddingVertical: spacing.md,
    },
    howText: {
      fontFamily: fonts.textSemi,
      fontSize: 13,
      color: colors.onSurfaceSecondary,
      textDecorationLine: "underline",
    },
    modalScreen: {
      flex: 1,
      backgroundColor: colors.surfaceSecondary,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      backgroundColor: colors.surface,
    },
    modalTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.onSurface,
    },
    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    settingIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.brandTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    settingTitle: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.onSurface,
    },
    settingSub: {
      fontFamily: fonts.text,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
      marginTop: 1,
    },
    settingDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: spacing.xs,
    },
    toggleTrack: {
      width: 42,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.surfaceTertiary,
      padding: 2,
      justifyContent: "center",
    },
    toggleTrackOn: {
      backgroundColor: colors.brand,
    },
    toggleThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "#FFFFFF",
    },
    toggleThumbOn: {
      marginLeft: 18,
    },
    modeToggle: {
      flexDirection: "row",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.pill,
      padding: 3,
      gap: 2,
    },
    modeOpt: {
      width: 34,
      height: 28,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    modeOptActive: {
      backgroundColor: colors.brand,
    },
    logoutBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.lg,
      marginTop: spacing.sm,
      ...shadow.card,
    },
    logoutText: {
      fontFamily: fonts.textBold,
      fontSize: 15,
      color: colors.error,
    },
  });
