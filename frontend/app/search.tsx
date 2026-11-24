import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { normalizeSearchModeParam } from "@/services/widgets/deepLink";
import { COLORS } from "@/theme/colors";

/**
 * Search entry target route for widget deep links (`heh://search?mode=voice|text`).
 * Voice mode requires explicit foreground permission verification before listening.
 */
export default function SearchEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const mode = normalizeSearchModeParam(params.mode);

  return (
    <SafeAreaView style={styles.container} testID="search-entry-screen">
      <View style={styles.content}>
        <Text style={styles.wordmark}>heh.</Text>
        <Text style={styles.title}>{mode === "voice" ? "Sesli Arama Hazır" : "Yazarak Arama"}</Text>
        <Text style={styles.subtitle}>
          {mode === "voice"
            ? "Mikrofon yalnızca açık iznin ve dokunuşunla başlatılır."
            : "Aradığın ürünü doğal Türkçe ile yazabilirsin."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ana ekrana dön"
          onPress={() => router.replace("/")}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Ana Ekrana Dön</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  wordmark: {
    color: COLORS.black,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  title: {
    color: COLORS.black,
    fontSize: 22,
    fontWeight: "600",
  },
  subtitle: {
    color: COLORS.black,
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    marginTop: 12,
    backgroundColor: COLORS.black,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "600",
  },
});
