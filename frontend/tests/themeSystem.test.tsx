import { render, screen, act } from "@testing-library/react-native";
import { AccessibilityInfo, Text } from "react-native";

import {
  DARK_PALETTE,
  HehThemeProvider,
  ICON_SPECS,
  ICON_STROKE_WIDTH,
  LIGHT_PALETTE,
  STATUS_BADGE_TOKENS,
  STATUS_ICON_SPECS,
  THEME_PALETTES,
  TYPOGRAPHY,
  getContrastRatio,
  getResponsiveLayoutMetrics,
  meetsWcagAA,
  meetsWcagNonText,
  resolveMotionSpec,
  resolveThemeScheme,
  useHehTheme,
  type ThemeColorPalette,
} from "../src/theme";

function assertPaletteContrast(palette: ThemeColorPalette): void {
  // Primary text on all backgrounds
  expect(meetsWcagAA(palette.textPrimary, palette.background)).toBe(true);
  expect(meetsWcagAA(palette.textPrimary, palette.surfaceElevated)).toBe(true);
  expect(meetsWcagAA(palette.textPrimary, palette.surfaceMuted)).toBe(true);

  // Secondary and muted body text on main and muted surfaces
  expect(meetsWcagAA(palette.textSecondary, palette.background)).toBe(true);
  expect(meetsWcagAA(palette.textSecondary, palette.surfaceElevated)).toBe(true);
  expect(meetsWcagAA(palette.textSecondary, palette.surfaceMuted)).toBe(true);
  expect(meetsWcagAA(palette.textMuted, palette.background)).toBe(true);
  expect(meetsWcagAA(palette.textMuted, palette.surfaceMuted)).toBe(true);

  // CTA foreground/background pairs
  expect(meetsWcagAA(palette.ctaText, palette.ctaBackground)).toBe(true);
  expect(meetsWcagAA(palette.ctaText, palette.ctaPressed)).toBe(true);
  expect(meetsWcagAA(palette.ctaDisabledText, palette.ctaDisabledBackground)).toBe(true);

  // Interactive border non-text WCAG 1.4.11 >= 3.0:1
  expect(meetsWcagNonText(palette.borderControl, palette.background)).toBe(true);
  expect(meetsWcagNonText(palette.borderControl, palette.surfaceMuted)).toBe(true);
  expect(meetsWcagNonText(palette.borderFocus, palette.background)).toBe(true);
}

describe("HEH Monochrome Design System (D06)", () => {
  it("satisfies WCAG 2.1 AA text and non-text contrast baselines in light and dark modes", () => {
    expect(getContrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    assertPaletteContrast(LIGHT_PALETTE);
    assertPaletteContrast(DARK_PALETTE);
  });

  it("pairs criterion statuses with non-color visual geometry, icons, labels, and AA contrast", () => {
    for (const scheme of ["light", "dark"] as const) {
      const tokens = STATUS_BADGE_TOKENS[scheme];

      expect(tokens.applied.label).toBe("Filtre uygulandı");
      expect(tokens.query_only.label).toBe("Arama metninde");
      expect(tokens.unsupported.label).toBe("Uygulanamadı");

      // Distinct border style separates unsupported from applied/query_only even in grayscale
      expect(tokens.unsupported.borderStyle).toBe("dashed");
      expect(tokens.applied.borderStyle).toBe("solid");

      for (const status of ["applied", "query_only", "unsupported"] as const) {
        const badge = tokens[status];
        const outerCanvas = THEME_PALETTES[scheme].background;
        expect(meetsWcagAA(badge.text, badge.background)).toBe(true);
        expect(meetsWcagNonText(badge.border, outerCanvas)).toBe(true);
        if (badge.background !== badge.border) {
          expect(meetsWcagNonText(badge.border, badge.background)).toBe(true);
        }
        expect(STATUS_ICON_SPECS[status].glyphFallback.length).toBeGreaterThan(0);
        expect(STATUS_ICON_SPECS[status].accessibilityLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("computes responsive layout metrics for small iPhone SE and large Android phones", () => {
    const iphoneSe = getResponsiveLayoutMetrics(320, 568);
    expect(iphoneSe.tier).toBe("compact");
    expect(iphoneSe.isShortHeight).toBe(true);
    expect(iphoneSe.horizontalPadding).toBe(20);
    expect(iphoneSe.heroMicSize).toBe(72);
    expect(iphoneSe.minButtonHeight).toBe(48);

    const compactAndroid = getResponsiveLayoutMetrics(360, 640);
    expect(compactAndroid.tier).toBe("compact");
    expect(compactAndroid.horizontalPadding).toBe(20);

    const standardPhone = getResponsiveLayoutMetrics(390, 844);
    expect(standardPhone.tier).toBe("regular");
    expect(standardPhone.horizontalPadding).toBe(24);
    expect(standardPhone.heroMicSize).toBe(88);

    const tablet = getResponsiveLayoutMetrics(768, 1024);
    expect(tablet.tier).toBe("expanded");
    expect(tablet.maxContentWidth).toBe(480);

    const invalidFallback = getResponsiveLayoutMetrics(0, -100);
    expect(invalidFallback.width).toBe(390);
    expect(invalidFallback.height).toBe(844);
  });

  it("enforces Reduce Motion durations and 1.5px icon grammar with Dynamic Type caps", () => {
    const standardMotion = resolveMotionSpec(false);
    expect(standardMotion.reducedMotion).toBe(false);
    expect(standardMotion.fastMs).toBeGreaterThan(0);
    expect(standardMotion.allowLoopingPulse).toBe(true);

    const reducedMotion = resolveMotionSpec(true);
    expect(reducedMotion.reducedMotion).toBe(true);
    expect(reducedMotion.fastMs).toBe(0);
    expect(reducedMotion.normalMs).toBe(0);
    expect(reducedMotion.pulseMs).toBe(0);
    expect(reducedMotion.allowScaleTransforms).toBe(false);
    expect(reducedMotion.allowLoopingPulse).toBe(false);

    expect(ICON_STROKE_WIDTH).toBe(1.5);
    expect(ICON_SPECS.mic.strokeWidth).toBe(1.5);
    expect(TYPOGRAPHY.wordmarkHero.maxFontSizeMultiplier).toBeLessThanOrEqual(1.4);
    expect(TYPOGRAPHY.body.maxFontSizeMultiplier).toBeGreaterThanOrEqual(1.5);
  });

  it("resolves theme scheme and tracks OS reduceMotionChanged events in HehThemeProvider", async () => {
    expect(resolveThemeScheme("system", "dark")).toBe("dark");
    expect(resolveThemeScheme("system", null)).toBe("light");
    expect(resolveThemeScheme("light", "dark")).toBe("light");
    expect(resolveThemeScheme("dark", "light")).toBe("dark");

    let motionListener: ((enabled: boolean) => void) | null = null;
    const removeMock = jest.fn();

    const isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    const addListenerSpy = jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation((_eventName, handler) => {
        motionListener = handler as (enabled: boolean) => void;
        return { remove: removeMock } as ReturnType<typeof AccessibilityInfo.addEventListener>;
      });

    function Probe() {
      const { scheme, palette, motion } = useHehTheme();
      return (
        <Text testID="theme-probe">
          {`${scheme}:${palette.background}:${motion.reducedMotion ? "reduced" : "normal"}`}
        </Text>
      );
    }

    const { unmount } = await render(
      <HehThemeProvider initialMode="dark">
        <Probe />
      </HehThemeProvider>,
    );

    expect(screen.getByTestId("theme-probe").props.children).toBe("dark:#000000:normal");

    await act(async () => {
      motionListener?.(true);
    });

    expect(screen.getByTestId("theme-probe").props.children).toBe("dark:#000000:reduced");

    await unmount();
    expect(removeMock).toHaveBeenCalledTimes(1);

    isReduceMotionSpy.mockRestore();
    addListenerSpy.mockRestore();
  });
});
