import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import type { LinkResolution } from "../src/api";
import { RedirectCTA, buildRedirectBreakdown } from "../src/features/search/components/RedirectCTA";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import {
  launchSafeProviderRedirect,
  validateExternalProviderUrl,
} from "../src/features/search/externalRedirect";
import { useSearchFlow } from "../src/features/search/queryHooks";
import { HehThemeProvider } from "../src/theme";

const BASE_NOTICE =
  "Doğrulanan ölçütler web kanıtına dayanır; mobil uygulama doğrulaması beklenir.";

describe("D24 RedirectCTA, Deep-Link Fallback, Open-Redirect Blocking & Honesty", () => {
  it("blocks open-redirect, percent-encoded CRLF, arbitrary paths, and unallowlisted query params", () => {
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?wc=118&prc=0-3000")).toBe(true);
    expect(
      validateExternalProviderUrl("https://www.trendyol.com/siyah-erkek-mont-x-r14-g2-c118"),
    ).toBe(true);
    expect(
      validateExternalProviderUrl("https://www.trendyol.com/apple-cep-telefonu-x-b101470-c103498"),
    ).toBe(true);

    expect(validateExternalProviderUrl("http://www.trendyol.com/sr?q=mont")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com.evil.com/sr?q=mont")).toBe(false);
    expect(validateExternalProviderUrl("https://user:pass@www.trendyol.com/sr?q=mont")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com:8443/sr?q=mont")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?q=mont#frag")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?q=mont%0d%0a")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com/hesabim/sil")).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com/sr?wc=118&evil=1")).toBe(false);
  });

  it("executes primary -> browser fallback safely and blocks unsafe redirects before Linking", async () => {
    const canOpenUrlMock = jest.fn();
    const openPrimaryMock = jest.fn();
    const openFallbackMock = jest.fn();

    const blocked = await launchSafeProviderRedirect("https://evil.example/sr?q=mont", {
      canOpenUrl: canOpenUrlMock,
      openPrimaryUrl: openPrimaryMock,
      openFallbackUrl: openFallbackMock,
    });
    expect(blocked.opened).toBe(false);
    expect(blocked.target).toBe("blocked");
    expect(canOpenUrlMock).not.toHaveBeenCalled();
    expect(openPrimaryMock).not.toHaveBeenCalled();
    expect(openFallbackMock).not.toHaveBeenCalled();

    // Case 1: Deep link / universal link is unsupported (canOpenUrl=false) -> falls back to HTTPS browser.
    canOpenUrlMock.mockResolvedValueOnce(false);
    openFallbackMock.mockResolvedValueOnce(undefined);
    const fallbackOk = await launchSafeProviderRedirect("https://www.trendyol.com/sr?wc=118", {
      canOpenUrl: canOpenUrlMock,
      openPrimaryUrl: openPrimaryMock,
      openFallbackUrl: openFallbackMock,
    });
    expect(fallbackOk).toEqual({
      opened: true,
      target: "fallback_browser",
      url: "https://www.trendyol.com/sr?wc=118",
    });
    expect(openPrimaryMock).not.toHaveBeenCalled();
    expect(openFallbackMock).toHaveBeenCalledTimes(1);

    // Case 2: Both primary throw and fallback throw -> returns explicit failed state cleanly.
    canOpenUrlMock.mockResolvedValueOnce(true);
    openPrimaryMock.mockRejectedValueOnce(new Error("intent failure"));
    openFallbackMock.mockRejectedValueOnce(new Error("no browser"));
    const bothFailed = await launchSafeProviderRedirect("https://www.trendyol.com/sr?wc=118", {
      canOpenUrl: canOpenUrlMock,
      openPrimaryUrl: openPrimaryMock,
      openFallbackUrl: openFallbackMock,
    });
    expect(bothFailed.opened).toBe(false);
    expect(bothFailed.target).toBe("failed");
    expect(bothFailed.errorMessage).toBe("Bağlantı açılamadı.");
  });

  it("never shows fake 'Filtre uygulandı' for WEB_VERIFIED_PENDING_MOBILE and highlights partial searches", async () => {
    const webPendingResolution: LinkResolution = {
      provider: "trendyol",
      url: "https://www.trendyol.com/sr?wc=118&q=Nike&prc=0-3000",
      route_strategy: "canonical_search_query",
      mapping_version: "2026.11.25.1",
      applied_filters: [
        {
          criterion_id: "cat-1",
          field: "category",
          label: "Erkek Mont",
          operator: "eq",
          status: "WEB_VERIFIED_PENDING_MOBILE",
          url_param: "wc",
          url_value: "118",
          reason: "Web kanıtı mevcut.",
        },
        {
          criterion_id: "price-1",
          field: "price",
          label: "0-3000 TL",
          operator: "lte",
          status: "WEB_VERIFIED_PENDING_MOBILE",
          url_param: "prc",
          url_value: "0-3000",
          reason: "Web kanıtı mevcut.",
        },
      ],
      query_only: [
        {
          criterion_id: "brand-1",
          field: "brand",
          label: "Nike",
          operator: "eq",
          status: "QUERY_ONLY",
          reason: "Metinde aktarılır.",
        },
      ],
      unsupported: [
        {
          criterion_id: "color-not-1",
          field: "color",
          label: "Beyaz olmasın",
          operator: "not_in",
          status: "UNSUPPORTED",
          reason: "Desteklenmiyor.",
        },
      ],
      warning_level: "partial",
      verification_notice: BASE_NOTICE,
    };

    const breakdown = buildRedirectBreakdown(webPendingResolution);
    expect(breakdown.appliedLabel).toBe("Web doğrulandı: 2");
    expect(breakdown.appliedLabel).not.toContain("Filtre uygulandı");

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <RedirectCTA
          ctaLabel="Kısmi aramayı aç"
          disabled={false}
          externalOpenError={null}
          isBusy={false}
          onPressOpenExternal={jest.fn()}
          resolution={webPendingResolution}
        />
      </HehThemeProvider>,
    );

    expect(screen.getByTestId("redirect-pill-applied").props.children.props.children).toBe(
      "Web doğrulandı: 2",
    );
    expect(screen.getByTestId("redirect-pill-query-only").props.children.props.children).toBe(
      "Metinde: 1",
    );
    expect(screen.getByTestId("redirect-pill-unsupported").props.children.props.children).toBe(
      "Uygulanamadı: 1",
    );
    expect(screen.queryByText(/Filtre uygulandı/)).toBeNull();
    expect(screen.getByTestId("redirect-partial-warning")).toBeTruthy();
    expect(screen.getByText(/Beyaz olmasın/)).toBeTruthy();
    expect(screen.getByText("Kısmi aramayı aç")).toBeTruthy();
  });

  it("shows 'Filtre uygulandı' only when dual-verified and prevents double-tap while opening", async () => {
    const dualVerifiedResolution: LinkResolution = {
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
      verification_notice: BASE_NOTICE,
    };
    expect(buildRedirectBreakdown(dualVerifiedResolution).appliedLabel).toBe("Filtre uygulandı: 1");

    let releaseBrowser!: () => void;
    const canOpenUrlMock = jest.fn(async () => false);
    const openFallbackMock = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseBrowser = resolve;
        }),
    );

    function HookHarness() {
      const flow = useSearchFlow({
        transport: new MockSearchTransport(),
        redirectDeps: {
          canOpenUrl: canOpenUrlMock,
          openFallbackUrl: openFallbackMock,
        },
      });
      return (
        <HehThemeProvider initialMode="light" initialReduceMotion>
          <Text
            onPress={() => {
              void flow.runParse("3000 altı erkek mont");
            }}
            testID="seed-flow"
          >
            Seed
          </Text>
          {flow.resolution ? (
            <RedirectCTA
              ctaLabel={flow.ctaLabel}
              disabled={flow.chips.length === 0}
              externalOpenError={flow.externalOpenError}
              isBusy={flow.phase === "parsing" || flow.phase === "resolving"}
              isOpeningExternal={flow.phase === "opening_external"}
              onPressOpenExternal={() => {
                void flow.openExternalResult();
              }}
              resolution={flow.resolution}
            />
          ) : null}
        </HehThemeProvider>
      );
    }

    await render(<HookHarness />);
    await fireEvent.press(screen.getByTestId("seed-flow"));

    // First tap triggers canOpenURL(false) -> HTTPS browser fallback and locks button to "Açılıyor...".
    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));
    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));

    expect(screen.getByText("Açılıyor...")).toBeTruthy();
    expect(openFallbackMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseBrowser();
    });
    expect(screen.getByText("Trendyol'da göster")).toBeTruthy();
  });
});
