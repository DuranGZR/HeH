import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState, Linking, Platform, type AppStateStatus } from "react-native";

import { resolveDefaultSpeechProvider } from "./mockSpeechProvider";
import { SpeechSessionController, isSpeechSessionActive } from "./stateMachine";
import type { SpeechPermissionResult, SpeechProvider, SpeechSessionState } from "./types";

export interface UseSpeechSessionOptions {
  readonly provider?: SpeechProvider;
  readonly locale?: string;
  readonly sessionTimeoutMs?: number;
  readonly stopGraceTimeoutMs?: number;
  readonly syncPermissionOnMount?: boolean;
  readonly openSettingsImpl?: () => Promise<void>;
  readonly onFinalTranscript?: (transcript: string) => void;
}

export interface UseSpeechSessionResult {
  readonly state: SpeechSessionState;
  readonly isAvailable: boolean;
  readonly supportsOnDevice: boolean;
  readonly isBusy: boolean;
  readonly isListening: boolean;
  readonly isRequestingPermission: boolean;
  readonly isPermissionBlocked: boolean;
  readonly transcript: string;
  readonly startListening: () => Promise<SpeechSessionState>;
  readonly stopListening: () => void;
  readonly cancelListening: () => void;
  readonly resetSession: () => void;
  readonly syncPermission: () => Promise<SpeechPermissionResult>;
  readonly openAppSettings: () => Promise<boolean>;
}

/**
 * React lifecycle hook owning a single `SpeechSessionController`:
 * - Never auto-starts recording on mount or foreground restore (`US-01` / `US-09`)
 * - Immediately aborts active recording and frees hardware/listeners on background/inactive (`AT-19`)
 * - Emits `onFinalTranscript` once per completed session without StrictMode effect duplication
 */
export function useSpeechSession(options?: UseSpeechSessionOptions): UseSpeechSessionResult {
  const resolvedProvider = useMemo(
    () => options?.provider ?? resolveDefaultSpeechProvider(),
    [options?.provider],
  );
  const locale = options?.locale ?? "tr-TR";
  const sessionTimeoutMs = options?.sessionTimeoutMs ?? 15_000;
  const stopGraceTimeoutMs = options?.stopGraceTimeoutMs ?? 1_500;
  const syncPermissionOnMount = options?.syncPermissionOnMount ?? false;
  const openSettingsImpl = options?.openSettingsImpl;

  const onFinalTranscriptRef = useRef(options?.onFinalTranscript);
  useEffect(() => {
    onFinalTranscriptRef.current = options?.onFinalTranscript;
  }, [options?.onFinalTranscript]);

  const controller = useMemo(
    () =>
      new SpeechSessionController(resolvedProvider, locale, sessionTimeoutMs, stopGraceTimeoutMs),
    [locale, resolvedProvider, sessionTimeoutMs, stopGraceTimeoutMs],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.subscribe(() => onStoreChange()),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    let lastStatus = controller.getState().status;
    const unsubFinal = controller.subscribe((nextState) => {
      const transitionedToFinal =
        lastStatus !== "transcribed" &&
        nextState.status === "transcribed" &&
        nextState.finalTranscript.trim().length > 0;
      lastStatus = nextState.status;
      if (transitionedToFinal) {
        onFinalTranscriptRef.current?.(nextState.finalTranscript);
      }
    });

    if (syncPermissionOnMount) {
      void controller.syncPermission();
    }

    const handleAppStateChange = (nextState: AppStateStatus): void => {
      if (nextState === "background" || nextState === "inactive") {
        controller.handleAppBackground();
        return;
      }
      if (nextState === "active") {
        void controller.syncPermission();
      }
    };

    const appStateSub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      unsubFinal();
      appStateSub?.remove?.();
      controller.cancel();
    };
  }, [controller, syncPermissionOnMount]);

  const startListening = useCallback(() => controller.start(), [controller]);
  const stopListening = useCallback(() => controller.stop(), [controller]);
  const cancelListening = useCallback(() => controller.cancel(), [controller]);
  const resetSession = useCallback(() => controller.reset(), [controller]);
  const syncPermission = useCallback(() => controller.syncPermission(), [controller]);
  const openAppSettings = useCallback(async (): Promise<boolean> => {
    try {
      if (openSettingsImpl) {
        await openSettingsImpl();
        return true;
      }
      if (Platform.OS === "web" || typeof Linking.openSettings !== "function") {
        return false;
      }
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }, [openSettingsImpl]);

  return {
    state,
    isAvailable: controller.isAvailable(),
    supportsOnDevice: controller.supportsOnDevice(),
    isBusy: isSpeechSessionActive(state.status),
    isListening: state.status === "listening" || state.status === "stopping",
    isRequestingPermission: state.status === "permission_request",
    isPermissionBlocked: state.permission === "denied" && !state.canAskAgain,
    transcript: state.finalTranscript || state.partialTranscript,
    startListening,
    stopListening,
    cancelListening,
    resetSession,
    syncPermission,
    openAppSettings,
  };
}
