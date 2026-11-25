import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import type { SearchParseResponse } from "../src/api";
import { CriteriaReviewPanel } from "../src/features/search/components/CriteriaReviewPanel";
import { MockSearchTransport, type SearchApiTransport } from "../src/features/search/demoFixtures";
import {
  mapStatusToUiBadge,
  useSearchFlow,
  validateExternalProviderUrl,
} from "../src/features/search/queryHooks";
import { HehThemeProvider } from "../src/theme";

describe("D13 1-RTT Search Flow & CriteriaReview Honesty", () => {
  it("never shows a fake 'Filtre uygulandı' badge before dual mobile verification", () => {
    expect(mapStatusToUiBadge("FILTER_VERIFIED")).toEqual({
      visualStatus: "applied",
      badgeLabel: "Filtre uygulandı",
    });
    expect(mapStatusToUiBadge("WEB_VERIFIED_PENDING_MOBILE")).toEqual({
      visualStatus: "query_only",
      badgeLabel: "Web doğrulandı",
    });
    expect(mapStatusToUiBadge("UNSUPPORTED")).toEqual({
      visualStatus: "unsupported",
      badgeLabel: "Uygulanamadı",
    });
    expect(mapStatusToUiBadge("QUERY_ONLY")).toEqual({
      visualStatus: "query_only",
      badgeLabel: "Arama metninde",
    });
  });

  it("blocks untrusted external open-redirect URLs client-side", () => {
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?wc=118")).toBe(true);
    expect(validateExternalProviderUrl("http://www.trendyol.com/sr?wc=118")).toBe(false);
    expect(validateExternalProviderUrl("https://trendyol.com.evil.example/sr")).toBe(false);
    expect(validateExternalProviderUrl("not-a-url")).toBe(false);
  });

  it("runs 1-RTT parse once, edits via /resolve, and opens Trendyol only on explicit tap", async () => {
    const mockTransport = new MockSearchTransport();
    const parseSpy = jest.spyOn(mockTransport, "parseSearch");
    const resolveSpy = jest.spyOn(mockTransport, "resolveSearch");
    const openUrlMock = jest.fn(async () => undefined);

    function Harness() {
      const flow = useSearchFlow({ transport: mockTransport, openUrl: openUrlMock });
      return (
        <>
          <Text
            onPress={() => {
              void flow.runParse("3000 altı siyah m beden nike olmasın erkek mont");
            }}
            testID="trigger-parse"
          >
            Parse
          </Text>
          {flow.resolution && flow.summaryText ? (
            <CriteriaReviewPanel
              chips={flow.chips}
              ctaLabel={flow.ctaLabel}
              externalOpenError={flow.externalOpenError}
              isBusy={flow.phase === "parsing" || flow.phase === "resolving"}
              onPressOpenExternal={() => {
                void flow.openExternalResult();
              }}
              onRemoveCriterion={(id) => {
                void flow.removeCriterion(id);
              }}
              resolution={flow.resolution}
              summaryText={flow.summaryText}
            />
          ) : null}
        </>
      );
    }

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <Harness />
      </HehThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId("trigger-parse"));

    // Strictly 1 RTT on initial parse: /resolve MUST NOT be called yet.
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledTimes(0);
    expect(openUrlMock).toHaveBeenCalledTimes(0);

    expect(screen.getByTestId("criteria-review-panel")).toBeTruthy();
    expect(screen.getByTestId("criterion-badge-brand-not-1").props.children).toBe("Uygulanamadı");
    expect(screen.getByTestId("criterion-badge-price-1").props.children).toBe("Web doğrulandı");
    expect(screen.getByText("Kısmi aramayı aç")).toBeTruthy();

    // Remove unsupported negative brand criterion -> triggers edit-only /resolve once
    await fireEvent.press(screen.getByTestId("remove-criterion-brand-not-1"));
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("criterion-chip-brand-not-1")).toBeNull();
    expect(screen.getByText("Trendyol'da göster")).toBeTruthy();

    // External navigation occurs ONLY upon explicit user button press
    expect(openUrlMock).toHaveBeenCalledTimes(0);
    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.trendyol\.com\/sr\?/),
    );
  });

  it("ignores stale out-of-order parse responses when newer search starts", async () => {
    let resolveFirst!: (val: SearchParseResponse) => void;
    let resolveSecond!: (val: SearchParseResponse) => void;
    const base = new MockSearchTransport();
    const firstTemplate = await base.parseSearch({ text: "3000 altı erkek mont" });
    const secondTemplate = await base.parseSearch({ text: "siyah kulaklık" });

    let callIndex = 0;
    const racingTransport: SearchApiTransport = {
      parseSearch: jest.fn(() => {
        callIndex += 1;
        return new Promise<SearchParseResponse>((res) => {
          if (callIndex === 1) {
            resolveFirst = res;
          } else {
            resolveSecond = res;
          }
        });
      }),
      resolveSearch: jest.fn(async (req) => base.resolveSearch(req)),
    };

    function RaceHarness() {
      const flow = useSearchFlow({ transport: racingTransport });
      return (
        <>
          <Text onPress={() => void flow.runParse("3000 altı erkek mont")} testID="first" />
          <Text onPress={() => void flow.runParse("siyah kulaklık")} testID="second" />
          <Text testID="active-query">{flow.intent?.raw_query ?? "none"}</Text>
        </>
      );
    }

    await render(<RaceHarness />);

    await fireEvent.press(screen.getByTestId("first"));
    await fireEvent.press(screen.getByTestId("second"));

    await act(async () => {
      resolveSecond(secondTemplate);
    });
    expect(screen.getByTestId("active-query").props.children).toBe("siyah kulaklık");

    await act(async () => {
      resolveFirst(firstTemplate);
    });
    // Out-of-order late response from first query MUST NOT overwrite second query
    expect(screen.getByTestId("active-query").props.children).toBe("siyah kulaklık");
  });
});
