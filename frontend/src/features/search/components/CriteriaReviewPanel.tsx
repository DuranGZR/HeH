import { Pressable, StyleSheet, Text, View } from "react-native";

import type { LinkResolution } from "@/api";
import { useHehTheme } from "@/theme";

import type { CriteriaChipViewModel } from "../queryHooks";

export interface CriteriaReviewPanelProps {
  readonly resolution: LinkResolution;
  readonly chips: readonly CriteriaChipViewModel[];
  readonly summaryText: string;
  readonly ctaLabel: string;
  readonly isBusy: boolean;
  readonly externalOpenError: string | null;
  readonly onRemoveCriterion: (criterionId: string) => void;
  readonly onPressOpenExternal: () => void;
}

/**
 * Monochrome CriteriaReview component (`SCREEN-04`).
 * Renders non-color-only verification statuses, single-tap chip deletion,
 * and explicit user-initiated external search redirect without percentage hallucinations.
 */
export function CriteriaReviewPanel({
  resolution,
  chips,
  summaryText,
  ctaLabel,
  isBusy,
  externalOpenError,
  onRemoveCriterion,
  onPressOpenExternal,
}: CriteriaReviewPanelProps) {
  const {
    palette,
    statusTokens,
    statusIcons,
    typography,
    spacing,
    radius,
    borderWidth,
    touchTarget,
    icons,
    hitSlop,
  } = useHehTheme();

  return (
    <View style={[styles.container, { gap: spacing.sm }]} testID="criteria-review-panel">
      <Text
        maxFontSizeMultiplier={typography.heroTitle.maxFontSizeMultiplier}
        style={[typography.heroTitle, { color: palette.textPrimary }]}
      >
        Şunu mu arıyorsun?
      </Text>

      <Text
        maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
        style={[typography.caption, { color: palette.textSecondary }]}
        testID="criteria-summary-text"
      >
        {summaryText}
      </Text>

      <View style={[styles.chipList, { gap: spacing.xs }]}>
        {chips.map((chip) => {
          const badgeToken = statusTokens[chip.visualStatus];
          const statusIcon = statusIcons[chip.visualStatus];
          return (
            <View
              key={chip.criterionId}
              style={[
                styles.chipCard,
                {
                  borderRadius: radius.md,
                  borderWidth: borderWidth.hairline,
                  borderStyle: badgeToken.borderStyle,
                  borderColor: badgeToken.border,
                  backgroundColor: badgeToken.background,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  gap: spacing.xs,
                },
              ]}
              testID={`criterion-chip-${chip.criterionId}`}
            >
              <View style={styles.chipHeader}>
                <View style={styles.chipTitleGroup}>
                  <Text
                    accessible={false}
                    style={[typography.bodyMedium, { color: badgeToken.iconColor }]}
                  >
                    {statusIcon.glyphFallback}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={typography.bodyMedium.maxFontSizeMultiplier}
                    style={[typography.bodyMedium, { color: badgeToken.text, flexShrink: 1 }]}
                  >
                    {chip.label}
                  </Text>
                </View>

                <Pressable
                  accessibilityLabel={`${chip.label} kriterini kaldır`}
                  accessibilityRole="button"
                  disabled={isBusy}
                  hitSlop={hitSlop}
                  onPress={() => onRemoveCriterion(chip.criterionId)}
                  style={[
                    styles.removeButton,
                    { minWidth: touchTarget.iosMinimum, minHeight: touchTarget.iosMinimum },
                  ]}
                  testID={`remove-criterion-${chip.criterionId}`}
                >
                  <Text
                    accessible={false}
                    style={[typography.bodyMedium, { color: badgeToken.text }]}
                  >
                    {icons.specs.close.glyphFallback}
                  </Text>
                </Pressable>
              </View>

              <Text
                maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                style={[typography.badge, { color: badgeToken.text }]}
                testID={`criterion-badge-${chip.criterionId}`}
              >
                {chip.badgeLabel}
              </Text>
            </View>
          );
        })}
      </View>

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
            style={[typography.caption, { color: palette.textSecondary }]}
          >
            {`${externalOpenError} Bağlantı: ${resolution.url}`}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityHint="Doğrulanan bağlantıyı haricî Trendyol uygulamasında veya tarayıcıda açar"
        accessibilityLabel={ctaLabel}
        accessibilityRole="button"
        disabled={isBusy}
        hitSlop={hitSlop}
        onPress={onPressOpenExternal}
        style={({ pressed }) => [
          styles.ctaButton,
          {
            minHeight: touchTarget.minimum,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            backgroundColor: isBusy
              ? palette.ctaDisabledBackground
              : pressed
                ? palette.ctaPressed
                : palette.ctaBackground,
            gap: spacing.xs,
          },
        ]}
        testID="open-trendyol-cta"
      >
        <Text
          maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
          style={[typography.button, { color: isBusy ? palette.ctaDisabledText : palette.ctaText }]}
        >
          {ctaLabel}
        </Text>
        <Text
          accessible={false}
          style={[typography.button, { color: isBusy ? palette.ctaDisabledText : palette.ctaText }]}
        >
          {icons.specs.external.glyphFallback}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  chipList: {
    width: "100%",
  },
  chipCard: {
    width: "100%",
  },
  chipHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipTitleGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  removeButton: {
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
