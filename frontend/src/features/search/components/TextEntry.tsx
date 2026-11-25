import { useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useHehTheme } from "@/theme";

import { EXAMPLE_SEARCH_PROMPTS, MAX_SEARCH_QUERY_LENGTH, validateSearchQuery } from "../types";

export interface TextEntryProps {
  readonly query: string;
  readonly onChangeQuery: (value: string) => void;
  readonly onSubmit: () => void;
  readonly errorMessage?: string | null;
  readonly isBusy?: boolean;
  readonly autoFocus?: boolean;
  readonly onRetry?: () => void;
  readonly prompts?: readonly string[];
  readonly showPrompts?: boolean;
}

const CHAR_COUNTER_THRESHOLD = 420;

/**
 * Monochrome natural-Turkish text entry experience (`D22` / `SCREEN-03`).
 * Provides starter prompts, keyboard focus/clear management, validation feedback,
 * and offline/error text preservation with one-tap focus or retry recovery.
 */
export function TextEntry({
  query,
  onChangeQuery,
  onSubmit,
  errorMessage,
  isBusy = false,
  autoFocus = false,
  onRetry,
  prompts = EXAMPLE_SEARCH_PROMPTS,
  showPrompts = true,
}: TextEntryProps) {
  const { palette, typography, spacing, radius, borderWidth, touchTarget, icons, hitSlop } =
    useHehTheme();

  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [blankSubmitAttempted, setBlankSubmitAttempted] = useState(false);

  const validation = validateSearchQuery(query);
  const canSubmit = validation.valid && !isBusy;

  // Derived invalid feedback: immediately clears once input becomes valid without effect hooks.
  const localValidationError =
    validation.reason === "control_chars" || validation.reason === "too_long"
      ? validation.errorMessage
      : blankSubmitAttempted && !validation.valid
        ? validation.errorMessage
        : null;

  const activeError = errorMessage ?? localValidationError;
  const shouldShowPrompts = showPrompts && prompts.length > 0 && !query.trim() && !isBusy;
  const shouldShowCounter = query.length >= CHAR_COUNTER_THRESHOLD;

  const focusInput = (): void => {
    inputRef.current?.focus();
  };

  const handleChangeText = (nextValue: string): void => {
    if (blankSubmitAttempted && nextValue.trim().length > 0) {
      setBlankSubmitAttempted(false);
    }
    onChangeQuery(nextValue);
  };

  const handleClearPress = (): void => {
    setBlankSubmitAttempted(false);
    onChangeQuery("");
    focusInput();
  };

  const handlePromptPress = (promptText: string): void => {
    setBlankSubmitAttempted(false);
    onChangeQuery(promptText);
    focusInput();
  };

  const handleSubmitAttempt = (): void => {
    if (isBusy) {
      return;
    }
    if (!validation.valid) {
      if (validation.reason === "empty") {
        setBlankSubmitAttempted(true);
      }
      focusInput();
      return;
    }
    setBlankSubmitAttempted(false);
    onSubmit();
  };

  return (
    <View style={[styles.wrapper, { gap: spacing.sm }]} testID="text-search-composer">
      <View
        style={[
          styles.inputCard,
          {
            borderRadius: radius.lg,
            borderWidth: isFocused ? borderWidth.focus : borderWidth.control,
            borderColor: activeError || isFocused ? palette.borderFocus : palette.borderControl,
            backgroundColor: palette.surfaceMuted,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
        testID="text-search-input-card"
      >
        <TextInput
          ref={inputRef}
          accessibilityHint="Fiyat, renk, marka veya beden gibi ölçütleri Türkçe yaz"
          accessibilityLabel="Arama metni"
          autoCapitalize="none"
          autoCorrect
          autoFocus={autoFocus}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          multiline
          onBlur={() => setIsFocused(false)}
          onChangeText={handleChangeText}
          onFocus={() => setIsFocused(true)}
          onSubmitEditing={handleSubmitAttempt}
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
            accessibilityHint="Arama kutusundaki metni temizler ve odağı korur"
            accessibilityLabel="Metni temizle"
            accessibilityRole="button"
            hitSlop={hitSlop}
            onPress={handleClearPress}
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

      {shouldShowCounter ? (
        <View style={styles.counterRow}>
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textMuted }]}
            testID="text-search-char-count"
          >
            {`${query.length}/${MAX_SEARCH_QUERY_LENGTH}`}
          </Text>
        </View>
      ) : null}

      {shouldShowPrompts ? (
        <View style={[styles.promptsSection, { gap: spacing.xs }]} testID="text-search-prompts">
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textSecondary }]}
          >
            Örnek aramalar (dokunarak doldur):
          </Text>
          <View style={[styles.promptsWrap, { gap: spacing.xs }]}>
            {prompts.map((promptText, idx) => (
              <Pressable
                key={promptText}
                accessibilityHint="Arama kutusunu bu örnekle doldurur"
                accessibilityLabel={promptText}
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => handlePromptPress(promptText)}
                style={({ pressed }) => [
                  styles.promptChip,
                  {
                    minHeight: touchTarget.minimum,
                    borderRadius: radius.pill,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderControl,
                    backgroundColor: pressed ? palette.surfacePressed : palette.surfaceElevated,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                  },
                ]}
                testID={`text-prompt-chip-${idx}`}
              >
                <Text
                  maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
                  style={[typography.chip, { color: palette.textPrimary }]}
                >
                  {promptText}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {activeError ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.errorContainer,
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
          <View style={[styles.errorBannerRow, { gap: spacing.xs }]}>
            <Text accessible={false} style={[typography.caption, { color: palette.iconSecondary }]}>
              {icons.specs.alert.glyphFallback}
            </Text>
            <Text
              maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
              style={[typography.caption, { color: palette.textSecondary, flex: 1 }]}
            >
              {activeError}
            </Text>
          </View>
          <View
            style={[styles.errorActionsRow, { gap: spacing.xs }]}
            testID="text-search-error-actions"
          >
            <Pressable
              accessibilityLabel="Düzenle"
              accessibilityRole="button"
              hitSlop={hitSlop}
              onPress={focusInput}
              style={({ pressed }) => [
                styles.recoveryButton,
                {
                  minHeight: touchTarget.iosMinimum,
                  borderRadius: radius.sm,
                  borderWidth: borderWidth.hairline,
                  borderColor: palette.borderControl,
                  paddingHorizontal: spacing.sm,
                  backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                },
              ]}
              testID="text-search-focus-edit"
            >
              <Text
                maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                style={[typography.chip, { color: palette.textPrimary }]}
              >
                Düzenle
              </Text>
            </Pressable>

            {errorMessage && canSubmit ? (
              <Pressable
                accessibilityLabel="Tekrar Dene"
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={onRetry ?? handleSubmitAttempt}
                style={({ pressed }) => [
                  styles.recoveryButton,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.ctaBackground,
                    paddingHorizontal: spacing.sm,
                    backgroundColor: pressed ? palette.ctaPressed : palette.ctaBackground,
                  },
                ]}
                testID="text-search-retry"
              >
                <Text
                  maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                  style={[typography.chip, { color: palette.ctaText }]}
                >
                  Tekrar Dene
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityHint="Yazdığın ölçütleri inceleme ve bağlantı oluşturma adımına taşır"
        accessibilityLabel={isBusy ? "Hazırlanıyor..." : "Kriterleri Göster"}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit, busy: isBusy }}
        disabled={!canSubmit}
        hitSlop={hitSlop}
        onPress={handleSubmitAttempt}
        style={({ pressed }) => [
          styles.submitButton,
          {
            minHeight: touchTarget.minimum,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            gap: spacing.xs,
            backgroundColor: !canSubmit
              ? palette.ctaDisabledBackground
              : pressed
                ? palette.ctaPressed
                : palette.ctaBackground,
          },
        ]}
        testID="text-search-submit"
      >
        {isBusy ? <ActivityIndicator color={palette.ctaDisabledText} size="small" /> : null}
        <Text
          maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
          style={[
            typography.button,
            { color: canSubmit ? palette.ctaText : palette.ctaDisabledText },
          ]}
        >
          {isBusy ? "Hazırlanıyor..." : "Kriterleri Göster"}
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
  counterRow: {
    alignItems: "flex-end",
  },
  promptsSection: {
    width: "100%",
  },
  promptsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  promptChip: {
    justifyContent: "center",
  },
  errorContainer: {
    width: "100%",
  },
  errorBannerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  errorActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  recoveryButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
