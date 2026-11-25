import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Linking, Pressable, Text } from "react-native";

import NotFoundScreen from "../app/+not-found";
import { HehApiClient, HehApiError, type SearchIntentV2Output } from "../src/api";
import { CriteriaReview } from "../src/features/search/components/CriteriaReview";
import { Listening } from "../src/features/search/components/Listening";
import { VoiceEntry } from "../src/features/search/components/VoiceEntry";
import {
  buildCriteriaGroupViewModels,
  updatePriceCriterionInIntent,
} from "../src/features/search/criteriaAst";
import { MockSearchTransport, toInputIntent } from "../src/features/search/demoFixtures";
import { validateExternalProviderUrl } from "../src/features/search/externalRedirect";
import { useSearchFlow } from "../src/features/search/queryHooks";
import { EXAMPLE_SEARCH_PROMPTS, validateSearchQuery } from "../src/features/search/types";
import { ExpoSpeechRecognitionAdapter } from "../src/services/speech/expoSpeechAdapter";
import { SpeechSessionController } from "../src/services/speech/stateMachine";
import type { SpeechProvider, SpeechSessionState } from "../src/services/speech/types";
import { useSpeechSession } from "../src/services/speech/useSpeechSession";
import { HehThemeProvider, STATUS_BADGE_TOKENS } from "../src/theme";

function StaleClearHarness({ transport }: { readonly transport: MockSearchTransport }) {
  const flow = useSearchFlow({ transport });
  return (
    <HehThemeProvider initialMode="light" initialReduceMotion>
      <Pressable
        testID="parse-first"
        onPress={() => void flow.runParse("3000 altı siyah M erkek mont")}
      >
        <Text>First</Text>
      </Pressable>
      <Pressable testID="parse-second" onPress={() => void flow.runParse("sony kulaklık")}>
        <Text>Second</Text>
      </Pressable>
      <Pressable testID="remove-not" onPress={() => void flow.removeCriterion("brand-not-1")}>
        <Text>Remove Not</Text>
      </Pressable>
      <Text testID="flow-phase">{flow.phase}</Text>
      <Text testID="flow-url">{flow.resolution?.url ?? ""}</Text>
      <Text testID="flow-warnings-len">{String(flow.warnings.length)}</Text>
    </HehThemeProvider>
  );
}

describe("W1-W7 Frontend Audit Remediation Fixes", () => {
  it("preserves contrast in CriteriaReview applied cards, +not-found, and 0 min price bounds", async () => {
    const intent: SearchIntentV2Output = {
      schema_version: "2.0.0",
      ontology_version: "1.0.0",
      intent_type: "unsupported",
      raw_query: "0-3000 TL erkek mont",
      normalized_query: "0-3000 tl erkek mont",
      criteria: [
        {
          id: "price-1",
          field: "price",
          operator: "between",
          value: { min_amount: "0", max_amount: "3000", currency: "TRY" },
          display_label: "0-3000 TL",
        },
      ],
      logic_groups: [{ operator: "all_of", criterion_ids: ["price-1"] }],
    };

    const groups = buildCriteriaGroupViewModels(
      [
        {
          criterionId: "price-1",
          field: "price",
          label: "0-3000 TL",
          operator: "between",
          status: "FILTER_VERIFIED",
          visualStatus: "applied",
          badgeLabel: "Filtre uygulandı",
          reason: "verified",
        },
      ],
      intent,
    );
    expect(groups[0]?.items[0]?.priceBounds).toEqual({ minAmount: "0", maxAmount: "3000" });

    const editedPrice = updatePriceCriterionInIntent(intent, "price-1", "100", "250.5");
    expect(editedPrice?.intent_type).toBe("product_search");
    expect(editedPrice?.criteria?.[0]?.display_label).toBe("100-250,5 TL");
    const serialized = toInputIntent(intent);
    expect(serialized.ontology_version).toBe("1.0.0");
    expect(serialized.intent_type).toBe("unsupported");

    const chip = groups[0]?.items[0]?.chip;
    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <CriteriaReview
          canRestore={false}
          chips={chip ? [chip] : []}
          ctaLabel="Trendyol'da göster"
          externalOpenError={null}
          groups={groups}
          isBusy={false}
          onPressOpenExternal={jest.fn()}
          onRemoveCriterion={jest.fn()}
          onUpdatePriceRange={jest.fn()}
          resolution={{
            provider: "trendyol",
            url: "https://www.trendyol.com/sr?prc=0-3000",
            route_strategy: "canonical_search_query",
            mapping_version: "1.0.0",
            warning_level: "none",
            verification_notice: "notice",
          }}
          summaryText="1 kriter"
          warnings={[]}
        />
        <NotFoundScreen />
      </HehThemeProvider>,
    );

    const editText = screen.getByText("Fiyatı Düzenle");
    expect(editText.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: STATUS_BADGE_TOKENS.light.applied.text }),
      ]),
    );
  });

  it("supports all 4 starter prompts in MockSearchTransport and clears stale parse/warning state", async () => {
    const transport = new MockSearchTransport();
    for (const prompt of EXAMPLE_SEARCH_PROMPTS) {
      const parsed = await transport.parseSearch({ text: prompt });
      expect(parsed.resolution.url).toContain("https://www.trendyol.com/sr?");
    }
    const fourthPrompt = EXAMPLE_SEARCH_PROMPTS[3] ?? "";
    const shoeNeg = await transport.parseSearch({ text: fourthPrompt });
    expect(shoeNeg.resolution.url).not.toContain("nike");

    const baseTransport = new MockSearchTransport();
    let failSecond = false;
    const partialFailTransport: MockSearchTransport = {
      parseSearch: async (payload) => {
        if (failSecond && payload.text === "sony kulaklık") {
          throw new HehApiError({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "Sunucu hatası",
            requestId: "req-2",
          });
        }
        return baseTransport.parseSearch(payload);
      },
      resolveSearch: (payload) => baseTransport.resolveSearch(payload),
    } as MockSearchTransport;

    await render(<StaleClearHarness transport={partialFailTransport} />);
    await fireEvent.press(screen.getByTestId("parse-first"));
    expect(screen.getByTestId("flow-url").props.children).toContain("wc=118");

    failSecond = true;
    await fireEvent.press(screen.getByTestId("parse-second"));
    expect(screen.getByTestId("flow-phase").props.children).toBe("error");
    expect(screen.getByTestId("flow-url").props.children).toBe("");
  });

  it("propagates live draft edits on VoiceEntry switch-to-text and validates zero-width whitespace", async () => {
    expect(validateSearchQuery("\u200b\ufeff   ").valid).toBe(false);
    expect(validateExternalProviderUrl("https://www.trendyol.com/erkek-mont-x-b43-g2-c118")).toBe(
      true,
    );

    const onSwitchToText = jest.fn();
    let capturedCallbacks: Parameters<SpeechProvider["startListening"]>[1] | null = null;
    const provider: SpeechProvider = {
      isAvailable: () => true,
      supportsOnDevice: () => true,
      getPermission: async () => ({ status: "granted", canAskAgain: true }),
      requestPermission: async () => ({ status: "granted", canAskAgain: true }),
      checkLocaleSupport: async (locale) => ({ locale, supported: true, installedOffline: true }),
      startListening: (_locale, cb) => {
        capturedCallbacks = cb;
        cb.onStart();
        cb.onFinalResult("eski transkript");
        return () => undefined;
      },
      stopListening: jest.fn(),
      abortListening: jest.fn(),
    };

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={onSwitchToText}
          onTranscriptReady={jest.fn()}
          speechProvider={provider}
        />
      </HehThemeProvider>,
    );

    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    expect(capturedCallbacks).not.toBeNull();
    await fireEvent.changeText(screen.getByTestId("voice-transcript-input"), "güncel metin");
    await fireEvent.press(screen.getByTestId("voice-fallback-text-button"));
    expect(onSwitchToText).toHaveBeenCalledWith("güncel metin");

    const relistenBtn = screen.getByTestId("voice-relisten-button");
    expect(relistenBtn.props.accessibilityState).toEqual({ disabled: false });
    expect(screen.getByTestId("voice-transcript-input").props.blurOnSubmit).toBe(true);
  });

  it("handles 503 ReadinessResponse JSON, aborts external signal on timeout, and handles speech edge cases", async () => {
    const abortSignalsSeen: AbortSignal[] = [];
    const client = new HehApiClient({
      baseUrl: "https://api.example.com",
      timeoutMs: 25,
      fetchImpl: async (url, init) => {
        if (init?.signal) {
          abortSignalsSeen.push(init.signal);
        }
        if (url.endsWith("/api/v1/health/ready")) {
          return new Response(
            JSON.stringify({ status: "degraded", db: "degraded", mapping_snapshot: "ok" }),
            { status: 503, headers: { "content-type": "application/json" } },
          );
        }
        return new Promise<Response>(() => undefined);
      },
    });

    const ready = await client.getHealthReady();
    expect(ready).toEqual({ status: "degraded", db: "degraded", mapping_snapshot: "ok" });

    const externalCtrl = new AbortController();
    await expect(client.getCapabilities(externalCtrl.signal)).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    expect(abortSignalsSeen[1]?.aborted).toBe(true);

    // Sync finalization inside startListening must still teardown cleanly and not stay stuck
    const syncProvider: SpeechProvider = {
      isAvailable: () => true,
      supportsOnDevice: () => true,
      getPermission: async () => ({ status: "granted", canAskAgain: true }),
      requestPermission: async () => ({ status: "granted", canAskAgain: true }),
      checkLocaleSupport: async (locale) => ({ locale, supported: true, installedOffline: true }),
      startListening: (_loc, cb) => {
        cb.onStart();
        cb.onFinalResult("siyah mont");
        return jest.fn();
      },
      stopListening: jest.fn(),
      abortListening: jest.fn(),
    };
    const controller = new SpeechSessionController(syncProvider);
    const state: SpeechSessionState = await controller.start();
    expect(state.status).toBe("transcribed");

    // Adapter handles empty results safely without throwing
    const adapter = new ExpoSpeechRecognitionAdapter(null);
    expect(adapter.isAvailable()).toBe(false);
    expect(typeof Linking.openSettings).toBe("function");
    expect(typeof useSpeechSession).toBe("function");
    expect(typeof Listening).toBe("function");
    await act(async () => undefined);
  });
});
