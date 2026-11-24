import {
  SpeechSessionController,
  createInitialSpeechState,
  speechStateReducer,
} from "../src/services/speech/stateMachine";
import {
  SPEECH_RECOVERY_MESSAGES,
  type SpeechAdapter,
  type SpeechAdapterCallbacks,
  type SpeechPermissionResult,
} from "../src/services/speech/types";

interface FakeAdapterControls {
  adapter: SpeechAdapter;
  getCallbacks: () => SpeechAdapterCallbacks | null;
  stopMock: jest.Mock;
  abortMock: jest.Mock;
  cleanupMock: jest.Mock;
}

function createFakeAdapter(options?: {
  available?: boolean;
  permission?: SpeechPermissionResult;
}): FakeAdapterControls {
  let activeCallbacks: SpeechAdapterCallbacks | null = null;
  const stopMock = jest.fn();
  const abortMock = jest.fn();
  const cleanupMock = jest.fn();
  const permission = options?.permission ?? { status: "granted", canAskAgain: true };

  const adapter: SpeechAdapter = {
    isAvailable: () => options?.available ?? true,
    supportsOnDevice: () => false,
    getPermission: async () => permission,
    requestPermission: async () => permission,
    startListening: (_locale, callbacks) => {
      activeCallbacks = callbacks;
      return cleanupMock;
    },
    stopListening: stopMock,
    abortListening: abortMock,
  };

  return {
    adapter,
    getCallbacks: () => activeCallbacks,
    stopMock,
    abortMock,
    cleanupMock,
  };
}

describe("SpeechSessionController & speechStateReducer", () => {
  it("completes happy path from idle to transcribed", async () => {
    const { adapter, getCallbacks, cleanupMock } = createFakeAdapter();
    const controller = new SpeechSessionController(adapter, "tr-TR");

    await controller.start();
    expect(controller.getState().status).toBe("starting");

    getCallbacks()?.onStart();
    expect(controller.getState().status).toBe("listening");

    getCallbacks()?.onPartialResult("3000 altı siyah");
    expect(controller.getState().partialTranscript).toBe("3000 altı siyah");

    getCallbacks()?.onFinalResult("3000 altı siyah mont");
    expect(controller.getState().status).toBe("transcribed");
    expect(controller.getState().finalTranscript).toBe("3000 altı siyah mont");
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("blocks concurrent STT sessions with ALREADY_ACTIVE", async () => {
    const { adapter } = createFakeAdapter();
    const controller = new SpeechSessionController(adapter);

    await controller.start();
    const second = await controller.start();

    expect(second.status).toBe("starting");
    expect(second.errorCode).toBe("ALREADY_ACTIVE");
  });

  it("falls back cleanly when microphone permission is denied", async () => {
    const { adapter } = createFakeAdapter({
      permission: { status: "denied", canAskAgain: false },
    });
    const controller = new SpeechSessionController(adapter);

    const state = await controller.start();

    expect(state.status).toBe("error");
    expect(state.permission).toBe("denied");
    expect(state.errorCode).toBe("PERMISSION_DENIED");
    expect(state.errorMessage).toBe(SPEECH_RECOVERY_MESSAGES.PERMISSION_DENIED);
  });

  it("reports SERVICE_UNAVAILABLE when STT is missing on device", async () => {
    const { adapter } = createFakeAdapter({ available: false });
    const controller = new SpeechSessionController(adapter);

    const state = await controller.start();

    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("SERVICE_UNAVAILABLE");
    expect(state.errorMessage).toBe(SPEECH_RECOVERY_MESSAGES.SERVICE_UNAVAILABLE);
  });

  it("aborts immediately and clears state on app background (AT-19)", async () => {
    const { adapter, getCallbacks, abortMock, cleanupMock } = createFakeAdapter();
    const controller = new SpeechSessionController(adapter);

    await controller.start();
    getCallbacks()?.onStart();
    expect(controller.getState().status).toBe("listening");

    controller.handleAppBackground();

    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("cancelled");
  });

  it("rejects empty final transcripts cleanly", () => {
    const listening = { ...createInitialSpeechState(), permission: "granted" as const };
    const starting = speechStateReducer(listening, { type: "START_REQUESTED" });
    const active = speechStateReducer(starting, { type: "SESSION_STARTED" });
    const empty = speechStateReducer(active, { type: "FINAL_RESULT", transcript: "   " });

    expect(empty.status).toBe("error");
    expect(empty.errorCode).toBe("EMPTY_TRANSCRIPT");
    expect(empty.errorMessage).toBe(SPEECH_RECOVERY_MESSAGES.EMPTY_TRANSCRIPT);
  });
});
