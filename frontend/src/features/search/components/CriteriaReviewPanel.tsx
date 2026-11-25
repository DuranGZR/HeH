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
  readonly warnings?: readonly string[];
  readonly canRestore?: boolean;
  readonly onRemoveCriterion: (criterionId: string) => void;
  readonly onRestoreLast?: () => void;
  readonly onPressOpenExternal: () => void;
}

/**
 * Monochrome CriteriaReview component (`SCREEN-04`).
 * Renders non-color-only verification statuses, single-tap chip deletion, undo restore,
 * and explicit user-initiated external search redirect without percentage hallucinations.
 */
export function CriteriaReviewPanel({
  resolution,
  chips,
  summaryText,
  ctaLabel,
  isBusy,
  externalOpenError,
  warnings = [],
  canRestore = false,
  onRemoveCriterion,
  onRestoreLast,
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

  const hasZeroCriteria = chips.length === 0;
  const ctaDisabled = isBusy || hasZeroCriteria;

  return (
    <View style={[styles.container, { gap: spacing.sm }]} testID="criteria-review-panel">
      <Text
        accessibilityRole="header"
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

      {warnings.length > 0 ? (
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
          testID="criteria-warnings-box"
        >
          {warnings.map((warn, idx) => (
            <Text
              key={`${idx}-${warn}`}
              maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
              style={[typography.caption, { color: palette.textSecondary }]}
            >
              {warn}
            </Text>
          ))}
        </View>
      ) : null}

      {hasZeroCriteria ? (
        <View
          style={{
            borderRadius: radius.md,
            borderWidth: borderWidth.hairline,
            borderStyle: "dashed",
            borderColor: palette.borderControl,
            padding: spacing.md,
            gap: spacing.xs,
          }}
          testID="criteria-empty-state"
        >
          <Text
            maxFontSizeMultiplier={typography.body.maxFontSizeMultiplier}
            style={[typography.body, { color: palette.textSecondary }]}
          >
            Tüm ölçütler kaldırıldı. Devam etmek için son kaldırılanı geri al veya yeni arama yaz.
          </Text>
        </View>
      ) : (
        <View style={[styles.chipList, { gap: spacing.xs }]}>
          {chips.map((chip) => {
            const badgeToken = statusTokens[chip.visualStatus];
            const statusIcon =
              chip.status === "WEB_VERIFIED_PENDING_MOBILE"
                ? icons.specs.tune
                : statusIcons[chip.visualStatus];
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

                {chip.status === "UNSUPPORTED" ||
                chip.status === "QUERY_ONLY" ||
                chip.status === "UNKNOWN" ? (
                  <Text
                    maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                    style={[typography.caption, { color: palette.textSecondary }]}
                    testID={`criterion-reason-${chip.criterionId}`}
                  >
                    {chip.reason}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {canRestore && onRestoreLast ? (
        <Pressable
          accessibilityLabel="Son kaldırılan ölçütü geri al"
          accessibilityRole="button"
          disabled={isBusy}
          hitSlop={hitSlop}
          onPress={onRestoreLast}
          style={({ pressed }) => [
            styles.ctaButton,
            {
              minHeight: touchTarget.minimum,
              borderRadius: radius.md,
              borderWidth: borderWidth.hairline,
              borderColor: palette.borderControl,
              backgroundColor: pressed ? palette.surfacePressed : palette.surfaceMuted,
              paddingHorizontal: spacing.md,
            },
          ]}
          testID="restore-criterion-button"
        >
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textPrimary }]}
          >
            Son Kaldırılan Ölçütü Geri Al
          </Text>
        </Pressable>
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
        accessibilityHint="Doğrulanan bağlantıyı haricî Trendyol uygulamasında veya tarayıcıda açar"
        accessibilityLabel={ctaLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: ctaDisabled }}
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
        <Text
          maxFontSizeMultiplier={typography.button.maxFontSizeMultiplier}
          style={[
            typography.button,
            { color: ctaDisabled ? palette.ctaDisabledText : palette.ctaText },
          ]}
        >
          {ctaLabel}
        </Text>
        <Text
          accessible={false}
          style={[
            typography.button,
            { color: ctaDisabled ? palette.ctaDisabledText : palette.ctaText },
          ]}
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
