import type {
  ApiErrorDetail,
  ApiErrorResponse,
  ProviderCapabilitiesResponse,
  ReadinessResponse,
  SearchParseRequest,
  SearchParseResponse,
  SearchResolveRequest,
  SearchResolveResponse,
} from "./generated";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export class HehApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId: string;
  public readonly details: readonly ApiErrorDetail[];

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId: string;
    details?: readonly ApiErrorDetail[];
  }) {
    super(params.message);
    this.name = "HehApiError";
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details ?? [];
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HehApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
}

/**
 * Typed HTTP client generated directly from FastAPI OpenAPI contracts.
 * Mobile performs zero local URL construction or NLP rule evaluation.
 */
export class HehApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: HehApiClientOptions) {
    const envBase =
      typeof process !== "undefined" ? process.env.EXPO_PUBLIC_HEH_API_URL : undefined;
    const rawBase = options?.baseUrl ?? envBase ?? DEFAULT_API_BASE_URL;
    this.baseUrl = rawBase.replace(/\/+$/, "");
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  }

  public getHealthReady(signal?: AbortSignal): Promise<ReadinessResponse> {
    return this.requestJson<ReadinessResponse>("/api/v1/health/ready", {
      method: "GET",
      signal,
    });
  }

  public getCapabilities(signal?: AbortSignal): Promise<ProviderCapabilitiesResponse> {
    return this.requestJson<ProviderCapabilitiesResponse>("/api/v1/search/capabilities", {
      method: "GET",
      signal,
    });
  }

  public parseSearch(
    payload: SearchParseRequest,
    signal?: AbortSignal,
  ): Promise<SearchParseResponse> {
    return this.requestJson<SearchParseResponse>("/api/v1/search/parse", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    });
  }

  public resolveSearch(
    payload: SearchResolveRequest,
    signal?: AbortSignal,
  ): Promise<SearchResolveResponse> {
    return this.requestJson<SearchResolveResponse>("/api/v1/search/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    });
  }

  private async requestJson<TResponse>(
    path: string,
    init: { method: "GET" | "POST"; body?: string; signal?: AbortSignal },
  ): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      signal: init.signal,
    });

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    return (await response.json()) as TResponse;
  }

  private async buildApiError(response: Response): Promise<HehApiError> {
    const headerRequestId = response.headers.get("x-request-id") ?? "unknown";
    try {
      const payload = (await response.json()) as Partial<ApiErrorResponse>;
      if (payload.error) {
        return new HehApiError({
          status: response.status,
          code: payload.error.code,
          message: payload.error.message,
          requestId: payload.error.request_id || headerRequestId,
          details: payload.error.details,
        });
      }
    } catch {
      // Fall back cleanly when non-JSON proxy error responses are received.
    }

    return new HehApiError({
      status: response.status,
      code: `HTTP_${response.status}`,
      message: "Sunucuya erişilirken beklenmeyen bir hata oluştu.",
      requestId: headerRequestId,
    });
  }
}
