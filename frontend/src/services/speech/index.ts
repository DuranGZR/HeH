export { ExpoSpeechRecognitionAdapter } from "./expoSpeechAdapter";
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
  type SpeechPermissionResult,
  type SpeechPermissionStatus,
  type SpeechSessionState,
} from "./types";
