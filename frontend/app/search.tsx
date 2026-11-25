import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  CriteriaReviewPanel,
  TextSearchComposer,
  canSubmitSearchQuery,
  useSearchFlow,
} from "@/features/search";
import { normalizeSearchModeParam } from "@/services/widgets/deepLink";
import { useHehTheme } from "@/theme";

/**
 * Search entry & 1-RTT review route (`heh://search?mode=voice|text`).
 * Voice entry requires explicit foreground consent; text queries show editable CriteriaReview.
 */
export default function SearchEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[]; q?: string | string[] }>();
  const mode = normalizeSearchModeParam(params.mode);
  const initialQuery = Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "");

  const [prevInitialQuery, setPrevInitialQuery] = useState<string>(initialQuery);
  const [queryText, setQueryText] = useState<string>(initialQuery);
  if (initialQuery !== prevInitialQuery) {
    setPrevInitialQuery(initialQuery);
    setQueryText(initialQuery);
  }
  const { palette, typography, spacing, radius, borderWidth, touchTarget, layout, icons, hitSlop } =
    useHehTheme();

  const {
    phase,
    resolution,
    chips,
    summaryText,
    ctaLabel,
    warnings,
    errorMessage,
    externalOpenError,
    canRestore,
    runParse,
    removeCriterion,
    restoreLastRemoved,
    openExternalResult,
  } = useSearchFlow();

  useEffect(() => {
    if (mode === "text" && canSubmitSearchQuery(initialQuery)) {
      void runParse(initialQuery, "text");
    }
  }, [initialQuery, mode, runParse]);

  const modeIcon = mode === "voice" ? icons.specs.mic : icons.specs.keyboard;
  const isBusy = phase === "parsing" || phase === "resolving" || phase === "opening_external";

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.background }]}
      testID="search-entry-screen"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={[
            styles.frame,
            {
              maxWidth: layout.maxContentWidth,
              paddingHorizontal: layout.horizontalPadding,
              paddingVertical: layout.verticalPadding,
              gap: layout.sectionGap,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={typography.wordmarkCompact.maxFontSizeMultiplier}
            style={[typography.wordmarkCompact, { color: palette.textPrimary }]}
          >
            heh.
          </Text>

          <View
            style={[
              styles.modeBadge,
              {
                alignSelf: "flex-start",
                borderRadius: radius.pill,
                borderWidth: borderWidth.hairline,
                borderColor: palette.borderControl,
                backgroundColor: palette.surfaceMuted,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xxs,
                gap: spacing.xs,
              },
            ]}
          >
            <Text accessible={false} style={[typography.caption, { color: palette.iconPrimary }]}>
              {modeIcon.glyphFallback}
            </Text>
            <Text
              maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
              style={[typography.badge, { color: palette.textPrimary }]}
            >
              {mode === "voice" ? "Sesli Giriş" : "Yazılı Giriş"}
            </Text>
          </View>

          <Text
            maxFontSizeMultiplier={typography.heroTitle.maxFontSizeMultiplier}
            style={[typography.heroTitle, { color: palette.textPrimary }]}
          >
            {mode === "voice" ? "Sesli Arama Hazır" : "Yazarak Arama"}
          </Text>

          <Text
            maxFontSizeMultiplier={typography.body.maxFontSizeMultiplier}
            style={[typography.body, { color: palette.textSecondary }]}
          >
            {mode === "voice"
              ? "Mikrofon yalnızca açık iznin ve dokunuşunla başlatılır."
              : "Aradığın ürünü doğal Türkçe ile yazabilirsin."}
          </Text>

          {mode === "voice" ? (
            <View style={{ gap: spacing.sm }} testID="voice-entry-fallback-box">
              {errorMessage ? (
                <Text
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                  style={[typography.caption, { color: palette.textSecondary }]}
                  testID="voice-search-error"
                >
                  {errorMessage}
                </Text>
              ) : null}
              <Pressable
                accessibilityLabel="Yazarak devam et"
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => router.replace({ pathname: "/search", params: { mode: "text" } })}
                style={({ pressed }) => [
                  styles.button,
                  {
                    minHeight: touchTarget.minimum,
                    borderRadius: radius.md,
                    borderWidth: borderWidth.control,
                    borderColor: palette.borderControl,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.lg,
                    backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                  },
                ]}
                testID="voice-fallback-text-button"
              >
                <Text
                  maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
                  style={[typography.button, { color: palette.textPrimary }]}
                >
                  Yazarak Devam Et
                </Text>
              </Pressable>
            </View>
          ) : (
            <TextSearchComposer
              errorMessage={errorMessage}
              isBusy={isBusy}
              onChangeQuery={setQueryText}
              onSubmit={() => {
                void runParse(queryText, "text");
              }}
              query={queryText}
            />
          )}

          {resolution && summaryText ? (
            <CriteriaReviewPanel
              canRestore={canRestore}
              chips={chips}
              ctaLabel={ctaLabel}
              externalOpenError={externalOpenError}
              isBusy={isBusy}
              onPressOpenExternal={() => {
                void openExternalResult();
              }}
              onRemoveCriterion={(criterionId) => {
                void removeCriterion(criterionId);
              }}
              onRestoreLast={() => {
                void restoreLastRemoved();
              }}
              resolution={resolution}
              summaryText={summaryText}
              warnings={warnings}
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ana ekrana dön"
            hitSlop={hitSlop}
            onPress={() => router.replace("/")}
            style={({ pressed }) => [
              styles.button,
              {
                marginTop: spacing.sm,
                minHeight: touchTarget.minimum,
                borderRadius: radius.md,
                borderWidth: borderWidth.hairline,
                borderColor: palette.borderControl,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.lg,
                backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
              },
            ]}
          >
            <Text
              maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
              style={[typography.button, { color: palette.textPrimary }]}
            >
              Ana Ekrana Dön
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  frame: {
    flexGrow: 1,
    width: "100%",
    alignSelf: "center",
    justifyContent: "center",
  },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
});
