/**
 * LinguaConnect auth screen — email-only login + signup.
 *
 * A clean, reference-inspired form with a centered heading and rounded CTA.
 * Both flows share the same fields (name shown only when signing up).
 * Only working email authentication is exposed; no guest or social placeholders.
 */

import { Ionicons } from "@/src/ui/icons";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "@/src/components/layout/KeyboardAvoidingView";
import { AppLogo } from "@/src/components/AppLogo";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/src/components/BackButton";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, spacing, ThemeColors } from "@/src/theme";
import { GoogleGlyph } from "@/src/ui/GoogleGlyph";
import { ApiError } from "@/src/utils/net-diagnostics";

type FieldKey = "name" | "email" | "password";
type Mode = "login" | "register";

export default function AuthScreen() {
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(
    initialMode === "login" ? "login" : "register",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<FieldKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const { login, register, signInWithGoogle, googleError, user } = useAuth();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const submitting = useRef(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode: themeMode } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    setMode(initialMode === "login" ? "login" : "register");
    setError(null);
    setShowPassword(false);
  }, [initialMode]);

  const isLogin = mode === "login";

  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordValid = password.length >= 6;
  const nameValid = isLogin || name.trim().length >= 1;
  const formValid = emailValid && (isLogin ? password.length > 0 : passwordValid) && nameValid;

  const routeAfterAuth = useCallback(
    (u: { native_language?: string | null; learning_language?: string | null }) => {
      if (!u.native_language || !u.learning_language) {
        router.replace("/onboarding");
      } else {
        router.replace("/(tabs)/connect");
      }
    },
    [router],
  );

  // Single owner of post-auth navigation: whichever path signs the user in
  // (email form, Google auth-session result, or a hot deep link that landed
  // while this screen was open), the screen must change once `user` exists.
  const routedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || routedFor.current === user.id) return;
    routedFor.current = user.id;
    routeAfterAuth(user);
  }, [user, routeAfterAuth]);

  // Surface Google failures (including cold-start ones) in the same error row.
  useEffect(() => {
    if (googleError) setError(googleError);
  }, [googleError]);

  const startGoogle = async () => {
    if (busy || googleBusy) return;
    setError(null);
    Keyboard.dismiss();
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // Success is handled by the `user` effect above; `null` = cancelled or
      // web navigation in progress — nothing to show.
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : "Google sign-in didn't complete."));
    } finally {
      if (Platform.OS !== "web") setGoogleBusy(false);
    }
  };

  const humanizeError = (raw: string) => {
    if (/incorrect email or password/i.test(raw)) {
      return "Wrong email or password. Please try again.";
    }
    if (/email already registered/i.test(raw)) {
      return "This email is already registered. Try logging in instead.";
    }
    if (/banned/i.test(raw)) return "This account has been suspended.";
    // Transport failures already arrive with a precise, honest message from
    // `src/utils/net-diagnostics.ts` (offline vs. server unreachable vs.
    // timeout vs. unconfigured build) — never flatten them back into a generic
    // "check your connection". Only third-party/raw fetch messages need help.
    if (/^network request failed$|failed to fetch/i.test(raw.trim())) {
      return "Can't reach the server right now. Please try again.";
    }
    return raw;
  };

  // ── email / password submit ──────────────────────────────────────────
  const submit = async () => {
    if (submitting.current) return;
    setError(null);
    setRetryable(false);
    if (!email.trim()) return setError("Please enter your email.");
    if (!emailValid) return setError("Please enter a valid email address.");
    if (!password) return setError("Please enter your password.");
    if (!isLogin && !passwordValid) {
      return setError("Password must be at least 6 characters.");
    }
    if (!isLogin && !name.trim()) return setError("Please enter your name.");
    Keyboard.dismiss();
    submitting.current = true;
    setBusy(true);
    try {
      const authedUser = isLogin
        ? await login(email.trim(), password)
        : await register(email.trim(), password, name.trim());
      // Navigation happens in the `user` effect; guard against a stale race
      // where the context user was already this account.
      if (routedFor.current === authedUser.id) routeAfterAuth(authedUser);
    } catch (e) {
      // Connection-level failures are worth retrying in place; wrong password
      // and friends are not.
      setRetryable(e instanceof ApiError && e.kind !== "http");
      setError(humanizeError(e instanceof Error ? e.message : "Something went wrong"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const inputWrapStyle = (key: FieldKey) => [
    styles.inputWrap,
    focused === key && styles.inputWrapFocused,
  ];

  const bothBusy = busy || googleBusy;


  // ── render ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingLeft: insets.left, paddingRight: insets.right }]} testID="auth-screen">
      <StatusBar style={themeMode === "dark" ? "light" : "dark"} />
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <BackButton
          testID="auth-back-btn"
          variant="plain"
          onPress={() => {
            if (busy) return;
            if (router.canGoBack()) router.back();
            else router.replace("/welcome");
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
          <AppLogo size={28} testID="auth-app-logo" />
          <Text style={styles.wordmark}>Mello</Text>
        </View>
        <View style={styles.headerBalance} />
      </View>

      {/* One continuous surface; scrollable with the keyboard open. */}
      <KeyboardAvoidingView
        style={styles.sheetFlex}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : Platform.OS === "android"
              ? "height"
              : undefined
        }
      >
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xxl + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.form}>
            <View style={styles.intro}>
              <Text testID="auth-title" accessibilityRole="header" style={styles.heading}>
                {isLogin ? "Login" : "Sign up"}
              </Text>
              <Text style={styles.subtitle}>
                {isLogin ? "Good to see you again." : "A new language. A new connection."}
              </Text>
            </View>

            {!isLogin && (
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <View style={inputWrapStyle("name")}>
                  <Ionicons
                    name="person-outline"
                    size={18}
                    color={focused === "name" ? colors.brand : colors.onSurfaceSecondary}
                  />
                  <TextInput
                    testID="auth-name-input"
                    accessibilityLabel="Name"
                    editable={!busy}
                    autoComplete="name"
                    textContentType="name"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    style={styles.input}
                    placeholder="Your name"
                    placeholderTextColor={colors.onSurfaceSecondary}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    onFocus={() => setFocused("name")}
                    onBlur={() => setFocused(null)}
                  />
                </View>
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <View style={inputWrapStyle("email")}>
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={focused === "email" ? colors.brand : colors.onSurfaceSecondary}
                />
                <TextInput
                  ref={emailRef}
                  testID="auth-email-input"
                  accessibilityLabel="Email"
                  editable={!busy}
                  autoCorrect={false}
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.onSurfaceSecondary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={inputWrapStyle("password")}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color={
                    focused === "password" ? colors.brand : colors.onSurfaceSecondary
                  }
                />
                <TextInput
                  ref={passwordRef}
                  testID="auth-password-input"
                  accessibilityLabel="Password"
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  textContentType={isLogin ? "password" : "newPassword"}
                  returnKeyType="go"
                  onSubmitEditing={() => { void submit(); }}
                  style={styles.input}
                  placeholder={isLogin ? "Your password" : "At least 6 characters"}
                  placeholderTextColor={colors.onSurfaceSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                />
                <Pressable
                  testID="auth-toggle-password-btn"
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                  accessibilityState={{ checked: showPassword }}
                  style={styles.passwordToggle}
                  onPress={() => setShowPassword((v) => !v)}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={19}
                    color={colors.onSurfaceSecondary}
                  />
                </Pressable>
              </View>
              {!isLogin && (
                <Text
                  style={[
                    styles.hint,
                    password.length > 0 && !passwordValid && { color: colors.error },
                  ]}
                >
                  {password.length === 0
                    ? "Use at least 6 characters."
                    : passwordValid
                      ? "✓ Looks good!"
                      : `${password.length}/6 characters`}
                </Text>
              )}
            </View>

            {isLogin && (
              <Pressable
                testID="auth-forgot-btn"
                accessibilityRole="button"
                style={styles.forgotButton}
                onPress={() => setError("Password recovery is not available in this preview yet.")}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            )}

            {error && (
              <View style={styles.errorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={15} color={colors.error} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text testID="auth-error-text" style={styles.error}>
                    {error}
                  </Text>
                  {retryable && (
                    <Pressable
                      testID="auth-retry-btn"
                      accessibilityRole="button"
                      disabled={bothBusy}
                      onPress={submit}
                      hitSlop={8}
                    >
                      <Text style={styles.retryText}>Try again</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            <Pressable
              testID="auth-submit-btn"
              accessibilityRole="button"
              accessibilityLabel={isLogin ? "Login" : "Sign up"}
              accessibilityState={{ disabled: busy || !formValid, busy }}
              style={({ pressed }) => [
                styles.submitWrap,
                (pressed || busy) && { opacity: 0.85 },
                (!formValid || bothBusy) && !busy && { opacity: 0.5 },
              ]}
              onPress={submit}
              disabled={bothBusy || !formValid}
            >
              <View style={styles.submitBtn}>
                {busy ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.submitText}>{isLogin ? "Login" : "Sign up"}</Text>
                )}
              </View>
            </Pressable>

            <View style={styles.dividerRow} accessibilityElementsHidden>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              testID="auth-google-btn"
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ disabled: bothBusy, busy: googleBusy }}
              style={({ pressed }) => [
                styles.googleBtn,
                pressed && { opacity: 0.85 },
                busy && { opacity: 0.5 },
              ]}
              onPress={() => { void startGoogle(); }}
              disabled={bothBusy}
            >
              {googleBusy ? (
                <ActivityIndicator color={colors.onSurface} />
              ) : (
                <>
                  <GoogleGlyph size={20} testID="auth-google-glyph" />
                  <Text style={styles.googleText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            <Pressable
              testID="auth-switch-mode-btn"
              accessibilityRole="button"
              accessibilityLabel={isLogin ? "Create an account" : "Log in instead"}
              disabled={busy}
              onPress={() => {
                setMode(isLogin ? "register" : "login");
                setShowPassword(false);
                setError(null);
              }}
              style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.switchPrompt}>
                {isLogin ? "Need an account? " : "Already have an account? "}
                <Text style={styles.switchText}>{isLogin ? "Sign up" : "Log in"}</Text>
              </Text>
            </Pressable>
            {!isLogin && <Text style={styles.tosText}>Your language journey starts with a simple hello.</Text>}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
    wordmark: { fontFamily: fonts.textSemi, fontSize: 13, letterSpacing: 0.3, color: colors.onSurfaceSecondary },
    headerBalance: { width: 40 },
    sheetFlex: { flex: 1 },
    sheet: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xxl, paddingTop: spacing.xl },
    form: { width: "100%", maxWidth: 380, alignSelf: "center" },
    intro: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.xxl },
    heading: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 36, color: colors.onSurface, textAlign: "center", letterSpacing: -0.5 },
    subtitle: { fontFamily: fonts.text, fontSize: 13, lineHeight: 20, textAlign: "center", color: colors.onSurfaceSecondary },
    field: { marginBottom: spacing.lg },
    label: { fontFamily: fonts.textSemi, fontSize: 12, color: colors.onSurfaceSecondary, marginBottom: spacing.sm, marginLeft: spacing.xs },
    inputWrap: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.divider, borderRadius: 14, paddingLeft: 16, paddingRight: 4 },
    inputWrapFocused: { borderColor: colors.brand, backgroundColor: colors.surface },
    input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 12, paddingRight: 8, fontFamily: fonts.text, fontSize: 14, color: colors.onSurface, ...(Platform.OS === "web" ? { outlineWidth: 0 } : {}) },
    passwordToggle: { width: 48, minHeight: 52, alignItems: "center", justifyContent: "center" },
    forgotButton: { minHeight: 44, justifyContent: "center", alignItems: "center", alignSelf: "flex-end", marginTop: -spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.sm },
    forgotText: { fontFamily: fonts.text, fontSize: 12, color: colors.onSurfaceSecondary, textDecorationLine: "underline" },
    hint: { fontFamily: fonts.text, fontSize: 11.5, lineHeight: 17, color: colors.onSurfaceSecondary, marginTop: 7, marginLeft: 4 },
    errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: `${colors.error}14`, borderRadius: 12, padding: 12, marginBottom: spacing.lg },
    error: { fontFamily: fonts.textSemi, fontSize: 12.5, lineHeight: 19, color: colors.error },
    retryText: { fontFamily: fonts.textSemi, fontSize: 12.5, color: colors.brand, textDecorationLine: "underline" },
    submitWrap: { marginTop: spacing.xs, borderRadius: 999, overflow: "hidden", backgroundColor: colors.onSurface },
    submitBtn: { minHeight: 52, alignItems: "center", justifyContent: "center", paddingVertical: 15, paddingHorizontal: spacing.lg },
    submitText: { fontFamily: fonts.textBold, fontSize: 15, color: colors.surface },
    dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.md },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
    dividerText: { fontFamily: fonts.text, fontSize: 12, color: colors.onSurfaceSecondary },
    googleBtn: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface, paddingVertical: 14, paddingHorizontal: spacing.lg },
    googleText: { fontFamily: fonts.textSemi, fontSize: 14.5, color: colors.onSurface },
    switchBtn: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: spacing.xl, paddingVertical: spacing.md },
    switchPrompt: { fontFamily: fonts.text, fontSize: 13, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
    switchText: { fontFamily: fonts.textBold, fontSize: 13, color: colors.onSurface },
    tosText: { textAlign: "center", fontFamily: fonts.text, fontSize: 11.5, color: colors.onSurfaceSecondary, marginTop: spacing.sm, lineHeight: 18 },
  });
