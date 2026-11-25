import {
  useMutation,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  HehApiClient,
  HehApiError,
  createClientRequestId,
  createHehQueryClient,
  hehQueryKeys,
  isAbortError,
  type LinkFilterItem,
  type LinkResolution,
  type ProviderCapabilitiesResponse,
  type ReadinessResponse,
  type SearchApiTransport,
  type SearchIntentV2Output,
  type SearchParseResponse,
  type SearchResolveRequest,
  type SearchResolveResponse,
} from "@/api";
import type { CriterionVisualStatus } from "@/theme";

import {
  buildCriteriaGroupViewModels,
  removeCriterionFromIntent,
  removeOptionFromOrIntent,
  updatePriceCriterionInIntent,
  type CriteriaChipViewModel,
  type CriteriaGroupViewModel,
} from "./criteriaAst";
import { MockSearchTransport, toInputIntent } from "./demoFixtures";
import {
  launchSafeProviderRedirect,
  validateExternalProviderUrl,
  type SafeRedirectDeps,
} from "./externalRedirect";

export {
  launchSafeProviderRedirect,
  validateExternalProviderUrl,
  type ExternalRedirectResult,
  type SafeRedirectDeps,
} from "./externalRedirect";

export type {
  CriteriaChipViewModel,
  CriteriaGroupItemViewModel,
  CriteriaGroupKind,
  CriteriaGroupViewModel,
  OrOptionChip,
} from "./criteriaAst";

export type SearchFlowPhase =
  "idle" | "parsing" | "reviewing" | "resolving" | "opening_external" | "error";

/** Resolve live `HehApiClient` unless demo mock mode is explicitly enabled via env or options. */
export function resolveDefaultSearchTransport(options?: {
  readonly useMock?: boolean;
  readonly baseUrl?: string;
}): SearchApiTransport {
  const envMockFlag =
    typeof process !== "undefined" ? process.env.EXPO_PUBLIC_HEH_USE_MOCK : undefined;
  const shouldUseMock = options?.useMock ?? envMockFlag === "1";
  if (shouldUseMock) {
    return new MockSearchTransport();
  }
  return new HehApiClient(options?.baseUrl ? { baseUrl: options.baseUrl } : undefined);
}

/**
 * Map backend verification status into honest UI badges.
 * Never displays "Filtre uygulandı" unless dual-platform `FILTER_VERIFIED` proof exists.
 */
export function mapStatusToUiBadge(status: LinkFilterItem["status"]): {
  readonly visualStatus: CriterionVisualStatus;
  readonly badgeLabel: string;
} {
  switch (status) {
    case "FILTER_VERIFIED":
      return { visualStatus: "applied", badgeLabel: "Filtre uygulandı" };
    case "WEB_VERIFIED_PENDING_MOBILE":
      return { visualStatus: "query_only", badgeLabel: "Web doğrulandı" };
    case "UNSUPPORTED":
      return { visualStatus: "unsupported", badgeLabel: "Uygulanamadı" };
    case "QUERY_ONLY":
    case "UNKNOWN":
      return { visualStatus: "query_only", badgeLabel: "Arama metninde" };
  }
}

export function buildCriteriaViewModels(
  resolution: LinkResolution,
): readonly CriteriaChipViewModel[] {
  const combined: readonly LinkFilterItem[] = [
    ...(resolution.applied_filters ?? []),
    ...(resolution.query_only ?? []),
    ...(resolution.unsupported ?? []),
  ];
  return combined.map((item) => {
    const { visualStatus, badgeLabel } = mapStatusToUiBadge(item.status);
    return {
      criterionId: item.criterion_id,
      field: item.field,
      label: item.label,
      operator: item.operator,
      status: item.status,
      visualStatus,
      badgeLabel,
      reason: item.reason,
    };
  });
}

export function buildResolutionSummaryText(resolution: LinkResolution): string {
  const applied = resolution.applied_filters ?? [];
  const verifiedMobileCount = applied.filter((item) => item.status === "FILTER_VERIFIED").length;
  const webPendingCount = applied.filter(
    (item) => item.status === "WEB_VERIFIED_PENDING_MOBILE",
  ).length;
  const queryCount = (resolution.query_only ?? []).length;
  const unsupportedCount = (resolution.unsupported ?? []).length;

  const appliedLabel =
    verifiedMobileCount === applied.length && verifiedMobileCount > 0
      ? `${verifiedMobileCount} kriter filtrelendi`
      : applied.length === 0
        ? "0 web filtresi"
        : `${applied.length} web filtresi (${webPendingCount > 0 ? "mobil kontrol bekliyor" : "hazır"})`;

  return `${appliedLabel}, ${queryCount} metinle arandı, ${unsupportedCount} uygulanamadı.`;
}

function mapFlowErrorMessage(err: unknown): string {
  if (err instanceof HehApiError) {
    if (err.status === 422) {
      return "Bu cümleyi filtrelere ayıramadık. Düzenleyebilirsin.";
    }
    if (err.status === 409) {
      return "Filtre sözlüğü güncellendi. Aramayı tekrar çalıştır.";
    }
    if (err.message.trim()) {
      return err.message;
    }
  }
  return "Bağlantı yok. Tekrar dene.";
}

export function buildSafeRedirectDeps(options?: UseSearchFlowOptions): SafeRedirectDeps {
  if (options?.redirectDeps) {
    return options.redirectDeps;
  }
  if (options?.openUrl) {
    const openUrl = options.openUrl;
    return {
      canOpenUrl: async () => true,
      openPrimaryUrl: openUrl,
      openFallbackUrl: openUrl,
    };
  }
  return {};
}

export function selectPrimaryCtaLabel(resolution: LinkResolution): string {
  if (resolution.warning_level === "critical" || (resolution.unsupported ?? []).length > 0) {
    return "Kısmi aramayı aç";
  }
  return "Trendyol'da göster";
}

function linkAbortSignals(
  primary: AbortSignal,
  secondary?: AbortSignal,
): {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
} {
  if (!secondary) {
    return { signal: primary, cleanup: () => undefined };
  }
  const bridge = new AbortController();
  const abortBridge = (): void => bridge.abort();
  if (primary.aborted || secondary.aborted) {
    bridge.abort();
    return { signal: bridge.signal, cleanup: () => undefined };
  }
  primary.addEventListener("abort", abortBridge, { once: true });
  secondary.addEventListener("abort", abortBridge, { once: true });
  return {
    signal: bridge.signal,
    cleanup: () => {
      primary.removeEventListener("abort", abortBridge);
      secondary.removeEventListener("abort", abortBridge);
    },
  };
}

function useResolvedQueryClient(explicitClient?: QueryClient): QueryClient {
  const contextClient = useContext(QueryClientContext);
  const [fallbackClient] = useState<QueryClient>(() => createHehQueryClient());
  const isUsingFallback = !explicitClient && !contextClient;

  useEffect(() => {
    if (!isUsingFallback) {
      return undefined;
    }
    return () => {
      fallbackClient.clear();
    };
  }, [fallbackClient, isUsingFallback]);

  return explicitClient ?? contextClient ?? fallbackClient;
}

/** Query active Trendyol mapping capabilities via TanStack Query. */
export function useProviderCapabilitiesQuery(
  transport?: SearchApiTransport,
  enabled = true,
): UseQueryResult<ProviderCapabilitiesResponse, Error> {
  const activeQueryClient = useResolvedQueryClient();
  const resolvedTransport = useMemo(
    () => transport ?? resolveDefaultSearchTransport(),
    [transport],
  );

  return useQuery<ProviderCapabilitiesResponse, Error>(
    {
      queryKey: hehQueryKeys.capabilities(),
      enabled,
      queryFn: ({ signal }) => {
        if (!resolvedTransport.getCapabilities) {
          throw new Error("Capabilities endpoint is unavailable on this transport");
        }
        return resolvedTransport.getCapabilities(signal);
      },
    },
    activeQueryClient,
  );
}

/** Query fail-open readiness via TanStack Query. */
export function useBackendReadinessQuery(
  transport?: SearchApiTransport,
  enabled = true,
): UseQueryResult<ReadinessResponse, Error> {
  const activeQueryClient = useResolvedQueryClient();
  const resolvedTransport = useMemo(
    () => transport ?? resolveDefaultSearchTransport(),
    [transport],
  );

  return useQuery<ReadinessResponse, Error>(
    {
      queryKey: hehQueryKeys.healthReady(),
      enabled,
      queryFn: ({ signal }) => {
        if (!resolvedTransport.getHealthReady) {
          throw new Error("Health readiness endpoint is unavailable on this transport");
        }
        return resolvedTransport.getHealthReady(signal);
      },
    },
    activeQueryClient,
  );
}

export interface UseSearchFlowOptions {
  readonly transport?: SearchApiTransport;
  readonly queryClient?: QueryClient;
  readonly openUrl?: (url: string) => Promise<void>;
  readonly redirectDeps?: SafeRedirectDeps;
}

export interface UseSearchFlowResult {
  readonly phase: SearchFlowPhase;
  readonly intent: SearchIntentV2Output | null;
  readonly resolution: LinkResolution | null;
  readonly chips: readonly CriteriaChipViewModel[];
  readonly criteriaGroups: readonly CriteriaGroupViewModel[];
  readonly summaryText: string | null;
  readonly ctaLabel: string;
  readonly warnings: readonly string[];
  readonly errorMessage: string | null;
  readonly externalOpenError: string | null;
  readonly lastRequestId: string | null;
  readonly canRestore: boolean;
  readonly runParse: (text: string, inputSource?: "text" | "voice") => Promise<void>;
  readonly removeCriterion: (criterionId: string) => Promise<void>;
  readonly removeOrOption: (criterionId: string, optionKey: string) => Promise<void>;
  readonly updatePriceRange: (
    criterionId: string,
    minAmount: string | null,
    maxAmount: string | null,
  ) => Promise<void>;
  readonly restoreLastRemoved: () => Promise<void>;
  readonly openExternalResult: () => Promise<boolean>;
  readonly clearError: () => void;
  readonly reset: () => void;
}

/**
 * TanStack Query backed 1-RTT search flow hook enforcing single-flight parse/resolve calls,
 * identical in-flight deduplication, out-of-order cancellation, edit-only /resolve, and redirect safety.
 */
export function useSearchFlow(options?: UseSearchFlowOptions): UseSearchFlowResult {
  const queryClient = useResolvedQueryClient(options?.queryClient);

  const transportRef = useRef<SearchApiTransport>(
    options?.transport ?? resolveDefaultSearchTransport(),
  );
  useEffect(() => {
    if (options?.transport) {
      transportRef.current = options.transport;
    }
  }, [options?.transport]);

  const redirectDepsRef = useRef<SafeRedirectDeps>(buildSafeRedirectDeps(options));
  useEffect(() => {
    redirectDepsRef.current = buildSafeRedirectDeps({
      redirectDeps: options?.redirectDeps,
      openUrl: options?.openUrl,
    });
  }, [options?.openUrl, options?.redirectDeps]);

  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);
  const inFlightParseRef = useRef<{
    readonly dedupeKey: string;
    readonly promise: Promise<void>;
    readonly signal: AbortSignal;
  } | null>(null);
  const openingRef = useRef<boolean>(false);

  const [phase, setPhase] = useState<SearchFlowPhase>("idle");
  const [parseState, setParseState] = useState<SearchParseResponse | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<SearchParseResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  const resolveMutation = useMutation<
    SearchResolveResponse,
    unknown,
    { readonly payload: SearchResolveRequest; readonly signal: AbortSignal }
  >(
    {
      mutationFn: ({ payload, signal }) => transportRef.current.resolveSearch(payload, signal),
      retry: false,
    },
    queryClient,
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      inFlightParseRef.current = null;
    };
  }, []);

  const runParse = useCallback(
    async (text: string, inputSource: "text" | "voice" = "text") => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const dedupeKey = `${inputSource}:${trimmed}`;
      const existing = inFlightParseRef.current;
      if (existing && existing.dedupeKey === dedupeKey && !existing.signal.aborted) {
        return existing.promise;
      }

      abortRef.current?.abort();
      void queryClient.cancelQueries({ queryKey: hehQueryKeys.searchParseRoot() });

      const controller = new AbortController();
      abortRef.current = controller;
      const reqSeq = ++requestSeqRef.current;
      const clientRequestId = createClientRequestId("parse");

      setPhase("parsing");
      setErrorMessage(null);
      setExternalOpenError(null);
      setUndoSnapshot(null);
      setLastRequestId(clientRequestId);

      const parsePromise = (async () => {
        try {
          const response = await queryClient.fetchQuery<SearchParseResponse>({
            queryKey: hehQueryKeys.searchParse(trimmed, inputSource),
            staleTime: 0,
            retry: false,
            queryFn: ({ signal: rqSignal }) => {
              const linked = linkAbortSignals(controller.signal, rqSignal);
              return transportRef.current
                .parseSearch(
                  {
                    text: trimmed,
                    locale: "tr-TR",
                    input_source: inputSource,
                    client_request_id: clientRequestId,
                  },
                  linked.signal,
                )
                .finally(linked.cleanup);
            },
          });

          if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
            return;
          }

          setParseState(response);
          setLastRequestId(response.request_id);
          setPhase("reviewing");
        } catch (err) {
          if (reqSeq !== requestSeqRef.current || controller.signal.aborted || isAbortError(err)) {
            return;
          }
          setErrorMessage(mapFlowErrorMessage(err));
          if (err instanceof HehApiError && err.requestId) {
            setLastRequestId(err.requestId);
          }
          setPhase("error");
        } finally {
          if (inFlightParseRef.current?.signal === controller.signal) {
            inFlightParseRef.current = null;
          }
        }
      })();

      inFlightParseRef.current = {
        dedupeKey,
        promise: parsePromise,
        signal: controller.signal,
      };
      return parsePromise;
    },
    [queryClient],
  );

  const executeResolveEdit = useCallback(
    async (
      baseState: SearchParseResponse,
      nextIntent: SearchIntentV2Output,
      nextUndoSnapshot: SearchParseResponse | null,
    ) => {
      if ((nextIntent.criteria ?? []).length === 0) {
        abortRef.current?.abort();
        inFlightParseRef.current = null;
        requestSeqRef.current += 1;
        setUndoSnapshot(nextUndoSnapshot);
        setParseState({
          ...baseState,
          intent: nextIntent,
          resolution: {
            ...baseState.resolution,
            url: "",
            applied_filters: [],
            query_only: [],
            unsupported: [],
            warning_level: "none",
          },
        });
        setErrorMessage(null);
        setExternalOpenError(null);
        setPhase("reviewing");
        return;
      }

      abortRef.current?.abort();
      inFlightParseRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      const reqSeq = ++requestSeqRef.current;
      const clientRequestId = createClientRequestId("resolve");

      setPhase("resolving");
      setErrorMessage(null);
      setExternalOpenError(null);
      setLastRequestId(clientRequestId);

      try {
        const resolved = await resolveMutation.mutateAsync({
          payload: {
            intent: toInputIntent(nextIntent),
            mapping_version: baseState.resolution.mapping_version,
            client_request_id: clientRequestId,
          },
          signal: controller.signal,
        });

        if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }

        setUndoSnapshot(nextUndoSnapshot);
        setParseState({
          ...baseState,
          request_id: resolved.request_id,
          intent: resolved.intent,
          resolution: resolved.resolution,
        });
        setLastRequestId(resolved.request_id);
        setPhase("reviewing");
      } catch (err) {
        if (reqSeq !== requestSeqRef.current || controller.signal.aborted || isAbortError(err)) {
          return;
        }
        setErrorMessage(mapFlowErrorMessage(err));
        if (err instanceof HehApiError && err.requestId) {
          setLastRequestId(err.requestId);
        }
        setPhase("reviewing");
      }
    },
    [resolveMutation],
  );

  const removeCriterion = useCallback(
    async (criterionId: string) => {
      if (!parseState || openingRef.current) {
        return;
      }
      const nextIntentOutput = removeCriterionFromIntent(parseState.intent, criterionId);
      await executeResolveEdit(parseState, nextIntentOutput, parseState);
    },
    [executeResolveEdit, parseState],
  );

  const removeOrOption = useCallback(
    async (criterionId: string, optionKey: string) => {
      if (!parseState || openingRef.current) {
        return;
      }
      const nextIntentOutput = removeOptionFromOrIntent(parseState.intent, criterionId, optionKey);
      await executeResolveEdit(parseState, nextIntentOutput, parseState);
    },
    [executeResolveEdit, parseState],
  );

  const updatePriceRange = useCallback(
    async (criterionId: string, minAmount: string | null, maxAmount: string | null) => {
      if (!parseState || openingRef.current) {
        return;
      }
      const nextIntentOutput = updatePriceCriterionInIntent(
        parseState.intent,
        criterionId,
        minAmount,
        maxAmount,
      );
      if (!nextIntentOutput) {
        return;
      }
      await executeResolveEdit(parseState, nextIntentOutput, parseState);
    },
    [executeResolveEdit, parseState],
  );

  const restoreLastRemoved = useCallback(async () => {
    if (!undoSnapshot || openingRef.current) {
      return;
    }
    await executeResolveEdit(undoSnapshot, undoSnapshot.intent, null);
  }, [executeResolveEdit, undoSnapshot]);

  const openExternalResult = useCallback(async (): Promise<boolean> => {
    if (openingRef.current) {
      return false;
    }
    const targetUrl = parseState?.resolution.url;
    if (!targetUrl || !validateExternalProviderUrl(targetUrl)) {
      setExternalOpenError("Güvenli Trendyol bağlantısı doğrulanamadı.");
      return false;
    }

    openingRef.current = true;
    const reqSeq = requestSeqRef.current;
    setPhase("opening_external");
    setExternalOpenError(null);
    try {
      const outcome = await launchSafeProviderRedirect(targetUrl, redirectDepsRef.current);
      if (reqSeq === requestSeqRef.current) {
        if (!outcome.opened) {
          setExternalOpenError(outcome.errorMessage ?? "Bağlantı açılamadı.");
        }
        setPhase("reviewing");
      }
      return outcome.opened;
    } catch {
      if (reqSeq === requestSeqRef.current) {
        setExternalOpenError("Bağlantı açılamadı.");
        setPhase("reviewing");
      }
      return false;
    } finally {
      openingRef.current = false;
    }
  }, [parseState]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setExternalOpenError(null);
    setPhase((prev) => (prev === "error" ? (parseState ? "reviewing" : "idle") : prev));
  }, [parseState]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    inFlightParseRef.current = null;
    void queryClient.cancelQueries({ queryKey: hehQueryKeys.searchParseRoot() });
    requestSeqRef.current += 1;
    openingRef.current = false;
    setParseState(null);
    setUndoSnapshot(null);
    setErrorMessage(null);
    setExternalOpenError(null);
    setLastRequestId(null);
    setPhase("idle");
  }, [queryClient]);

  const resolution = parseState?.resolution ?? null;
  const chips = useMemo(
    () => (resolution ? buildCriteriaViewModels(resolution) : []),
    [resolution],
  );
  const activeIntent = parseState?.intent ?? null;
  const criteriaGroups = useMemo(
    () => buildCriteriaGroupViewModels(chips, activeIntent),
    [activeIntent, chips],
  );
  const summaryText = useMemo(
    () => (resolution ? buildResolutionSummaryText(resolution) : null),
    [resolution],
  );
  const ctaLabel = useMemo(
    () => (resolution ? selectPrimaryCtaLabel(resolution) : "Trendyol'da göster"),
    [resolution],
  );

  return {
    phase,
    intent: activeIntent,
    resolution,
    chips,
    criteriaGroups,
    summaryText,
    ctaLabel,
    warnings: parseState?.warnings ?? [],
    errorMessage,
    externalOpenError,
    lastRequestId,
    canRestore: undoSnapshot !== null,
    runParse,
    removeCriterion,
    removeOrOption,
    updatePriceRange,
    restoreLastRemoved,
    openExternalResult,
    clearError,
    reset,
  };
}
