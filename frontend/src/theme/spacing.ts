/** 8px monochrome spacing grid, corner radii, touch targets, and responsive breakpoints. */

export const GRID_UNIT = 8 as const;

export const SPACING = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  hero: 64,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 9999,
} as const;

export const BORDER_WIDTH = {
  hairline: 1,
  control: 1.5,
  focus: 2,
} as const;

/** Accessible hit-target sizes satisfying iOS (44dp) & Android Material (48dp). */
export const TOUCH_TARGET = {
  iosMinimum: 44,
  minimum: 48,
  compactMic: 72,
  regularMic: 88,
} as const;

export const HIT_SLOP_DEFAULT = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8,
} as const;

export type ViewportTier = "compact" | "regular" | "expanded";

export interface ResponsiveLayoutMetrics {
  readonly tier: ViewportTier;
  readonly width: number;
  readonly height: number;
  readonly isShortHeight: boolean;
  /** Screen horizontal edge margin strictly between 20dp (compact) and 24dp (regular+). */
  readonly horizontalPadding: 20 | 24;
  readonly verticalPadding: 16 | 24;
  readonly sectionGap: 12 | 16;
  readonly heroMicSize: 72 | 88;
  readonly minButtonHeight: 48;
  readonly maxContentWidth: number;
}

const COMPACT_WIDTH_MAX = 360;
const EXPANDED_WIDTH_MIN = 600;
const SHORT_HEIGHT_MAX = 667;
const MAX_READABLE_WIDTH = 480;

/**
 * Derive responsive layout metrics for small iPhone SE (`320x568`), standard phones (`390x844`),
 * and wider Android/tablet viewports without clipping or oversized margins.
 */
export function getResponsiveLayoutMetrics(width: number, height: number): ResponsiveLayoutMetrics {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 390;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 844;

  let tier: ViewportTier = "regular";
  if (safeWidth <= COMPACT_WIDTH_MAX) {
    tier = "compact";
  } else if (safeWidth >= EXPANDED_WIDTH_MIN) {
    tier = "expanded";
  }

  const isCompact = tier === "compact";
  const isShortHeight = safeHeight <= SHORT_HEIGHT_MAX;

  return {
    tier,
    width: safeWidth,
    height: safeHeight,
    isShortHeight,
    horizontalPadding: isCompact ? SPACING.lg : SPACING.xl,
    verticalPadding: isCompact || isShortHeight ? SPACING.md : SPACING.xl,
    sectionGap: isCompact || isShortHeight ? SPACING.sm : SPACING.md,
    heroMicSize: isCompact || isShortHeight ? TOUCH_TARGET.compactMic : TOUCH_TARGET.regularMic,
    minButtonHeight: TOUCH_TARGET.minimum,
    maxContentWidth: MAX_READABLE_WIDTH,
  };
}
