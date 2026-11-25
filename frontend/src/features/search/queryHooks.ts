import { Linking } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  HehApiError,
  type LinkFilterItem,
  type LinkResolution,
  type SearchIntentV2Output,
  type SearchParseResponse,
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

function hasForbiddenControlOrSpace(rawUrl: string): boolean {
  if (/\s/.test(rawUrl)) {
    return true;
  }
  for (let i = 0; i < rawUrl.length; i += 1) {
    const code = rawUrl.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

/** Enforce HTTPS, allowlisted host, credential/port/fragment/control-char safety client-side. */
export function validateExternalProviderUrl(rawUrl: string): boolean {
  if (hasForbiddenControlOrSpace(rawUrl)) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase()) &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.hash === ""
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
  readonly canRestore: boolean;
  readonly runParse: (text: string, inputSource?: "text" | "voice") => Promise<void>;
  readonly removeCriterion: (criterionId: string) => Promise<void>;
  readonly restoreLastRemoved: () => Promise<void>;
  readonly openExternalResult: () => Promise<boolean>;
  readonly reset: () => void;
}

/**
 * 1-RTT search flow hook enforcing single-flight parse/resolve calls,
 * out-of-order response discarding, edit-only /resolve, undo restore, and explicit redirect safety.
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
  const openingRef = useRef<boolean>(false);

  const [phase, setPhase] = useState<SearchFlowPhase>("idle");
  const [parseState, setParseState] = useState<SearchParseResponse | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<SearchParseResponse | null>(null);
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
    setUndoSnapshot(null);

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
    } catch (err) {
      if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
        return;
      }
      setErrorMessage(mapFlowErrorMessage(err));
      setPhase("error");
    }
  }, []);

  const removeCriterion = useCallback(
    async (criterionId: string) => {
      if (!parseState) {
        return;
      }

      const previousSnapshot = parseState;
      const existingCriteria = parseState.intent.criteria ?? [];
      const removedCriterion = existingCriteria.find((crit) => crit.id === criterionId);
      const nextCriteria = existingCriteria.filter((crit) => crit.id !== criterionId);
      const hasRemainingCategory = nextCriteria.some(
        (crit) => crit.field === "category" && crit.operator !== "not_in",
      );
      const nextIntentOutput: SearchIntentV2Output = {
        ...parseState.intent,
        category_key:
          removedCriterion?.field === "category" || !hasRemainingCategory
            ? null
            : parseState.intent.category_key,
        criteria: nextCriteria,
        logic_groups: (parseState.intent.logic_groups ?? [])
          .map((group) => ({
            ...group,
            criterion_ids: group.criterion_ids.filter((id) => id !== criterionId),
          }))
          .filter((group) => group.criterion_ids.length > 0),
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

        setUndoSnapshot(previousSnapshot);
        setParseState({
          ...parseState,
          request_id: resolved.request_id,
          intent: resolved.intent,
          resolution: resolved.resolution,
        });
        setPhase("reviewing");
      } catch (err) {
        if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
          return;
        }
        setErrorMessage(mapFlowErrorMessage(err));
        setPhase("reviewing");
      }
    },
    [parseState],
  );

  const restoreLastRemoved = useCallback(async () => {
    if (!undoSnapshot) {
      return;
    }

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
          intent: toInputIntent(undoSnapshot.intent),
          mapping_version: undoSnapshot.resolution.mapping_version,
        },
        controller.signal,
      );
      if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
        return;
      }
      setParseState({
        ...undoSnapshot,
        request_id: resolved.request_id,
        intent: resolved.intent,
        resolution: resolved.resolution,
      });
      setUndoSnapshot(null);
      setPhase("reviewing");
    } catch (err) {
      if (reqSeq !== requestSeqRef.current || controller.signal.aborted) {
        return;
      }
      setErrorMessage(mapFlowErrorMessage(err));
      setPhase("reviewing");
    }
  }, [undoSnapshot]);

  const openExternalResult = useCallback(async (): Promise<boolean> => {
    if (openingRef.current) {
      return false;
    }
    const targetUrl = parseState?.resolution.url;
    if (!targetUrl || !validateExternalProviderUrl(targetUrl)) {
      setExternalOpenError("Bağlantı açılamadı.");
      return false;
    }

    openingRef.current = true;
    const reqSeq = requestSeqRef.current;
    setPhase("opening_external");
    setExternalOpenError(null);
    try {
      await openUrlRef.current(targetUrl);
      if (reqSeq === requestSeqRef.current) {
        setPhase("reviewing");
      }
      return true;
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

  const reset = useCallback(() => {
    abortRef.current?.abort();
    requestSeqRef.current += 1;
    openingRef.current = false;
    setParseState(null);
    setUndoSnapshot(null);
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
    canRestore: undoSnapshot !== null,
    runParse,
    removeCriterion,
    restoreLastRemoved,
    openExternalResult,
    reset,
  };
}
