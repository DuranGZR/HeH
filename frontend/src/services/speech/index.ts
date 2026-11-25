export {
  ExpoSpeechRecognitionAdapter,
  type AndroidSpeechServiceInfo,
  type ExpoSpeechRecognitionAdapterOptions,
  type ExpoSpeechRecognitionNativeModule,
} from "./expoSpeechAdapter";
export {
  MockSpeechProvider,
  resolveDefaultSpeechProvider,
  type MockSpeechProviderOptions,
} from "./mockSpeechProvider";
export {
  SpeechSessionController,
  createInitialSpeechState,
  isSpeechSessionActive,
  speechStateReducer,
} from "./stateMachine";
export type { SpeechAction } from "./stateMachine";
export {
  SPEECH_RECOVERY_MESSAGES,
  type SpeechAdapter,
  type SpeechAdapterCallbacks,
  type SpeechErrorCode,
  type SpeechLifecycleStatus,
  type SpeechLocaleSupport,
  type SpeechPermissionResult,
  type SpeechPermissionStatus,
  type SpeechProvider,
  type SpeechProviderCallbacks,
  type SpeechSessionState,
} from "./types";
export {
  useSpeechSession,
  type UseSpeechSessionOptions,
  type UseSpeechSessionResult,
} from "./useSpeechSession";
