import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useHehTheme } from "@/theme";

/** Safe fallback route for malformed or unknown `heh://` deep links. */
export default function NotFoundScreen() {
  const router = useRouter();
  const { palette, typography, spacing, radius, borderWidth, touchTarget, layout, hitSlop } =
    useHehTheme();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.content,
          {
            maxWidth: layout.maxContentWidth,
            paddingHorizontal: layout.horizontalPadding,
            gap: spacing.md,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={typography.heroTitle.maxFontSizeMultiplier}
          style={[typography.heroTitle, { color: palette.textPrimary }]}
        >
          heh.
        </Text>
        <Text
          maxFontSizeMultiplier={typography.body.maxFontSizeMultiplier}
          style={[typography.body, { color: palette.textSecondary }]}
        >
          Bağlantı tanınmadı; ana ekrandan güvenle aramaya devam edebilirsin.
        </Text>
        <Pressable
          accessibilityLabel="Ana ekrana dön"
          accessibilityRole="button"
          hitSlop={hitSlop}
          onPress={() => router.replace("/")}
          style={({ pressed }) => [
            styles.button,
            {
              minHeight: touchTarget.minimum,
              borderRadius: radius.md,
              borderWidth: borderWidth.hairline,
              borderColor: palette.borderControl,
              backgroundColor: pressed ? palette.surfacePressed : palette.ctaBackground,
              paddingHorizontal: spacing.lg,
            },
          ]}
        >
          <Text
            maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
            style={[typography.button, { color: palette.ctaText }]}
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
  content: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    justifyContent: "center",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
});
