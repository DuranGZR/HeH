import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/theme/colors";

/** Minimal home screen with explicit mode entry (no auto-recording on mount). */
export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} testID="home-screen">
      <View style={styles.center}>
        <Text style={styles.wordmark}>heh.</Text>
        <Text style={styles.tagline}>Söyle, aradığını hemen bul.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sesli ara"
          onPress={() => router.push({ pathname: "/search", params: { mode: "voice" } })}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryLabel}>Sesli Ara</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yazarak ara"
          onPress={() => router.push({ pathname: "/search", params: { mode: "text" } })}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>Yazarak Ara</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    justifyContent: "space-between",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  wordmark: {
    color: COLORS.black,
    fontSize: 40,
    fontWeight: "600",
    letterSpacing: -1,
  },
  tagline: {
    color: COLORS.black,
    fontSize: 16,
    marginTop: 8,
  },
  actions: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: COLORS.black,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryLabel: {
    color: COLORS.black,
    fontSize: 15,
    fontWeight: "500",
  },
});
