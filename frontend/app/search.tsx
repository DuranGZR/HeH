import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TextSearchComposer } from "@/features/search";
import { normalizeSearchModeParam } from "@/services/widgets/deepLink";
import { useHehTheme } from "@/theme";

/**
 * Search entry target route for widget deep links (`heh://search?mode=voice|text`)
 * and home screen transitions. Voice mode verifies foreground permission before listening.
 */
export default function SearchEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[]; q?: string | string[] }>();
  const mode = normalizeSearchModeParam(params.mode);
  const initialQuery = Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "");

  const [queryText, setQueryText] = useState<string>(initialQuery);
  const [submittedNote, setSubmittedNote] = useState<string | null>(null);

  const { palette, typography, spacing, radius, borderWidth, touchTarget, layout, icons, hitSlop } =
    useHehTheme();

  const modeIcon = mode === "voice" ? icons.specs.mic : icons.specs.keyboard;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.background }]}
      testID="search-entry-screen"
    >
      <View
        style={[
          styles.frame,
          {
            maxWidth: layout.maxContentWidth,
            paddingHorizontal: layout.horizontalPadding,
            paddingVertical: layout.verticalPadding,
            gap: layout.sectionGap,
          },
        ]}
      >
        <Text
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

        {mode === "text" ? (
          <TextSearchComposer
            errorMessage={submittedNote}
            onChangeQuery={(value) => {
              setQueryText(value);
              if (submittedNote) {
                setSubmittedNote(null);
              }
            }}
            onSubmit={() => {
              setSubmittedNote(`Sorgu hazır (${queryText.trim().length} karakter).`);
            }}
            query={queryText}
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  frame: {
    flex: 1,
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
