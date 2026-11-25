/** Shared UI state types, Turkish prompt examples, and input validation helpers. */

export type HomeInputMode = "voice" | "text";

export type OverflowMenuItemId = "history" | "account" | "settings" | "privacy";

export interface OverflowMenuItem {
  readonly id: OverflowMenuItemId;
  readonly label: string;
  readonly subtitle: string;
  readonly accessibilityHint: string;
}

export const MAX_SEARCH_QUERY_LENGTH = 500 as const;

export const EXAMPLE_SEARCH_PROMPTS: readonly string[] = [
  "3000 altı siyah M erkek mont",
  "Sony veya JBL bluetooth kulaklık",
  "2000 üstü 42 numara spor ayakkabı",
  "Nike olmasın beyaz koşu ayakkabısı",
] as const;

export type SearchQueryValidationReason = "empty" | "control_chars" | "too_long";

export interface SearchQueryValidationResult {
  readonly valid: boolean;
  readonly reason: SearchQueryValidationReason | null;
  readonly errorMessage: string | null;
}

function containsDisallowedControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      return true;
    }
  }
  return false;
}

const ZERO_WIDTH_REGEX = /[\u200b-\u200f\u2060\ufeff]/g;

/** Validate query bounds, blank whitespace, and control-character hygiene cleanly client-side. */
export function validateSearchQuery(rawQuery: string): SearchQueryValidationResult {
  if (containsDisallowedControlChar(rawQuery)) {
    return {
      valid: false,
      reason: "control_chars",
      errorMessage: "Geçersiz karakter içeriyor; lütfen metni düzenle.",
    };
  }
  const trimmed = rawQuery.replace(ZERO_WIDTH_REGEX, "").trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      reason: "empty",
      errorMessage: "Aramak için en az bir ürün veya ölçüt yaz.",
    };
  }
  if (trimmed.length > MAX_SEARCH_QUERY_LENGTH) {
    return {
      valid: false,
      reason: "too_long",
      errorMessage: "En fazla 500 karakter yazabilirsin.",
    };
  }
  return {
    valid: true,
    reason: null,
    errorMessage: null,
  };
}

export const OVERFLOW_MENU_ITEMS: readonly OverflowMenuItem[] = [
  {
    id: "history",
    label: "Arama Geçmişi",
    subtitle: "Cihazdaki son aramalar (W5)",
    accessibilityHint: "Yerel arama geçmişi hakkında bilgi gösterir",
  },
  {
    id: "account",
    label: "Hesap (İsteğe bağlı)",
    subtitle: "Geçmiş eşitleme — misafir kullanım açık",
    accessibilityHint: "İsteğe bağlı hesap eşitleme bilgisini gösterir",
  },
  {
    id: "settings",
    label: "Ayarlar",
    subtitle: "Tema ve mikrofon izin tercihleri",
    accessibilityHint: "Tema ve gizlilik ayarları bilgisini gösterir",
  },
  {
    id: "privacy",
    label: "Hakkında ve Gizlilik",
    subtitle: "Bağımsız arama bağlantısı aracı — Trendyol ortağı değil",
    accessibilityHint: "Gizlilik ve bağımsızlık beyanını gösterir",
  },
] as const;

/** Normalize surrounding whitespace and reject empty, control-char, or over-limit search input. */
export function canSubmitSearchQuery(rawQuery: string): boolean {
  return validateSearchQuery(rawQuery).valid;
}
