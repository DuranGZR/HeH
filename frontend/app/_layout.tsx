import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { HehThemeProvider, useHehTheme } from "@/theme";

function ThemedRootStack() {
  const { isDark, palette, motion } = useHehTheme();

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
          animation: motion.reducedMotion ? "none" : "default",
        }}
      />
    </>
  );
}

/** Root navigation layout wrapped in theme, contrast, and safe-area providers. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <HehThemeProvider>
        <ThemedRootStack />
      </HehThemeProvider>
    </SafeAreaProvider>
  );
}
