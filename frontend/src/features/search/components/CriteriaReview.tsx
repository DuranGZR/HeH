import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { LinkResolution } from "@/api";
import { useHehTheme } from "@/theme";

import {
  buildCriteriaGroupViewModels,
  parseTurkishPriceDraft,
  type CriteriaChipViewModel,
  type CriteriaGroupItemViewModel,
  type CriteriaGroupViewModel,
} from "../criteriaAst";
import { RedirectCTA } from "./RedirectCTA";

export interface CriteriaReviewProps {
  readonly resolution: LinkResolution;
  readonly chips: readonly CriteriaChipViewModel[];
  readonly groups?: readonly CriteriaGroupViewModel[];
  readonly summaryText: string;
  readonly ctaLabel: string;
  readonly isBusy: boolean;
  readonly isOpeningExternal?: boolean;
  readonly resolveError?: string | null;
  readonly externalOpenError: string | null;
  readonly warnings?: readonly string[];
  readonly canRestore?: boolean;
  readonly onRemoveCriterion: (criterionId: string) => void;
  readonly onRemoveOrOption?: (criterionId: string, optionKey: string) => void;
  readonly onUpdatePriceRange?: (
    criterionId: string,
    minAmount: string | null,
    maxAmount: string | null,
  ) => void;
  readonly onRestoreLast?: () => void;
  readonly onPressOpenExternal: () => void;
}

/**
 * Monochrome AST-group-aware CriteriaReview component (`D23` / `SCREEN-04`).
 * Preserves `all_of`, `any_of` (`VEYA` options), and `not` exclusion groups cleanly without flattening,
 * renders inline price edits + single-tap removal -> `/resolve`, undo restore, and delegates explicit handoff to `RedirectCTA`.
 */
export function CriteriaReview({
  resolution,
  chips,
  groups,
  summaryText,
  ctaLabel,
  isBusy,
  isOpeningExternal = false,
  resolveError = null,
  externalOpenError,
  warnings = [],
  canRestore = false,
  onRemoveCriterion,
  onRemoveOrOption,
  onUpdatePriceRange,
  onRestoreLast,
  onPressOpenExternal,
}: CriteriaReviewProps) {
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

  const [prevResolutionUrl, setPrevResolutionUrl] = useState(resolution.url);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [minDraft, setMinDraft] = useState("");
  const [maxDraft, setMaxDraft] = useState("");
  const [priceDraftError, setPriceDraftError] = useState<string | null>(null);

  if (
    resolution.url !== prevResolutionUrl ||
    (editingPriceId !== null && !chips.some((chip) => chip.criterionId === editingPriceId))
  ) {
    if (resolution.url !== prevResolutionUrl) {
      setPrevResolutionUrl(resolution.url);
    }
    if (editingPriceId !== null) {
      setEditingPriceId(null);
      setMinDraft("");
      setMaxDraft("");
      setPriceDraftError(null);
    }
  }

  const renderedGroups = groups ?? buildCriteriaGroupViewModels(chips, null);
  const hasZeroCriteria = chips.length === 0;
  const ctaDisabled = isBusy || hasZeroCriteria;

  const openPriceEditor = (item: CriteriaGroupItemViewModel): void => {
    setEditingPriceId(item.chip.criterionId);
    setMinDraft(item.priceBounds?.minAmount ?? "");
    setMaxDraft(item.priceBounds?.maxAmount ?? "");
    setPriceDraftError(null);
  };

  const submitPriceEditor = (criterionId: string): void => {
    const minTrimmed = minDraft.trim();
    const maxTrimmed = maxDraft.trim();
    const parsedMin = minTrimmed ? parseTurkishPriceDraft(minTrimmed) : null;
    const parsedMax = maxTrimmed ? parseTurkishPriceDraft(maxTrimmed) : null;

    if ((minTrimmed && parsedMin === null) || (maxTrimmed && parsedMax === null)) {
      setPriceDraftError("Geçerli sayısal bir TL tutarı gir.");
      return;
    }
    if (parsedMin === null && parsedMax === null) {
      setPriceDraftError("En az alt veya üst fiyat sınırı yaz.");
      return;
    }
    if (parsedMin !== null && parsedMax !== null && Number(parsedMin) > Number(parsedMax)) {
      setPriceDraftError("En az tutar, en çok tutardan büyük olamaz.");
      return;
    }

    setPriceDraftError(null);
    setEditingPriceId(null);
    onUpdatePriceRange?.(criterionId, parsedMin, parsedMax);
  };

  const renderChipCard = (item: CriteriaGroupItemViewModel, isInOrGroup: boolean) => {
    const { chip, orOptions } = item;
    const badgeToken = statusTokens[chip.visualStatus];
    const statusIcon =
      chip.status === "WEB_VERIFIED_PENDING_MOBILE"
        ? icons.specs.tune
        : statusIcons[chip.visualStatus];
    const isEditingThisPrice = editingPriceId === chip.criterionId;

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
            <Text accessible={false} style={[typography.bodyMedium, { color: badgeToken.text }]}>
              {icons.specs.close.glyphFallback}
            </Text>
          </Pressable>
        </View>

        {orOptions.length >= 2 && onRemoveOrOption ? (
          <View
            style={[styles.orOptionsRow, { gap: spacing.xs }]}
            testID={`criterion-or-options-${chip.criterionId}`}
          >
            {orOptions.map((opt, idx) => (
              <View key={opt.key} style={[styles.orOptionCluster, { gap: spacing.xs }]}>
                <Pressable
                  accessibilityHint="Bu seçeneği VEYA grubundan çıkarır"
                  accessibilityLabel={`${opt.label} seçeneğini çıkar`}
                  accessibilityRole="button"
                  disabled={isBusy}
                  hitSlop={hitSlop}
                  onPress={() => onRemoveOrOption(chip.criterionId, opt.key)}
                  style={({ pressed }) => [
                    styles.orOptionPill,
                    {
                      minHeight: touchTarget.iosMinimum,
                      borderRadius: radius.pill,
                      borderWidth: borderWidth.hairline,
                      borderColor: palette.borderControl,
                      backgroundColor: pressed ? palette.surfacePressed : palette.background,
                      paddingHorizontal: spacing.sm,
                      gap: spacing.xs,
                    },
                  ]}
                  testID={`remove-or-option-${chip.criterionId}-${opt.key}`}
                >
                  <Text
                    maxFontSizeMultiplier={typography.chip.maxFontSizeMultiplier}
                    style={[typography.chip, { color: palette.textPrimary }]}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    accessible={false}
                    style={[typography.caption, { color: palette.textSecondary }]}
                  >
                    {icons.specs.close.glyphFallback}
                  </Text>
                </Pressable>
                {idx < orOptions.length - 1 ? (
                  <Text
                    maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                    style={[typography.badge, { color: palette.textSecondary }]}
                  >
                    VEYA
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.badgeRow, { gap: spacing.xs }]}>
          <Text
            maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
            style={[typography.badge, { color: badgeToken.text }]}
            testID={`criterion-badge-${chip.criterionId}`}
          >
            {chip.badgeLabel}
          </Text>

          {isInOrGroup ? (
            <Text
              maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
              style={[typography.badge, { color: badgeToken.text }]}
              testID={`criterion-or-tag-${chip.criterionId}`}
            >
              · VEYA
            </Text>
          ) : null}

          {chip.operator === "not_in" ? (
            <Text
              maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
              style={[typography.badge, { color: badgeToken.text }]}
              testID={`criterion-not-tag-${chip.criterionId}`}
            >
              · HARİÇ
            </Text>
          ) : null}

          {chip.field === "price" && onUpdatePriceRange && !isEditingThisPrice ? (
            <Pressable
              accessibilityLabel="Fiyatı Düzenle"
              accessibilityRole="button"
              disabled={isBusy}
              hitSlop={hitSlop}
              onPress={() => openPriceEditor(item)}
              style={{
                minHeight: touchTarget.iosMinimum,
                justifyContent: "center",
                paddingHorizontal: spacing.xs,
              }}
              testID={`edit-price-${chip.criterionId}`}
            >
              <Text
                maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                style={[
                  typography.badge,
                  { color: badgeToken.text, textDecorationLine: "underline" },
                ]}
              >
                Fiyatı Düzenle
              </Text>
            </Pressable>
          ) : null}
        </View>

        {isEditingThisPrice ? (
          <View
            style={{
              gap: spacing.xs,
              borderRadius: radius.sm,
              borderWidth: borderWidth.hairline,
              borderColor: palette.borderControl,
              backgroundColor: palette.background,
              padding: spacing.xs,
            }}
            testID={`price-editor-${chip.criterionId}`}
          >
            <View style={[styles.priceInputsRow, { gap: spacing.xs }]}>
              <TextInput
                accessibilityLabel="En az fiyat TL"
                keyboardType="decimal-pad"
                onChangeText={setMinDraft}
                placeholder="En az TL"
                placeholderTextColor={palette.textMuted}
                style={[
                  typography.caption,
                  styles.priceInput,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderControl,
                    backgroundColor: palette.background,
                    color: palette.textPrimary,
                    paddingHorizontal: spacing.sm,
                  },
                ]}
                testID={`price-min-input-${chip.criterionId}`}
                value={minDraft}
              />
              <TextInput
                accessibilityLabel="En çok fiyat TL"
                keyboardType="decimal-pad"
                onChangeText={setMaxDraft}
                placeholder="En çok TL"
                placeholderTextColor={palette.textMuted}
                style={[
                  typography.caption,
                  styles.priceInput,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderControl,
                    backgroundColor: palette.background,
                    color: palette.textPrimary,
                    paddingHorizontal: spacing.sm,
                  },
                ]}
                testID={`price-max-input-${chip.criterionId}`}
                value={maxDraft}
              />
            </View>
            {priceDraftError ? (
              <Text
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
                style={[typography.caption, { color: palette.textSecondary }]}
                testID={`price-draft-error-${chip.criterionId}`}
              >
                {priceDraftError}
              </Text>
            ) : null}
            <View style={[styles.priceActionsRow, { gap: spacing.xs }]}>
              <Pressable
                accessibilityLabel="Fiyatı Uygula"
                accessibilityRole="button"
                disabled={isBusy}
                hitSlop={hitSlop}
                onPress={() => submitPriceEditor(chip.criterionId)}
                style={[
                  styles.priceActionBtn,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    backgroundColor: palette.ctaBackground,
                    paddingHorizontal: spacing.md,
                  },
                ]}
                testID={`price-apply-${chip.criterionId}`}
              >
                <Text
                  maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                  style={[typography.badge, { color: palette.ctaText }]}
                >
                  Uygula
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Fiyat düzenlemesini iptal et"
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => {
                  setEditingPriceId(null);
                  setPriceDraftError(null);
                }}
                style={[
                  styles.priceActionBtn,
                  {
                    minHeight: touchTarget.iosMinimum,
                    borderRadius: radius.sm,
                    borderWidth: borderWidth.hairline,
                    borderColor: palette.borderControl,
                    backgroundColor: palette.background,
                    paddingHorizontal: spacing.md,
                  },
                ]}
                testID={`price-cancel-${chip.criterionId}`}
              >
                <Text
                  maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                  style={[typography.badge, { color: palette.textPrimary }]}
                >
                  Vazgeç
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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
  };

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

      {resolveError ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            borderRadius: radius.sm,
            borderWidth: borderWidth.hairline,
            borderStyle: "dashed",
            borderColor: palette.borderControl,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
          }}
          testID="criteria-resolve-error"
        >
          <Text
            maxFontSizeMultiplier={typography.caption.maxFontSizeMultiplier}
            style={[typography.caption, { color: palette.textSecondary }]}
          >
            {resolveError}
          </Text>
        </View>
      ) : null}

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
        <View style={[styles.chipList, { gap: spacing.sm }]}>
          {renderedGroups.map((group) => (
            <View
              key={group.groupId}
              style={[
                styles.groupSection,
                group.kind !== "all_of"
                  ? {
                      borderRadius: radius.md,
                      borderWidth: borderWidth.hairline,
                      borderStyle: group.kind === "not" ? "dashed" : "solid",
                      borderColor: palette.borderSubtle,
                      padding: spacing.xs,
                      gap: spacing.xs,
                    }
                  : { gap: spacing.xs },
              ]}
              testID={
                group.kind === "not"
                  ? "criteria-group-not"
                  : group.kind === "any_of"
                    ? `criteria-group-any-of-${group.groupId}`
                    : "criteria-group-all-of"
              }
            >
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                style={[typography.badge, { color: palette.textMuted }]}
              >
                {group.title}
              </Text>
              {group.items.map((item, idx) => (
                <View key={item.chip.criterionId} style={{ gap: spacing.xs }}>
                  {renderChipCard(item, group.kind === "any_of")}
                  {group.kind === "any_of" && idx < group.items.length - 1 ? (
                    <Text
                      maxFontSizeMultiplier={typography.badge.maxFontSizeMultiplier}
                      style={[
                        typography.badge,
                        { color: palette.textSecondary, textAlign: "center" },
                      ]}
                    >
                      VEYA
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
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

      <RedirectCTA
        ctaLabel={ctaLabel}
        disabled={ctaDisabled}
        externalOpenError={externalOpenError}
        isBusy={isBusy}
        isOpeningExternal={isOpeningExternal}
        onPressOpenExternal={onPressOpenExternal}
        resolution={resolution}
      />
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
  groupSection: {
    width: "100%",
  },
  chipCard: {
    width: "100%",
  },
  chipHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
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
  orOptionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  orOptionCluster: {
    flexDirection: "row",
    alignItems: "center",
  },
  orOptionPill: {
    flexDirection: "row",
    alignItems: "center",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  priceInputsRow: {
    flexDirection: "row",
  },
  priceInput: {
    flex: 1,
  },
  priceActionsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  priceActionBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
