import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSpeechSession, type SpeechProvider } from "@/services/speech";
import { useHehTheme } from "@/theme";

import { Listening } from "./Listening";

export interface VoiceEntryProps {
  readonly speechProvider?: SpeechProvider;
  readonly isParsing?: boolean;
  readonly parseErrorMessage?: string | null;
  readonly onTranscriptReady: (transcript: string) => void;
  readonly onSwitchToText: (prefillQuery?: string) => void;
  readonly onVoiceActivityStart?: () => void;
  readonly openSettingsImpl?: () => Promise<void>;
}

/**
 * Monochrome voice search entry panel (`D27`–`D30` / `SCREEN-02`).
 * Requires explicit tap before microphone/speech permission activation (`US-01`, `US-09`),
 * composes `Listening` for partial-vs-final separation & editable transcript refinement,
 * supports offline/weak-network retry without re-recording, and offers one-tap text fallback.
 */
export function VoiceEntry({
  speechProvider,
  isParsing = false,
  parseErrorMessage = null,
  onTranscriptReady,
  onSwitchToText,
  onVoiceActivityStart,
  openSettingsImpl,
}: VoiceEntryProps) {
  const { palette, typography, spacing, radius, borderWidth, touchTarget, icons, hitSlop } =
    useHehTheme();

  const speech = useSpeechSession({
    provider: speechProvider,
    locale: "tr-TR",
    syncPermissionOnMount: false,
    openSettingsImpl,
    onFinalTranscript: onTranscriptReady,
  });

  const [prevFinal, setPrevFinal] = useState(speech.state.finalTranscript);
  const [editedTranscript, setEditedTranscript] = useState(speech.state.finalTranscript);
  if (speech.state.finalTranscript !== prevFinal) {
    setPrevFinal(speech.state.finalTranscript);
    setEditedTranscript(speech.state.finalTranscript);
  }

  const activeError =
    parseErrorMessage ??
    speech.state.errorMessage ??
    (!speech.isAvailable ? "Bu cihazda sesli arama kullanılamıyor." : null);
  const micButtonDisabled = isParsing || !speech.isAvailable;
  const retryCandidate = editedTranscript.trim() || speech.state.finalTranscript.trim();
  const canRetryFailedParse = Boolean(parseErrorMessage && retryCandidate && !isParsing);
  const isListeningPhase =
    speech.state.status === "permission_request" ||
    speech.state.status === "starting" ||
    speech.state.status === "listening" ||
    speech.state.status === "stopping";

  const handleFallbackPress = (): void => {
    speech.cancelListening();
    const carryOver = editedTranscript.trim() || speech.transcript.trim();
    onSwitchToText(carryOver || undefined);
  };

  const handleStartVoice = (): void => {
    onVoiceActivityStart?.();
    void speech.startListening();
  };

  const handleRetryVoice = (): void => {
    onVoiceActivityStart?.();
    speech.resetSession();
    setEditedTranscript("");
    void speech.startListening();
  };

  return (
    <View style={[styles.container, { gap: spacing.sm }]} testID="voice-entry-fallback-box">
      {!isListeningPhase && speech.state.status !== "transcribed" ? (
        <Pressable
          accessibilityHint="Dokunduğunda mikrofon ve konuşma tanıma izni doğrulanarak Türkçe dinleme başlar"
          accessibilityLabel={isParsing ? "Hazırlanıyor..." : "Sesli aramayı başlat"}
          accessibilityRole="button"
          accessibilityState={{ disabled: micButtonDisabled }}
          disabled={micButtonDisabled}
          hitSlop={hitSlop}
          onPress={handleStartVoice}
          style={({ pressed }) => [
            styles.button,
            {
              minHeight: touchTarget.minimum,
              borderRadius: radius.md,
              backgroundColor: micButtonDisabled
                ? palette.ctaDisabledBackground
                : pressed
                  ? palette.ctaPressed
                  : palette.ctaBackground,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              gap: spacing.xs,
            },
          ]}
          testID="voice-mic-toggle"
        >
          <Text
            accessible={false}
            style={[
              typography.button,
              { color: micButtonDisabled ? palette.ctaDisabledText : palette.iconOnInverse },
            ]}
          >
            {icons.specs.mic.glyphFallback}
          </Text>
          <Text
            maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
            style={[
              typography.button,
              { color: micButtonDisabled ? palette.ctaDisabledText : palette.ctaText },
            ]}
          >
            {isParsing ? "Kriterler Hazırlanıyor..." : "Mikrofona Dokun ve Söyle"}
          </Text>
        </Pressable>
      ) : null}

      <Listening
        isParsing={isParsing}
        onCancelListening={speech.cancelListening}
        onDraftChange={setEditedTranscript}
        onRetryVoice={handleRetryVoice}
        onStopListening={speech.stopListening}
        onSubmitEditedTranscript={(nextText) => {
          onVoiceActivityStart?.();
          setEditedTranscript(nextText);
          onTranscriptReady(nextText);
        }}
        state={speech.state}
      />

      {activeError ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            borderRadius: radius.sm,
            borderWidth: borderWidth.hairline,
            borderStyle: "dashed",
            borderColor: palette.borderControl,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            gap: spacing.xs,
          }}
        >
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textSecondary }]}
            testID="voice-search-error"
          >
            {activeError}
          </Text>

          <View style={[styles.actionRow, { gap: spacing.xs }]}>
            {speech.isPermissionBlocked ? (
              <Pressable
                accessibilityLabel="Cihaz ayarlarını aç"
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => {
                  void speech.openAppSettings();
                }}
                style={({ pressed }) => [
                  styles.button,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderControl,
                    backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                    paddingHorizontal: spacing.sm,
                  },
                ]}
                testID="voice-open-settings-button"
              >
                <Text
                  maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
                  style={[typography.chip, { color: palette.textPrimary }]}
                >
                  Ayarları Aç
                </Text>
              </Pressable>
            ) : null}

            {canRetryFailedParse ? (
              <Pressable
                accessibilityLabel="Tekrar dene"
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => onTranscriptReady(retryCandidate)}
                style={({ pressed }) => [
                  styles.button,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderControl,
                    backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                    paddingHorizontal: spacing.sm,
                  },
                ]}
                testID="voice-retry-parse-button"
              >
                <Text
                  maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
                  style={[typography.chip, { color: palette.textPrimary }]}
                >
                  Tekrar Dene
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="Yazarak devam et"
        accessibilityRole="button"
        hitSlop={hitSlop}
        onPress={handleFallbackPress}
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
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
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
});
