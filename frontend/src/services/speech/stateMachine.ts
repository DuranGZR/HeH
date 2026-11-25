import {
  SPEECH_RECOVERY_MESSAGES,
  type SpeechAdapter,
  type SpeechErrorCode,
  type SpeechLifecycleStatus,
  type SpeechPermissionResult,
  type SpeechSessionState,
} from "./types";

const ACTIVE_STATUSES: ReadonlySet<SpeechLifecycleStatus> = new Set([
  "permission_request",
  "starting",
  "listening",
  "stopping",
]);

export type SpeechAction =
  | { type: "PERMISSION_REQUESTED" }
  | { type: "PERMISSION_RESOLVED"; result: SpeechPermissionResult }
  | { type: "SERVICE_UNAVAILABLE" }
  | { type: "START_REQUESTED" }
  | { type: "SESSION_STARTED" }
  | { type: "PARTIAL_RESULT"; transcript: string }
  | { type: "STOP_REQUESTED" }
  | { type: "FINAL_RESULT"; transcript: string }
  | { type: "EMPTY_RESULT" }
  | { type: "CANCELLED" }
  | { type: "ERROR"; code: SpeechErrorCode; message?: string }
  | { type: "RESET" };

export function createInitialSpeechState(): SpeechSessionState {
  return {
    status: "idle",
    permission: "undetermined",
    canAskAgain: true,
    partialTranscript: "",
    finalTranscript: "",
    errorCode: null,
    errorMessage: null,
  };
}

export function isSpeechSessionActive(status: SpeechLifecycleStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Pure state transitions enforcing single-session lock and safe error fallbacks. */
export function speechStateReducer(
  state: SpeechSessionState,
  action: SpeechAction,
): SpeechSessionState {
  switch (action.type) {
    case "RESET":
      return {
        ...createInitialSpeechState(),
        permission: state.permission,
        canAskAgain: state.canAskAgain,
      };

    case "PERMISSION_REQUESTED":
      if (isSpeechSessionActive(state.status)) {
        return {
          ...state,
          errorCode: "ALREADY_ACTIVE",
          errorMessage: SPEECH_RECOVERY_MESSAGES.ALREADY_ACTIVE,
        };
      }
      return {
        ...state,
        status: "permission_request",
        errorCode: null,
        errorMessage: null,
      };

    case "PERMISSION_RESOLVED": {
      const { status, canAskAgain } = action.result;
      if (status !== "granted") {
        const code: SpeechErrorCode =
          status === "unavailable" ? "SERVICE_UNAVAILABLE" : "PERMISSION_DENIED";
        return {
          ...state,
          status: "error",
          permission: status,
          canAskAgain,
          errorCode: code,
          errorMessage: SPEECH_RECOVERY_MESSAGES[code],
        };
      }
      return {
        ...state,
        permission: "granted",
        canAskAgain,
        errorCode: null,
        errorMessage: null,
      };
    }

    case "SERVICE_UNAVAILABLE":
      return {
        ...state,
        status: "error",
        permission: "unavailable",
        canAskAgain: false,
        errorCode: "SERVICE_UNAVAILABLE",
        errorMessage: SPEECH_RECOVERY_MESSAGES.SERVICE_UNAVAILABLE,
      };

    case "START_REQUESTED":
      if (
        state.status === "starting" ||
        state.status === "listening" ||
        state.status === "stopping"
      ) {
        return {
          ...state,
          errorCode: "ALREADY_ACTIVE",
          errorMessage: SPEECH_RECOVERY_MESSAGES.ALREADY_ACTIVE,
        };
      }
      if (state.permission !== "granted") {
        return {
          ...state,
          status: "error",
          errorCode: "PERMISSION_DENIED",
          errorMessage: SPEECH_RECOVERY_MESSAGES.PERMISSION_DENIED,
        };
      }
      return {
        ...state,
        status: "starting",
        partialTranscript: "",
        finalTranscript: "",
        errorCode: null,
        errorMessage: null,
      };

    case "SESSION_STARTED":
      if (state.status !== "starting") {
        return state;
      }
      return {
        ...state,
        status: "listening",
      };

    case "PARTIAL_RESULT":
      if (state.status !== "listening" && state.status !== "stopping") {
        return state;
      }
      return {
        ...state,
        partialTranscript: action.transcript,
      };

    case "STOP_REQUESTED":
      if (state.status !== "listening" && state.status !== "starting") {
        return state;
      }
      return {
        ...state,
        status: "stopping",
      };

    case "FINAL_RESULT": {
      const cleaned = action.transcript.trim();
      if (!cleaned) {
        return {
          ...state,
          status: "error",
          partialTranscript: "",
          finalTranscript: "",
          errorCode: "EMPTY_TRANSCRIPT",
          errorMessage: SPEECH_RECOVERY_MESSAGES.EMPTY_TRANSCRIPT,
        };
      }
      return {
        ...state,
        status: "transcribed",
        partialTranscript: cleaned,
        finalTranscript: cleaned,
        errorCode: null,
        errorMessage: null,
      };
    }

    case "EMPTY_RESULT":
      return {
        ...state,
        status: "error",
        partialTranscript: "",
        finalTranscript: "",
        errorCode: "EMPTY_TRANSCRIPT",
        errorMessage: SPEECH_RECOVERY_MESSAGES.EMPTY_TRANSCRIPT,
      };

    case "CANCELLED":
      return {
        ...state,
        status: "cancelled",
        partialTranscript: "",
        errorCode: null,
        errorMessage: null,
      };

    case "ERROR": {
      const resolvedMessage =
        action.message && action.message.trim().length > 0
          ? action.message
          : SPEECH_RECOVERY_MESSAGES[action.code];
      if (action.code === "ALREADY_ACTIVE" && isSpeechSessionActive(state.status)) {
        return {
          ...state,
          errorCode: "ALREADY_ACTIVE",
          errorMessage: resolvedMessage,
        };
      }
      return {
        ...state,
        status: "error",
        errorCode: action.code,
        errorMessage: resolvedMessage,
      };
    }
  }
}

/** Coordinates an active STT session with single-session locking, timeout, and cleanup. */
export class SpeechSessionController {
  private state: SpeechSessionState = createInitialSpeechState();
  private cleanupSubscriptions: (() => void) | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private sessionSeq = 0;
  private readonly listeners = new Set<(state: SpeechSessionState) => void>();

  constructor(
    private readonly adapter: SpeechAdapter,
    private readonly locale: string = "tr-TR",
    private readonly sessionTimeoutMs: number = 15_000,
  ) {}

  public getState(): SpeechSessionState {
    return this.state;
  }

  public subscribe(listener: (state: SpeechSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async start(): Promise<SpeechSessionState> {
    if (this.disposed) {
      return this.state;
    }
    if (isSpeechSessionActive(this.state.status)) {
      this.dispatch({ type: "ERROR", code: "ALREADY_ACTIVE" });
      return this.state;
    }

    if (!this.adapter.isAvailable()) {
      this.dispatch({ type: "SERVICE_UNAVAILABLE" });
      return this.state;
    }

    const activeSeq = ++this.sessionSeq;
    this.dispatch({ type: "PERMISSION_REQUESTED" });

    let permission: SpeechPermissionResult;
    try {
      permission = await this.adapter.requestPermission();
    } catch {
      if (this.disposed || this.sessionSeq !== activeSeq) {
        return this.state;
      }
      this.dispatch({ type: "ERROR", code: "PLATFORM_ERROR" });
      return this.state;
    }

    // Enforce T-11 / AT-19: abort startup if user cancelled/backgrounded while waiting for OS dialog
    if (
      this.disposed ||
      this.sessionSeq !== activeSeq ||
      this.state.status === "cancelled" ||
      this.state.status !== "permission_request"
    ) {
      return this.state;
    }

    this.dispatch({ type: "PERMISSION_RESOLVED", result: permission });

    if (permission.status !== "granted") {
      return this.state;
    }

    this.dispatch({ type: "START_REQUESTED" });
    this.detachSubscriptions();
    this.armSessionTimeout(activeSeq);

    try {
      this.cleanupSubscriptions = this.adapter.startListening(this.locale, {
        onStart: () => {
          this.dispatch({ type: "SESSION_STARTED" });
        },
        onPartialResult: (transcript) => {
          this.dispatch({ type: "PARTIAL_RESULT", transcript });
        },
        onFinalResult: (transcript) => {
          this.detachSubscriptions();
          this.dispatch({ type: "FINAL_RESULT", transcript });
        },
        onEmptyResult: () => {
          this.detachSubscriptions();
          this.dispatch({ type: "EMPTY_RESULT" });
        },
        onError: (code, message) => {
          this.detachSubscriptions();
          if (code === "ABORTED") {
            this.dispatch({ type: "CANCELLED" });
            return;
          }
          this.dispatch({ type: "ERROR", code, message });
        },
        onEnd: () => {
          this.detachSubscriptions();
          if (this.state.status === "stopping" || this.state.status === "listening") {
            const fallbackText = this.state.partialTranscript.trim();
            if (fallbackText) {
              this.dispatch({ type: "FINAL_RESULT", transcript: fallbackText });
            } else {
              this.dispatch({ type: "EMPTY_RESULT" });
            }
          }
        },
      });
    } catch {
      this.detachSubscriptions();
      this.dispatch({ type: "ERROR", code: "PLATFORM_ERROR" });
    }

    return this.state;
  }

  public stop(): void {
    if (this.state.status !== "listening" && this.state.status !== "starting") {
      return;
    }
    this.dispatch({ type: "STOP_REQUESTED" });
    try {
      this.adapter.stopListening();
    } catch {
      this.detachSubscriptions();
      this.dispatch({ type: "ERROR", code: "PLATFORM_ERROR" });
    }
  }

  public cancel(): void {
    if (!isSpeechSessionActive(this.state.status)) {
      return;
    }
    this.sessionSeq += 1;
    this.detachSubscriptions();
    try {
      this.adapter.abortListening();
    } finally {
      this.dispatch({ type: "CANCELLED" });
    }
  }

  public reset(): void {
    this.sessionSeq += 1;
    this.detachSubscriptions();
    if (isSpeechSessionActive(this.state.status)) {
      try {
        this.adapter.abortListening();
      } catch {
        // Ignore teardown failures on reset
      }
    }
    this.dispatch({ type: "RESET" });
  }

  /** Enforce AT-19 / T-11: never keep microphone active when app leaves foreground. */
  public handleAppBackground(): void {
    this.cancel();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancel();
    this.clearSessionTimeout();
    this.listeners.clear();
  }

  private armSessionTimeout(seq: number): void {
    this.clearSessionTimeout();
    if (this.sessionTimeoutMs <= 0) {
      return;
    }
    this.sessionTimer = setTimeout(() => {
      if (this.disposed || this.sessionSeq !== seq || !isSpeechSessionActive(this.state.status)) {
        return;
      }
      this.detachSubscriptions();
      try {
        this.adapter.abortListening();
      } catch {
        // Best-effort abort on native timeout
      }
      this.dispatch({ type: "EMPTY_RESULT" });
    }, this.sessionTimeoutMs);
    const timerHandle = this.sessionTimer as unknown as { unref?: () => void };
    timerHandle.unref?.();
  }

  private clearSessionTimeout(): void {
    if (this.sessionTimer !== null) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  private detachSubscriptions(): void {
    this.clearSessionTimeout();
    if (this.cleanupSubscriptions) {
      this.cleanupSubscriptions();
      this.cleanupSubscriptions = null;
    }
  }

  private dispatch(action: SpeechAction): void {
    this.state = speechStateReducer(this.state, action);
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
