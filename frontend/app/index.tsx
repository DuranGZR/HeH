import { useRouter } from "expo-router";
import { useState } from "react";
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
  MoreMenuModal,
  TextSearchComposer,
  canSubmitSearchQuery,
  type HomeInputMode,
} from "@/features/search";
import { useHehTheme } from "@/theme";

/**
 * Minimalist mic-centered Home screen (`SCREEN-01` / `SCREEN-03` / `SCREEN-05`).
 * Zero bottom tab bars; no auto-recording on mount; seamless inline voice/text mode switching.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { palette, typography, spacing, radius, borderWidth, touchTarget, layout, icons, hitSlop } =
    useHehTheme();

  const [inputMode, setInputMode] = useState<HomeInputMode>("voice");
  const [queryText, setQueryText] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  const wordmarkStyle =
    layout.tier === "compact" && layout.isShortHeight
      ? typography.wordmarkCompact
      : typography.wordmarkHero;

  const openVoiceSearch = (): void => {
    router.push({ pathname: "/search", params: { mode: "voice" } });
  };

  const openTextModeOrSubmit = (): void => {
    if (inputMode !== "text") {
      setInputMode("text");
      return;
    }
    if (canSubmitSearchQuery(queryText)) {
      router.push({ pathname: "/search", params: { mode: "text", q: queryText.trim() } });
    }
  };

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.screen, { backgroundColor: palette.background }]}
      testID="home-screen"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.frame,
              {
                maxWidth: layout.maxContentWidth,
                paddingHorizontal: layout.horizontalPadding,
                paddingVertical: layout.verticalPadding,
              },
            ]}
            testID="home-frame"
          >
            {/* Minimal header: compact brand + top-right three-dots menu (no tab bar) */}
            <View style={styles.headerRow}>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={wordmarkStyle.maxFontSizeMultiplier}
                style={[wordmarkStyle, { color: palette.textPrimary }]}
              >
                heh.
              </Text>
              <Pressable
                accessibilityHint="Geçmiş, tema ve gizlilik menüsünü açar"
                accessibilityLabel="Diğer seçenekler"
                accessibilityRole="button"
                accessibilityState={{ expanded: menuOpen }}
                hitSlop={hitSlop}
                onPress={() => setMenuOpen(true)}
                style={({ pressed }) => [
                  styles.moreButton,
                  {
                    minWidth: touchTarget.minimum,
                    minHeight: touchTarget.minimum,
                    borderRadius: radius.pill,
                    backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
                  },
                ]}
                testID="home-more-button"
              >
                <Text
                  accessible={false}
                  style={[typography.sectionTitle, { color: palette.iconPrimary }]}
                >
                  {icons.specs.more.glyphFallback}
                </Text>
              </Pressable>
            </View>

            {/* Center workspace: Voice hero mic OR inline TextSearchComposer */}
            {inputMode === "voice" ? (
              <View style={[styles.centerHero, { gap: spacing.sm }]}>
                <Text
                  maxFontSizeMultiplier={typography.heroTitle.maxFontSizeMultiplier}
                  style={[
                    typography.heroTitle,
                    { color: palette.textPrimary, textAlign: "center" },
                  ]}
                >
                  Ne arıyorsun?
                </Text>
                <Text
                  maxFontSizeMultiplier={typography.body.maxFontSizeMultiplier}
                  style={[
                    typography.body,
                    { color: palette.textSecondary, textAlign: "center", marginBottom: spacing.md },
                  ]}
                >
                  Söyle, aradığını hemen bul.
                </Text>

                <Pressable
                  accessibilityHint="Dokunduğunda mikrofon izni doğrulanarak sesli arama açılır"
                  accessibilityLabel="Sesli ara"
                  accessibilityRole="button"
                  hitSlop={hitSlop}
                  onPress={openVoiceSearch}
                  style={({ pressed }) => [
                    styles.heroMicButton,
                    {
                      width: layout.heroMicSize,
                      height: layout.heroMicSize,
                      minHeight: touchTarget.minimum,
                      borderRadius: radius.pill,
                      borderWidth: borderWidth.control,
                      borderColor: palette.ctaBackground,
                      backgroundColor: pressed ? palette.ctaPressed : palette.ctaBackground,
                    },
                  ]}
                  testID="home-voice-button"
                >
                  <Text
                    accessible={false}
                    style={{ fontSize: icons.sizes.hero, color: palette.iconOnInverse }}
                  >
                    {icons.specs.mic.glyphFallback}
                  </Text>
                </Pressable>

                <Text
                  maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                  style={[typography.caption, { color: palette.textMuted, marginTop: spacing.xs }]}
                  testID="home-voice-consent-note"
                >
                  Mikrofon yalnızca sen dokunduğunda açılır.
                </Text>
              </View>
            ) : (
              <View style={[styles.centerComposer, { gap: spacing.md }]}>
                <Text
                  maxFontSizeMultiplier={typography.heroTitle.maxFontSizeMultiplier}
                  style={[typography.heroTitle, { color: palette.textPrimary }]}
                >
                  Aradığını yaz
                </Text>
                <TextSearchComposer
                  autoFocus
                  onChangeQuery={setQueryText}
                  onSubmit={openTextModeOrSubmit}
                  query={queryText}
                />
              </View>
            )}

            {/* Bottom inline input mode switcher (no bottom navigation tabs) */}
            <View
              style={[
                styles.modeSwitcher,
                {
                  borderRadius: radius.pill,
                  borderWidth: borderWidth.hairline,
                  borderColor: palette.borderControl,
                  backgroundColor: palette.surfaceMuted,
                  padding: spacing.xxs,
                  gap: spacing.xxs,
                },
              ]}
              testID="home-mode-switcher"
            >
              <Pressable
                accessibilityLabel="Yazarak ara"
                accessibilityRole="button"
                accessibilityState={{ selected: inputMode === "text" }}
                onPress={() => setInputMode("text")}
                style={[
                  styles.modeOption,
                  {
                    minHeight: touchTarget.minimum,
                    borderRadius: radius.pill,
                    backgroundColor:
                      inputMode === "text" ? palette.ctaBackground : palette.surfaceMuted,
                    gap: spacing.xs,
                  },
                ]}
                testID="home-text-button"
              >
                <Text
                  accessible={false}
                  style={[
                    typography.caption,
                    { color: inputMode === "text" ? palette.iconOnInverse : palette.iconPrimary },
                  ]}
                >
                  {icons.specs.keyboard.glyphFallback}
                </Text>
                <Text
                  maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
                  style={[
                    typography.chip,
                    { color: inputMode === "text" ? palette.ctaText : palette.textPrimary },
                  ]}
                >
                  Yazarak
                </Text>
              </Pressable>

              <Pressable
                accessibilityLabel="Sesli moda geç"
                accessibilityRole="button"
                accessibilityState={{ selected: inputMode === "voice" }}
                onPress={() => setInputMode("voice")}
                style={[
                  styles.modeOption,
                  {
                    minHeight: touchTarget.minimum,
                    borderRadius: radius.pill,
                    backgroundColor:
                      inputMode === "voice" ? palette.ctaBackground : palette.surfaceMuted,
                    gap: spacing.xs,
                  },
                ]}
                testID="home-mode-voice-button"
              >
                <Text
                  accessible={false}
                  style={[
                    typography.caption,
                    { color: inputMode === "voice" ? palette.iconOnInverse : palette.iconPrimary },
                  ]}
                >
                  {icons.specs.waveform.glyphFallback}
                </Text>
                <Text
                  maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
                  style={[
                    typography.chip,
                    { color: inputMode === "voice" ? palette.ctaText : palette.textPrimary },
                  ]}
                >
                  Sesli
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <MoreMenuModal onClose={() => setMenuOpen(false)} visible={menuOpen} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  frame: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moreButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerHero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroMicButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerComposer: {
    flex: 1,
    justifyContent: "center",
  },
  modeSwitcher: {
    flexDirection: "row",
    alignItems: "center",
  },
  modeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
