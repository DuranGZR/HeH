import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorCode,
} from "expo-speech-recognition";

type NativePermissionResponse = Awaited<
  ReturnType<typeof ExpoSpeechRecognitionModule.getPermissionsAsync>
>;

import {
  SPEECH_RECOVERY_MESSAGES,
  type SpeechAdapter,
  type SpeechAdapterCallbacks,
  type SpeechErrorCode,
  type SpeechPermissionResult,
} from "./types";

const TR_COMMERCE_CONTEXTUAL_STRINGS = [
  "Trendyol",
  "Sony",
  "JBL",
  "Nike",
  "Adidas",
  "Apple",
  "Samsung",
  "mont",
  "kulaklık",
  "laptop",
];

function mapPermissionResponse(response: NativePermissionResponse): SpeechPermissionResult {
  if (response.restricted) {
    return { status: "unavailable", canAskAgain: false };
  }
  if (response.granted) {
    return { status: "granted", canAskAgain: true };
  }
  return {
    status: response.status === "undetermined" ? "undetermined" : "denied",
    canAskAgain: response.canAskAgain,
  };
}

function mapNativeErrorCode(code: ExpoSpeechRecognitionErrorCode): SpeechErrorCode {
  switch (code) {
    case "not-allowed":
      return "PERMISSION_DENIED";
    case "service-not-allowed":
    case "language-not-supported":
      return "SERVICE_UNAVAILABLE";
    case "no-speech":
    case "speech-timeout":
      return "EMPTY_TRANSCRIPT";
    case "network":
      return "NETWORK_ERROR";
    case "busy":
    case "too-many-requests":
      return "BUSY_ERROR";
    case "interrupted":
      return "INTERRUPTED";
    case "aborted":
      return "ABORTED";
    default:
      return "PLATFORM_ERROR";
  }
}

/** Expo SDK 58 concrete STT adapter wrapping `expo-speech-recognition`. */
export class ExpoSpeechRecognitionAdapter implements SpeechAdapter {
  public isAvailable(): boolean {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  }

  public supportsOnDevice(): boolean {
    return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  }

  public async getPermission(): Promise<SpeechPermissionResult> {
    const response = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    return mapPermissionResponse(response);
  }

  public async requestPermission(): Promise<SpeechPermissionResult> {
    const response = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return mapPermissionResponse(response);
  }

  public startListening(locale: string, callbacks: SpeechAdapterCallbacks): () => void {
    const startSub = ExpoSpeechRecognitionModule.addListener("start", () => {
      callbacks.onStart();
    });

    const resultSub = ExpoSpeechRecognitionModule.addListener("result", (event) => {
      const transcript = event.results[0]?.transcript ?? "";
      if (event.isFinal) {
        callbacks.onFinalResult(transcript);
      } else {
        callbacks.onPartialResult(transcript);
      }
    });

    const noMatchSub = ExpoSpeechRecognitionModule.addListener("nomatch", () => {
      callbacks.onEmptyResult();
    });

    const errorSub = ExpoSpeechRecognitionModule.addListener("error", (event) => {
      const mapped = mapNativeErrorCode(event.error);
      callbacks.onError(mapped, SPEECH_RECOVERY_MESSAGES[mapped]);
    });

    const endSub = ExpoSpeechRecognitionModule.addListener("end", () => {
      callbacks.onEnd();
    });

    const cleanup = (): void => {
      startSub.remove();
      resultSub.remove();
      noMatchSub.remove();
      errorSub.remove();
      endSub.remove();
    };

    try {
      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        contextualStrings: TR_COMMERCE_CONTEXTUAL_STRINGS,
      });
    } catch (err) {
      cleanup();
      throw err;
    }

    return cleanup;
  }

  public stopListening(): void {
    ExpoSpeechRecognitionModule.stop();
  }

  public abortListening(): void {
    ExpoSpeechRecognitionModule.abort();
  }
}
