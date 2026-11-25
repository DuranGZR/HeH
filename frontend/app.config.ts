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
  plugins: [
    "expo-router",
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "heh. sesli ürün araması yapabilmen için mikrofonuna yalnızca sen başlattığında erişir.",
        speechRecognitionPermission:
          "heh. söylediğin ürün kriterlerini Türkçe metne dönüştürmek için konuşma tanımayı kullanır.",
        androidSpeechServicePackages: [
          "com.google.android.googlequicksearchbox",
          "com.google.android.as",
          "com.google.android.tts",
        ],
      },
    ],
    [
      "expo-widgets",
      {
        enableAndroid: false,
        bundleIdentifier: "com.heh.app.widgets",
        groupIdentifier: "group.com.heh.app",
        widgets: [
          {
            name: "HehQuickSearch",
            displayName: "heh. Hızlı Arama",
            description: "Ana ekrandan sesli veya yazılı ürün aramasını tek dokunuşla başlat.",
            ios: {
              supportedFamilies: ["systemSmall", "systemMedium"],
              contentMarginsDisabled: true,
            },
            android: {
              minWidth: 110,
              minHeight: 110,
              targetCellWidth: 2,
              targetCellHeight: 2,
              resizeMode: "both",
            },
          },
        ],
      },
    ],
  ],
};

export default config;
