import { Linking } from "react-native";

const ALLOWED_EXTERNAL_HOSTS = new Set(["www.trendyol.com"]);
const ALLOWED_TRENDYOL_QUERY_PARAMS = new Set([
  "q",
  "wc",
  "wg",
  "wb",
  "wcl",
  "vr",
  "prc",
  "pi",
  "sst",
]);
const VERIFIED_FACET_PATH_REGEX = /^\/[a-z0-9-]+-x-(?:b\d+-c\d+|r\d+-g\d+-c\d+)$/;
const ENCODED_CONTROL_CHAR_REGEX = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const MAX_EXTERNAL_URL_LENGTH = 2048;

function hasForbiddenControlOrSpace(rawUrl: string): boolean {
  if (/\s/.test(rawUrl) || ENCODED_CONTROL_CHAR_REGEX.test(rawUrl)) {
    return true;
  }
  for (let i = 0; i < rawUrl.length; i += 1) {
    const code = rawUrl.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * Enforce HTTPS, allowlisted host, credential/port/fragment/control-char safety,
 * route allowlist (`/sr` or verified `-x-` SEO path), and query parameter allowlisting.
 */
export function validateExternalProviderUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.length > MAX_EXTERNAL_URL_LENGTH || hasForbiddenControlOrSpace(rawUrl)) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "https:" ||
      !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase()) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }

    const pathname = parsed.pathname;
    const isCanonicalSearch = pathname === "/sr";
    const isVerifiedFacetPath = VERIFIED_FACET_PATH_REGEX.test(pathname);
    if (!isCanonicalSearch && !isVerifiedFacetPath) {
      return false;
    }

    for (const key of parsed.searchParams.keys()) {
      if (!ALLOWED_TRENDYOL_QUERY_PARAMS.has(key)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export interface SafeRedirectDeps {
  readonly canOpenUrl?: (url: string) => Promise<boolean>;
  readonly openPrimaryUrl?: (url: string) => Promise<void>;
  readonly openFallbackUrl?: (url: string) => Promise<void>;
}

export interface ExternalRedirectResult {
  readonly opened: boolean;
  readonly target: "primary" | "fallback_browser" | "blocked" | "failed";
  readonly url: string;
  readonly errorMessage?: string;
}

/**
 * Safely launch a validated Trendyol URL via universal/deep link handler first,
 * falling back cleanly to HTTPS browser opening if deep-link handling is unavailable.
 */
export async function launchSafeProviderRedirect(
  rawUrl: string,
  deps?: SafeRedirectDeps,
): Promise<ExternalRedirectResult> {
  if (!validateExternalProviderUrl(rawUrl)) {
    return {
      opened: false,
      target: "blocked",
      url: rawUrl,
      errorMessage: "Güvenli Trendyol bağlantısı doğrulanamadı.",
    };
  }

  const canOpen = deps?.canOpenUrl ?? ((url: string) => Linking.canOpenURL(url));
  const openPrimary = deps?.openPrimaryUrl ?? ((url: string) => Linking.openURL(url));
  const openFallback = deps?.openFallbackUrl ?? ((url: string) => Linking.openURL(url));

  try {
    const supported = await canOpen(rawUrl);
    if (supported) {
      await openPrimary(rawUrl);
      return {
        opened: true,
        target: "primary",
        url: rawUrl,
      };
    }
  } catch {
    // Fall through cleanly to HTTPS browser fallback below.
  }

  try {
    await openFallback(rawUrl);
    return {
      opened: true,
      target: "fallback_browser",
      url: rawUrl,
    };
  } catch {
    return {
      opened: false,
      target: "failed",
      url: rawUrl,
      errorMessage: "Bağlantı açılamadı.",
    };
  }
}
