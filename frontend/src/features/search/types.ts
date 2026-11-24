/** Shared D07 UI state types and input validation helpers (zero NLP/URL logic). */

export type HomeInputMode = "voice" | "text";

export type OverflowMenuItemId = "history" | "account" | "settings" | "privacy";

export interface OverflowMenuItem {
  readonly id: OverflowMenuItemId;
  readonly label: string;
  readonly subtitle: string;
  readonly accessibilityHint: string;
}

export const MAX_SEARCH_QUERY_LENGTH = 500 as const;

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

/** Normalize surrounding whitespace and reject empty or over-limit search input. */
export function canSubmitSearchQuery(rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SEARCH_QUERY_LENGTH;
}
