import { Linking } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  LinkFilterItem,
  LinkResolution,
  SearchIntentV2Output,
  SearchParseResponse,
} from "@/api";
import type { CriterionVisualStatus } from "@/theme";

import { MockSearchTransport, toInputIntent, type SearchApiTransport } from "./demoFixtures";

export type SearchFlowPhase =
  "idle" | "parsing" | "reviewing" | "resolving" | "opening_external" | "error";

export interface CriteriaChipViewModel {
  readonly criterionId: string;
  readonly field: LinkFilterItem["field"];
  readonly label: string;
  readonly status: LinkFilterItem["status"];
  readonly visualStatus: CriterionVisualStatus;
  readonly badgeLabel: string;
  readonly reason: string;
}

const ALLOWED_EXTERNAL_HOSTS = new Set(["www.trendyol.com"]);

/** Enforce HTTPS + allowlisted host check client-side before invoking OS browser/app opening. */
export function validateExternalProviderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
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
      : `${applied.length} web filtresi (${webPendingCount > 0 ? "mobil kontrol bekliyor" : "hazır"})`;

  return `${appliedLabel}, ${queryCount} metinle arandı, ${unsupportedCount} uygulanamadı.`;
}

export function selectPrimaryCtaLabel(resolution: LinkResolution): string {
  if (resolution.warning_level === "critical" || (resolution.unsupported ?? []).length > 0) {
    return "Kısmi aramayı aç";
  }
  return "Trendyol'da göster";
}

export interface UseSearchFlowOptions {
  readonly transport?: SearchApiTransport;
  readonly openUrl?: (url: string) => Promise<void>;
}

export interface UseSearchFlowResult {
  readonly phase: SearchFlowPhase;
  readonly intent: SearchIntentV2Output | null;
  readonly resolution: LinkResolution | null;
  readonly chips: readonly CriteriaChipViewModel[];
  readonly summaryText: string | null;
  readonly ctaLabel: string;
  readonly warnings: readonly string[];
  readonly errorMessage: string | null;
  readonly externalOpenError: string | null;
  readonly runParse: (text: string, inputSource?: "text" | "voice") => Promise<void>;
  readonly removeCriterion: (criterionId: string) => Promise<void>;
  readonly openExternalResult: () => Promise<boolean>;
  readonly reset: () => void;
}

/**
 * 1-RTT search flow hook enforcing single-flight parse/resolve calls,
 * out-of-order response discarding, edit-only /resolve, and explicit redirect safety.
 */
export function useSearchFlow(options?: UseSearchFlowOptions): UseSearchFlowResult {
  const transportRef = useRef<SearchApiTransport>(options?.transport ?? new MockSearchTransport());
  const openUrlRef = useRef<(url: string) => Promise<void>>(
    options?.openUrl ??
      (async (url) => {
        await Linking.openURL(url);
      }),
  );

  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);

  const [phase, setPhase] = useState<SearchFlowPhase>("idle");
  const [parseState, setParseState] = useState<SearchParseResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runParse = useCallback(async (text: string, inputSource: "text" | "voice" = "text") => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqSeq = ++requestSeqRef.current;

    setPhase("parsing");
    setErrorMessage(null);
    setExternalOpenError(null);

    try {
      const response = await transportRef.current.parseSearch(
        {
          text: trimmed,
          locale: "tr-TR",
          input_source: inputSource,
        },
        controller.signal,
      );

      if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
        return;
      }

      setParseState(response);
      setPhase("reviewing");
    } catch {
      if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
        return;
      }
      setErrorMessage("Bağlantı yok. Tekrar dene.");
      setPhase("error");
    }
  }, []);

  const removeCriterion = useCallback(
    async (criterionId: string) => {
      if (!parseState) {
        return;
      }

      const nextCriteria = (parseState.intent.criteria ?? []).filter(
        (crit) => crit.id !== criterionId,
      );
      const nextIntentOutput: SearchIntentV2Output = {
        ...parseState.intent,
        criteria: nextCriteria,
        logic_groups: (parseState.intent.logic_groups ?? []).filter((group) =>
          group.criterion_ids.some((id) => id !== criterionId),
        ),
      };

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const reqSeq = ++requestSeqRef.current;

      setPhase("resolving");
      setErrorMessage(null);
      setExternalOpenError(null);

      try {
        const resolved = await transportRef.current.resolveSearch(
          {
            intent: toInputIntent(nextIntentOutput),
            mapping_version: parseState.resolution.mapping_version,
          },
          controller.signal,
        );

        if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }

        setParseState({
          ...parseState,
          request_id: resolved.request_id,
          intent: resolved.intent,
          resolution: resolved.resolution,
        });
        setPhase("reviewing");
      } catch {
        if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setErrorMessage("Bağlantı yok. Tekrar dene.");
        setPhase("reviewing");
      }
    },
    [parseState],
  );

  const openExternalResult = useCallback(async (): Promise<boolean> => {
    const targetUrl = parseState?.resolution.url;
    if (!targetUrl || !validateExternalProviderUrl(targetUrl)) {
      setExternalOpenError("Bağlantı açılamadı.");
      return false;
    }

    setPhase("opening_external");
    setExternalOpenError(null);
    try {
      await openUrlRef.current(targetUrl);
      setPhase("reviewing");
      return true;
    } catch {
      setExternalOpenError("Bağlantı açılamadı.");
      setPhase("reviewing");
      return false;
    }
  }, [parseState]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    requestSeqRef.current += 1;
    setParseState(null);
    setErrorMessage(null);
    setExternalOpenError(null);
    setPhase("idle");
  }, []);

  const resolution = parseState?.resolution ?? null;
  const chips = useMemo(
    () => (resolution ? buildCriteriaViewModels(resolution) : []),
    [resolution],
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
    intent: parseState?.intent ?? null,
    resolution,
    chips,
    summaryText,
    ctaLabel,
    warnings: parseState?.warnings ?? [],
    errorMessage,
    externalOpenError,
    runParse,
    removeCriterion,
    openExternalResult,
    reset,
  };
}
