import { Platform, type TextStyle } from "react-native";

/**
 * Platform-native system typography for HEH.
 * Unlicensed custom font binaries are never bundled without license clearance.
 */
export const FONT_FAMILIES = {
  sans: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "System",
  }),
  sansMedium: Platform.select({
    ios: "System",
    android: "sans-serif-medium",
    default: "System",
  }),
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }),
} as const;

/** Dynamic Type max multiplier caps so large OS fonts stay legible without overflow. */
export const MAX_FONT_SCALE = {
  display: 1.3,
  heading: 1.4,
  body: 1.6,
  control: 1.35,
} as const;

export interface TypographyToken extends Pick<
  TextStyle,
  "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing"
> {
  readonly maxFontSizeMultiplier: number;
}

export type TypographyScaleKey =
  | "wordmarkHero"
  | "wordmarkCompact"
  | "heroTitle"
  | "screenTitle"
  | "sectionTitle"
  | "body"
  | "bodyMedium"
  | "caption"
  | "button"
  | "chip"
  | "badge";

export const TYPOGRAPHY: Readonly<Record<TypographyScaleKey, TypographyToken>> = {
  wordmarkHero: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 40,
    fontWeight: "600",
    lineHeight: 48,
    letterSpacing: -1,
    maxFontSizeMultiplier: MAX_FONT_SCALE.display,
  },
  wordmarkCompact: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 28,
    fontWeight: "600",
    lineHeight: 34,
    letterSpacing: -0.5,
    maxFontSizeMultiplier: MAX_FONT_SCALE.display,
  },
  heroTitle: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 28,
    letterSpacing: -0.3,
    maxFontSizeMultiplier: MAX_FONT_SCALE.heading,
  },
  screenTitle: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 24,
    letterSpacing: -0.2,
    maxFontSizeMultiplier: MAX_FONT_SCALE.heading,
  },
  sectionTitle: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
    letterSpacing: -0.1,
    maxFontSizeMultiplier: MAX_FONT_SCALE.heading,
  },
  body: {
    fontFamily: FONT_FAMILIES.sans,
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 22,
    letterSpacing: 0,
    maxFontSizeMultiplier: MAX_FONT_SCALE.body,
  },
  bodyMedium: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
    letterSpacing: 0,
    maxFontSizeMultiplier: MAX_FONT_SCALE.body,
  },
  caption: {
    fontFamily: FONT_FAMILIES.sans,
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 18,
    letterSpacing: 0,
    maxFontSizeMultiplier: MAX_FONT_SCALE.body,
  },
  button: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    letterSpacing: 0,
    maxFontSizeMultiplier: MAX_FONT_SCALE.control,
  },
  chip: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 18,
    letterSpacing: 0,
    maxFontSizeMultiplier: MAX_FONT_SCALE.control,
  },
  badge: {
    fontFamily: FONT_FAMILIES.sansMedium,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    letterSpacing: 0.1,
    maxFontSizeMultiplier: MAX_FONT_SCALE.control,
  },
} as const;
