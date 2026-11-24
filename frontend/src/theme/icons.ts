import type { CriterionVisualStatus } from "./colors";

/** Minimalist 1.5px stroke monochrome icon grammar matching the HEH visual reference. */
export const ICON_STROKE_WIDTH = 1.5 as const;

export const ICON_SIZES = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
  hero: 32,
} as const;

export type HehIconName =
  | "mic"
  | "keyboard"
  | "waveform"
  | "stop"
  | "tune"
  | "more"
  | "back"
  | "close"
  | "check"
  | "search"
  | "alert"
  | "external"
  | "history"
  | "settings"
  | "globe"
  | "moon"
  | "trash"
  | "bag";

export interface IconAccessibilitySpec {
  readonly name: HehIconName;
  readonly strokeWidth: typeof ICON_STROKE_WIDTH;
  readonly glyphFallback: string;
  readonly accessibilityLabel: string;
}

export const ICON_SPECS: Readonly<Record<HehIconName, IconAccessibilitySpec>> = {
  mic: {
    name: "mic",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "🎙",
    accessibilityLabel: "Mikrofon",
  },
  keyboard: {
    name: "keyboard",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "⌨",
    accessibilityLabel: "Klavye",
  },
  waveform: {
    name: "waveform",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "∿",
    accessibilityLabel: "Ses dalgası",
  },
  stop: {
    name: "stop",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "■",
    accessibilityLabel: "Durdur",
  },
  tune: {
    name: "tune",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "⊶",
    accessibilityLabel: "Filtreler",
  },
  more: {
    name: "more",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "⋯",
    accessibilityLabel: "Diğer seçenekler",
  },
  back: {
    name: "back",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "‹",
    accessibilityLabel: "Geri",
  },
  close: {
    name: "close",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "×",
    accessibilityLabel: "Kapat",
  },
  check: {
    name: "check",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "✓",
    accessibilityLabel: "Uygulandı",
  },
  search: {
    name: "search",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "⌕",
    accessibilityLabel: "Arama metninde",
  },
  alert: {
    name: "alert",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "⊘",
    accessibilityLabel: "Uygulanamadı",
  },
  external: {
    name: "external",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "↗",
    accessibilityLabel: "Dış bağlantıyı aç",
  },
  history: {
    name: "history",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "◷",
    accessibilityLabel: "Arama geçmişi",
  },
  settings: {
    name: "settings",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "⚙",
    accessibilityLabel: "Ayarlar",
  },
  globe: {
    name: "globe",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "🌐",
    accessibilityLabel: "Dil",
  },
  moon: {
    name: "moon",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "☾",
    accessibilityLabel: "Tema",
  },
  trash: {
    name: "trash",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "🗑",
    accessibilityLabel: "Temizle",
  },
  bag: {
    name: "bag",
    strokeWidth: ICON_STROKE_WIDTH,
    glyphFallback: "🛍",
    accessibilityLabel: "heh. alışveriş",
  },
} as const;

/**
 * Mandatory non-color-only icon pairing for each backend verification status.
 * Ensures screen readers and color-blind users distinguish every criterion state.
 */
export const STATUS_ICON_SPECS: Readonly<Record<CriterionVisualStatus, IconAccessibilitySpec>> = {
  applied: ICON_SPECS.check,
  query_only: ICON_SPECS.search,
  unsupported: ICON_SPECS.alert,
} as const;
