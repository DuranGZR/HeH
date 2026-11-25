import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useHehTheme } from "@/theme";

import { MAX_SEARCH_QUERY_LENGTH, canSubmitSearchQuery } from "../types";

export interface TextSearchComposerProps {
  readonly query: string;
  readonly onChangeQuery: (value: string) => void;
  readonly onSubmit: () => void;
  readonly errorMessage?: string | null;
  readonly isBusy?: boolean;
}

/**
 * Monochrome natural-Turkish query input composer (`SCREEN-03`).
 * Keeps submit disabled when blank/whitespace and caps input at backend limit (500 chars).
 */
export function TextSearchComposer({
  query,
  onChangeQuery,
  onSubmit,
  errorMessage,
  isBusy = false,
}: TextSearchComposerProps) {
  const { palette, typography, spacing, radius, borderWidth, touchTarget, icons, hitSlop } =
    useHehTheme();

  const canSubmit = canSubmitSearchQuery(query) && !isBusy;

  return (
    <View style={[styles.wrapper, { gap: spacing.sm }]} testID="text-search-composer">
      <View
        style={[
          styles.inputCard,
          {
            borderRadius: radius.lg,
            borderWidth: borderWidth.control,
            borderColor: errorMessage ? palette.borderFocus : palette.borderControl,
            backgroundColor: palette.surfaceMuted,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      >
        <TextInput
          accessibilityHint="Fiyat, renk, marka veya beden gibi ölçütleri Türkçe yaz"
          accessibilityLabel="Arama metni"
          autoCapitalize="none"
          autoCorrect
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          multiline
          onChangeText={onChangeQuery}
          onSubmitEditing={() => {
            if (canSubmit) {
              onSubmit();
            }
          }}
          placeholder="Örn. 3000 TL altı siyah M erkek mont"
          placeholderTextColor={palette.textMuted}
          returnKeyType="search"
          submitBehavior="submit"
          style={[
            typography.body,
            styles.inputField,
            {
              color: palette.textPrimary,
            },
          ]}
          testID="text-search-input"
          value={query}
        />

        {query.length > 0 ? (
          <Pressable
            accessibilityLabel="Metni temizle"
            accessibilityRole="button"
            hitSlop={hitSlop}
            onPress={() => onChangeQuery("")}
            style={[
              styles.clearButton,
              { minWidth: touchTarget.iosMinimum, minHeight: touchTarget.iosMinimum },
            ]}
            testID="text-search-clear"
          >
            <Text
              accessible={false}
              style={[typography.bodyMedium, { color: palette.textSecondary }]}
            >
              {icons.specs.close.glyphFallback}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {errorMessage ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.errorBanner,
            {
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderStyle: "dashed",
              borderColor: palette.borderControl,
              backgroundColor: palette.background,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              gap: spacing.xs,
            },
          ]}
          testID="text-search-error"
        >
          <Text accessible={false} style={[typography.caption, { color: palette.iconSecondary }]}>
            {icons.specs.alert.glyphFallback}
          </Text>
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textSecondary, flex: 1 }]}
          >
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityHint="Yazdığın ölçütleri inceleme ve bağlantı oluşturma adımına taşır"
        accessibilityLabel="Kriterleri Göster"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        hitSlop={hitSlop}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.submitButton,
          {
            minHeight: touchTarget.minimum,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            backgroundColor: !canSubmit
              ? palette.ctaDisabledBackground
              : pressed
                ? palette.ctaPressed
                : palette.ctaBackground,
          },
        ]}
        testID="text-search-submit"
      >
        <Text
          maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
          style={[
            typography.button,
            { color: canSubmit ? palette.ctaText : palette.ctaDisabledText },
          ]}
        >
          Kriterleri Göster
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
  },
  inputCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  inputField: {
    flex: 1,
    minHeight: 72,
    maxHeight: 144,
    textAlignVertical: "top",
  },
  clearButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
  },
  submitButton: {
    alignItems: "center",
    justifyContent: "center",
  },
});
