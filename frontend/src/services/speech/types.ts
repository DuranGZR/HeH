export type SpeechLifecycleStatus =
  | "idle"
  | "permission_request"
  | "starting"
  | "listening"
  | "stopping"
  | "transcribed"
  | "error"
  | "cancelled";

export type SpeechPermissionStatus = "undetermined" | "granted" | "denied" | "unavailable";

export type SpeechErrorCode =
  | "PERMISSION_DENIED"
  | "SERVICE_UNAVAILABLE"
  | "EMPTY_TRANSCRIPT"
  | "ALREADY_ACTIVE"
  | "INTERRUPTED"
  | "ABORTED"
  | "NETWORK_ERROR"
  | "BUSY_ERROR"
  | "PLATFORM_ERROR";

export interface SpeechPermissionResult {
  readonly status: SpeechPermissionStatus;
  readonly canAskAgain: boolean;
}

export interface SpeechLocaleSupport {
  readonly locale: string;
  readonly supported: boolean;
  readonly installedOffline: boolean;
}

export interface SpeechSessionState {
  readonly status: SpeechLifecycleStatus;
  readonly permission: SpeechPermissionStatus;
  readonly canAskAgain: boolean;
  readonly partialTranscript: string;
  readonly finalTranscript: string;
  readonly errorCode: SpeechErrorCode | null;
  readonly errorMessage: string | null;
}

export interface SpeechProviderCallbacks {
  readonly onStart: () => void;
  readonly onPartialResult: (transcript: string) => void;
  readonly onFinalResult: (transcript: string) => void;
  readonly onEmptyResult: () => void;
  readonly onError: (code: SpeechErrorCode, message: string) => void;
  readonly onEnd: () => void;
}

/** Canonical STT provider interface isolating native/mock speech modules behind a clean port. */
export interface SpeechProvider {
  isAvailable(): boolean;
  supportsOnDevice(): boolean;
  checkLocaleSupport?(locale: string): Promise<SpeechLocaleSupport>;
  getPermission(): Promise<SpeechPermissionResult>;
  requestPermission(): Promise<SpeechPermissionResult>;
  startListening(locale: string, callbacks: SpeechProviderCallbacks): () => void;
  stopListening(): void;
  abortListening(): void;
}

export type SpeechAdapter = SpeechProvider;
export type SpeechAdapterCallbacks = SpeechProviderCallbacks;

export const SPEECH_RECOVERY_MESSAGES: Record<SpeechErrorCode, string> = {
  PERMISSION_DENIED: "Mikrofon kapalı. Yazarak devam edebilirsin.",
  SERVICE_UNAVAILABLE: "Bu cihazda sesli arama kullanılamıyor.",
  EMPTY_TRANSCRIPT: "Bir şey duyamadım. Tekrar deneyebilirsin.",
  ALREADY_ACTIVE: "Sesli arama zaten aktif.",
  INTERRUPTED: "Ses kaydı kesintiye uğradı. Tekrar deneyebilirsin.",
  ABORTED: "Sesli arama iptal edildi.",
  NETWORK_ERROR: "Ağ bağlantısı zayıf. Cihazdaki ses tanıma veya yazı modunu dene.",
  BUSY_ERROR: "Konuşma servisi şu an meşgul. Kısa süre sonra tekrar dene.",
  PLATFORM_ERROR: "Ses algılanamadı. Yazarak devam edebilirsin.",
};
