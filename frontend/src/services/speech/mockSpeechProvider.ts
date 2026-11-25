import { ExpoSpeechRecognitionAdapter } from "./expoSpeechAdapter";
import {
  SPEECH_RECOVERY_MESSAGES,
  type SpeechErrorCode,
  type SpeechLocaleSupport,
  type SpeechPermissionResult,
  type SpeechProvider,
  type SpeechProviderCallbacks,
} from "./types";

export interface MockSpeechProviderOptions {
  readonly available?: boolean;
  readonly onDeviceSupported?: boolean;
  readonly supportedLocales?: readonly string[];
  readonly permission?: SpeechPermissionResult;
  readonly partialTranscripts?: readonly string[];
  readonly finalTranscript?: string;
  readonly partialIntervalMs?: number;
  readonly simulateError?: SpeechErrorCode | null;
  readonly simulateEmptyResult?: boolean;
}

/**
 * Deterministic in-memory SpeechProvider for automated unit tests, simulators,
 * and hardware-free local runs. Guarantees idempotent timer/listener teardown.
 */
export class MockSpeechProvider implements SpeechProvider {
  private available: boolean;
  private readonly onDeviceSupported: boolean;
  private readonly supportedLocales: readonly string[];
  private permission: SpeechPermissionResult;
  private readonly partialTranscripts: readonly string[];
  private readonly finalTranscript: string;
  private readonly partialIntervalMs: number;
  private readonly simulateError: SpeechErrorCode | null;
  private readonly simulateEmptyResult: boolean;

  private activeCallbacks: SpeechProviderCallbacks | null = null;
  private activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private lastPartial = "";
  private activeSubscriptionCount = 0;

  public startCount = 0;
  public stopCount = 0;
  public abortCount = 0;
  public cleanupCount = 0;

  constructor(options?: MockSpeechProviderOptions) {
    this.available = options?.available ?? true;
    this.onDeviceSupported = options?.onDeviceSupported ?? true;
    this.supportedLocales = options?.supportedLocales ?? ["tr-TR", "tr_TR"];
    this.permission = options?.permission ?? { status: "granted", canAskAgain: true };
    this.partialTranscripts = options?.partialTranscripts ?? [
      "3000 altı",
      "3000 altı siyah erkek mont",
    ];
    this.finalTranscript = options?.finalTranscript ?? "3000 altı siyah erkek mont";
    this.partialIntervalMs = options?.partialIntervalMs ?? 20;
    this.simulateError = options?.simulateError ?? null;
    this.simulateEmptyResult = options?.simulateEmptyResult ?? false;
  }

  public isAvailable(): boolean {
    return this.available;
  }

  public supportsOnDevice(): boolean {
    return this.onDeviceSupported;
  }

  public async checkLocaleSupport(locale: string): Promise<SpeechLocaleSupport> {
    if (!this.available) {
      return { locale, supported: false, installedOffline: false };
    }
    const target = locale.trim().replace(/_/g, "-").toLowerCase();
    const supported = this.supportedLocales.some(
      (tag) => tag.trim().replace(/_/g, "-").toLowerCase() === target,
    );
    return {
      locale,
      supported,
      installedOffline: supported && this.onDeviceSupported,
    };
  }

  public async getPermission(): Promise<SpeechPermissionResult> {
    return this.permission;
  }

  public async requestPermission(): Promise<SpeechPermissionResult> {
    return this.permission;
  }

  public setPermission(nextPermission: SpeechPermissionResult): void {
    this.permission = nextPermission;
  }

  public setAvailable(nextAvailable: boolean): void {
    this.available = nextAvailable;
  }

  public getActiveSubscriptionCount(): number {
    return this.activeSubscriptionCount;
  }

  public startListening(_locale: string, callbacks: SpeechProviderCallbacks): () => void {
    this.startCount += 1;
    this.activeCallbacks = callbacks;
    this.activeSubscriptionCount += 1;
    this.lastPartial = "";

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      this.cleanupCount += 1;
      this.activeSubscriptionCount = Math.max(0, this.activeSubscriptionCount - 1);
      this.clearAllTimers();
      this.activeCallbacks = null;
    };

    const schedule = (delayMs: number, fn: () => void): void => {
      const handle = setTimeout(() => {
        this.activeTimers.delete(handle);
        if (!cleaned && this.activeCallbacks === callbacks) {
          fn();
        }
      }, delayMs);
      const timerObj = handle as unknown as { unref?: () => void };
      timerObj.unref?.();
      this.activeTimers.add(handle);
    };

    schedule(0, () => {
      callbacks.onStart();

      if (this.simulateError) {
        const code = this.simulateError;
        schedule(this.partialIntervalMs, () => {
          callbacks.onError(code, SPEECH_RECOVERY_MESSAGES[code]);
        });
        return;
      }

      if (this.simulateEmptyResult) {
        schedule(this.partialIntervalMs, () => {
          callbacks.onEmptyResult();
        });
        return;
      }

      this.partialTranscripts.forEach((chunk, index) => {
        schedule((index + 1) * this.partialIntervalMs, () => {
          this.lastPartial = chunk;
          callbacks.onPartialResult(chunk);
        });
      });

      const finalDelay = (this.partialTranscripts.length + 1) * this.partialIntervalMs;
      schedule(finalDelay, () => {
        callbacks.onFinalResult(this.finalTranscript);
      });
    });

    return cleanup;
  }

  public stopListening(): void {
    this.stopCount += 1;
    const cb = this.activeCallbacks;
    this.clearAllTimers();
    if (!cb) {
      return;
    }
    const candidate = this.lastPartial.trim() || this.finalTranscript.trim();
    if (this.simulateEmptyResult || !candidate) {
      cb.onEmptyResult();
      return;
    }
    cb.onFinalResult(candidate);
  }

  public abortListening(): void {
    this.abortCount += 1;
    const cb = this.activeCallbacks;
    this.clearAllTimers();
    this.activeCallbacks = null;
    cb?.onError("ABORTED", SPEECH_RECOVERY_MESSAGES.ABORTED);
  }

  private clearAllTimers(): void {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
  }
}

/** Resolve Expo native STT unless mock speech mode is explicitly enabled for dev/CI. */
export function resolveDefaultSpeechProvider(options?: {
  readonly useMock?: boolean;
  readonly mockOptions?: MockSpeechProviderOptions;
}): SpeechProvider {
  const envMockFlag =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_HEH_USE_MOCK_SPEECH : undefined;
  const shouldUseMock = options?.useMock ?? envMockFlag === "1";
  if (shouldUseMock) {
    return new MockSpeechProvider(options?.mockOptions);
  }
  return new ExpoSpeechRecognitionAdapter();
}
