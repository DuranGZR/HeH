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
const SAFE_REQUEST_ID_STRIP_REGEX = /[^A-Za-z0-9_.-]/g;

let clientRequestSequence = 0;

/** Generate an HTTP-safe correlation ID (`<= 64` chars) compatible with backend `X-Request-ID`. */
export function createClientRequestId(prefix = "heh"): string {
  const safePrefix = prefix.replace(SAFE_REQUEST_ID_STRIP_REGEX, "") || "heh";
  clientRequestSequence = (clientRequestSequence + 1) % 1_000_000;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}-${ts}-${clientRequestSequence}-${rand}`.slice(0, 64);
}

/** Return true if `error` represents an intentional request cancellation (`AbortError`). */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { name?: unknown; code?: unknown };
  return maybeError.name === "AbortError" || maybeError.code === "ABORT_ERR";
}

function createAbortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

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

/** Shared transport abstraction satisfied by both live `HehApiClient` and offline mock fixtures. */
export interface SearchApiTransport {
  parseSearch(payload: SearchParseRequest, signal?: AbortSignal): Promise<SearchParseResponse>;
  resolveSearch(
    payload: SearchResolveRequest,
    signal?: AbortSignal,
  ): Promise<SearchResolveResponse>;
  getCapabilities?(signal?: AbortSignal): Promise<ProviderCapabilitiesResponse>;
  getHealthReady?(signal?: AbortSignal): Promise<ReadinessResponse>;
}

export interface HehApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

/**
 * Typed HTTP client generated directly from FastAPI OpenAPI contracts.
 * Mobile performs zero local URL construction or NLP rule evaluation.
 */
export class HehApiClient implements SearchApiTransport {
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

  public async getHealthReady(signal?: AbortSignal): Promise<ReadinessResponse> {
    return this.requestJson<ReadinessResponse>("/api/v1/health/ready", {
      method: "GET",
      signal,
      requestPrefix: "ready",
      acceptDegraded503: true,
    });
  }

  public getCapabilities(signal?: AbortSignal): Promise<ProviderCapabilitiesResponse> {
    return this.requestJson<ProviderCapabilitiesResponse>("/api/v1/search/capabilities", {
      method: "GET",
      signal,
      requestPrefix: "caps",
    });
  }

  public parseSearch(
    payload: SearchParseRequest,
    signal?: AbortSignal,
  ): Promise<SearchParseResponse> {
    const requestId = payload.client_request_id?.trim() || createClientRequestId("parse");
    const enrichedPayload: SearchParseRequest = {
      ...payload,
      client_request_id: requestId,
    };
    return this.requestJson<SearchParseResponse>("/api/v1/search/parse", {
      method: "POST",
      body: JSON.stringify(enrichedPayload),
      signal,
      requestId,
    });
  }

  public resolveSearch(
    payload: SearchResolveRequest,
    signal?: AbortSignal,
  ): Promise<SearchResolveResponse> {
    const requestId = payload.client_request_id?.trim() || createClientRequestId("resolve");
    const enrichedPayload: SearchResolveRequest = {
      ...payload,
      client_request_id: requestId,
    };
    return this.requestJson<SearchResolveResponse>("/api/v1/search/resolve", {
      method: "POST",
      body: JSON.stringify(enrichedPayload),
      signal,
      requestId,
    });
  }

  private async requestJson<TResponse>(
    path: string,
    init: {
      method: "GET" | "POST";
      body?: string;
      signal?: AbortSignal;
      requestId?: string;
      requestPrefix?: string;
      acceptDegraded503?: boolean;
    },
  ): Promise<TResponse> {
    if (init.signal?.aborted) {
      throw createAbortError();
    }

    const requestId = init.requestId ?? createClientRequestId(init.requestPrefix ?? "req");
    // Always abort underlying fetch on timeout while forwarding external signal cancellation.
    const requestController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let externalAbortListener: (() => void) | null = null;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        requestController.abort();
        reject(
          new HehApiError({
            status: 408,
            code: "REQUEST_TIMEOUT",
            message: "İstek zaman aşımına uğradı. Tekrar dene.",
            requestId,
          }),
        );
      }, this.timeoutMs);
      const handle = timer as unknown as { unref?: () => void };
      handle.unref?.();

      if (init.signal) {
        externalAbortListener = () => {
          requestController.abort();
          reject(createAbortError());
        };
        init.signal.addEventListener("abort", externalAbortListener, { once: true });
      }
    });

    let response: Response;
    try {
      const fetchPromise = this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Accept: "application/json",
          "X-Request-ID": requestId,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body,
        signal: requestController.signal,
      });
      // Prevent late unhandled rejections if abort/timeout settles Promise.race first.
      fetchPromise.catch(() => undefined);
      response = await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (externalAbortListener && init.signal) {
        init.signal.removeEventListener("abort", externalAbortListener);
      }
    }

    if (!response.ok) {
      if (init.acceptDegraded503 && response.status === 503) {
        try {
          const parsed = (await response.json()) as Partial<ReadinessResponse>;
          if (
            parsed &&
            typeof parsed.status === "string" &&
            typeof parsed.mapping_snapshot === "string"
          ) {
            return parsed as TResponse;
          }
        } catch {
          // Fall through to standard error handling if body isn't ReadinessResponse JSON
        }
      }
      throw await this.buildApiError(response, requestId);
    }

    try {
      return (await response.json()) as TResponse;
    } catch {
      throw new HehApiError({
        status: response.status,
        code: "INVALID_JSON_RESPONSE",
        message: "Sunucudan geçersiz yanıt alındı.",
        requestId: response.headers.get("x-request-id") ?? requestId,
      });
    }
  }

  private async buildApiError(response: Response, fallbackRequestId: string): Promise<HehApiError> {
    const headerRequestId = response.headers.get("x-request-id") ?? fallbackRequestId;
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
