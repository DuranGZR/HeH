import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { AppState, Linking, Pressable, Text, View, type AppStateStatus } from "react-native";

import {
  ExpoSpeechRecognitionAdapter,
  MockSpeechProvider,
  SPEECH_RECOVERY_MESSAGES,
  SpeechSessionController,
  resolveDefaultSpeechProvider,
  useSpeechSession,
  type SpeechProvider,
} from "../src/services/speech";

function SpeechHookHarness({
  provider,
  syncPermissionOnMount = false,
  openSettingsImpl,
}: {
  readonly provider: SpeechProvider;
  readonly syncPermissionOnMount?: boolean;
  readonly openSettingsImpl?: () => Promise<void>;
}) {
  const speech = useSpeechSession({
    provider,
    syncPermissionOnMount,
    openSettingsImpl,
  });

  return (
    <View>
      <Text testID="speech-status">{speech.state.status}</Text>
      <Text testID="speech-permission">{speech.state.permission}</Text>
      <Text testID="speech-blocked">{String(speech.isPermissionBlocked)}</Text>
      <Text testID="speech-transcript">{speech.transcript}</Text>
      <Text testID="speech-error">{speech.state.errorMessage ?? ""}</Text>
      <Pressable testID="btn-start" onPress={() => void speech.startListening()} />
      <Pressable testID="btn-stop" onPress={speech.stopListening} />
      <Pressable testID="btn-cancel" onPress={speech.cancelListening} />
      <Pressable testID="btn-reset" onPress={speech.resetSession} />
      <Pressable testID="btn-settings" onPress={() => void speech.openAppSettings()} />
    </View>
  );
}

describe("D26 SpeechProvider API, Permission Sync & AppState Lifecycle Cleanup", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("executes deterministic MockSpeechProvider partial -> final transcript flow and tears down subscriptions", async () => {
    jest.useFakeTimers();
    const provider = new MockSpeechProvider({
      partialTranscripts: ["3000 altı", "3000 altı siyah"],
      finalTranscript: "3000 altı siyah erkek mont",
      partialIntervalMs: 25,
    });

    const controller = new SpeechSessionController(provider, "tr-TR", 5_000);
    await controller.start();

    expect(provider.startCount).toBe(1);
    expect(provider.getActiveSubscriptionCount()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(controller.getState().status).toBe("listening");

    await act(async () => {
      jest.advanceTimersByTime(30);
    });
    expect(controller.getState().partialTranscript).toBe("3000 altı");

    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(controller.getState().status).toBe("transcribed");
    expect(controller.getState().finalTranscript).toBe("3000 altı siyah erkek mont");
    expect(provider.getActiveSubscriptionCount()).toBe(0);
    expect(provider.cleanupCount).toBe(1);
  });

  it("handles permanent permission denial -> passive settings return unlock without auto-recording", async () => {
    let appStateListener: ((state: AppStateStatus) => void) | null = null;
    const removeSubMock = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      appStateListener = handler;
      return { remove: removeSubMock } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    const provider = new MockSpeechProvider({
      permission: { status: "denied", canAskAgain: false },
    });
    const openSettingsMock = jest.fn(async () => undefined);

    await render(<SpeechHookHarness openSettingsImpl={openSettingsMock} provider={provider} />);

    // Never auto-starts recording on mount (US-01 / US-09)
    expect(screen.getByTestId("speech-status").props.children).toBe("idle");
    expect(provider.startCount).toBe(0);

    // User taps start -> blocked permanent denial surfaces without auto-retrying OS dialog repeatedly
    await fireEvent.press(screen.getByTestId("btn-start"));
    expect(screen.getByTestId("speech-status").props.children).toBe("error");
    expect(screen.getByTestId("speech-blocked").props.children).toBe("true");
    expect(screen.getByTestId("speech-error").props.children).toBe(
      SPEECH_RECOVERY_MESSAGES.PERMISSION_DENIED,
    );

    // Tapping Open Settings opens OS settings cleanly
    await fireEvent.press(screen.getByTestId("btn-settings"));
    expect(openSettingsMock).toHaveBeenCalledTimes(1);

    // User grants permission in OS Settings and returns to foreground ("active")
    provider.setPermission({ status: "granted", canAskAgain: true });
    await act(async () => {
      appStateListener?.("active");
    });

    // Unlocks UI cleanly back to "idle" & "granted" WITHOUT starting microphone automatically
    expect(screen.getByTestId("speech-permission").props.children).toBe("granted");
    expect(screen.getByTestId("speech-status").props.children).toBe("idle");
    expect(screen.getByTestId("speech-blocked").props.children).toBe("false");
    expect(provider.startCount).toBe(0);
  });

  it("aborts recording and cleans up subscriptions immediately on AppState background/inactive and unmount", async () => {
    jest.useFakeTimers();
    let appStateListener: ((state: AppStateStatus) => void) | null = null;
    const removeSubMock = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      appStateListener = handler;
      return { remove: removeSubMock } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    const provider = new MockSpeechProvider({ partialIntervalMs: 100 });
    const { unmount } = await render(<SpeechHookHarness provider={provider} />);

    await fireEvent.press(screen.getByTestId("btn-start"));
    await act(async () => {
      jest.advanceTimersByTime(5);
    });
    expect(screen.getByTestId("speech-status").props.children).toBe("listening");
    expect(provider.getActiveSubscriptionCount()).toBe(1);

    // Background transition immediately aborts STT and frees listeners (AT-19)
    await act(async () => {
      appStateListener?.("background");
    });
    expect(provider.abortCount).toBe(1);
    expect(provider.getActiveSubscriptionCount()).toBe(0);
    expect(screen.getByTestId("speech-status").props.children).toBe("cancelled");

    // Start again, then test unmount cleanup releases AppState + active session cleanly
    await fireEvent.press(screen.getByTestId("btn-start"));
    await act(async () => {
      jest.advanceTimersByTime(5);
    });
    expect(screen.getByTestId("speech-status").props.children).toBe("listening");

    await unmount();
    expect(removeSubMock).toHaveBeenCalledTimes(1);
    expect(provider.abortCount).toBe(2);
    expect(provider.getActiveSubscriptionCount()).toBe(0);
  });

  it("recovers from OS stop hang via stop-grace watchdog and resolves default SpeechProvider cleanly", async () => {
    jest.useFakeTimers();
    const abortMock = jest.fn();
    const stopMock = jest.fn();
    const cleanupMock = jest.fn();
    const stalledStopProvider: SpeechProvider = {
      isAvailable: () => true,
      supportsOnDevice: () => false,
      getPermission: async () => ({ status: "granted", canAskAgain: true }),
      requestPermission: async () => ({ status: "granted", canAskAgain: true }),
      startListening: (_locale, cb) => {
        cb.onStart();
        cb.onPartialResult("nike spor");
        return cleanupMock;
      },
      stopListening: stopMock,
      abortListening: abortMock,
    };

    const controller = new SpeechSessionController(stalledStopProvider, "tr-TR", 10_000, 120);
    await controller.start();
    expect(controller.getState().partialTranscript).toBe("nike spor");

    controller.stop();
    expect(controller.getState().status).toBe("stopping");
    expect(stopMock).toHaveBeenCalledTimes(1);

    // OS never emits onEnd -> stop grace timer resolves cleanly with partial transcript
    await act(async () => {
      jest.advanceTimersByTime(130);
    });
    expect(controller.getState().status).toBe("transcribed");
    expect(controller.getState().finalTranscript).toBe("nike spor");
    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    // Also test Linking.openSettings fallback inside hook default
    const linkingSpy = jest.spyOn(Linking, "openSettings").mockResolvedValueOnce(undefined);
    const defaultMock = resolveDefaultSpeechProvider({ useMock: true });
    expect(defaultMock).toBeInstanceOf(MockSpeechProvider);
    const defaultNative = resolveDefaultSpeechProvider({ useMock: false });
    expect(defaultNative).toBeInstanceOf(ExpoSpeechRecognitionAdapter);

    await render(<SpeechHookHarness provider={defaultMock} syncPermissionOnMount />);
    await fireEvent.press(screen.getByTestId("btn-settings"));
    expect(linkingSpy).toHaveBeenCalledTimes(1);
  });
});
