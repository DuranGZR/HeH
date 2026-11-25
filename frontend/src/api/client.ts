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
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

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
  readonly timeoutMs?: number;
}

/**
 * Typed HTTP client generated directly from FastAPI OpenAPI contracts.
 * Mobile performs zero local URL construction or NLP rule evaluation.
 */
export class HehApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options?: HehApiClientOptions) {
    const envBase =
      typeof process !== "undefined" ? process.env.EXPO_PUBLIC_HEH_API_URL : undefined;
    const candidate = (options?.baseUrl ?? envBase ?? "").trim() || DEFAULT_API_BASE_URL;
    if (!/^https?:\/\//i.test(candidate)) {
      throw new Error("EXPO_PUBLIC_HEH_API_URL must start with http:// or https://");
    }
    this.baseUrl = candidate.replace(/\/+$/, "");
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
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
    const timeoutController = !init.signal ? new AbortController() : null;
    const timer =
      timeoutController !== null
        ? setTimeout(() => timeoutController.abort(), this.timeoutMs)
        : null;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body,
        signal: init.signal ?? timeoutController?.signal,
      });
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    try {
      return (await response.json()) as TResponse;
    } catch {
      throw new HehApiError({
        status: response.status,
        code: "INVALID_JSON_RESPONSE",
        message: "Sunucudan geçersiz yanıt alındı.",
        requestId: response.headers.get("x-request-id") ?? "unknown",
      });
    }
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
