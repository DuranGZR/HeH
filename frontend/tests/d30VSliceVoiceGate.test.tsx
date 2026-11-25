import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { AppState, StyleSheet, View, type AppStateStatus } from "react-native";

import HomeScreen from "../app/index";
import SearchEntryScreen from "../app/search";
import {
  HehApiClient,
  createHehQueryClient,
  type FetchLike,
  type SearchApiTransport,
} from "../src/api";
import { CriteriaReviewPanel } from "../src/features/search/components/CriteriaReviewPanel";
import { VoiceEntry } from "../src/features/search/components/VoiceEntry";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import { validateExternalProviderUrl } from "../src/features/search/externalRedirect";
import { useSearchFlow } from "../src/features/search/queryHooks";
import { MockSpeechProvider } from "../src/services/speech/mockSpeechProvider";
import { SPEECH_RECOVERY_MESSAGES, type SpeechProvider } from "../src/services/speech/types";
import { parseWidgetDeepLink } from "../src/services/widgets/deepLink";
import { HehThemeProvider } from "../src/theme";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockRouteParams: Record<string, string> = { mode: "voice" };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockRouteParams,
}));

function buildCountingBackendFetch(
  base: MockSearchTransport,
  counts: { parse: number; resolve: number },
  options?: { failNextParse?: boolean },
): FetchLike {
  return async (input, init) => {
    const body = init?.body ? String(init.body) : "{}";
    const parsedJson = JSON.parse(body) as Record<string, unknown>;
    if (input.endsWith("/api/v1/search/parse")) {
      counts.parse += 1;
      if (options?.failNextParse) {
        options.failNextParse = false;
        throw new TypeError("Weak network timeout");
      }
      const res = await base.parseSearch(
        parsedJson as unknown as Parameters<typeof base.parseSearch>[0],
      );
      return new Response(JSON.stringify(res), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": res.request_id },
      });
    }
    if (input.endsWith("/api/v1/search/resolve")) {
      counts.resolve += 1;
      const res = await base.resolveSearch(
        parsedJson as unknown as Parameters<typeof base.resolveSearch>[0],
      );
      return new Response(JSON.stringify(res), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": res.request_id },
      });
    }
    return new Response("Not Found", { status: 404 });
  };
}

function VoiceVSliceHarness({
  speechProvider,
  searchTransport,
  openUrlMock,
}: {
  readonly speechProvider: SpeechProvider;
  readonly searchTransport: SearchApiTransport;
  readonly openUrlMock: (url: string) => Promise<void>;
}) {
  const flow = useSearchFlow({ transport: searchTransport, openUrl: openUrlMock });
  const isBusy =
    flow.phase === "parsing" || flow.phase === "resolving" || flow.phase === "opening_external";

  return (
    <HehThemeProvider initialMode="light" initialReduceMotion>
      <View>
        <VoiceEntry
          isParsing={flow.phase === "parsing"}
          onSwitchToText={() => undefined}
          onTranscriptReady={(spoken) => {
            void flow.runParse(spoken, "voice");
          }}
          onVoiceActivityStart={flow.clearError}
          parseErrorMessage={flow.phase === "error" ? flow.errorMessage : null}
          speechProvider={speechProvider}
        />
        {flow.resolution && flow.summaryText ? (
          <CriteriaReviewPanel
            canRestore={flow.canRestore}
            chips={flow.chips}
            ctaLabel={flow.ctaLabel}
            externalOpenError={flow.externalOpenError}
            groups={flow.criteriaGroups}
            isBusy={isBusy}
            isOpeningExternal={flow.phase === "opening_external"}
            onPressOpenExternal={() => {
              void flow.openExternalResult();
            }}
            onRemoveCriterion={(id) => {
              void flow.removeCriterion(id);
            }}
            onRemoveOrOption={(id, key) => {
              void flow.removeOrOption(id, key);
            }}
            onRestoreLast={() => {
              void flow.restoreLastRemoved();
            }}
            onUpdatePriceRange={(id, min, max) => {
              void flow.updatePriceRange(id, min, max);
            }}
            resolveError={flow.phase === "reviewing" ? flow.errorMessage : null}
            resolution={flow.resolution}
            summaryText={flow.summaryText}
            warnings={flow.warnings}
          />
        ) : null}
      </View>
    </HehThemeProvider>
  );
}

describe("D30 Gate-VSlice-Voice — End-to-End Voice Search Vertical Slice", () => {
  const clients: ReturnType<typeof createHehQueryClient>[] = [];

  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockRouteParams = { mode: "voice" };
  });

  afterEach(() => {
    for (const qc of clients) {
      qc.clear();
    }
    clients.length = 0;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("enforces privacy-first entry from HomeScreen & widget deep-link without auto-recording", async () => {
    // Widget deep-link requires foreground permission verification and never auto-opens microphone
    expect(parseWidgetDeepLink("heh://search?mode=voice")).toEqual({
      destination: "search",
      mode: "voice",
      requiresPermissionCheck: true,
    });

    await render(
      <HehThemeProvider initialMode="light" initialReduceMotion>
        <HomeScreen />
      </HehThemeProvider>,
    );
    expect(screen.getByTestId("home-voice-consent-note")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("home-voice-button"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/search",
      params: { mode: "voice" },
    });

    const qc = createHehQueryClient();
    clients.push(qc);
    await render(
      <QueryClientProvider client={qc}>
        <HehThemeProvider initialMode="light" initialReduceMotion>
          <SearchEntryScreen />
        </HehThemeProvider>
      </QueryClientProvider>,
    );
    expect(
      screen.getByText("Mikrofon yalnızca açık iznin ve dokunuşunla başlatılır."),
    ).toBeTruthy();
  });

  it("executes Mic -> partial -> editable transcript -> 1-RTT M0 -> edit (/resolve) -> safe Trendyol CTA", async () => {
    jest.useFakeTimers();
    const counts = { parse: 0, resolve: 0 };
    const fetchImpl = buildCountingBackendFetch(new MockSearchTransport(), counts);
    const client = new HehApiClient({ baseUrl: "http://127.0.0.1:8000", fetchImpl });
    const openUrlMock = jest.fn<Promise<void>, [string]>(async () => undefined);

    const speechProvider = new MockSpeechProvider({
      partialTranscripts: ["3000 altı", "3000 altı nike olmasın"],
      finalTranscript: "3000 altı siyah nike olmasın erkek mont",
      partialIntervalMs: 20,
    });

    const qc = createHehQueryClient();
    clients.push(qc);
    await render(
      <QueryClientProvider client={qc}>
        <VoiceVSliceHarness
          openUrlMock={openUrlMock}
          searchTransport={client}
          speechProvider={speechProvider}
        />
      </QueryClientProvider>,
    );

    // Must not start before tap
    expect(speechProvider.startCount).toBe(0);

    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("voice-partial-badge")).toBeTruthy();

    // Partial transcripts never trigger premature HTTP /parse calls
    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    expect(counts.parse).toBe(0);

    // Final transcript triggers strictly 1-RTT /parse
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(counts.parse).toBe(1);
    expect(counts.resolve).toBe(0);
    expect(openUrlMock).toHaveBeenCalledTimes(0);

    expect(screen.getByTestId("criteria-review-panel")).toBeTruthy();
    expect(screen.getByTestId("criteria-group-not")).toBeTruthy();
    expect(screen.getByText("Kısmi aramayı aç")).toBeTruthy();

    // Removing NOT negation chip invokes edit-only /resolve once and shifts CTA to Trendyol
    await fireEvent.press(screen.getByTestId("remove-criterion-brand-not-1"));
    expect(counts.parse).toBe(1);
    expect(counts.resolve).toBe(1);
    expect(screen.getByText("Trendyol'da göster")).toBeTruthy();

    // User notices an edit needed in final transcript -> updates directly and re-parses cleanly
    await fireEvent.changeText(
      screen.getByTestId("voice-transcript-input"),
      "Sony veya JBL bluetooth kulaklık",
    );
    await fireEvent.press(screen.getByTestId("voice-transcript-submit"));
    expect(counts.parse).toBe(2);
    expect(screen.getByTestId("criteria-group-any-of-group-any-1")).toBeTruthy();

    // Explicit user tap launches allowlisted Trendyol HTTPS URL
    await fireEvent.press(screen.getByTestId("open-trendyol-cta"));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    const launchedUrl = openUrlMock.mock.calls[0]?.[0] ?? "";
    expect(validateExternalProviderUrl(launchedUrl)).toBe(true);
    expect(launchedUrl).toContain("wb=795%2C102285");
  });

  it("handles weak-network /parse failure after STT with one-tap Tekrar Dene retry (zero re-recording)", async () => {
    jest.useFakeTimers();
    const counts = { parse: 0, resolve: 0 };
    const networkState = { failNextParse: true };
    const fetchImpl = buildCountingBackendFetch(new MockSearchTransport(), counts, networkState);
    const client = new HehApiClient({ baseUrl: "http://127.0.0.1:8000", fetchImpl });

    const speechProvider = new MockSpeechProvider({
      partialTranscripts: ["siyah"],
      finalTranscript: "3000 altı siyah erkek mont",
      partialIntervalMs: 15,
    });

    const qc = createHehQueryClient();
    clients.push(qc);
    await render(
      <QueryClientProvider client={qc}>
        <VoiceVSliceHarness
          openUrlMock={jest.fn(async () => undefined)}
          searchTransport={client}
          speechProvider={speechProvider}
        />
      </QueryClientProvider>,
    );

    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    await act(async () => {
      jest.advanceTimersByTime(60);
    });

    // Offline error appears, retry button MUST render even though STT status is "transcribed"!
    expect(screen.getByTestId("voice-search-error").props.children).toBe(
      "Bağlantı yok. Tekrar dene.",
    );
    const retryBtn = screen.getByTestId("voice-retry-parse-button");
    expect(retryBtn).toBeTruthy();

    // Tapping Tekrar Dene succeeds without calling mic again
    await fireEvent.press(retryBtn);
    expect(speechProvider.startCount).toBe(1);
    expect(counts.parse).toBe(2);
    expect(screen.getByTestId("criteria-review-panel")).toBeTruthy();
  });

  it("enforces permission deny -> settings unlock and AppState background cleanup (AT-19)", async () => {
    jest.useFakeTimers();
    let appStateListener: ((next: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_evt, cb) => {
      appStateListener = cb;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    const speechProvider = new MockSpeechProvider({
      permission: { status: "denied", canAskAgain: false },
      partialIntervalMs: 100,
    });
    const fallbackSpy = jest.fn();

    await render(
      <HehThemeProvider initialMode="dark" initialReduceMotion>
        <VoiceEntry
          onSwitchToText={fallbackSpy}
          onTranscriptReady={jest.fn()}
          openSettingsImpl={jest.fn(async () => undefined)}
          speechProvider={speechProvider}
        />
      </HehThemeProvider>,
    );

    // Dark-mode 48dp target check & denial recovery
    expect(StyleSheet.flatten(screen.getByTestId("voice-mic-toggle").props.style).minHeight).toBe(
      48,
    );
    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    expect(screen.getByTestId("voice-search-error").props.children).toBe(
      SPEECH_RECOVERY_MESSAGES.PERMISSION_DENIED,
    );
    expect(screen.getByTestId("voice-open-settings-button")).toBeTruthy();

    // User enables permission in Settings and returns to foreground -> mic unlocks without auto-starting
    speechProvider.setPermission({ status: "granted", canAskAgain: true });
    await act(async () => {
      appStateListener?.("active");
    });
    expect(speechProvider.startCount).toBe(0);

    // User starts listening, then backgrounds app -> active audio immediately aborts & frees listener
    await fireEvent.press(screen.getByTestId("voice-mic-toggle"));
    await act(async () => {
      jest.advanceTimersByTime(5);
    });
    expect(speechProvider.getActiveSubscriptionCount()).toBe(1);

    await act(async () => {
      appStateListener?.("background");
    });
    expect(speechProvider.abortCount).toBe(1);
    expect(speechProvider.getActiveSubscriptionCount()).toBe(0);

    // One-tap fallback to text entry
    await fireEvent.press(screen.getByTestId("voice-fallback-text-button"));
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });
});
