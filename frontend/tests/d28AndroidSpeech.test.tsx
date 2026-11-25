import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Platform } from "react-native";

import appConfig from "../app.config";
import { VoiceEntry } from "../src/features/search/components/VoiceEntry";
import {
  ExpoSpeechRecognitionAdapter,
  type ExpoSpeechRecognitionNativeModule,
} from "../src/services/speech/expoSpeechAdapter";
import { MockSpeechProvider } from "../src/services/speech/mockSpeechProvider";
import { SPEECH_RECOVERY_MESSAGES } from "../src/services/speech/types";
import { HehThemeProvider } from "../src/theme";

function buildAndroidNativeSpeechMock(options?: {
  available?: boolean;
  onDevice?: boolean;
  services?: string[];
  defaultPackage?: string;
  installedLocales?: string[];
}): ExpoSpeechRecognitionNativeModule & {
  __emit: (eventName: string, payload: unknown) => void;
} {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    isRecognitionAvailable: jest.fn(() => options?.available ?? true),
    supportsOnDeviceRecognition: jest.fn(() => options?.onDevice ?? true),
    getSpeechRecognitionServices: jest.fn(
      () => options?.services ?? ["com.google.android.as", "com.google.android.tts"],
    ),
    getDefaultRecognitionService: jest.fn(() => ({
      packageName: options?.defaultPackage ?? "com.google.android.tts",
    })),
    getSupportedLocales: jest.fn(async () => ({
      locales: ["en-US", "tr-TR"],
      installedLocales: options?.installedLocales ?? ["tr-TR"],
    })),
    getPermissionsAsync: jest.fn(async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
    })),
    requestPermissionsAsync: jest.fn(async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
    })),
    addListener: jest.fn((eventName: string, cb: (payload: unknown) => void) => {
      listeners.set(eventName, cb);
      return {
        remove: jest.fn(() => {
          listeners.delete(eventName);
        }),
      };
    }) as ExpoSpeechRecognitionNativeModule["addListener"],
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    __emit: (eventName: string, payload: unknown) => {
      listeners.get(eventName)?.(payload);
    },
  };
}

describe("D28 Android SpeechRecognizer Service Discovery, Offline Handling & Fallback", () => {
  const originalOs = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
  });

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalOs });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("declares Android SpeechRecognizer <queries> packages and package id in app.config.ts", () => {
    const pluginEntry = (appConfig.plugins ?? []).find(
      (item) => Array.isArray(item) && item[0] === "expo-speech-recognition",
    ) as [string, { androidSpeechServicePackages?: string[] }];

    expect(pluginEntry[1].androidSpeechServicePackages).toEqual(
      expect.arrayContaining([
        "com.google.android.googlequicksearchbox",
        "com.google.android.as",
        "com.google.android.tts",
      ]),
    );
    expect(appConfig.android?.package).toBe("com.heh.app");
  });

  it("discovers com.google.android.as service, passes web_search model, and checks offline tr-TR pack", async () => {
    const androidMod = buildAndroidNativeSpeechMock({
      services: ["com.samsung.android.bixby.agent", "com.google.android.as"],
      defaultPackage: "com.samsung.android.bixby.agent",
      installedLocales: ["tr-TR"],
    });
    const adapter = new ExpoSpeechRecognitionAdapter({
      nativeModule: androidMod,
      requiresOnDeviceRecognition: true,
    });

    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.getAndroidSpeechServiceInfo()).toEqual({
      services: ["com.samsung.android.bixby.agent", "com.google.android.as"],
      defaultPackage: "com.samsung.android.bixby.agent",
      selectedPackage: "com.google.android.as",
    });

    const trLocale = await adapter.checkLocaleSupport("tr-TR");
    expect(trLocale).toEqual({
      locale: "tr-TR",
      supported: true,
      installedOffline: true,
    });

    const cleanup = adapter.startListening("tr-TR", {
      onStart: jest.fn(),
      onPartialResult: jest.fn(),
      onFinalResult: jest.fn(),
      onEmptyResult: jest.fn(),
      onError: jest.fn(),
      onEnd: jest.fn(),
    });

    expect(androidMod.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "tr-TR",
        androidRecognitionServicePackage: "com.google.android.as",
        requiresOnDeviceRecognition: true,
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: "web_search" },
      }),
    );

    cleanup();
  });

  it("maps Android SpeechRecognizer numeric error codes (offline, busy, language unavailable) accurately", () => {
    const androidMod = buildAndroidNativeSpeechMock();
    const adapter = new ExpoSpeechRecognitionAdapter({ nativeModule: androidMod });
    const onError = jest.fn();

    const cleanup = adapter.startListening("tr-TR", {
      onStart: jest.fn(),
      onPartialResult: jest.fn(),
      onFinalResult: jest.fn(),
      onEmptyResult: jest.fn(),
      onError,
      onEnd: jest.fn(),
    });

    // ERROR_SERVER=4 -> NETWORK_ERROR
    androidMod.__emit("error", { error: "client", code: 4, message: "Server offline" });
    expect(onError).toHaveBeenLastCalledWith(
      "NETWORK_ERROR",
      SPEECH_RECOVERY_MESSAGES.NETWORK_ERROR,
    );

    // ERROR_LANGUAGE_UNAVAILABLE=13 -> SERVICE_UNAVAILABLE
    androidMod.__emit("error", { error: "unknown", code: 13, message: "Offline pack missing" });
    expect(onError).toHaveBeenLastCalledWith(
      "SERVICE_UNAVAILABLE",
      SPEECH_RECOVERY_MESSAGES.SERVICE_UNAVAILABLE,
    );

    // ERROR_RECOGNIZER_BUSY=8 -> BUSY_ERROR
    androidMod.__emit("error", { error: "unknown", code: 8, message: "Busy" });
    expect(onError).toHaveBeenLastCalledWith("BUSY_ERROR", SPEECH_RECOVERY_MESSAGES.BUSY_ERROR);

    cleanup();
  });

  it("treats Android devices with zero speech services as unavailable without touching mic", async () => {
    const noServiceMod = buildAndroidNativeSpeechMock({
      available: true, // Some OEM ROMs erroneously return true despite 0 packages
      services: [],
      defaultPackage: "",
    });
    const adapter = new ExpoSpeechRecognitionAdapter({ nativeModule: noServiceMod });

    expect(adapter.isAvailable()).toBe(false);
    expect(await adapter.checkLocaleSupport("tr-TR")).toEqual({
      locale: "tr-TR",
      supported: false,
      installedOffline: false,
    });

    const switchToText = jest.fn();
    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={switchToText}
          onTranscriptReady={jest.fn()}
          speechProvider={adapter}
        />
      </HehThemeProvider>,
    );

    expect(noServiceMod.start).not.toHaveBeenCalled();
    expect(screen.getByTestId("voice-search-error").props.children).toBe(
      SPEECH_RECOVERY_MESSAGES.SERVICE_UNAVAILABLE,
    );
    expect(screen.getByTestId("voice-mic-toggle").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );

    await fireEvent.press(screen.getByTestId("voice-fallback-text-button"));
    expect(switchToText).toHaveBeenCalledTimes(1);
  });

  it("handles Android happy flow and offline network failure fallback without auto-recording", async () => {
    jest.useFakeTimers();
    const happyProvider = new MockSpeechProvider({
      partialTranscripts: ["2000 üstü"],
      finalTranscript: "2000 üstü 42 numara spor ayakkabı",
      partialIntervalMs: 15,
    });
    const transcriptSpy = jest.fn();

    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={jest.fn()}
          onTranscriptReady={transcriptSpy}
          speechProvider={happyProvider}
        />
      </HehThemeProvider>,
    );

    expect(happyProvider.startCount).toBe(0);
    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(transcriptSpy).toHaveBeenCalledWith("2000 üstü 42 numara spor ayakkabı");

    // Offline network failure renders Turkish recovery guidance and allows instant fallback to text
    const offlineProvider = new MockSpeechProvider({
      simulateError: "NETWORK_ERROR",
      partialIntervalMs: 15,
    });
    const fallbackSpy = jest.fn();

    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={fallbackSpy}
          onTranscriptReady={jest.fn()}
          speechProvider={offlineProvider}
        />
      </HehThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    await act(async () => {
      jest.advanceTimersByTime(30);
    });
    expect(screen.getByTestId("voice-search-error").props.children).toBe(
      SPEECH_RECOVERY_MESSAGES.NETWORK_ERROR,
    );

    await fireEvent.press(screen.getByTestId("voice-fallback-text-button"));
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });
});
