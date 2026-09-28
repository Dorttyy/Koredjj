import { Ionicons } from "@/src/ui/icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "@/src/components/layout/KeyboardAvoidingView";
import { SafeAreaView } from "@/src/components/layout/SafeAreaView";

import { DateOfBirthPicker, DateOfBirthValue, computeAgeFromDob, dobToIso } from "@/src/components/DateOfBirthPicker";
import { CountryFlagIcon, FlagIcon } from "@/src/components/FlagIcon";
import { COUNTRIES } from "@/src/constants/countries";
import { INTERESTS, MAX_INTERESTS } from "@/src/constants/interests";
import { LANGUAGES } from "@/src/constants/languages";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, radius, spacing, ThemeColors } from "@/src/theme";
import { api, User } from "@/src/utils/api";

const MAX_LEARN = 1; // new accounts start as free users — VIP unlocks 3

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [nativeLang, setNativeLang] = useState<string | null>(null);
  const [learnLangs, setLearnLangs] = useState<string[]>([]);
  const [country, setCountry] = useState<string | null>(null);
  const [dob, setDob] = useState<DateOfBirthValue>({ year: null, month: null, day: null });
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setUser } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const steps = [
    {
      title: "What's your native language?",
      subtitle: "You'll help others learn it.",
    },
    {
      title: "Which language do you want to learn?",
      subtitle: "Pick one — VIP members can learn up to 3 languages.",
    },
    {
      title: "Where are you from?",
      subtitle: "Your country flag appears on your profile. This can't be changed later.",
    },
    {
      title: "A little about you",
      subtitle: "Your date of birth and gender appear on your profile. These can't be changed later.",
    },
    {
      title: "What do you love?",
      subtitle: `Pick up to ${MAX_INTERESTS} interests to find like-minded partners.`,
    },
  ];
  const lastStep = steps.length - 1;

  const ageComputed = computeAgeFromDob(dob);
  const ageValid = ageComputed != null && ageComputed >= 13 && ageComputed <= 120;

  const canContinue =
    (step === 0 && !!nativeLang) ||
    (step === 1 && learnLangs.length > 0) ||
    (step === 2 && !!country) ||
    (step === 3 && ageValid && !!gender) ||
    (step === 4 && interests.length > 0);

  const toggleIn = (
    list: string[],
    set: (v: string[]) => void,
    code: string,
    max: number,
  ) => {
    if (list.includes(code)) {
      set(list.filter((c) => c !== code));
    } else if (list.length < max) {
      set([...list, code]);
    }
  };

  const next = async () => {
    setError(null);
    if (step < lastStep) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        native_language: nativeLang,
        learning_languages: learnLangs,
        learning_language: learnLangs[0],
        country: COUNTRIES.find((c) => c.code === country)?.name,
        birthday: dobToIso(dob),
        gender,
        interests,
      };
      // `api.put` is idempotent and already retries transport failures three
      // times with backoff, so a second manual attempt here would only double
      // the time the button spins before the error is shown.
      const updated = await api.put<User>("/users/me", payload);
      setUser(updated);
      router.replace("/(tabs)/connect");
    } catch (e) {
      // `api` already returns a precise message (offline / server unreachable /
      // timeout / unconfigured build), so surface it as-is rather than
      // replacing every failure with "check your connection".
      const raw = e instanceof Error ? e.message : "Something went wrong";
      setError(/^network request failed$/i.test(raw.trim())
        ? "Can't reach the server right now. Please try again."
        : raw);
    } finally {
      setBusy(false);
    }
  };

  const renderLangGrid = (
    isSelected: (code: string) => boolean,
    onSelect: (code: string) => void,
    excluded: string[],
    testPrefix: string,
  ) => (
    <View style={styles.grid}>
      {LANGUAGES.filter((l) => !excluded.includes(l.code)).map((lang) => {
        const active = isSelected(lang.code);
        return (
          <Pressable
            key={lang.code}
            testID={`${testPrefix}-${lang.code}`}
            onPress={() => onSelect(lang.code)}
            style={[styles.langChip, active && styles.langChipActive]}
          >
            <FlagIcon code={lang.code} size={20} />
            <Text style={[styles.langName, active && styles.langNameActive]}>
              {lang.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} testID="onboarding-screen">
      <View style={styles.progressRow}>
        {steps.map((_, i) => (
          <View
            key={i}
            style={[styles.progressDot, i <= step && styles.progressDotActive]}
          />
        ))}
      </View>
      <Text style={styles.title}>{steps[step].title}</Text>
      <Text style={styles.subtitle}>{steps[step].subtitle}</Text>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        >
          {step === 0 &&
            renderLangGrid(
              (c) => nativeLang === c,
              (c) => setNativeLang(c),
              [],
              "onboarding-lang",
            )}
          {step === 1 &&
            renderLangGrid(
              (c) => learnLangs.includes(c),
              (c) => toggleIn(learnLangs, setLearnLangs, c, MAX_LEARN),
              nativeLang ? [nativeLang] : [],
              "onboarding-learn",
            )}
          {step === 2 && (
            <View style={styles.grid}>
              {COUNTRIES.map((c) => {
                const active = country === c.code;
                return (
                  <Pressable
                    key={c.code}
                    testID={`onboarding-country-${c.code}`}
                    onPress={() => setCountry(c.code)}
                    style={[styles.langChip, active && styles.langChipActive]}
                  >
                    <CountryFlagIcon country={c.code} size={20} />
                    <Text
                      style={[styles.langName, active && styles.langNameActive]}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {step === 3 && (
            <View style={styles.aboutBox}>
              <Text style={styles.sectionLabel}>Date of birth</Text>
              <DateOfBirthPicker
                testID="onboarding-dob-picker"
                value={dob}
                onChange={setDob}
              />
              {dob.year && dob.month && dob.day && (
                <View style={styles.ageDisplay}>
                  {ageValid ? (
                    <>
                      <Ionicons name="gift" size={16} color={colors.brand} />
                      <Text style={styles.ageDisplayText}>
                        You are {ageComputed} years old
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="alert-circle" size={16} color={colors.error} />
                      <Text style={[styles.ageDisplayText, { color: colors.error }]}>
                        Must be between 13 and 120 years old
                      </Text>
                    </>
                  )}
                </View>
              )}

              <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>
                Gender
              </Text>
              <View style={styles.genderRow}>
                {(["male", "female"] as const).map((g) => {
                  const active = gender === g;
                  return (
                    <Pressable
                      key={g}
                      testID={`onboarding-gender-${g}`}
                      onPress={() => setGender(g)}
                      style={[styles.genderCard, active && styles.genderCardActive]}
                    >
                      <View style={styles.genderIconWrap}>
                        <Ionicons
                          name={g}
                          size={30}
                          color={g === "male" ? "#3B82F6" : "#EC4899"}
                        />
                      </View>
                      <Text
                        style={[styles.langName, active && styles.langNameActive]}
                      >
                        {g === "male" ? "Male" : "Female"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {step === 4 && (
            <>
              <Text style={styles.counter}>
                {interests.length}/{MAX_INTERESTS} selected
              </Text>
              <View style={styles.grid}>
                {INTERESTS.map((i) => {
                  const active = interests.includes(i);
                  return (
                    <Pressable
                      key={i}
                      testID={`onboarding-interest-${i.toLowerCase().replace(/\s/g, "-")}`}
                      onPress={() =>
                        toggleIn(interests, setInterests, i, MAX_INTERESTS)
                      }
                      style={[styles.langChip, active && styles.langChipActive]}
                    >
                      <Text
                        style={[styles.langName, active && styles.langNameActive]}
                      >
                        {i}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>

        {error && (
          <Text testID="onboarding-error-text" style={styles.error}>
            {error}
          </Text>
        )}

        <View style={styles.footer}>
          {step > 0 && (
            <Pressable
              testID="onboarding-back-btn"
              onPress={() => setStep(step - 1)}
              style={styles.backBtn}
            >
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          )}
          <Pressable
            testID="onboarding-continue-btn"
            onPress={next}
            disabled={!canContinue || busy}
            style={[styles.continueBtn, (!canContinue || busy) && { opacity: 0.4 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Text style={styles.continueText}>
              {step === lastStep ? "Start Connecting" : "Continue"}
            </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.xl,
    },
    progressRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
    },
    progressDot: {
      flex: 1,
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceTertiary,
    },
    progressDotActive: {
      backgroundColor: colors.brand,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 26,
      color: colors.onSurface,
    },
    subtitle: {
      fontFamily: fonts.text,
      fontSize: 15,
      color: colors.onSurfaceSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    langChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 2,
      borderColor: "transparent",
    },
    langChipActive: {
      backgroundColor: colors.brandTertiary,
      borderColor: colors.brand,
    },
    langName: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.onSurfaceTertiary,
    },
    langNameActive: {
      color: colors.onBrandTertiary,
      fontFamily: fonts.textBold,
    },
    countryFlag: {
      width: 20,
      height: 20,
      borderRadius: 10,
    },
    ageBox: {
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.xl,
    },
    aboutBox: {
      paddingVertical: spacing.md,
    },
    sectionLabel: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: colors.onSurfaceTertiary,
      marginBottom: spacing.md,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    ageDisplay: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      backgroundColor: colors.brandTertiary,
      borderRadius: radius.md,
      alignSelf: "flex-start",
    },
    ageDisplayText: {
      fontFamily: fonts.textBold,
      fontSize: 14,
      color: colors.onBrandTertiary,
    },
    genderRow: {
      flexDirection: "row",
      gap: spacing.md,
    },
    genderCard: {
      flex: 1,
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 2,
      borderColor: "transparent",
    },
    genderCardActive: {
      backgroundColor: colors.brandTertiary,
      borderColor: colors.brand,
    },
    genderIconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    ageInput: {
      width: 140,
      textAlign: "center",
      fontFamily: fonts.display,
      fontSize: 44,
      color: colors.onSurface,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
      paddingVertical: spacing.lg,
    },
    ageHint: {
      fontFamily: fonts.textSemi,
      fontSize: 14,
      color: colors.onSurfaceSecondary,
    },
    counter: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: colors.brand,
      marginBottom: spacing.md,
    },
    error: {
      color: colors.error,
      fontFamily: fonts.textSemi,
      fontSize: 13,
      marginBottom: spacing.sm,
    },
    footer: {
      flexDirection: "row",
      gap: spacing.md,
      paddingVertical: spacing.lg,
    },
    backBtn: {
      paddingHorizontal: spacing.xl,
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
    },
    backText: {
      fontFamily: fonts.textBold,
      color: colors.onSurfaceTertiary,
      fontSize: 15,
    },
    continueBtn: {
      flex: 1,
      backgroundColor: colors.brand,
      borderRadius: radius.pill,
      paddingVertical: spacing.lg,
      alignItems: "center",
    },
    continueText: {
      color: colors.onBrand,
      fontFamily: fonts.textBold,
      fontSize: 16,
    },
  });
