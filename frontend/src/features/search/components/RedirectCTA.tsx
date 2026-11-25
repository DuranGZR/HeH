import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { LinkResolution } from "@/api";
import { useHehTheme } from "@/theme";

export interface RedirectCTAProps {
  readonly resolution: LinkResolution;
  readonly ctaLabel: string;
  readonly disabled: boolean;
  readonly isBusy: boolean;
  readonly isOpeningExternal?: boolean;
  readonly externalOpenError: string | null;
  readonly onPressOpenExternal: () => void;
}

/**
 * Build honest monochrome bucket summary metadata without ever emitting fake
 * "Filtre uygulandı" labels for `WEB_VERIFIED_PENDING_MOBILE` filters.
 */
export function buildRedirectBreakdown(resolution: LinkResolution): {
  readonly appliedLabel: string;
  readonly queryOnlyLabel: string;
  readonly unsupportedLabel: string;
  readonly hasPartialWarning: boolean;
  readonly unsupportedNames: readonly string[];
  readonly queryOnlyNames: readonly string[];
} {
  const applied = resolution.applied_filters ?? [];
  const queryOnly = resolution.query_only ?? [];
  const unsupported = resolution.unsupported ?? [];

  const dualVerifiedCount = applied.filter((item) => item.status === "FILTER_VERIFIED").length;
  const appliedLabel =
    applied.length === 0
      ? "Filtre: 0"
      : dualVerifiedCount === applied.length
        ? `Filtre uygulandı: ${dualVerifiedCount}`
        : `Web doğrulandı: ${applied.length}`;

  const queryOnlyLabel = `Metinde: ${queryOnly.length}`;
  const unsupportedLabel = `Uygulanamadı: ${unsupported.length}`;

  return {
    appliedLabel,
    queryOnlyLabel,
    unsupportedLabel,
    hasPartialWarning:
      resolution.warning_level === "partial" ||
      resolution.warning_level === "critical" ||
      unsupported.length > 0 ||
      queryOnly.length > 0,
    unsupportedNames: unsupported.map((item) => item.label),
    queryOnlyNames: queryOnly.map((item) => item.label),
  };
}

/**
 * Monochrome RedirectCTA (`D24` / explicit user handoff & partial-search honesty footer).
 * Displays Applied/Query-only/Unsupported separation, explicit destination preview,
 * partial-search disclosure, double-tap busy protection, and fallback link copy box.
 */
export function RedirectCTA({
  resolution,
  ctaLabel,
  disabled,
  isBusy,
  isOpeningExternal = false,
  externalOpenError,
  onPressOpenExternal,
}: RedirectCTAProps) {
  const {
    palette,
    statusTokens,
    typography,
    spacing,
    radius,
    borderWidth,
    touchTarget,
    icons,
    hitSlop,
  } = useHehTheme();

  const breakdown = buildRedirectBreakdown(resolution);
  const appliedToken =
    (resolution.applied_filters ?? []).length > 0 &&
    (resolution.applied_filters ?? []).every((i) => i.status === "FILTER_VERIFIED")
      ? statusTokens.applied
      : statusTokens.query_only;
  const queryToken = statusTokens.query_only;
  const unsupportedToken = statusTokens.unsupported;

  const ctaDisabled = disabled || isBusy || isOpeningExternal;

  return (
    <View style={[styles.container, { gap: spacing.xs }]} testID="redirect-cta-section">
      {/* Applied / Query-only / Unsupported monochrome status breakdown */}
      <View style={[styles.breakdownRow, { gap: spacing.xs }]} testID="redirect-status-breakdown">
        <View
          style={[
            styles.breakdownPill,
            {
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderStyle: appliedToken.borderStyle,
              borderColor: appliedToken.border,
              backgroundColor: appliedToken.background,
              paddingHorizontal: spacing.xs,
              paddingVertical: spacing.xxs,
            },
          ]}
          testID="redirect-pill-applied"
        >
          <Text
            maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
            style={[typography.badge, { color: appliedToken.text }]}
          >
            {breakdown.appliedLabel}
          </Text>
        </View>

        <View
          style={[
            styles.breakdownPill,
            {
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderStyle: queryToken.borderStyle,
              borderColor: queryToken.border,
              backgroundColor: queryToken.background,
              paddingHorizontal: spacing.xs,
              paddingVertical: spacing.xxs,
            },
          ]}
          testID="redirect-pill-query-only"
        >
          <Text
            maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
            style={[typography.badge, { color: queryToken.text }]}
          >
            {breakdown.queryOnlyLabel}
          </Text>
        </View>

        <View
          style={[
            styles.breakdownPill,
            {
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderStyle: unsupportedToken.borderStyle,
              borderColor: unsupportedToken.border,
              backgroundColor: unsupportedToken.background,
              paddingHorizontal: spacing.xs,
              paddingVertical: spacing.xxs,
            },
          ]}
          testID="redirect-pill-unsupported"
        >
          <Text
            maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
            style={[typography.badge, { color: unsupportedToken.text }]}
          >
            {breakdown.unsupportedLabel}
          </Text>
        </View>
      </View>

      {/* Partial search honesty callout before user taps external redirect */}
      {breakdown.hasPartialWarning ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            borderRadius: radius.sm,
            borderWidth: borderWidth.hairline,
            borderStyle: "dashed",
            borderColor: palette.borderControl,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            gap: spacing.xxs,
          }}
          testID="redirect-partial-warning"
        >
          {breakdown.unsupportedNames.length > 0 ? (
            <Text
              maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
              style={[typography.caption, { color: palette.textSecondary }]}
            >
              {`Uygulanamayan ölçütler dışlanır: ${breakdown.unsupportedNames.join(", ")}.`}
            </Text>
          ) : null}
          {breakdown.queryOnlyNames.length > 0 ? (
            <Text
              maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
              style={[typography.caption, { color: palette.textSecondary }]}
            >
              {`Metin aramasına aktarılanlar: ${breakdown.queryOnlyNames.join(", ")}.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text
        maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
        style={[typography.caption, { color: palette.textMuted }]}
        testID="criteria-verification-notice"
      >
        {resolution.verification_notice}
      </Text>

      {externalOpenError ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.errorBox,
            {
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderStyle: "dashed",
              borderColor: palette.borderControl,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
            },
          ]}
          testID="external-open-error"
        >
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            selectable
            style={[typography.caption, { color: palette.textSecondary }]}
          >
            {`${externalOpenError} Bağlantı (seçip kopyalayabilirsin): ${resolution.url}`}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityHint="Onayınla doğrulanmış Trendyol arama bağlantısını açar"
        accessibilityLabel={ctaLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: ctaDisabled, busy: isOpeningExternal }}
        disabled={ctaDisabled}
        hitSlop={hitSlop}
        onPress={onPressOpenExternal}
        style={({ pressed }) => [
          styles.ctaButton,
          {
            minHeight: touchTarget.minimum,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            backgroundColor: ctaDisabled
              ? palette.ctaDisabledBackground
              : pressed
                ? palette.ctaPressed
                : palette.ctaBackground,
            gap: spacing.xs,
          },
        ]}
        testID="open-trendyol-cta"
      >
        {isOpeningExternal ? (
          <ActivityIndicator color={palette.ctaDisabledText} size="small" />
        ) : null}
        <Text
          maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
          style={[
            typography.button,
            { color: ctaDisabled ? palette.ctaDisabledText : palette.ctaText },
          ]}
        >
          {isOpeningExternal ? "Açılıyor..." : ctaLabel}
        </Text>
        {!isOpeningExternal ? (
          <Text
            accessible={false}
            style={[
              typography.button,
              { color: ctaDisabled ? palette.ctaDisabledText : palette.ctaText },
            ]}
          >
            {icons.specs.external.glyphFallback}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  breakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  breakdownPill: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorBox: {
    width: "100%",
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
