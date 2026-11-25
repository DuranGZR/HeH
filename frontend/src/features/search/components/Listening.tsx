import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { MAX_SEARCH_QUERY_LENGTH, validateSearchQuery } from "../types";
import type { SpeechSessionState } from "@/services/speech";
import { useHehTheme } from "@/theme";

export interface ListeningProps {
  readonly state: SpeechSessionState;
  readonly isParsing?: boolean;
  readonly onStopListening: () => void;
  readonly onCancelListening: () => void;
  readonly onSubmitEditedTranscript: (transcript: string) => void;
  readonly onRetryVoice: () => void;
}

/**
 * Monochrome partial-vs-final STT surface (`D29` / `mobile/Listening.tsx`).
 * - Clearly marks `listening`/`stopping` text as ephemeral live hypotheses (never edits/submits early).
 * - Exposes a clean editable `finalTranscript` TextInput once finalized so users can fix ASR slips
 *   (phonetic brand names, numbers) before or after 1-RTT M0 review without re-recording.
 */
export function Listening({
  state,
  isParsing = false,
  onStopListening,
  onCancelListening,
  onSubmitEditedTranscript,
  onRetryVoice,
}: ListeningProps) {
  const { palette, typography, spacing, radius, borderWidth, touchTarget, hitSlop } = useHehTheme();

  const [prevFinalTranscript, setPrevFinalTranscript] = useState(state.finalTranscript);
  const [draftTranscript, setDraftTranscript] = useState(state.finalTranscript);
  if (state.finalTranscript !== prevFinalTranscript) {
    setPrevFinalTranscript(state.finalTranscript);
    setDraftTranscript(state.finalTranscript);
  }

  const isListeningPhase =
    state.status === "permission_request" ||
    state.status === "starting" ||
    state.status === "listening" ||
    state.status === "stopping";

  if (isListeningPhase) {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            borderRadius: radius.lg,
            borderWidth: borderWidth.focus,
            borderColor: palette.borderFocus,
            backgroundColor: palette.surfaceMuted,
            padding: spacing.md,
            gap: spacing.sm,
          },
        ]}
        testID="voice-listening-card"
      >
        <View style={[styles.statusRow, { gap: spacing.xs }]}>
          <ActivityIndicator color={palette.textPrimary} size="small" />
          <Text
            maxFontSizeMultiplier={typography.bodyMedium.maxFontSizeMultiplier}
            style={[typography.bodyMedium, { color: palette.textPrimary }]}
            testID="voice-listening-status"
          >
            {state.status === "permission_request"
              ? "Mikrofon izni bekleniyor..."
              : state.status === "stopping"
                ? "Konuşma sonlandırılıyor..."
                : "Dinleniyor (tr-TR)..."}
          </Text>
          <View
            style={{
              borderRadius: radius.pill,
              borderWidth: borderWidth.hairline,
              borderColor: palette.borderControl,
              paddingHorizontal: spacing.xs,
              paddingVertical: spacing.xxs,
            }}
            testID="voice-partial-badge"
          >
            <Text
              maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
              style={[typography.badge, { color: palette.textSecondary }]}
            >
              Anlık (geçici)
            </Text>
          </View>
        </View>

        {state.partialTranscript ? (
          <Text
            maxFontSizeMultiplier={typography.body.maxFontSizeMultiplier}
            style={[typography.body, { color: palette.textPrimary }]}
            testID="voice-partial-transcript"
          >
            {state.partialTranscript}
          </Text>
        ) : (
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textSecondary }]}
          >
            Örn. &ldquo;3000 altı siyah M erkek mont&rdquo;
          </Text>
        )}

        <View style={[styles.actionRow, { gap: spacing.xs }]}>
          {state.status === "listening" || state.status === "starting" ? (
            <Pressable
              accessibilityLabel="Dinlemeyi bitir"
              accessibilityRole="button"
              hitSlop={hitSlop}
              onPress={onStopListening}
              style={({ pressed }) => [
                styles.button,
                styles.flexButton,
                {
                  minHeight: touchTarget.minimum,
                  borderRadius: radius.md,
                  backgroundColor: pressed ? palette.ctaPressed : palette.ctaBackground,
                  paddingHorizontal: spacing.md,
                },
              ]}
              testID="voice-mic-stop"
            >
              <Text
                maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
                style={[typography.button, { color: palette.ctaText }]}
              >
                Bitir
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityLabel="Sesli aramayı iptal et"
            accessibilityRole="button"
            hitSlop={hitSlop}
            onPress={onCancelListening}
            style={({ pressed }) => [
              styles.button,
              styles.flexButton,
              {
                minHeight: touchTarget.minimum,
                borderRadius: radius.md,
                borderWidth: borderWidth.hairline,
                borderColor: palette.borderControl,
                backgroundColor: pressed ? palette.surfacePressed : palette.background,
                paddingHorizontal: spacing.md,
              },
            ]}
            testID="voice-mic-cancel"
          >
            <Text
              maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
              style={[typography.button, { color: palette.textPrimary }]}
            >
              İptal
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.status !== "transcribed" || !state.finalTranscript) {
    return null;
  }

  const draftValidation = validateSearchQuery(draftTranscript);
  const hasEditedDraft = draftTranscript.trim() !== state.finalTranscript.trim();
  const canSubmitDraft = draftValidation.valid && !isParsing;

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: radius.md,
          borderWidth: borderWidth.hairline,
          borderColor: palette.borderControl,
          backgroundColor: palette.surfaceMuted,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.xs,
        },
      ]}
      testID="voice-final-transcript-box"
    >
      <View style={styles.headerRow}>
        <Text
          maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
          style={[typography.badge, { color: palette.textMuted }]}
          testID="voice-final-badge"
        >
          Son Transkript (Düzenlenebilir)
        </Text>
        <Text
          maxFontSizeMultiplier={typography.body.maxFontSizeMultiplier}
          numberOfLines={1}
          style={[typography.caption, { color: palette.textSecondary, flexShrink: 1 }]}
          testID="voice-final-transcript"
        >
          {state.finalTranscript}
        </Text>
      </View>

      <TextInput
        accessibilityHint="Sesli tanıma sonucunda yanlış kelime varsa düzeltebilirsin"
        accessibilityLabel="Algılanan arama metnini düzenle"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={MAX_SEARCH_QUERY_LENGTH}
        multiline
        onChangeText={setDraftTranscript}
        onSubmitEditing={() => {
          if (canSubmitDraft) {
            onSubmitEditedTranscript(draftTranscript.trim());
          }
        }}
        placeholder="Algılanan aramayı düzenle..."
        placeholderTextColor={palette.textMuted}
        returnKeyType="search"
        style={[
          typography.body,
          styles.transcriptInput,
          {
            borderRadius: radius.sm,
            borderWidth: borderWidth.hairline,
            borderColor: draftValidation.valid ? palette.borderSubtle : palette.borderFocus,
            backgroundColor: palette.background,
            color: palette.textPrimary,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
          },
        ]}
        testID="voice-transcript-input"
        value={draftTranscript}
      />

      {!draftValidation.valid && draftValidation.errorMessage ? (
        <Text
          maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
          style={[typography.caption, { color: palette.textSecondary }]}
          testID="voice-transcript-validation-error"
        >
          {draftValidation.errorMessage}
        </Text>
      ) : null}

      <View style={[styles.actionRow, { gap: spacing.xs }]}>
        {hasEditedDraft ? (
          <Pressable
            accessibilityLabel="Düzeltilen metinle yeniden ara"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmitDraft }}
            disabled={!canSubmitDraft}
            hitSlop={hitSlop}
            onPress={() => onSubmitEditedTranscript(draftTranscript.trim())}
            style={({ pressed }) => [
              styles.button,
              styles.flexButton,
              {
                minHeight: touchTarget.minimum,
                borderRadius: radius.sm,
                backgroundColor: !canSubmitDraft
                  ? palette.ctaDisabledBackground
                  : pressed
                    ? palette.ctaPressed
                    : palette.ctaBackground,
                paddingHorizontal: spacing.sm,
              },
            ]}
            testID="voice-transcript-submit"
          >
            <Text
              maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
              style={[
                typography.chip,
                { color: canSubmitDraft ? palette.ctaText : palette.ctaDisabledText },
              ]}
            >
              Düzeltmeyi Ara
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityLabel="Yeniden dinle"
          accessibilityRole="button"
          disabled={isParsing}
          hitSlop={hitSlop}
          onPress={onRetryVoice}
          style={({ pressed }) => [
            styles.button,
            {
              minHeight: touchTarget.minimum,
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderColor: palette.borderControl,
              backgroundColor: pressed ? palette.surfacePressed : palette.background,
              paddingHorizontal: spacing.sm,
            },
          ]}
          testID="voice-relisten-button"
        >
          <Text
            maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
            style={[typography.chip, { color: palette.textPrimary }]}
          >
            Yeniden Söyle
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  transcriptInput: {
    minHeight: 48,
    textAlignVertical: "top",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  flexButton: {
    flex: 1,
  },
});
