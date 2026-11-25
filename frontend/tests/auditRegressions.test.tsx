import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { HehApiClient, HehApiError, type FetchLike, type SearchResolveRequest } from "../src/api";
import { CriteriaReviewPanel } from "../src/features/search/components/CriteriaReviewPanel";
import { MoreMenuModal } from "../src/features/search/components/MoreMenuModal";
import { MockSearchTransport, type SearchApiTransport } from "../src/features/search/demoFixtures";
import { useSearchFlow, validateExternalProviderUrl } from "../src/features/search/queryHooks";
import { parseWidgetDeepLink } from "../src/services/widgets/deepLink";
import { HehThemeProvider } from "../src/theme";

function SearchFlowRegressionHarness({
  transport,
  openUrl,
}: {
  readonly transport: SearchApiTransport;
  readonly openUrl: (url: string) => Promise<void>;
}) {
  const flow = useSearchFlow({ transport, openUrl });

  return (
    <HehThemeProvider initialMode="light">
      <View>
        <Pressable
          testID="run-parse"
          onPress={() => void flow.runParse("siyah erkek mont 3000 altı")}
        >
          <Text>Parse</Text>
        </Pressable>
        <Pressable testID="remove-cat" onPress={() => void flow.removeCriterion("cat-1")}>
          <Text>Remove Cat</Text>
        </Pressable>
        <Pressable testID="undo-last" onPress={() => void flow.restoreLastRemoved()}>
          <Text>Undo</Text>
        </Pressable>
        <Pressable testID="open-external" onPress={() => void flow.openExternalResult()}>
          <Text>Open</Text>
        </Pressable>
        <Text testID="phase">{flow.phase}</Text>
        <Text testID="can-restore">{String(flow.canRestore)}</Text>
        <Text testID="error-msg">{flow.errorMessage ?? ""}</Text>
        <Text testID="url">{flow.resolution?.url ?? ""}</Text>
      </View>
    </HehThemeProvider>
  );
}

describe("D01-D20 frontend audit regressions", () => {
  it("hardens external URL and widget deep-link parsers against spoofing and ports", () => {
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?q=mont")).toBe(true);
    expect(validateExternalProviderUrl("https://www.trendyol.com:8443/sr?q=mont")).toBe(false);
    expect(validateExternalProviderUrl("https://evil.com/sr?q=mont")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?q=mont\n")).toBe(false);

    expect(parseWidgetDeepLink("heh://search?mode=voice")).toEqual({
      destination: "search",
      mode: "voice",
      requiresPermissionCheck: true,
    });
    expect(parseWidgetDeepLink("heh://user@search:8080?mode=voice#frag")).toEqual({
      destination: "home",
      reason: "invalid_scheme",
    });
  });

  it("clears category_key when cat-1 is removed, supports undo, and guards double taps", async () => {
    const baseTransport = new MockSearchTransport();
    const capturedResolves: SearchResolveRequest[] = [];
    const spyingTransport: SearchApiTransport = {
      parseSearch: (payload) => baseTransport.parseSearch(payload),
      resolveSearch: (payload) => {
        capturedResolves.push(payload);
        return baseTransport.resolveSearch(payload);
      },
    };

    let releaseOpen!: () => void;
    const openUrlMock = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseOpen = resolve;
        }),
    );

    await render(<SearchFlowRegressionHarness transport={spyingTransport} openUrl={openUrlMock} />);

    await fireEvent.press(screen.getByTestId("run-parse"));
    expect(screen.getByTestId("phase").props.children).toBe("reviewing");

    await fireEvent.press(screen.getByTestId("remove-cat"));
    expect(capturedResolves[capturedResolves.length - 1]?.intent.category_key).toBeNull();
    expect(screen.getByTestId("can-restore").props.children).toBe("true");

    await fireEvent.press(screen.getByTestId("undo-last"));
    expect(screen.getByTestId("can-restore").props.children).toBe("false");

    // Double tapping Open while external open is in flight invokes openUrl once.
    await fireEvent.press(screen.getByTestId("open-external"));
    await fireEvent.press(screen.getByTestId("open-external"));
    await act(async () => {
      releaseOpen();
    });
    expect(openUrlMock).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP 422 HehApiError detail messages instead of masking them", async () => {
    const failingTransport: SearchApiTransport = {
      parseSearch: async () => {
        throw new HehApiError({
          status: 422,
          code: "INVALID_INTENT",
          requestId: "req-422",
          message: "Arama kriterleri gecersiz: en az bir kriter gerekli",
        });
      },
      resolveSearch: async () => {
        throw new Error("unexpected");
      },
    };

    await render(
      <SearchFlowRegressionHarness transport={failingTransport} openUrl={async () => {}} />,
    );

    await fireEvent.press(screen.getByTestId("run-parse"));

    expect(screen.getByTestId("phase").props.children).toBe("error");
    expect(screen.getByTestId("error-msg").props.children).toBe(
      "Bu cümleyi filtrelere ayıramadık. Düzenleyebilirsin.",
    );
  });

  it("renders warnings and undo action when 0 criteria remain", async () => {
    const baseTransport = new MockSearchTransport();
    const parsed = await baseTransport.parseSearch({ text: "Nike siyah erkek mont 3000 altı" });
    const resolved = await baseTransport.resolveSearch({
      intent: {
        ...parsed.intent,
        category_key: null,
        criteria: [],
      },
    });

    await render(
      <HehThemeProvider initialMode="light">
        <CriteriaReviewPanel
          resolution={{
            ...resolved.resolution,
            applied_filters: [],
            query_only: [],
            unsupported: [],
            warning_level: "partial",
            verification_notice: "Sponsorlu urunler fiyat disinda kalabilir",
          }}
          chips={[]}
          summaryText="Temiz arama"
          ctaLabel="Trendyol'da Aç"
          isBusy={false}
          externalOpenError={null}
          warnings={["Sponsorlu urunler fiyat disinda kalabilir"]}
          canRestore={true}
          onRemoveCriterion={jest.fn()}
          onRestoreLast={jest.fn()}
          onPressOpenExternal={jest.fn()}
        />
      </HehThemeProvider>,
    );

    expect(screen.getByTestId("criteria-warnings-box")).toBeTruthy();
    expect(screen.getByLabelText("Son kaldırılan ölçütü geri al")).toBeTruthy();
  });

  it("resets MoreMenuModal notice banner across close and reopen", async () => {
    const onClose = jest.fn();
    const { rerender } = await render(
      <HehThemeProvider initialMode="light">
        <MoreMenuModal visible={true} onClose={onClose} />
      </HehThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId("more-item-history"));
    const noticeNode = screen.getByTestId("more-menu-notice");
    expect(noticeNode).toBeTruthy();
    expect(screen.getAllByText(/Cihazdaki son aramalar/).length).toBeGreaterThanOrEqual(1);

    await rerender(
      <HehThemeProvider initialMode="light">
        <MoreMenuModal visible={false} onClose={onClose} />
      </HehThemeProvider>,
    );
    await rerender(
      <HehThemeProvider initialMode="light">
        <MoreMenuModal visible={true} onClose={onClose} />
      </HehThemeProvider>,
    );

    expect(screen.queryByTestId("more-menu-notice")).toBeNull();
  });

  it("covers HehApiClient invalid JSON protection, scheme validation, and endpoints", async () => {
    expect(() => new HehApiClient({ baseUrl: "ftp://invalid.example.com" })).toThrow();

    const htmlFetch: FetchLike = async () =>
      new Response("<html>bad gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const htmlClient = new HehApiClient({
      baseUrl: "   ",
      fetchImpl: htmlFetch,
    });
    await expect(htmlClient.getCapabilities()).rejects.toMatchObject({
      code: "INVALID_JSON_RESPONSE",
    });

    const jsonFetch: FetchLike = async (url) => {
      if (url.endsWith("/api/v1/search/capabilities")) {
        return new Response(
          JSON.stringify({
            provider: "trendyol",
            mapping_version: "1.0.0",
            long_tail_policy: "prc_plus_q",
            showcase_categories: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ resolution: { provider: "trendyol" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const apiClient = new HehApiClient({
      baseUrl: "https://api.example.com",
      fetchImpl: jsonFetch,
    });
    const caps = await apiClient.getCapabilities();
    expect(caps.mapping_version).toBe("1.0.0");

    const mockIntent = (await new MockSearchTransport().parseSearch({ text: "siyah mont" })).intent;
    const res = await apiClient.resolveSearch({ intent: mockIntent });
    expect(res.resolution.provider).toBe("trendyol");
  });
});
