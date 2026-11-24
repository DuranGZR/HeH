import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS } from "@/theme/colors";

/** Minimal bootstrap home screen verified during D01 setup. */
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container} testID="home-screen">
      <View style={styles.center}>
        <Text style={styles.wordmark}>heh.</Text>
        <Text style={styles.tagline}>Söyle, aradığını hemen bul.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
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
});
