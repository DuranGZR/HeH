import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

/** Root navigation layout for the minimal single-focus search flow. */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
