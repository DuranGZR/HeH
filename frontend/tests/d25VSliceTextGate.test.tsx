import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import HomeScreen from "../app/index";
import SearchEntryScreen from "../app/search";
import {
  HehApiClient,
  HehApiError,
  createHehQueryClient,
  type FetchLike,
  type LinkResolution,
  type SearchApiTransport,
  type SearchIntentV2Output,
  type SearchParseResponse,
} from "../src/api";
import { RedirectCTA, buildRedirectBreakdown } from "../src/features/search/components/RedirectCTA";
import { TextEntry } from "../src/features/search/components/TextEntry";
import {
  parseTurkishPriceDraft,
  removeOptionFromOrIntent,
} from "../src/features/search/criteriaAst";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import {
  launchSafeProviderRedirect,
  validateExternalProviderUrl,
} from "../src/features/search/externalRedirect";
import { useSearchFlow } from "../src/features/search/queryHooks";
import { MAX_SEARCH_QUERY_LENGTH, validateSearchQuery } from "../src/features/search/types";
import { CriteriaReview } from "../src/features/search/components/CriteriaReview";
import { HehThemeProvider } from "../src/theme";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockRouteParams: Record<string, string> = { mode: "text" };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockRouteParams,
}));

function buildMockBackendFetch(
  transport: MockSearchTransport,
  counts: { parseCalls: number; resolveCalls: number },
): FetchLike {
  return async (input, init) => {
    const rawBody = init?.body ? String(init.body) : "{}";
    const parsedJson = JSON.parse(rawBody) as Record<string, unknown>;
    if (input.endsWith("/api/v1/search/parse")) {
      counts.parseCalls += 1;
      const result = await transport.parseSearch(
        parsedJson as unknown as Parameters<typeof transport.parseSearch>[0],
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": result.request_id },
      });
    }
    if (input.endsWith("/api/v1/search/resolve")) {
      counts.resolveCalls += 1;
      const result = await transport.resolveSearch(
        parsedJson as unknown as Parameters<typeof transport.resolveSearch>[0],
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": result.request_id },
      });
    }
    return new Response("Not Found", { status: 404 });
  };
}

function FullSliceHarness({
  transport,
  openPrimaryUrl,
  openFallbackUrl,
  canOpenUrl,
}: {
  readonly transport: SearchApiTransport;
  readonly canOpenUrl?: (url: string) => Promise<boolean>;
  readonly openPrimaryUrl?: (url: string) => Promise<void>;
  readonly openFallbackUrl?: (url: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const flow = useSearchFlow({
    transport,
    redirectDeps: { canOpenUrl, openPrimaryUrl, openFallbackUrl },
  });

  return (
    <HehThemeProvider initialMode="light" initialReduceMotion>
      <TextEntry
        errorMessage={flow.phase === "error" ? flow.errorMessage : null}
        isBusy={flow.phase === "parsing" || flow.phase === "resolving"}
        onChangeQuery={(val) => {
          setQuery(val);
          if (flow.errorMessage) {
            flow.clearError();
          }
        }}
        onRetry={() => {
          void flow.runParse(query, "text");
        }}
        onSubmit={() => {
          void flow.runParse(query, "text");
        }}
        query={query}
      />
      {flow.resolution && flow.summaryText ? (
        <CriteriaReview
          canRestore={flow.canRestore}
          chips={flow.chips}
          ctaLabel={flow.ctaLabel}
          externalOpenError={flow.externalOpenError}
          groups={flow.criteriaGroups}
          isBusy={
            flow.phase === "parsing" ||
            flow.phase === "resolving" ||
            flow.phase === "opening_external"
          }
          isOpeningExternal={flow.phase === "opening_external"}
          onPressOpenExternal={() => {
            void flow.openExternalResult();
          }}
          onRemoveCriterion={(id) => {
            void flow.removeCriterion(id);
          }}
          onRemoveOrOption={(criterionId, optionKey) => {
            void flow.removeOrOption(criterionId, optionKey);
          }}
          onRestoreLast={() => {
            void flow.restoreLastRemoved();
          }}
          onUpdatePriceRange={(criterionId, minAmt, maxAmt) => {
            void flow.updatePriceRange(criterionId, minAmt, maxAmt);
          }}
          resolveError={flow.phase === "reviewing" ? flow.errorMessage : null}
          resolution={flow.resolution}
          summaryText={flow.summaryText}
          warnings={flow.warnings}
        />
      ) : null}
      <Text testID="vslice-url">{flow.resolution?.url ?? ""}</Text>
      <Text testID="vslice-phase">{flow.phase}</Text>
    </HehThemeProvider>
  );
}

describe("D25 Gate-VSlice-Text — 20-Scenario End-to-End Text Vertical Slice", () => {
  const clients: ReturnType<typeof createHehQueryClient>[] = [];

  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockRouteParams = { mode: "text" };
  });

  afterEach(() => {
    for (const qc of clients) {
      qc.clear();
    }
    clients.length = 0;
    jest.restoreAllMocks();
  });

  it("Scenario 01-03: 1-RTT showcase search, Turkish dot-thousands price edit -> /resolve, and lower-bound price edit", async () => {
    expect(parseTurkishPriceDraft("1.500")).toBe("1500");
    expect(parseTurkishPriceDraft("25.000,75")).toBe("25000.75");
    expect(parseTurkishPriceDraft("01500")).toBe("1500");

    const counts = { parseCalls: 0, resolveCalls: 0 };
    const transport = new HehApiClient({
      baseUrl: "http://127.0.0.1:8000",
      fetchImpl: buildMockBackendFetch(new MockSearchTransport(), counts),
    });
    const openedUrls: string[] = [];

    const qc = createHehQueryClient();
    clients.push(qc);

    await render(
      <QueryClientProvider client={qc}>
        <FullSliceHarness
          canOpenUrl={async () => true}
          openPrimaryUrl={async (url) => {
            openedUrls.push(url);
          }}
          transport={transport}
        />
      </QueryClientProvider>,
    );

    // Scenario 01: Happy showcase starter prompt ("3000 altı siyah M erkek mont")
    await fireEvent.press(screen.getByTestId("text-prompt-chip-0"));
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(counts.parseCalls).toBe(1);
    expect(counts.resolveCalls).toBe(0);
    expect(screen.queryByText("Filtre uygulandı")).toBeNull();
    expect(screen.getByTestId("criterion-badge-cat-1").props.children).toBe("Web doğrulandı");
    expect(screen.getByTestId("criterion-badge-size-1").props.children).toBe("Web doğrulandı");

    // Scenario 02: Turkish price edit ("1.500" to "2.500,50") triggers /resolve only (zero /parse!)
    await fireEvent.press(screen.getByTestId("edit-price-price-1"));
    await fireEvent.changeText(screen.getByTestId("price-min-input-price-1"), "1.500");
    await fireEvent.changeText(screen.getByTestId("price-max-input-price-1"), "2.500,50");
    await fireEvent.press(screen.getByTestId("price-apply-price-1"));
    expect(counts.parseCalls).toBe(1);
    expect(counts.resolveCalls).toBe(1);
    expect(String(screen.getByTestId("vslice-url").props.children)).toContain("prc=1500-2500.50");

    // Scenario 03: Lower-bound-only price edit ("2.000" min, empty max -> prc=2000-*)
    await fireEvent.press(screen.getByTestId("edit-price-price-1"));
    await fireEvent.changeText(screen.getByTestId("price-min-input-price-1"), "2.000");
    await fireEvent.changeText(screen.getByTestId("price-max-input-price-1"), "");
    await fireEvent.press(screen.getByTestId("price-apply-price-1"));
    expect(counts.resolveCalls).toBe(2);
    expect(String(screen.getByTestId("vslice-url").props.children)).toContain("prc=2000-*");

    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));
    expect(openedUrls).toHaveLength(1);
    expect(validateExternalProviderUrl(openedUrls[0] ?? "")).toBe(true);
  });

  it("Scenario 04-06: OR brand/color partial pruning shrinks to singleton cleanly without leaking removed options", async () => {
    const qc = createHehQueryClient();
    clients.push(qc);

    await render(
      <QueryClientProvider client={qc}>
        <FullSliceHarness transport={new MockSearchTransport()} />
      </QueryClientProvider>,
    );

    // Scenario 04: Sony veya JBL bluetooth kulaklık -> remove JBL
    await fireEvent.changeText(
      screen.getByTestId("text-search-input"),
      "Sony veya JBL bluetooth kulaklık",
    );
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(screen.getByTestId("criteria-group-any-of-group-any-1")).toBeTruthy();
    expect(String(screen.getByTestId("vslice-url").props.children)).toContain("wb=795%2C102285");

    await fireEvent.press(screen.getByTestId("remove-or-option-brand-or-1-jbl"));
    const afterJbl = String(screen.getByTestId("vslice-url").props.children);
    expect(afterJbl).toContain("wb=795");
    expect(afterJbl).not.toContain("102285");
    expect(afterJbl.toLowerCase()).not.toContain("jbl");

    // Scenario 05: siyah veya beyaz erkek mont -> remove beyaz
    await fireEvent.changeText(
      screen.getByTestId("text-search-input"),
      "siyah veya beyaz erkek mont",
    );
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    await fireEvent.press(screen.getByTestId("remove-or-option-color-or-1-beyaz"));
    expect(String(screen.getByTestId("vslice-url").props.children)).toContain("wcl=14");

    // Scenario 06: 3-option OR cluster preserves any_of until 2nd removal
    const threeBrandAst: SearchIntentV2Output = {
      raw_query: "Sony veya JBL veya Bose kulaklık",
      normalized_query: "sony veya jbl veya bose kulaklık",
      criteria: [
        {
          id: "brand-or-1",
          field: "brand",
          operator: "in",
          value: ["sony", "jbl", "bose"],
          display_label: "Sony veya JBL veya Bose",
        },
      ],
      logic_groups: [{ operator: "any_of", criterion_ids: ["brand-or-1"] }],
    };
    const twoBrands = removeOptionFromOrIntent(threeBrandAst, "brand-or-1", "bose");
    expect(twoBrands.criteria?.[0]?.operator).toBe("in");
    const oneBrand = removeOptionFromOrIntent(twoBrands, "brand-or-1", "jbl");
    expect(oneBrand.criteria?.[0]?.operator).toBe("eq");
  });

  it("Scenario 07-10: NOT partial warning -> remove negation -> long-tail q= -> critical warning -> empty undo", async () => {
    const qc = createHehQueryClient();
    clients.push(qc);

    await render(
      <QueryClientProvider client={qc}>
        <FullSliceHarness transport={new MockSearchTransport()} />
      </QueryClientProvider>,
    );

    // Scenario 07: Negation shows HARİÇ + "Kısmi aramayı aç", removal flips to "Trendyol'da göster"
    await fireEvent.changeText(
      screen.getByTestId("text-search-input"),
      "3000 altı nike olmasın erkek mont",
    );
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(screen.getByTestId("criteria-group-not")).toBeTruthy();
    expect(screen.getByText("Kısmi aramayı aç")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("remove-criterion-brand-not-1"));
    expect(screen.getByText("Trendyol'da göster")).toBeTruthy();

    // Scenario 08: Long-tail query maps honestly to QUERY_ONLY + query partial callout
    await fireEvent.changeText(screen.getByTestId("text-search-input"), "su geçirmez çadır");
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(screen.getByTestId("redirect-pill-query-only").props.children.props.children).toBe(
      "Metinde: 1",
    );
    expect(screen.getByTestId("redirect-partial-warning")).toBeTruthy();

    // Scenario 09: Critical unsupported-only criteria shows critical partial CTA
    await fireEvent.changeText(screen.getByTestId("text-search-input"), "nike olmasın");
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(screen.getByText("Kısmi aramayı aç")).toBeTruthy();

    // Scenario 10: Remove remaining criterion -> 0-criteria empty state disables CTA -> Undo restores
    await fireEvent.press(screen.getByTestId("remove-criterion-brand-not-1"));
    expect(screen.getByTestId("criteria-empty-state")).toBeTruthy();
    expect(screen.getByTestId("open-trendyol-cta").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(screen.getByTestId("restore-criterion-button"));
    expect(screen.queryByTestId("criteria-empty-state")).toBeNull();
  });

  it("Scenario 11-14: Redirect deep-link fallback, double-tap busy guard, open-redirect block, dual-verified badge", async () => {
    // Scenario 11 & 13: Fallback & unsafe URLs
    const unsafeResult = await launchSafeProviderRedirect("https://evil.example/sr?wc=118");
    expect(unsafeResult.target).toBe("blocked");
    const fallbackMock = jest.fn(async () => undefined);
    const fb = await launchSafeProviderRedirect("https://www.trendyol.com/sr?wc=118", {
      canOpenUrl: async () => false,
      openFallbackUrl: fallbackMock,
    });
    expect(fb.target).toBe("fallback_browser");
    expect(fallbackMock).toHaveBeenCalledTimes(1);

    // Scenario 12: Double-tap CTA while busy keeps 1 execution
    let release!: () => void;
    const primaryMock = jest.fn(
      () =>
        new Promise<void>((res) => {
          release = res;
        }),
    );
    const qc = createHehQueryClient();
    clients.push(qc);
    await render(
      <QueryClientProvider client={qc}>
        <FullSliceHarness
          canOpenUrl={async () => true}
          openPrimaryUrl={primaryMock}
          transport={new MockSearchTransport()}
        />
      </QueryClientProvider>,
    );
    await fireEvent.press(screen.getByTestId("text-prompt-chip-0"));
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));
    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));
    expect(screen.getByText("Açılıyor...")).toBeTruthy();
    expect(primaryMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });

    // Scenario 14: Dual FILTER_VERIFIED vs WEB_VERIFIED_PENDING_MOBILE breakdown honesty
    const dualRes: LinkResolution = {
      provider: "trendyol",
      url: "https://www.trendyol.com/sr?wc=118",
      route_strategy: "canonical_search_query",
      mapping_version: "2026.11.25.1",
      applied_filters: [
        {
          criterion_id: "cat-1",
          field: "category",
          label: "Erkek Mont",
          operator: "eq",
          status: "FILTER_VERIFIED",
          url_param: "wc",
          url_value: "118",
          reason: "Web ve mobil doğrulandı.",
        },
      ],
      query_only: [],
      unsupported: [],
      warning_level: "none",
      verification_notice: "Bilgi notu",
    };
    expect(buildRedirectBreakdown(dualRes).appliedLabel).toBe("Filtre uygulandı: 1");

    await render(
      <HehThemeProvider initialMode="light">
        <RedirectCTA
          ctaLabel="Trendyol'da göster"
          disabled={false}
          externalOpenError={null}
          isBusy={false}
          onPressOpenExternal={jest.fn()}
          resolution={dualRes}
        />
      </HehThemeProvider>,
    );
    expect(screen.getByText("Filtre uygulandı: 1")).toBeTruthy();
  });

  it("Scenario 15-17: HomeScreen -> SearchEntryScreen deep-link nav, offline retry recovery, and resolve error banner", async () => {
    // Scenario 15: HomeScreen inline mode switch + prompt fill -> router.push to /search
    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <HomeScreen />
      </HehThemeProvider>,
    );
    await fireEvent.press(screen.getByTestId("home-text-button"));
    await fireEvent.press(screen.getByTestId("text-prompt-chip-0"));
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/search",
      params: { mode: "text", q: "3000 altı siyah M erkek mont" },
    });

    // Scenario 16: Offline /parse failure preserves text on SearchEntryScreen & retry recovers
    const base = new MockSearchTransport();
    const parsePayload = await base.parseSearch({ text: "3000 altı siyah erkek mont" });
    let shouldFailParse = true;
    let shouldFailResolve = false;
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.endsWith("/api/v1/search/parse")) {
        if (shouldFailParse) {
          throw new TypeError("Offline");
        }
        return new Response(JSON.stringify(parsePayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/search/resolve") && shouldFailResolve) {
        return new Response(
          JSON.stringify({
            error: {
              code: "MAPPING_VERSION_CONFLICT",
              message: "Sözlük sürümü güncel değil",
              request_id: "req-409",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(parsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const qc = createHehQueryClient();
    clients.push(qc);
    await render(
      <QueryClientProvider client={qc}>
        <HehThemeProvider initialMode="light" initialReduceMotion>
          <SearchEntryScreen />
        </HehThemeProvider>
      </QueryClientProvider>,
    );

    await fireEvent.changeText(
      screen.getByTestId("text-search-input"),
      "3000 altı siyah erkek mont",
    );
    await fireEvent.press(screen.getByTestId("text-search-submit"));
    expect(screen.getByTestId("text-search-error")).toBeTruthy();
    expect(screen.getByTestId("text-search-input").props.value).toBe("3000 altı siyah erkek mont");

    shouldFailParse = false;
    await fireEvent.press(screen.getByTestId("text-search-retry"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("criteria-review-panel")).toBeTruthy();

    // Scenario 17: /resolve 409 error renders inline criteria-resolve-error right inside CriteriaReview
    shouldFailResolve = true;
    await fireEvent.press(screen.getByTestId("remove-criterion-color-1"));
    expect(screen.getByTestId("criteria-resolve-error")).toBeTruthy();
  });

  it("Scenario 18-20: Abort/stale guard, identical in-flight 1-RTT dedupe, and validation + dark accessibility checks", async () => {
    const base = new MockSearchTransport();
    const firstTemplate = await base.parseSearch({ text: "siyah mont" });
    const secondTemplate = await base.parseSearch({ text: "sony kulaklık" });
    const resolvers: Array<(res: SearchParseResponse) => void> = [];
    const signals: AbortSignal[] = [];

    const raceTransport: SearchApiTransport = {
      parseSearch: jest.fn((_payload, signal) => {
        if (signal) {
          signals.push(signal);
        }
        return new Promise<SearchParseResponse>((res) => {
          resolvers.push(res);
        });
      }),
      resolveSearch: (req) => base.resolveSearch(req),
    };

    const qc = createHehQueryClient();
    clients.push(qc);
    function RaceHarness() {
      const flow = useSearchFlow({ transport: raceTransport });
      return (
        <>
          <Pressable testID="go-1" onPress={() => void flow.runParse("siyah mont")}>
            <Text>1</Text>
          </Pressable>
          <Pressable testID="go-2" onPress={() => void flow.runParse("sony kulaklık")}>
            <Text>2</Text>
          </Pressable>
          <Text testID="active">{flow.intent?.raw_query ?? ""}</Text>
        </>
      );
    }

    await render(
      <QueryClientProvider client={qc}>
        <RaceHarness />
      </QueryClientProvider>,
    );

    // Scenario 19: Identical concurrent requests deduplicate strictly to 1 HTTP parse call
    await fireEvent.press(screen.getByTestId("go-1"));
    await fireEvent.press(screen.getByTestId("go-1"));
    expect(raceTransport.parseSearch).toHaveBeenCalledTimes(1);

    // Scenario 18: Rapid second query aborts first AbortSignal & ignores late first response
    await fireEvent.press(screen.getByTestId("go-2"));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      resolvers[1]?.(secondTemplate);
    });
    await act(async () => {
      resolvers[0]?.(firstTemplate);
    });
    expect(screen.getByTestId("active").props.children).toBe("sony kulaklık");

    // Scenario 20: Input validation bounds + dark theme accessible 48dp touch targets
    expect(validateSearchQuery("   ")).toMatchObject({ valid: false, reason: "empty" });
    expect(validateSearchQuery("test\x00")).toMatchObject({
      valid: false,
      reason: "control_chars",
    });
    expect(validateSearchQuery("x".repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toMatchObject({
      valid: false,
      reason: "too_long",
    });

    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <TextEntry onChangeQuery={jest.fn()} onSubmit={jest.fn()} query="" />
      </HehThemeProvider>,
    );
    expect(StyleSheet.flatten(screen.getByTestId("text-search-submit").props.style).minHeight).toBe(
      48,
    );
    // Keep unused import check clean when verifying error typing
    expect(new HehApiError({ status: 400, code: "X", message: "Y", requestId: "1" }).status).toBe(
      400,
    );
  });
});
