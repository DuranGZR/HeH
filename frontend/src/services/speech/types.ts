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
  status: SpeechPermissionStatus;
  canAskAgain: boolean;
}

export interface SpeechSessionState {
  status: SpeechLifecycleStatus;
  permission: SpeechPermissionStatus;
  canAskAgain: boolean;
  partialTranscript: string;
  finalTranscript: string;
  errorCode: SpeechErrorCode | null;
  errorMessage: string | null;
}

export interface SpeechAdapterCallbacks {
  onStart: () => void;
  onPartialResult: (transcript: string) => void;
  onFinalResult: (transcript: string) => void;
  onEmptyResult: () => void;
  onError: (code: SpeechErrorCode, message: string) => void;
  onEnd: () => void;
}

export interface SpeechAdapter {
  isAvailable(): boolean;
  supportsOnDevice(): boolean;
  getPermission(): Promise<SpeechPermissionResult>;
  requestPermission(): Promise<SpeechPermissionResult>;
  startListening(locale: string, callbacks: SpeechAdapterCallbacks): () => void;
  stopListening(): void;
  abortListening(): void;
}

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
