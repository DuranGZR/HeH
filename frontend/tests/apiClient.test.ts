import { HehApiClient, HehApiError, type FetchLike } from "../src/api";

describe("HehApiClient (D08 / D10 Contract Parity)", () => {
  it("sends 1-RTT /search/parse and edit-only /search/resolve cleanly", async () => {
    const mockFetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          request_id: "req-1",
          parser_version: "1.0.0",
          nlp_mode: "rules",
          confidence_state: "review_required",
          warnings: [],
          intent: {
            schema_version: "2.0.0",
            raw_query: "3000 altı siyah mont",
            normalized_query: "3000 altı siyah mont",
            locale: "tr-TR",
            input_source: "text",
            category_key: "erkek_mont",
            criteria: [],
            logic_groups: [],
          },
          resolution: {
            provider: "trendyol",
            url: "https://www.trendyol.com/sr?wc=118&wg=2&wcl=14&prc=0-3000",
            route_strategy: "canonical_search_query",
            mapping_version: "2026.11.24.1",
            applied_filters: [],
            query_only: [],
            unsupported: [],
            warning_level: "none",
            verification_notice: "notice",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new HehApiClient({ baseUrl: "http://127.0.0.1:8000/", fetchImpl: mockFetch });
    const controller = new AbortController();

    const parsed = await client.parseSearch(
      { text: "3000 altı siyah mont", locale: "tr-TR", input_source: "text" },
      controller.signal,
    );

    expect(parsed.request_id).toBe("req-1");
    expect(parsed.intent.category_key).toBe("erkek_mont");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/search/parse",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
      }),
    );
  });

  it("maps uniform ApiErrorResponse into typed HehApiError with requestId", async () => {
    const mockFetch = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "İstek alanlarını kontrol et.",
            request_id: "req-422",
            details: [{ field: "text", reason: "String should have at least 1 character" }],
          },
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json", "X-Request-ID": "req-422" },
        },
      ),
    );

    const client = new HehApiClient({ fetchImpl: mockFetch });

    await expect(client.parseSearch({ text: "" })).rejects.toMatchObject({
      name: "HehApiError",
      status: 422,
      code: "VALIDATION_ERROR",
      requestId: "req-422",
    } satisfies Partial<HehApiError>);
  });
});
