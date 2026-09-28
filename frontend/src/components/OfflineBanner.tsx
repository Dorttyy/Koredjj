/**
 * OfflineBanner — a soft strip that slides in from the top while the app has
 * no working connection. The copy depends on WHY, because "check your
 * connection" is wrong (and actively misleading) when the phone is online and
 * it is the backend that is missing or unreachable — the usual symptom of an
 * APK installed before the server was deployed. Renders nothing when online.
 */

import { Ionicons } from "@/src/ui/icons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useNetwork } from "@/src/context/NetworkContext";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, spacing, ThemeColors } from "@/src/theme";
import { hostOf, isEphemeralHost } from "@/src/utils/net-diagnostics";

export const OfflineBanner: React.FC = () => {
  const { isOnline, status, baseUrl } = useNetwork();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  if (isOnline) return null;

  let icon: React.ComponentProps<typeof Ionicons>["name"] = "cloud-offline";
  let title = "No network connection";
  let subtitle = "Please check your network settings";

  if (status === "no-server-url") {
    icon = "warning-outline";
    title = "No server address in this build";
    subtitle = "Re-publish the app, then install the new build";
  } else if (status === "server-not-running") {
    icon = "server-outline";
    title = "Server isn't running";
    subtitle = `${hostOf(baseUrl)} has no live app right now — tap for details`;
  } else if (status === "server-down") {
    icon = "cloud-offline-outline";
    title = "Can't reach the server";
    subtitle =
      Platform.OS !== "web" && isEphemeralHost(baseUrl)
        ? `${hostOf(baseUrl)} is a temporary address — deploy, then rebuild`
        : `${hostOf(baseUrl)} isn't responding — tap to diagnose`;
  }

  return (
    <Pressable
      // Tappable on purpose: on an installed build this banner is the only
      // entry point to the connection check, which is what turns "it doesn't
      // work" into an actual diagnosis.
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}. Tap to run a connection check.`}
      onPress={() => router.push("/connection-check")}
      style={[
        styles.banner,
        {
          paddingTop:
            Platform.OS === "android"
              ? insets.top + 10
              : insets.top === 0
                ? 12
                : insets.top + 4,
        },
      ]}
      testID="offline-banner"
    >
      <Ionicons name={icon} size={16} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} testID="offline-banner-title">
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.brand} />
    </Pressable>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    banner: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.brandTertiary,
      paddingHorizontal: spacing.md,
      paddingBottom: 10,
    },
    title: {
      fontFamily: fonts.textBold,
      fontSize: 13.5,
      color: colors.brand,
    },
    subtitle: {
      fontFamily: fonts.text,
      fontSize: 11.5,
      color: colors.brand,
      opacity: 0.75,
    },
  });
