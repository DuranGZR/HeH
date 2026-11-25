import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getSharedQueryClient } from "@/api";
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

/** Root navigation layout wrapped in query cache, theme, contrast, and safe-area providers. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={getSharedQueryClient()}>
        <HehThemeProvider>
          <ThemedRootStack />
        </HehThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
