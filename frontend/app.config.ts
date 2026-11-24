import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "heh.",
  slug: "heh",
  scheme: "heh",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.heh.app",
  },
  android: {
    package: "com.heh.app",
  },
  plugins: ["expo-router"],
};

export default config;
