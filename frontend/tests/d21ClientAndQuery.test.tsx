import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import {
  HehApiClient,
  HehApiError,
  createClientRequestId,
  createHehQueryClient,
  hehQueryKeys,
  isAbortError,
  shouldRetryHehRequest,
  type FetchLike,
  type SearchApiTransport,
  type SearchParseResponse,
} from "../src/api";
import { MockSearchTransport } from "../src/features/search/demoFixtures";
import {
  resolveDefaultSearchTransport,
  useBackendReadinessQuery,
  useProviderCapabilitiesQuery,
  useSearchFlow,
} from "../src/features/search/queryHooks";
import { HehThemeProvider } from "../src/theme";

function D21Harness({ transport }: { readonly transport: SearchApiTransport }) {
  const flow = useSearchFlow({ transport });
  return (
    <View>
      <Pressable
        testID="search-mont"
        onPress={() => {
          void flow.runParse("siyah erkek mont 3000 altı");
        }}
      >
        <Text>Search Mont</Text>
      </Pressable>
      <Pressable
        testID="search-headphones"
        onPress={() => {
          void flow.runParse("sony kulaklık");
        }}
      >
        <Text>Search Headphones</Text>
      </Pressable>
      <Pressable
        testID="remove-color"
        onPress={() => {
          void flow.removeCriterion("color-1");
        }}
      >
        <Text>Remove Color</Text>
      </Pressable>
      <Pressable
        testID="reset-flow"
        onPress={() => {
          flow.reset();
        }}
      >
        <Text>Reset</Text>
      </Pressable>
      <Text testID="phase">{flow.phase}</Text>
      <Text testID="query">{flow.intent?.raw_query ?? "none"}</Text>
      <Text testID="request-id">{flow.lastRequestId ?? "none"}</Text>
      <Text testID="error">{flow.errorMessage ?? ""}</Text>
      <Text testID="url">{flow.resolution?.url ?? ""}</Text>
    </View>
  );
}

describe("D21 1-RTT & Edit-Only TanStack Query API Client", () => {
  const originalEnv = { ...process.env };
  const activeQueryClients: ReturnType<typeof createHehQueryClient>[] = [];

  const makeIsolatedClient = () => {
    const qc = createHehQueryClient();
    activeQueryClients.push(qc);
    return qc;
  };

  afterEach(() => {
    for (const qc of activeQueryClients) {
      qc.clear();
    }
    activeQueryClients.length = 0;
    process.env = { ...originalEnv };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("generates backend-safe correlation IDs and enforces X-Request-ID and timeouts", async () => {
    const id = createClientRequestId("parse!@#");
    expect(id).toMatch(/^parse-[A-Za-z0-9_.-]+$/);
    expect(id.length).toBeLessThanOrEqual(64);

    const mockFetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { client_request_id?: string };
      expect(body.client_request_id).toBeTruthy();
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "X-Request-ID": body.client_request_id,
        }),
      );
      const mock = await new MockSearchTransport().parseSearch({ text: "siyah mont" });
      return new Response(
        JSON.stringify({ ...mock, request_id: body.client_request_id ?? mock.request_id }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new HehApiClient({ baseUrl: "http://127.0.0.1:8000", fetchImpl: mockFetch });
    const parsed = await client.parseSearch({ text: "siyah mont" });
    expect(parsed.request_id).toMatch(/^parse-/);

    // Pre-aborted signal must fail immediately without touching fetch.
    const aborted = new AbortController();
    aborted.abort();
    const beforeCalls = mockFetch.mock.calls.length;
    let caughtAbort: unknown;
    try {
      await client.parseSearch({ text: "siyah mont" }, aborted.signal);
    } catch (err) {
      caughtAbort = err;
    }
    expect(isAbortError(caughtAbort)).toBe(true);
    expect(mockFetch.mock.calls.length).toBe(beforeCalls);

    // Hanging fetch triggers typed 408 REQUEST_TIMEOUT even when caller supplies a signal.
    jest.useFakeTimers();
    const hangingFetch: FetchLike = () => new Promise<Response>(() => undefined);
    const timeoutClient = new HehApiClient({
      baseUrl: "http://127.0.0.1:8000",
      fetchImpl: hangingFetch,
      timeoutMs: 100,
    });
    const activeController = new AbortController();
    const timeoutPromise = timeoutClient.parseSearch(
      { text: "siyah mont" },
      activeController.signal,
    );
    jest.advanceTimersByTime(110);
    await expect(timeoutPromise).rejects.toMatchObject({
      name: "HehApiError",
      status: 408,
      code: "REQUEST_TIMEOUT",
    } satisfies Partial<HehApiError>);
  });

  it("deduplicates simultaneous identical parse calls to strictly 1-RTT", async () => {
    const base = new MockSearchTransport();
    let resolvePending!: (value: SearchParseResponse) => void;
    const parseSpy = jest.fn(
      () =>
        new Promise<SearchParseResponse>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const resolveSpy = jest.fn((payload: Parameters<typeof base.resolveSearch>[0]) =>
      base.resolveSearch(payload),
    );

    const queryClient = makeIsolatedClient();
    await render(
      <QueryClientProvider client={queryClient}>
        <HehThemeProvider initialMode="light">
          <D21Harness transport={{ parseSearch: parseSpy, resolveSearch: resolveSpy }} />
        </HehThemeProvider>
      </QueryClientProvider>,
    );

    await fireEvent.press(screen.getByTestId("search-mont"));
    await fireEvent.press(screen.getByTestId("search-mont"));

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledTimes(0);

    const fixture = await base.parseSearch({ text: "siyah erkek mont 3000 altı" });
    await act(async () => {
      resolvePending({ ...fixture, request_id: "req-1rtt-mont" });
    });

    expect(screen.getByTestId("phase").props.children).toBe("reviewing");
    expect(screen.getByTestId("request-id").props.children).toBe("req-1rtt-mont");

    // Only chip edits trigger /search/resolve; never re-runs /search/parse.
    await fireEvent.press(screen.getByTestId("remove-color"));
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("url").props.children).not.toContain("wcl=");
  });

  it("aborts earlier search signal and blocks late resolution or error from overwriting newer query", async () => {
    const base = new MockSearchTransport();
    const signals: AbortSignal[] = [];
    const resolvers: Array<{
      resolve: (val: SearchParseResponse) => void;
      reject: (err: unknown) => void;
    }> = [];

    const transport: SearchApiTransport = {
      parseSearch: (_payload, signal) => {
        if (signal) {
          signals.push(signal);
        }
        return new Promise<SearchParseResponse>((resolve, reject) => {
          resolvers.push({ resolve, reject });
        });
      },
      resolveSearch: (payload) => base.resolveSearch(payload),
    };

    const queryClient = makeIsolatedClient();
    await render(
      <QueryClientProvider client={queryClient}>
        <D21Harness transport={transport} />
      </QueryClientProvider>,
    );

    await fireEvent.press(screen.getByTestId("search-mont"));
    expect(signals[0]?.aborted).toBe(false);

    await fireEvent.press(screen.getByTestId("search-headphones"));
    // Newer query MUST abort the prior in-flight AbortSignal immediately.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    const headphonesResp = await base.parseSearch({ text: "sony kulaklık" });
    await act(async () => {
      resolvers[1]?.resolve({ ...headphonesResp, request_id: "req-headphones" });
    });
    expect(screen.getByTestId("query").props.children).toBe("sony kulaklık");
    expect(screen.getByTestId("request-id").props.children).toBe("req-headphones");

    // Late error from the aborted first search MUST NOT flash an error banner over newer result.
    await act(async () => {
      resolvers[0]?.reject(new Error("late socket close"));
    });
    expect(screen.getByTestId("phase").props.children).toBe("reviewing");
    expect(screen.getByTestId("query").props.children).toBe("sony kulaklık");
    expect(screen.getByTestId("error").props.children).toBe("");
  });

  it("enforces TanStack retry policy, capability/readiness queries, and env transport switch", async () => {
    expect(
      shouldRetryHehRequest(0, Object.assign(new Error("aborted"), { name: "AbortError" })),
    ).toBe(false);
    expect(
      shouldRetryHehRequest(
        0,
        new HehApiError({ status: 422, code: "VALIDATION_ERROR", message: "bad", requestId: "1" }),
      ),
    ).toBe(false);
    expect(
      shouldRetryHehRequest(
        0,
        new HehApiError({
          status: 409,
          code: "MAPPING_VERSION_CONFLICT",
          message: "c",
          requestId: "1",
        }),
      ),
    ).toBe(false);
    expect(
      shouldRetryHehRequest(
        0,
        new HehApiError({ status: 503, code: "TEMP", message: "busy", requestId: "1" }),
      ),
    ).toBe(true);
    expect(shouldRetryHehRequest(1, new Error("network"))).toBe(false);

    expect(hehQueryKeys.searchParse("mont", "text")).toEqual([
      "heh",
      "search",
      "parse",
      "text",
      "mont",
    ]);

    expect(resolveDefaultSearchTransport({ useMock: true })).toBeInstanceOf(MockSearchTransport);
    expect(resolveDefaultSearchTransport({ useMock: false })).toBeInstanceOf(HehApiClient);
    expect(resolveDefaultSearchTransport()).toBeInstanceOf(HehApiClient);

    const fakeClient = new HehApiClient({
      baseUrl: "http://127.0.0.1:8000",
      fetchImpl: async (url) => {
        if (url.endsWith("/api/v1/health/ready")) {
          return new Response(
            JSON.stringify({ status: "ok", db_status: "disabled", mapping_snapshot: "ready" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            provider: "trendyol",
            mapping_version: "2026.11.25.1",
            long_tail_policy: "prc_plus_q",
            showcase_categories: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    function MetaHarness() {
      const caps = useProviderCapabilitiesQuery(fakeClient);
      const ready = useBackendReadinessQuery(fakeClient);
      return (
        <>
          <Text testID="caps-ver">{caps.data?.mapping_version ?? "loading"}</Text>
          <Text testID="ready-snap">{ready.data?.mapping_snapshot ?? "loading"}</Text>
        </>
      );
    }

    const queryClient = makeIsolatedClient();
    await render(
      <QueryClientProvider client={queryClient}>
        <MetaHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("caps-ver").props.children).toBe("2026.11.25.1");
      expect(screen.getByTestId("ready-snap").props.children).toBe("ready");
    });
  });
});
