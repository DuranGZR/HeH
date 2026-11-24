/** Monochrome design tokens, dark/light palettes, and WCAG 2.1 contrast helpers for heh. */

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedThemeScheme = "light" | "dark";
export type CriterionVisualStatus = "applied" | "query_only" | "unsupported";

export interface ThemeColorPalette {
  readonly background: string;
  readonly surfaceElevated: string;
  readonly surfaceMuted: string;
  readonly surfacePressed: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly textDisabled: string;
  readonly borderSubtle: string;
  readonly borderControl: string;
  readonly borderFocus: string;
  readonly ctaBackground: string;
  readonly ctaPressed: string;
  readonly ctaText: string;
  readonly ctaDisabledBackground: string;
  readonly ctaDisabledText: string;
  readonly iconPrimary: string;
  readonly iconSecondary: string;
  readonly iconOnInverse: string;
}

export interface StatusBadgePalette {
  readonly label: string;
  readonly background: string;
  readonly text: string;
  readonly border: string;
  readonly borderStyle: "solid" | "dashed";
  readonly iconColor: string;
}

/** Light-mode monochrome palette (WCAG 2.1 AA+ verified against #FFFFFF & #F2F2F2). */
export const LIGHT_PALETTE: ThemeColorPalette = {
  background: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#F2F2F2",
  surfacePressed: "#E5E5E5",
  textPrimary: "#000000",
  textSecondary: "#525252",
  textMuted: "#595959",
  textDisabled: "#666666",
  borderSubtle: "#D4D4D4",
  borderControl: "#6E6E6E",
  borderFocus: "#000000",
  ctaBackground: "#000000",
  ctaPressed: "#262626",
  ctaText: "#FFFFFF",
  ctaDisabledBackground: "#E5E5E5",
  ctaDisabledText: "#525252",
  iconPrimary: "#000000",
  iconSecondary: "#525252",
  iconOnInverse: "#FFFFFF",
} as const;

/** Dark-mode monochrome palette (true black base + high-contrast grays). */
export const DARK_PALETTE: ThemeColorPalette = {
  background: "#000000",
  surfaceElevated: "#141414",
  surfaceMuted: "#1F1F1F",
  surfacePressed: "#2E2E2E",
  textPrimary: "#FFFFFF",
  textSecondary: "#B8B8B8",
  textMuted: "#A3A3A3",
  textDisabled: "#8F8F8F",
  borderSubtle: "#2E2E2E",
  borderControl: "#8C8C8C",
  borderFocus: "#FFFFFF",
  ctaBackground: "#FFFFFF",
  ctaPressed: "#D4D4D4",
  ctaText: "#000000",
  ctaDisabledBackground: "#262626",
  ctaDisabledText: "#A3A3A3",
  iconPrimary: "#FFFFFF",
  iconSecondary: "#B8B8B8",
  iconOnInverse: "#000000",
} as const;

export const THEME_PALETTES: Readonly<Record<ResolvedThemeScheme, ThemeColorPalette>> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
} as const;

/**
 * Monochrome non-color-only criterion status styles.
 * Each status has distinct fill/border geometry alongside paired icon + Turkish text.
 */
export const STATUS_BADGE_TOKENS: Readonly<
  Record<ResolvedThemeScheme, Readonly<Record<CriterionVisualStatus, StatusBadgePalette>>>
> = {
  light: {
    applied: {
      label: "Filtre uygulandı",
      background: LIGHT_PALETTE.ctaBackground,
      text: LIGHT_PALETTE.ctaText,
      border: LIGHT_PALETTE.ctaBackground,
      borderStyle: "solid",
      iconColor: LIGHT_PALETTE.iconOnInverse,
    },
    query_only: {
      label: "Arama metninde",
      background: LIGHT_PALETTE.surfaceMuted,
      text: LIGHT_PALETTE.textPrimary,
      border: LIGHT_PALETTE.borderControl,
      borderStyle: "solid",
      iconColor: LIGHT_PALETTE.iconPrimary,
    },
    unsupported: {
      label: "Uygulanamadı",
      background: LIGHT_PALETTE.background,
      text: LIGHT_PALETTE.textSecondary,
      border: LIGHT_PALETTE.borderControl,
      borderStyle: "dashed",
      iconColor: LIGHT_PALETTE.iconSecondary,
    },
  },
  dark: {
    applied: {
      label: "Filtre uygulandı",
      background: DARK_PALETTE.ctaBackground,
      text: DARK_PALETTE.ctaText,
      border: DARK_PALETTE.ctaBackground,
      borderStyle: "solid",
      iconColor: DARK_PALETTE.iconOnInverse,
    },
    query_only: {
      label: "Arama metninde",
      background: DARK_PALETTE.surfaceMuted,
      text: DARK_PALETTE.textPrimary,
      border: DARK_PALETTE.borderControl,
      borderStyle: "solid",
      iconColor: DARK_PALETTE.iconPrimary,
    },
    unsupported: {
      label: "Uygulanamadı",
      background: DARK_PALETTE.background,
      text: DARK_PALETTE.textSecondary,
      border: DARK_PALETTE.borderControl,
      borderStyle: "dashed",
      iconColor: DARK_PALETTE.iconSecondary,
    },
  },
} as const;

/** Static light-mode constants kept for non-React contexts (e.g. widget config). */
export const COLORS = {
  black: LIGHT_PALETTE.textPrimary,
  white: LIGHT_PALETTE.background,
  surfaceMuted: LIGHT_PALETTE.surfaceMuted,
  textSecondary: LIGHT_PALETTE.textSecondary,
  borderSubtle: LIGHT_PALETTE.borderSubtle,
  borderControl: LIGHT_PALETTE.borderControl,
} as const;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function toLinearChannel(channel255: number): number {
  const normalized = channel255 / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Compute WCAG 2.1 relative luminance for a `#RRGGBB` color string. */
export function hexToRelativeLuminance(hex: string): number {
  if (!HEX_COLOR_PATTERN.test(hex)) {
    throw new Error(`Expected #RRGGBB hex color, received '${hex}'`);
  }
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);

  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
}

/** Compute WCAG 2.1 contrast ratio (`1..21`) between two `#RRGGBB` colors. */
export function getContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const lumA = hexToRelativeLuminance(foregroundHex);
  const lumB = hexToRelativeLuminance(backgroundHex);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check WCAG 2.1 AA text threshold (`>= 4.5` normal text, `>= 3.0` large text). */
export function meetsWcagAA(
  foregroundHex: string,
  backgroundHex: string,
  largeText = false,
): boolean {
  const threshold = largeText ? 3.0 : 4.5;
  return getContrastRatio(foregroundHex, backgroundHex) >= threshold;
}

/** Check WCAG 2.1 Non-Text Contrast threshold (`>= 3.0` for UI borders & controls). */
export function meetsWcagNonText(foregroundHex: string, backgroundHex: string): boolean {
  return getContrastRatio(foregroundHex, backgroundHex) >= 3.0;
}
