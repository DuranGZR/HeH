import { QueryClient } from "@tanstack/react-query";

import { HehApiError, isAbortError } from "./client";

/** Canonical TanStack Query key registry preventing accidental duplicate requests or cache collisions. */
export const hehQueryKeys = {
  all: ["heh"] as const,
  healthReady: () => ["heh", "health", "ready"] as const,
  capabilities: () => ["heh", "search", "capabilities"] as const,
  searchRoot: () => ["heh", "search"] as const,
  searchParseRoot: () => ["heh", "search", "parse"] as const,
  searchParse: (query: string, inputSource: "text" | "voice") =>
    ["heh", "search", "parse", inputSource, query] as const,
};

/**
 * Determine whether a transient query error is safe to retry once.
 * Aborted requests, 4xx validation/conflict errors, and malformed payloads are never retried.
 */
export function shouldRetryHehRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || isAbortError(error)) {
    return false;
  }
  if (error instanceof HehApiError) {
    if (error.status >= 400 && error.status < 500 && error.status !== 408) {
      return false;
    }
    if (error.code === "INVALID_JSON_RESPONSE") {
      return false;
    }
  }
  return true;
}

/** Create an isolated TanStack QueryClient tuned for mobile 1-RTT search interactions. */
export function createHehQueryClient(): QueryClient {
  const isTestEnv = typeof process !== "undefined" && process.env.NODE_ENV === "test";
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: isTestEnv ? 0 : 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: shouldRetryHehRequest,
      },
      mutations: {
        gcTime: isTestEnv ? 0 : 5 * 60_000,
        retry: false,
      },
    },
  });
}

let sharedQueryClient: QueryClient | null = null;

/** Return the process-wide TanStack QueryClient mounted in the root app layout. */
export function getSharedQueryClient(): QueryClient {
  if (!sharedQueryClient) {
    sharedQueryClient = createHehQueryClient();
  }
  return sharedQueryClient;
}
