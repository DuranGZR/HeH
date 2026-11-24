import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import { ExpoSpeechRecognitionAdapter } from "../src/services/speech/expoSpeechAdapter";

jest.mock("expo-speech-recognition", () => {
  const listeners = new Map<string, (mockEvent: unknown) => void>();
  return {
    ExpoSpeechRecognitionModule: {
      isRecognitionAvailable: jest.fn(() => true),
      supportsOnDeviceRecognition: jest.fn(() => false),
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
      }),
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
      __emit: (eventName: string, payload: unknown) => {
        listeners.get(eventName)?.(payload);
      },
    },
  };
});

describe("ExpoSpeechRecognitionAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts recognition with tr-TR locale and maps events cleanly", async () => {
    const adapter = new ExpoSpeechRecognitionAdapter();
    expect(adapter.isAvailable()).toBe(true);

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

    expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "tr-TR",
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
      }),
    );

    const mod = ExpoSpeechRecognitionModule as unknown as {
      __emit: (name: string, payload: unknown) => void;
    };
    mod.__emit("start", null);
    mod.__emit("result", {
      isFinal: false,
      results: [{ transcript: "sony", confidence: 0, segments: [] }],
    });
    mod.__emit("result", {
      isFinal: true,
      results: [{ transcript: "sony kulaklık", confidence: 0.9, segments: [] }],
    });
    mod.__emit("error", { error: "not-allowed", message: "Denied" });
    mod.__emit("end", null);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onPartialResult).toHaveBeenCalledWith("sony");
    expect(onFinalResult).toHaveBeenCalledWith("sony kulaklık");
    expect(onError).toHaveBeenCalledWith(
      "PERMISSION_DENIED",
      "Mikrofon kapalı. Yazarak devam edebilirsin.",
    );
    expect(onEnd).toHaveBeenCalledTimes(1);

    adapter.stopListening();
    adapter.abortListening();
    expect(ExpoSpeechRecognitionModule.stop).toHaveBeenCalledTimes(1);
    expect(ExpoSpeechRecognitionModule.abort).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
