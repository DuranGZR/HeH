import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from "react-native";

import {
  STATUS_BADGE_TOKENS,
  THEME_PALETTES,
  type CriterionVisualStatus,
  type ResolvedThemeScheme,
  type StatusBadgePalette,
  type ThemeColorPalette,
  type ThemeMode,
} from "./colors";
import { ICON_SIZES, ICON_SPECS, ICON_STROKE_WIDTH, STATUS_ICON_SPECS } from "./icons";
import { resolveMotionSpec, type ResolvedMotionSpec } from "./motion";
import {
  BORDER_WIDTH,
  HIT_SLOP_DEFAULT,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  getResponsiveLayoutMetrics,
  type ResponsiveLayoutMetrics,
} from "./spacing";
import { TYPOGRAPHY } from "./typography";

export interface HehThemeContextValue {
  readonly mode: ThemeMode;
  readonly scheme: ResolvedThemeScheme;
  readonly isDark: boolean;
  readonly palette: ThemeColorPalette;
  readonly statusTokens: Readonly<Record<CriterionVisualStatus, StatusBadgePalette>>;
  readonly statusIcons: typeof STATUS_ICON_SPECS;
  readonly typography: typeof TYPOGRAPHY;
  readonly spacing: typeof SPACING;
  readonly radius: typeof RADIUS;
  readonly borderWidth: typeof BORDER_WIDTH;
  readonly touchTarget: typeof TOUCH_TARGET;
  readonly hitSlop: typeof HIT_SLOP_DEFAULT;
  readonly layout: ResponsiveLayoutMetrics;
  readonly icons: {
    readonly specs: typeof ICON_SPECS;
    readonly sizes: typeof ICON_SIZES;
    readonly strokeWidth: typeof ICON_STROKE_WIDTH;
  };
  readonly motion: ResolvedMotionSpec;
  readonly reducedMotion: boolean;
  readonly setMode: (mode: ThemeMode) => void;
}

/** Resolve explicit `"light" | "dark"` scheme from user preference + OS scheme. */
export function resolveThemeScheme(
  mode: ThemeMode,
  osColorScheme: "light" | "dark" | null | undefined,
): ResolvedThemeScheme {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return osColorScheme === "dark" ? "dark" : "light";
}

function createThemeValue(
  mode: ThemeMode,
  scheme: ResolvedThemeScheme,
  width: number,
  height: number,
  reducedMotion: boolean,
  setMode: (nextMode: ThemeMode) => void,
): HehThemeContextValue {
  return {
    mode,
    scheme,
    isDark: scheme === "dark",
    palette: THEME_PALETTES[scheme],
    statusTokens: STATUS_BADGE_TOKENS[scheme],
    statusIcons: STATUS_ICON_SPECS,
    typography: TYPOGRAPHY,
    spacing: SPACING,
    radius: RADIUS,
    borderWidth: BORDER_WIDTH,
    touchTarget: TOUCH_TARGET,
    hitSlop: HIT_SLOP_DEFAULT,
    layout: getResponsiveLayoutMetrics(width, height),
    icons: {
      specs: ICON_SPECS,
      sizes: ICON_SIZES,
      strokeWidth: ICON_STROKE_WIDTH,
    },
    motion: resolveMotionSpec(reducedMotion),
    reducedMotion,
    setMode,
  };
}

const noopSetMode = (): void => {
  // No-op fallback when hook is read outside a mounted provider (e.g. isolated unit renders).
};

const DEFAULT_THEME_VALUE: HehThemeContextValue = createThemeValue(
  "system",
  "light",
  390,
  844,
  false,
  noopSetMode,
);

const HehThemeContext = createContext<HehThemeContextValue>(DEFAULT_THEME_VALUE);

export interface HehThemeProviderProps extends PropsWithChildren {
  readonly initialMode?: ThemeMode;
  readonly initialReduceMotion?: boolean;
}

/**
 * Provides reactive monochrome Light/Dark palettes, responsive breakpoints,
 * and OS Reduce Motion settings across all screens.
 */
export function HehThemeProvider({
  children,
  initialMode = "system",
  initialReduceMotion,
}: HehThemeProviderProps) {
  const osColorScheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [reducedMotion, setReducedMotion] = useState<boolean>(initialReduceMotion ?? false);

  useEffect(() => {
    if (initialReduceMotion !== undefined) {
      return undefined;
    }

    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) {
          setReducedMotion(enabled);
        }
      })
      .catch(() => {
        // Ignore platform query failure and preserve false baseline.
      });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (isMounted) {
        setReducedMotion(enabled);
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [initialReduceMotion]);

  const scheme = resolveThemeScheme(mode, osColorScheme);

  const value = useMemo(
    () => createThemeValue(mode, scheme, width, height, reducedMotion, setMode),
    [mode, scheme, width, height, reducedMotion],
  );

  return <HehThemeContext.Provider value={value}>{children}</HehThemeContext.Provider>;
}

/** Access current HEH monochrome design tokens, layout metrics, and motion settings. */
export function useHehTheme(): HehThemeContextValue {
  return useContext(HehThemeContext);
}
