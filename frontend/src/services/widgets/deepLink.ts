export const WIDGET_SCHEME = "heh" as const;

export type SearchInputMode = "voice" | "text";

export type WidgetRouteTarget =
  | {
      destination: "search";
      mode: SearchInputMode;
      requiresPermissionCheck: boolean;
    }
  | {
      destination: "home";
      reason: "empty" | "invalid_scheme" | "unknown_route" | "invalid_mode";
    };

/** Build a safe allowlisted widget deep-link URI for launching HEH search. */
export function buildWidgetSearchUri(mode: SearchInputMode): string {
  return `${WIDGET_SCHEME}://search?mode=${mode}`;
}

/** Normalize an Expo Router `mode` query param safely without throwing. */
export function normalizeSearchModeParam(rawMode: string | string[] | undefined): SearchInputMode {
  const candidate = Array.isArray(rawMode) ? rawMode[0] : rawMode;
  return candidate === "voice" ? "voice" : "text";
}

/**
 * Parse and validate an inbound widget deep-link URI.
 * Rejects non-`heh` schemes, arbitrary routes, and unknown modes without throwing.
 */
export function parseWidgetDeepLink(rawUrl: string | null | undefined): WidgetRouteTarget {
  if (!rawUrl || !rawUrl.trim()) {
    return { destination: "home", reason: "empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { destination: "home", reason: "invalid_scheme" };
  }

  if (
    parsed.protocol.toLowerCase() !== `${WIDGET_SCHEME}:` ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== ""
  ) {
    return { destination: "home", reason: "invalid_scheme" };
  }

  const routeHost = parsed.hostname.toLowerCase();
  const routePath = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  const isSearchRoute =
    (routeHost === "search" && routePath === "") || (routeHost === "" && routePath === "search");

  if (!isSearchRoute) {
    return { destination: "home", reason: "unknown_route" };
  }

  const rawMode = parsed.searchParams.get("mode");
  if (rawMode !== "voice" && rawMode !== "text") {
    return { destination: "home", reason: "invalid_mode" };
  }

  return {
    destination: "search",
    mode: rawMode,
    requiresPermissionCheck: rawMode === "voice",
  };
}
