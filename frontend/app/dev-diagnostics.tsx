/**
 * Developer-only network diagnostics (`/dev-diagnostics`).
 *
 * Answers the single question that used to be impossible to answer from an
 * installed build: *which* server is this binary talking to, and what exactly
 * happens when it tries? Shows the resolved base URL and where it came from,
 * the `/api/health` result, latency, HTTP status, the OS network state and
 * whether a session token is held.
 *
 * Hidden in production: the route immediately bounces back when `__DEV__` is
 * false, and it never prints tokens, passwords or API keys.
 */

import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "@/src/components/layout/SafeAreaView";

import { useTheme } from "@/src/context/ThemeContext";
import { fonts, radius, spacing, ThemeColors } from "@/src/theme";
import { getApiUrl, getAuthToken } from "@/src/utils/api";
import {
  checkBackendHealth,
  deviceHasInternet,
  HealthResult,
  hostOf,
} from "@/src/utils/net-diagnostics";

const sourceOfBaseUrl = (): string => {
  if (Platform.OS === "web") return "window.location.origin (web)";
  if (process.env.EXPO_PUBLIC_BACKEND_URL) return "EXPO_PUBLIC_BACKEND_URL (bundled at build time)";
  if (Constants.expoConfig?.extra?.backendUrl) return "expoConfig.extra.backendUrl (app config)";
  return "none — build has no server address";
};

export default function DevDiagnostics() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [internet, setInternet] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);

  const baseUrl = getApiUrl();

  const run = useCallback(async () => {
    setRunning(true);
    const [net, res] = await Promise.all([deviceHasInternet(), checkBackendHealth(baseUrl)]);
    setInternet(net);
    setHealth(res);
    setRunning(false);
  }, [baseUrl]);

  useEffect(() => {
    if (!__DEV__) {
      router.replace("/");
      return;
    }
    run();
  }, [run, router]);

  if (!__DEV__) return null;

  const rows: { label: string; value: string }[] = [
    { label: "Base URL", value: baseUrl || "(empty)" },
    { label: "Host", value: hostOf(baseUrl) },
    { label: "Source", value: sourceOfBaseUrl() },
    { label: "Scheme", value: baseUrl.startsWith("https") ? "https (secure)" : baseUrl ? "http (cleartext)" : "—" },
    { label: "Platform", value: `${Platform.OS} · ${Constants.expoConfig?.version ?? "?"}` },
    {
      label: "Device internet",
      value: internet === null ? "unknown" : internet ? "yes" : "no",
    },
    {
      label: "Health /api/health",
      value: !health
        ? "…"
        : health.ok
          ? `OK (${health.status})`
          : `FAILED (${health.kind ?? health.status ?? "error"})`,
    },
    { label: "Latency", value: health ? `${health.latencyMs} ms` : "—" },
    { label: "Session token", value: getAuthToken() ? "present" : "none" },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]} testID="dev-diagnostics-screen">
      <View style={styles.header}>
        <Pressable testID="diag-back" onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Network diagnostics</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          {rows.map((r) => (
            <View key={r.label} style={styles.row}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowValue} selectable>
                {r.value}
              </Text>
            </View>
          ))}
        </View>
        {health && !health.ok && !!health.detail && (
          <Text style={styles.detail} testID="diag-detail">
            {health.detail}
          </Text>
        )}
        <Pressable testID="diag-rerun" style={styles.button} onPress={run} disabled={running}>
          {running ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.buttonText}>Run again</Text>
          )}
        </Pressable>
        <Text style={styles.note}>
          Development only. No tokens, passwords or keys are shown here.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    title: { fontFamily: fonts.textSemi, fontSize: 16, color: colors.onSurface },
    link: { fontFamily: fonts.textSemi, fontSize: 14, color: colors.brand },
    body: { padding: spacing.lg, gap: spacing.md },
    card: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    row: { gap: 2 },
    rowLabel: { fontFamily: fonts.textSemi, fontSize: 11, color: colors.onSurfaceSecondary },
    rowValue: { fontFamily: fonts.text, fontSize: 13, color: colors.onSurface },
    detail: { fontFamily: fonts.text, fontSize: 12.5, lineHeight: 19, color: colors.error },
    button: {
      minHeight: 48,
      borderRadius: radius.lg,
      backgroundColor: colors.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: { fontFamily: fonts.textSemi, fontSize: 15, color: colors.onBrand },
    note: { fontFamily: fonts.text, fontSize: 11, color: colors.onSurfaceSecondary },
  });
