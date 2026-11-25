import { requireOptionalNativeModule } from "expo";

import {
  ExpoSpeechRecognitionAdapter,
  type ExpoSpeechRecognitionNativeModule,
} from "../src/services/speech/expoSpeechAdapter";
import { SPEECH_RECOVERY_MESSAGES } from "../src/services/speech/types";

interface MockedNativeSpeechModule extends ExpoSpeechRecognitionNativeModule {
  __emit: (eventName: string, payload: unknown) => void;
}

jest.mock("expo", () => {
  const actual = jest.requireActual<Record<string, unknown>>("expo");
  const listeners = new Map<string, (mockEvent: unknown) => void>();

  const mockSpeechModule: MockedNativeSpeechModule = {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => false),
    getSupportedLocales: jest.fn(async () => ({
      locales: ["en-US", "tr_TR"],
      installedLocales: ["tr_TR"],
    })),
    getPermissionsAsync: jest.fn(async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
      restricted: false,
    })),
    requestPermissionsAsync: jest.fn(async () => ({
      granted: true,
      canAskAgain: true,
      status: "granted",
      restricted: false,
    })),
    addListener: jest.fn((eventName: string, cb: (mockEvent: unknown) => void) => {
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

  return {
    ...actual,
    requireOptionalNativeModule: jest.fn((name: string) =>
      name === "ExpoSpeechRecognition" ? mockSpeechModule : null,
    ),
  };
});

describe("ExpoSpeechRecognitionAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts recognition with tr-TR locale and maps events cleanly", async () => {
    const mockModule =
      requireOptionalNativeModule<MockedNativeSpeechModule>("ExpoSpeechRecognition");
    expect(mockModule).not.toBeNull();

    const adapter = new ExpoSpeechRecognitionAdapter();
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.supportsOnDevice()).toBe(false);

    const permission = await adapter.requestPermission();
    expect(permission).toEqual({ status: "granted", canAskAgain: true });

    const onStart = jest.fn();
    const onPartialResult = jest.fn();
    const onFinalResult = jest.fn();
    const onEmptyResult = jest.fn();
    const onError = jest.fn();
    const onEnd = jest.fn();

    const cleanup = adapter.startListening("tr-TR", {
      onStart,
      onPartialResult,
      onFinalResult,
      onEmptyResult,
      onError,
      onEnd,
    });

    expect(mockModule?.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "tr-TR",
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
      }),
    );

    mockModule?.__emit("start", null);
    mockModule?.__emit("result", {
      isFinal: false,
      results: [{ transcript: "sony", confidence: 0, segments: [] }],
    });
    mockModule?.__emit("result", {
      isFinal: true,
      results: [{ transcript: "sony kulaklık", confidence: 0.9, segments: [] }],
    });
    mockModule?.__emit("error", { error: "not-allowed", message: "Denied" });
    mockModule?.__emit("end", null);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onPartialResult).toHaveBeenCalledWith("sony");
    expect(onFinalResult).toHaveBeenCalledWith("sony kulaklık");
    expect(onError).toHaveBeenCalledWith(
      "PERMISSION_DENIED",
      SPEECH_RECOVERY_MESSAGES.PERMISSION_DENIED,
    );
    expect(onEnd).toHaveBeenCalledTimes(1);

    adapter.stopListening();
    adapter.abortListening();
    expect(mockModule?.stop).toHaveBeenCalledTimes(1);
    expect(mockModule?.abort).toHaveBeenCalledTimes(1);

    // Cleanup is idempotent across repeated invocations
    cleanup();
    cleanup();
  });

  it("degrades safely without throwing when native ExpoSpeechRecognition module is absent", async () => {
    const adapter = new ExpoSpeechRecognitionAdapter(null);
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.supportsOnDevice()).toBe(false);
    expect(await adapter.getPermission()).toEqual({ status: "unavailable", canAskAgain: false });
    expect(await adapter.requestPermission()).toEqual({
      status: "unavailable",
      canAskAgain: false,
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
    expect(onError).toHaveBeenCalledWith(
      "SERVICE_UNAVAILABLE",
      SPEECH_RECOVERY_MESSAGES.SERVICE_UNAVAILABLE,
    );
    cleanup();
  });
});
