import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";

import appConfig from "../app.config";
import SearchEntryScreen from "../app/search";
import { createHehQueryClient } from "../src/api";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import { VoiceEntry } from "../src/features/search/components/VoiceEntry";
import {
  ExpoSpeechRecognitionAdapter,
  type ExpoSpeechRecognitionNativeModule,
} from "../src/services/speech/expoSpeechAdapter";
import { MockSpeechProvider } from "../src/services/speech/mockSpeechProvider";
import { SPEECH_RECOVERY_MESSAGES } from "../src/services/speech/types";
import { HehThemeProvider } from "../src/theme";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = { mode: "voice" };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

function buildIosSpeechNativeMock(overrides?: {
  permission?: { granted: boolean; canAskAgain: boolean; status: string; restricted?: boolean };
  locales?: string[];
  installedLocales?: string[];
}): ExpoSpeechRecognitionNativeModule & {
  __emit: (eventName: string, payload: unknown) => void;
} {
  const listeners = new Map<string, (payload: unknown) => void>();
  const permission = overrides?.permission ?? {
    granted: true,
    canAskAgain: true,
    status: "granted",
    restricted: false,
  };

  return {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    getSupportedLocales: jest.fn(async () => ({
      locales: overrides?.locales ?? ["en-US", "tr_TR"],
      installedLocales: overrides?.installedLocales ?? ["tr_TR"],
    })),
    getPermissionsAsync: jest.fn(async () => permission),
    requestPermissionsAsync: jest.fn(async () => permission),
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

describe("D27 iOS SFSpeechRecognizer Config, Locale Support, Flow & Fallback", () => {
  const clients: ReturnType<typeof createHehQueryClient>[] = [];

  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockParams = { mode: "voice" };
  });

  afterEach(() => {
    for (const qc of clients) {
      qc.clear();
    }
    clients.length = 0;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("declares iOS NSMicrophone and NSSpeechRecognition Turkish usage descriptions in app.config.ts", () => {
    const pluginEntry = (appConfig.plugins ?? []).find(
      (item) => Array.isArray(item) && item[0] === "expo-speech-recognition",
    ) as [string, { microphonePermission?: string; speechRecognitionPermission?: string }];

    expect(pluginEntry).toBeTruthy();
    expect(pluginEntry[1].microphonePermission).toContain("mikrofonuna");
    expect(pluginEntry[1].speechRecognitionPermission).toContain("Türkçe metne");
    expect(appConfig.ios?.bundleIdentifier).toBe("com.heh.app");
  });

  it("tunes iOS SFSpeechRecognizer options (iosTaskHint=search, contextualStrings, tr_TR match) and maps interrupted audio", async () => {
    const iosMod = buildIosSpeechNativeMock({ locales: ["en-US", "tr_TR"] });
    const adapter = new ExpoSpeechRecognitionAdapter({
      nativeModule: iosMod,
      iosTaskHint: "search",
    });

    const trSupport = await adapter.checkLocaleSupport("tr-TR");
    expect(trSupport).toEqual({
      locale: "tr-TR",
      supported: true,
      installedOffline: true,
    });

    const onError = jest.fn();
    const cleanup = adapter.startListening("tr-TR", {
      onStart: jest.fn(),
      onPartialResult: jest.fn(),
      onFinalResult: jest.fn(),
      onEmptyResult: jest.fn(),
      onError,
      onEnd: jest.fn(),
    });

    expect(iosMod.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "tr-TR",
        iosTaskHint: "search",
        addsPunctuation: true,
        contextualStrings: expect.arrayContaining(["Trendyol", "Sony", "JBL"]),
      }),
    );

    iosMod.__emit("error", { error: "interrupted", message: "Incoming call" });
    expect(onError).toHaveBeenCalledWith("INTERRUPTED", SPEECH_RECOVERY_MESSAGES.INTERRUPTED);

    cleanup();
  });

  it("never auto-records on mount and connects final tr-TR transcript directly to 1-RTT voice parse", async () => {
    jest.useFakeTimers();
    const provider = new MockSpeechProvider({
      partialTranscripts: ["sony veya", "sony veya jbl"],
      finalTranscript: "Sony veya JBL bluetooth kulaklık",
      partialIntervalMs: 20,
    });
    const parseSpy = jest.fn();

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={jest.fn()}
          onTranscriptReady={parseSpy}
          speechProvider={provider}
        />
      </HehThemeProvider>,
    );

    // Zero microphone activation before explicit tap
    expect(provider.startCount).toBe(0);
    const micButton = screen.getByTestId("voice-mic-toggle");
    expect(StyleSheet.flatten(micButton.props.style).minHeight).toBe(48);

    await fireEvent.press(micButton);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("voice-listening-card")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    expect(screen.getByTestId("voice-partial-transcript").props.children).toBe("sony veya");

    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(screen.getByTestId("voice-final-transcript").props.children).toBe(
      "Sony veya JBL bluetooth kulaklık",
    );
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy).toHaveBeenCalledWith("Sony veya JBL bluetooth kulaklık");
  });

  it("handles iOS permanent permission denial with Settings shortcut and one-tap Yazarak Devam Et fallback", async () => {
    const provider = new MockSpeechProvider({
      permission: { status: "denied", canAskAgain: false },
    });
    const openSettingsSpy = jest.fn(async () => undefined);
    const switchToTextSpy = jest.fn();

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={switchToTextSpy}
          onTranscriptReady={jest.fn()}
          openSettingsImpl={openSettingsSpy}
          speechProvider={provider}
        />
      </HehThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    expect(screen.getByTestId("voice-search-error").props.children).toBe(
      SPEECH_RECOVERY_MESSAGES.PERMISSION_DENIED,
    );

    await fireEvent.press(screen.getByTestId("voice-open-settings-button"));
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId("voice-fallback-text-button"));
    expect(switchToTextSpy).toHaveBeenCalledWith(undefined);
  });

  it("renders SearchEntryScreen in mode=voice safely and navigates to text fallback on button press", async () => {
    const baseTransport = new MockSearchTransport();
    const parsePayload = await baseTransport.parseSearch({
      text: "3000 altı siyah erkek mont",
      input_source: "voice",
    });
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(parsePayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const qc = createHehQueryClient();
    clients.push(qc);

    await render(
      <QueryClientProvider client={qc}>
        <HehThemeProvider initialMode="light" initialReduceMotion>
          <SearchEntryScreen />
        </HehThemeProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("voice-entry-fallback-box")).toBeTruthy();
    expect(screen.getByTestId("voice-mic-toggle")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("voice-fallback-text-button"));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/search",
      params: { mode: "text" },
    });
  });
});
