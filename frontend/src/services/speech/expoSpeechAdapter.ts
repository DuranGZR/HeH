import { requireOptionalNativeModule } from "expo";
import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
  IOSTaskHintValue,
} from "expo-speech-recognition";
import { Platform } from "react-native";

import {
  SPEECH_RECOVERY_MESSAGES,
  type SpeechErrorCode,
  type SpeechLocaleSupport,
  type SpeechPermissionResult,
  type SpeechProvider,
  type SpeechProviderCallbacks,
} from "./types";

export interface NativePermissionResponse {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: string;
  readonly restricted?: boolean;
}

export interface NativeSupportedLocalesResponse {
  readonly locales: readonly string[];
  readonly installedLocales: readonly string[];
}

export interface NativeEventSubscription {
  remove(): void;
}

export interface ExpoSpeechRecognitionNativeModule {
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  getSpeechRecognitionServices?(): string[];
  getDefaultRecognitionService?(): { readonly packageName: string };
  getSupportedLocales?(options: {
    androidRecognitionServicePackage?: string;
  }): Promise<NativeSupportedLocalesResponse>;
  getPermissionsAsync(): Promise<NativePermissionResponse>;
  requestPermissionsAsync(): Promise<NativePermissionResponse>;
  addListener(
    eventName: "start" | "nomatch" | "end",
    listener: () => void,
  ): NativeEventSubscription;
  addListener(
    eventName: "result",
    listener: (event: ExpoSpeechRecognitionResultEvent) => void,
  ): NativeEventSubscription;
  addListener(
    eventName: "error",
    listener: (event: ExpoSpeechRecognitionErrorEvent) => void,
  ): NativeEventSubscription;
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
}

export interface AndroidSpeechServiceInfo {
  readonly services: readonly string[];
  readonly defaultPackage: string;
  readonly selectedPackage: string | undefined;
}

export interface ExpoSpeechRecognitionAdapterOptions {
  readonly nativeModule?: ExpoSpeechRecognitionNativeModule | null;
  readonly iosTaskHint?: IOSTaskHintValue;
  readonly requiresOnDeviceRecognition?: boolean;
  readonly androidRecognitionServicePackage?: string;
}

const PREFERRED_ANDROID_PACKAGES = [
  "com.google.android.as",
  "com.google.android.googlequicksearchbox",
  "com.google.android.tts",
] as const;

const TR_COMMERCE_CONTEXTUAL_STRINGS = [
  "Trendyol",
  "Sony",
  "JBL",
  "Nike",
  "Adidas",
  "Apple",
  "Samsung",
  "Xiaomi",
  "Lenovo",
  "Asus",
  "erkek mont",
  "bluetooth kulaklık",
  "spor ayakkabı",
  "cep telefonu",
  "laptop",
  "olmasın",
];

function normalizeLocaleTag(tag: string): string {
  return tag.trim().replace(/_/g, "-").toLowerCase();
}

function matchesLocale(candidate: string, target: string): boolean {
  const normalizedCandidate = normalizeLocaleTag(candidate);
  const normalizedTarget = normalizeLocaleTag(target);
  if (normalizedCandidate === normalizedTarget) {
    return true;
  }
  const [targetLang] = normalizedTarget.split("-");
  return Boolean(targetLang && normalizedCandidate === targetLang);
}

function loadOptionalNativeSpeechModule(): ExpoSpeechRecognitionNativeModule | null {
  try {
    return (
      requireOptionalNativeModule<ExpoSpeechRecognitionNativeModule>("ExpoSpeechRecognition") ??
      requireOptionalNativeModule<ExpoSpeechRecognitionNativeModule>("ExpoSpeechRecognitionModule")
    );
  } catch {
    return null;
  }
}

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

function mapAndroidNumericErrorCode(nativeCode?: number): SpeechErrorCode | null {
  switch (nativeCode) {
    case 1: // ERROR_NETWORK_TIMEOUT
    case 2: // ERROR_NETWORK
    case 4: // ERROR_SERVER
    case 11: // ERROR_SERVER_DISCONNECTED
      return "NETWORK_ERROR";
    case 3: // ERROR_AUDIO
      return "INTERRUPTED";
    case 6: // ERROR_SPEECH_TIMEOUT
    case 7: // ERROR_NO_MATCH
      return "EMPTY_TRANSCRIPT";
    case 8: // ERROR_RECOGNIZER_BUSY
    case 10: // ERROR_TOO_MANY_REQUESTS
      return "BUSY_ERROR";
    case 9: // ERROR_INSUFFICIENT_PERMISSIONS
      return "PERMISSION_DENIED";
    case 12: // ERROR_LANGUAGE_NOT_SUPPORTED
    case 13: // ERROR_LANGUAGE_UNAVAILABLE
    case 14: // ERROR_CANNOT_CHECK_SUPPORT
      return "SERVICE_UNAVAILABLE";
    default:
      return null;
  }
}

function mapNativeErrorEvent(event: ExpoSpeechRecognitionErrorEvent): SpeechErrorCode {
  const mappedCode = mapNativeErrorCode(event.error);
  if (mappedCode !== "PLATFORM_ERROR") {
    return mappedCode;
  }
  return mapAndroidNumericErrorCode(event.code) ?? "PLATFORM_ERROR";
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
    case "audio-capture":
      return "INTERRUPTED";
    case "aborted":
      return "ABORTED";
    default:
      return "PLATFORM_ERROR";
  }
}

/**
 * Expo SDK 58 concrete STT provider wrapping `ExpoSpeechRecognition` safely.
 * Tunes iOS `SFSpeechRecognizer` (`iosTaskHint: "search"`), Android `RecognizerIntent`
 * (`web_search`, service package discovery across `com.google.android.as`/GSA/TTS, numeric errors),
 * and degrades cleanly without throwing when native speech modules are absent.
 */
export class ExpoSpeechRecognitionAdapter implements SpeechProvider {
  private readonly overrideModule?: ExpoSpeechRecognitionNativeModule | null;
  private readonly iosTaskHint: IOSTaskHintValue;
  private readonly requiresOnDeviceRecognition: boolean;
  private readonly androidRecognitionServicePackage?: string;

  constructor(
    optionsOrModule?:
      ExpoSpeechRecognitionAdapterOptions | ExpoSpeechRecognitionNativeModule | null,
  ) {
    if (optionsOrModule === null) {
      this.overrideModule = null;
      this.iosTaskHint = "search";
      this.requiresOnDeviceRecognition = false;
      return;
    }
    if (optionsOrModule && "start" in optionsOrModule) {
      this.overrideModule = optionsOrModule;
      this.iosTaskHint = "search";
      this.requiresOnDeviceRecognition = false;
      return;
    }
    this.overrideModule = optionsOrModule?.nativeModule;
    this.iosTaskHint = optionsOrModule?.iosTaskHint ?? "search";
    this.requiresOnDeviceRecognition = optionsOrModule?.requiresOnDeviceRecognition ?? false;
    this.androidRecognitionServicePackage = optionsOrModule?.androidRecognitionServicePackage;
  }

  private getNativeModule(): ExpoSpeechRecognitionNativeModule | null {
    if (this.overrideModule !== undefined) {
      return this.overrideModule;
    }
    return loadOptionalNativeSpeechModule();
  }

  public getAndroidSpeechServiceInfo(): AndroidSpeechServiceInfo {
    const mod = this.getNativeModule();
    if (!mod || Platform.OS !== "android") {
      return {
        services: [],
        defaultPackage: "",
        selectedPackage: this.androidRecognitionServicePackage,
      };
    }
    const services = mod.getSpeechRecognitionServices?.() ?? [];
    const defaultPackage = mod.getDefaultRecognitionService?.()?.packageName ?? "";
    const selectedPackage =
      this.androidRecognitionServicePackage ??
      PREFERRED_ANDROID_PACKAGES.find((pkg) => services.includes(pkg)) ??
      (defaultPackage || services[0]);
    return {
      services,
      defaultPackage,
      selectedPackage,
    };
  }

  public isAvailable(): boolean {
    const mod = this.getNativeModule();
    if (!mod) {
      return false;
    }
    if (Platform.OS === "android") {
      const info = this.getAndroidSpeechServiceInfo();
      const hasDiscoveredService = info.services.length > 0 || info.defaultPackage.length > 0;
      const canQueryServices =
        typeof mod.getSpeechRecognitionServices === "function" ||
        typeof mod.getDefaultRecognitionService === "function";
      if (canQueryServices && !hasDiscoveredService) {
        return false;
      }
    }
    return mod.isRecognitionAvailable();
  }

  public supportsOnDevice(): boolean {
    const mod = this.getNativeModule();
    if (!mod) {
      return false;
    }
    return mod.supportsOnDeviceRecognition();
  }

  public async checkLocaleSupport(locale: string): Promise<SpeechLocaleSupport> {
    const mod = this.getNativeModule();
    if (!mod || !this.isAvailable()) {
      return { locale, supported: false, installedOffline: false };
    }
    if (!mod.getSupportedLocales) {
      return {
        locale,
        supported: true,
        installedOffline: mod.supportsOnDeviceRecognition(),
      };
    }
    try {
      const androidInfo = this.getAndroidSpeechServiceInfo();
      const targetPackage = androidInfo.selectedPackage;
      const result = await mod.getSupportedLocales(
        targetPackage ? { androidRecognitionServicePackage: targetPackage } : {},
      );
      return {
        locale,
        supported: result.locales.some((item) => matchesLocale(item, locale)),
        installedOffline: result.installedLocales.some((item) => matchesLocale(item, locale)),
      };
    } catch {
      return { locale, supported: false, installedOffline: false };
    }
  }

  public async getPermission(): Promise<SpeechPermissionResult> {
    const mod = this.getNativeModule();
    if (!mod) {
      return { status: "unavailable", canAskAgain: false };
    }
    const response = await mod.getPermissionsAsync();
    return mapPermissionResponse(response);
  }

  public async requestPermission(): Promise<SpeechPermissionResult> {
    const mod = this.getNativeModule();
    if (!mod) {
      return { status: "unavailable", canAskAgain: false };
    }
    const response = await mod.requestPermissionsAsync();
    return mapPermissionResponse(response);
  }

  public startListening(locale: string, callbacks: SpeechProviderCallbacks): () => void {
    const mod = this.getNativeModule();
    if (!mod || !this.isAvailable()) {
      callbacks.onError("SERVICE_UNAVAILABLE", SPEECH_RECOVERY_MESSAGES.SERVICE_UNAVAILABLE);
      return () => undefined;
    }

    const startSub = mod.addListener("start", () => {
      callbacks.onStart();
    });

    const resultSub = mod.addListener("result", (event) => {
      const transcript = event?.results?.[0]?.transcript ?? "";
      if (event?.isFinal) {
        callbacks.onFinalResult(transcript);
      } else {
        callbacks.onPartialResult(transcript);
      }
    });

    const noMatchSub = mod.addListener("nomatch", () => {
      callbacks.onEmptyResult();
    });

    const errorSub = mod.addListener("error", (event) => {
      const mapped = mapNativeErrorEvent(event);
      callbacks.onError(mapped, SPEECH_RECOVERY_MESSAGES[mapped]);
    });

    const endSub = mod.addListener("end", () => {
      callbacks.onEnd();
    });

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      startSub?.remove?.();
      resultSub?.remove?.();
      noMatchSub?.remove?.();
      errorSub?.remove?.();
      endSub?.remove?.();
    };

    try {
      const androidInfo = this.getAndroidSpeechServiceInfo();
      const startOptions: ExpoSpeechRecognitionOptions = {
        lang: locale,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        contextualStrings: TR_COMMERCE_CONTEXTUAL_STRINGS,
        iosTaskHint: this.iosTaskHint,
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: "web_search",
        },
        ...(this.requiresOnDeviceRecognition ? { requiresOnDeviceRecognition: true } : {}),
        ...(androidInfo.selectedPackage
          ? { androidRecognitionServicePackage: androidInfo.selectedPackage }
          : {}),
      };
      mod.start(startOptions);
    } catch (err) {
      cleanup();
      throw err;
    }

    return cleanup;
  }

  public stopListening(): void {
    this.getNativeModule()?.stop();
  }

  public abortListening(): void {
    this.getNativeModule()?.abort();
  }
}
