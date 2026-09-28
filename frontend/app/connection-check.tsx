/**
 * Connection check (`/connection-check`) — available in RELEASE builds.
 *
 * Why this ships to production: when an installed APK cannot reach the
 * backend, there is no console, no debugger and no logcat available to the
 * person holding the phone. Without an in-app report the only signal we get is
 * "it doesn't work", and the actual cause (VPN, DNS filtering, carrier block,
 * captive portal, a stale build with the wrong server address, or a genuinely
 * down server) is indistinguishable.
 *
 * The screen therefore pairs OUR host with neutral control URLs:
 *   - our `/api/health`
 *   - Google's `generate_204`  -> does this phone have ANY internet?
 *   - Cloudflare's `cdn-cgi/trace` -> is Cloudflare (which fronts our backend)
 *     reachable, and from which IP/colo?
 * Comparing the three pinpoints the layer that is broken, and "Copy report"
 * lets the user paste the whole thing back to us.
 *
 * Privacy: never renders tokens, passwords, emails or API keys — only the
 * server address, OS network state, HTTP statuses, latencies and raw
 * transport-error strings.
 */

import * as Clipboard from "expo-clipboard";
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
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "@/src/components/layout/KeyboardAvoidingView";

import { SafeAreaView } from "@/src/components/layout/SafeAreaView";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, radius, spacing, ThemeColors } from "@/src/theme";
import {
  currentAddressSource,
  getApiUrl,
  getAuthToken,
  getManualAddress,
  lastTransportFailure,
  probeAddress,
  setManualAddress,
} from "@/src/utils/api";
import { useNetwork } from "@/src/context/NetworkContext";
import {
  CONTROL_PROBES,
  hostOf,
  isEphemeralHost,
  networkSnapshot,
  probeUrl,
  type NetworkSnapshot,
  type ProbeResult,
} from "@/src/utils/net-diagnostics";

const SOURCE_LABELS: Record<string, string> = {
  manual: "manual address you entered",
  "last-good": "last address that worked",
  "build-env": "EXPO_PUBLIC_BACKEND_URL (baked at build time)",
  "app-config": "app config extra.backendUrl",
  "web-origin": "window.location.origin (web)",
  none: "none — this build has no server address",
};

const sourceOfBaseUrl = (): string =>
  SOURCE_LABELS[currentAddressSource()] ?? currentAddressSource();

/** Plain-language conclusion so the user is not left reading raw errors. */
const verdictFor = (
  baseUrl: string,
  server: ProbeResult | null,
  controls: ProbeResult[],
): { title: string; detail: string } => {
  if (!baseUrl) {
    return {
      title: "This build has no server address",
      detail:
        "The app was packaged without a backend URL. Re-publish the app and install the new build.",
    };
  }
  if (!server) return { title: "Checking…", detail: "Running the connection tests." };
  if (!server.ok && server.errorName?.startsWith("HTTP ")) {
    // Something answered, but it is not this app's API.
    const gateway = /HTTP 50[234]/.test(server.errorName);
    return gateway
      ? {
          title: "Server is temporarily unavailable",
          detail: `${hostOf(baseUrl)} answered with ${server.errorName} (${server.errorMessage ?? ""}). The server is restarting or overloaded — wait a minute and run the check again.`,
        }
      : {
          title: "The app server isn't running at this address",
          detail: `${hostOf(baseUrl)} answered "${server.errorMessage ?? server.errorName}" — that is not the Mello API, so this deployment was removed, stopped or failed. Re-deploy the app from Emergent (Publish → Deploy). If the new deployment has a different address, enter it below or build a new APK.`,
        };
  }
  if (server.ok) {
    return {
      title: "Server reachable",
      detail: `${hostOf(baseUrl)} answered in ${server.latencyMs} ms. If the app still misbehaves, the problem is not the connection.`,
    };
  }
  const anyControlOk = controls.some((c) => c.ok);
  const cloudflareProbe = controls.find((c) => c.label === "Cloudflare edge");
  if (!controls.length) {
    return { title: "Can't reach the server", detail: server.errorMessage ?? "No response." };
  }
  if (!anyControlOk) {
    return {
      title: "This device has no working internet",
      detail:
        "Neither our server nor the neutral test addresses responded, so the phone itself is offline or behind a login-required Wi-Fi (captive portal). Switch to mobile data or another Wi-Fi and run the check again.",
    };
  }
  if (Platform.OS !== "web" && isEphemeralHost(baseUrl)) {
    return {
      title: "This build points at a temporary address",
      detail: `${hostOf(baseUrl)} only exists on the build machine, so a phone can never reach it. Deploy the app, then install a fresh build.`,
    };
  }
  if (cloudflareProbe && !cloudflareProbe.ok) {
    return {
      title: "Our server's network is blocked on this connection",
      detail:
        "The internet works, but Cloudflare — which our server sits behind — is unreachable too. That is almost always a VPN, a DNS/ad blocker, or the mobile operator filtering traffic. Turn off any VPN or blocker, or switch network, then run the check again.",
    };
  }
  return {
    title: "Only our server is unreachable",
    detail: `The internet works on this device, but ${hostOf(baseUrl)} did not answer (${server.timedOut ? "timed out" : (server.errorMessage ?? "transport error")}). The server may be restarting — wait a minute and run the check again. If it keeps failing, send us this report.`,
  };
};

export default function ConnectionCheck() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [server, setServer] = useState<ProbeResult | null>(null);
  const [controls, setControls] = useState<ProbeResult[]>([]);
  const [net, setNet] = useState<NetworkSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const { retry: retryConnection, status } = useNetwork();
  const [manual, setManual] = useState<string>(() => getManualAddress());
  const [manualBusy, setManualBusy] = useState(false);
  const [manualNote, setManualNote] = useState<string | null>(null);

  const baseUrl = getApiUrl();
  // Browsers block cross-origin reads without CORS headers, so the neutral
  // control URLs would always "fail" on web and mislead. They are only needed
  // on a device anyway — on web the fact that this page loaded already proves
  // the internet works. Memoised so `run` stays stable (an unstable dependency
  // would re-fire the probes on every render).
  const controlProbes = useMemo(
    () => (Platform.OS === "web" ? [] : CONTROL_PROBES),
    [],
  );

  const run = useCallback(async () => {
    setRunning(true);
    setCopied(false);
    const [snapshot, ours, ...rest] = await Promise.all([
      networkSnapshot(),
      baseUrl
        ? probeAddress(baseUrl, 15000).then(
            (h): ProbeResult => ({
              label: "Our server",
              url: `${baseUrl}/api/health`,
              ok: h.ok,
              status: h.status,
              latencyMs: h.latencyMs,
              timedOut: h.timedOut,
              errorName: h.errorName,
              errorMessage: h.errorMessage,
            }),
          )
        : Promise.resolve<ProbeResult>({
            label: "Our server",
            url: "",
            ok: false,
            latencyMs: 0,
            errorName: "no-backend-url",
            errorMessage: "This build has no server address",
          }),
      ...controlProbes.map((p) => probeUrl(p.label, p.url, 12000)),
    ]);
    setNet(snapshot);
    setServer(ours);
    setControls(rest);
    setRunning(false);
  }, [baseUrl, controlProbes]);

  /**
   * Point this installed build at a different backend without rebuilding it.
   * This is the escape hatch for a host that a particular phone cannot reach
   * (DNS filtering, a VPN, an operator block) or for an address that changed
   * after the app was published.
   */
  const applyManual = useCallback(async () => {
    setManualBusy(true);
    setManualNote(null);
    try {
      const saved = await setManualAddress(manual);
      setManual(saved);
      const reachable = await retryConnection();
      // Report the address that ACTUALLY answered: the engine falls over to
      // the next candidate, so "connected" may well mean a different host.
      const inUse = getApiUrl();
      setManualNote(
        !saved
          ? "Custom address cleared — using the address this build shipped with."
          : !reachable
            ? `${hostOf(saved)} did not answer. Check the address and try again.`
            : inUse === saved
              ? `Connected to ${hostOf(saved)}.`
              : `${hostOf(saved)} did not answer — still using ${hostOf(inUse)}.`,
      );
      await run();
    } catch (err) {
      setManualNote(err instanceof Error ? err.message : "Could not save that address.");
    } finally {
      setManualBusy(false);
    }
  }, [manual, retryConnection, run]);

  useEffect(() => {
    // Deferred by a tick so the first commit is never mutated synchronously.
    const id = setTimeout(() => {
      void run();
    }, 0);
    return () => clearTimeout(id);
  }, [run]);

  const verdict = verdictFor(baseUrl, server, controls);

  const rows: { label: string; value: string }[] = useMemo(
    () => [
      { label: "Server address", value: baseUrl || "(none)" },
      { label: "Address source", value: sourceOfBaseUrl() },
      {
        label: "App",
        value: `${Constants.expoConfig?.version ?? "?"} · ${Platform.OS} ${Platform.Version} · ${Constants.appOwnership ?? "standalone"}`,
      },
      { label: "Network type", value: net?.type ?? "…" },
      {
        label: "OS says connected",
        value: net ? `${net.isConnected} (internet reachable: ${net.isInternetReachable})` : "…",
      },
      { label: "Signed in", value: getAuthToken() ? "yes" : "no" },
    ],
    [baseUrl, net],
  );

  const probeRows = useMemo(
    () => [...(server ? [server] : []), ...controls],
    [server, controls],
  );

  const report = useMemo(
    () =>
      [
        "--- Mello connection report ---",
        ...rows.map((r) => `${r.label}: ${r.value}`),
        ...probeRows.map(
          (p) =>
            `${p.label}: ${p.ok ? `OK ${p.status}` : `FAIL ${p.timedOut ? "timeout" : `${p.errorName ?? ""} ${p.errorMessage ?? ""}`.trim()}`} (${p.latencyMs} ms)${
              p.label === "Cloudflare edge" && p.body
                ? ` [${(p.body.match(/ip=.*/)?.[0] ?? "").trim()} ${(p.body.match(/colo=.*/)?.[0] ?? "").trim()}]`
                : ""
            }`,
        ),
        `Status: ${status}`,
        (() => {
          const failure = lastTransportFailure();
          return failure
            ? `Last transport error: ${failure.kind} ${failure.errorName ?? ""} ${failure.errorMessage ?? ""}`.trim()
            : "Last transport error: none";
        })(),
        `Verdict: ${verdict.title}`,
      ].join("\n"),
    [rows, probeRows, verdict.title, status],
  );

  const copy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [report]);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]} testID="connection-check-screen">
      <View style={styles.header}>
        <Pressable testID="diag-back" onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Connection check</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, styles.verdictCard]}>
          <Text style={styles.verdictTitle} testID="diag-verdict">
            {verdict.title}
          </Text>
          <Text style={styles.verdictDetail}>{verdict.detail}</Text>
        </View>

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

        <Text style={styles.sectionTitle}>Tests</Text>
        <View style={styles.card}>
          {probeRows.length === 0 && <Text style={styles.rowValue}>Running…</Text>}
          {probeRows.map((p) => (
            <View key={p.label} style={styles.row}>
              <Text style={styles.rowLabel}>{p.label}</Text>
              <Text
                style={[styles.rowValue, { color: p.ok ? colors.success : colors.error }]}
                selectable
              >
                {p.ok
                  ? `OK · HTTP ${p.status} · ${p.latencyMs} ms`
                  : `FAILED · ${p.timedOut ? "timed out" : `${p.errorName ?? "error"}: ${p.errorMessage ?? "unknown"}`} · ${p.latencyMs} ms`}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Server address</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>
            Use a different server (advanced)
          </Text>
          <TextInput
            testID="diag-manual-input"
            value={manual}
            onChangeText={setManual}
            placeholder="https://my-app.emergent.host"
            placeholderTextColor={colors.onSurfaceSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          <Text style={styles.note}>
            Leave empty and save to go back to the address this build shipped with.
          </Text>
          {!!manualNote && (
            <Text style={styles.manualNote} testID="diag-manual-note">
              {manualNote}
            </Text>
          )}
          <Pressable
            testID="diag-manual-save"
            style={styles.buttonGhost}
            onPress={applyManual}
            disabled={manualBusy}
          >
            {manualBusy ? (
              <ActivityIndicator color={colors.onSurface} />
            ) : (
              <Text style={styles.buttonGhostText}>Save & test this address</Text>
            )}
          </Pressable>
        </View>

        <Pressable testID="diag-rerun" style={styles.button} onPress={run} disabled={running}>
          {running ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.buttonText}>Run the check again</Text>
          )}
        </Pressable>

        <Pressable testID="diag-copy" style={styles.buttonGhost} onPress={copy}>
          <Text style={styles.buttonGhostText}>
            {copied ? "Report copied" : "Copy report"}
          </Text>
        </Pressable>

        <Text style={styles.note}>
          This report contains no passwords, tokens or personal data.
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
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
    body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    verdictCard: { backgroundColor: colors.brandTertiary },
    verdictTitle: { fontFamily: fonts.textSemi, fontSize: 16, color: colors.onSurface },
    verdictDetail: {
      fontFamily: fonts.text,
      fontSize: 13,
      lineHeight: 20,
      color: colors.onSurfaceSecondary,
    },
    sectionTitle: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: colors.onSurfaceSecondary,
      marginTop: spacing.xs,
    },
    row: { gap: 2 },
    rowLabel: { fontFamily: fonts.textSemi, fontSize: 11, color: colors.onSurfaceSecondary },
    rowValue: { fontFamily: fonts.text, fontSize: 13, color: colors.onSurface },
    button: {
      minHeight: 48,
      borderRadius: radius.lg,
      backgroundColor: colors.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: { fontFamily: fonts.textSemi, fontSize: 15, color: colors.onBrand },
    buttonGhost: {
      minHeight: 48,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonGhostText: { fontFamily: fonts.textSemi, fontSize: 15, color: colors.onSurface },
    note: { fontFamily: fonts.text, fontSize: 11, color: colors.onSurfaceSecondary },
    manualNote: { fontFamily: fonts.textSemi, fontSize: 12, color: colors.brand },
    input: {
      minHeight: 48,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      fontFamily: fonts.text,
      fontSize: 14,
      color: colors.onSurface,
    },
  });
