import type {
  ConstraintGroup,
  LinkFilterItem,
  PriceValueInput,
  PriceValueOutput,
  SearchCriterionNodeOutput,
  SearchIntentV2Output,
} from "@/api";
import type { CriterionVisualStatus } from "@/theme";

export interface CriteriaChipViewModel {
  readonly criterionId: string;
  readonly field: LinkFilterItem["field"];
  readonly label: string;
  readonly operator: LinkFilterItem["operator"];
  readonly status: LinkFilterItem["status"];
  readonly visualStatus: CriterionVisualStatus;
  readonly badgeLabel: string;
  readonly reason: string;
}

export interface OrOptionChip {
  readonly key: string;
  readonly label: string;
}

export interface CriteriaGroupItemViewModel {
  readonly chip: CriteriaChipViewModel;
  readonly orOptions: readonly OrOptionChip[];
  readonly priceBounds?: {
    readonly minAmount: string | null;
    readonly maxAmount: string | null;
  };
}

export type CriteriaGroupKind = "all_of" | "any_of" | "not";

export interface CriteriaGroupViewModel {
  readonly groupId: string;
  readonly kind: CriteriaGroupKind;
  readonly title: string;
  readonly items: readonly CriteriaGroupItemViewModel[];
}

const OR_GROUP_TITLES: Readonly<Partial<Record<LinkFilterItem["field"], string>>> = {
  brand: "Marka Seçenekleri (VEYA)",
  color: "Renk Seçenekleri (VEYA)",
  size: "Beden Seçenekleri (VEYA)",
};

function pruneLogicGroups(
  groups: readonly ConstraintGroup[] | undefined,
  activeIds: ReadonlySet<string>,
): ConstraintGroup[] {
  return (groups ?? [])
    .map((group) => ({
      ...group,
      criterion_ids: group.criterion_ids.filter((id) => activeIds.has(id)),
    }))
    .filter((group) => group.criterion_ids.length > 0);
}

function finalizeEditedIntent(
  intent: SearchIntentV2Output,
  nextCriteria: readonly SearchCriterionNodeOutput[],
  nextGroups: readonly ConstraintGroup[],
): SearchIntentV2Output {
  const activeIds = new Set(nextCriteria.map((c) => c.id));
  const hasRemainingCategory = nextCriteria.some(
    (crit) => crit.field === "category" && crit.operator !== "not_in",
  );
  const nextIntentType =
    nextCriteria.length > 0 && intent.intent_type === "unsupported"
      ? "product_search"
      : intent.intent_type;
  return {
    ...intent,
    intent_type: nextIntentType,
    category_key: hasRemainingCategory ? intent.category_key : null,
    criteria: nextCriteria,
    logic_groups: pruneLogicGroups(nextGroups, activeIds),
  };
}

/** Remove an entire criterion node from the AST without flattening remaining OR/NOT groups. */
export function removeCriterionFromIntent(
  intent: SearchIntentV2Output,
  criterionId: string,
): SearchIntentV2Output {
  const existingCriteria = intent.criteria ?? [];
  const nextCriteria = existingCriteria.filter((crit) => crit.id !== criterionId);
  return finalizeEditedIntent(intent, nextCriteria, intent.logic_groups ?? []);
}

function splitOrDisplayLabels(displayLabel: string, valueCount: number): string[] {
  const split = displayLabel
    .split(/\s+veya\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (split.length === valueCount) {
    return split;
  }
  return [];
}

/**
 * Remove a single option inside an `in` / `any_of` OR cluster cleanly:
 * - 2+ remaining options -> keeps `operator="in"` and `any_of` group intact
 * - 1 remaining option -> shrinks cleanly to `operator="eq"` inside `all_of`
 * - 0 remaining options -> deletes the criterion node cleanly
 */
export function removeOptionFromOrIntent(
  intent: SearchIntentV2Output,
  criterionId: string,
  optionKey: string,
): SearchIntentV2Output {
  const existingCriteria = intent.criteria ?? [];
  const target = existingCriteria.find((c) => c.id === criterionId);
  if (!target || target.operator !== "in" || !Array.isArray(target.value)) {
    return removeCriterionFromIntent(intent, criterionId);
  }

  const values = target.value.map(String);
  const labels = splitOrDisplayLabels(target.display_label, values.length);
  const keptPairs: Array<{ readonly key: string; readonly label: string }> = [];

  for (let i = 0; i < values.length; i += 1) {
    const val = values[i];
    if (val === undefined || val === optionKey) {
      continue;
    }
    const label = labels[i] ?? val;
    keptPairs.push({ key: val, label });
  }

  if (keptPairs.length === 0) {
    return removeCriterionFromIntent(intent, criterionId);
  }

  const nextGroups = [...(intent.logic_groups ?? [])];
  if (keptPairs.length === 1) {
    const [single] = keptPairs;
    if (!single) {
      return removeCriterionFromIntent(intent, criterionId);
    }
    const updatedNode: SearchCriterionNodeOutput = {
      ...target,
      operator: "eq",
      value: single.key,
      display_label: single.label,
      provenance: "user_edit",
      required: true,
      modality: "must",
      source_span: null,
      span_start: null,
      span_end: null,
    };
    const nextCriteria = existingCriteria.map((c) => (c.id === criterionId ? updatedNode : c));
    // Strip criterionId from any singleton `any_of` group cleanly while preserving `all_of`.
    const adjustedGroups: ConstraintGroup[] = nextGroups
      .map((group) =>
        group.operator === "any_of"
          ? {
              ...group,
              criterion_ids: group.criterion_ids.filter((id) => id !== criterionId),
            }
          : group,
      )
      .filter((group) => group.criterion_ids.length > 0);
    return finalizeEditedIntent(intent, nextCriteria, adjustedGroups);
  }

  const updatedNode: SearchCriterionNodeOutput = {
    ...target,
    operator: "in",
    value: keptPairs.map((pair) => pair.key),
    display_label: keptPairs.map((pair) => pair.label).join(" veya "),
    provenance: "user_edit",
    source_span: null,
    span_start: null,
    span_end: null,
  };
  const nextCriteria = existingCriteria.map((c) => (c.id === criterionId ? updatedNode : c));
  return finalizeEditedIntent(intent, nextCriteria, nextGroups);
}

/** Validate and parse optional Turkish numeric price string (supports spaces, `.` thousands, `,` decimals). */
export function parseTurkishPriceDraft(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, "");
  if (!cleaned) {
    return null;
  }
  let normalized = cleaned;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [wholePart = "0", decimalPart] = normalized.split(".");
  const compactWhole = wholePart.replace(/^0+(?=\d)/, "");
  return decimalPart !== undefined ? `${compactWhole}.${decimalPart}` : compactWhole;
}

/** Format user-edited price range cleanly into a deterministic `SearchIntentV2Output` mutation. */
export function updatePriceCriterionInIntent(
  intent: SearchIntentV2Output,
  criterionId: string,
  minAmount: string | null,
  maxAmount: string | null,
): SearchIntentV2Output | null {
  if (minAmount === null && maxAmount === null) {
    return null;
  }
  if (minAmount !== null && maxAmount !== null && Number(minAmount) > Number(maxAmount)) {
    return null;
  }

  const existingCriteria = intent.criteria ?? [];
  const target = existingCriteria.find((c) => c.id === criterionId && c.field === "price");
  if (!target) {
    return null;
  }

  const operator: SearchCriterionNodeOutput["operator"] =
    minAmount !== null && maxAmount !== null ? "between" : minAmount !== null ? "gte" : "lte";

  const priceValue: PriceValueInput = {
    min_amount: minAmount ?? "0",
    max_amount: maxAmount,
    min_inclusive: true,
    max_inclusive: true,
    currency: "TRY",
  };

  const formatLabelNumber = (amt: string): string => amt.replace(".", ",");
  const displayLabel =
    minAmount !== null && maxAmount !== null
      ? `${formatLabelNumber(minAmount)}-${formatLabelNumber(maxAmount)} TL`
      : minAmount !== null
        ? `${formatLabelNumber(minAmount)} TL üzeri`
        : `${formatLabelNumber(maxAmount ?? "0")} TL altı`;

  const updatedNode: SearchCriterionNodeOutput = {
    ...target,
    operator,
    value: priceValue as unknown as SearchCriterionNodeOutput["value"],
    display_label: displayLabel,
    provenance: "user_edit",
    required: true,
    modality: "must",
    source_span: null,
    span_start: null,
    span_end: null,
  };
  const nextCriteria = existingCriteria.map((c) => (c.id === criterionId ? updatedNode : c));
  return finalizeEditedIntent(intent, nextCriteria, intent.logic_groups ?? []);
}

function buildOrOptionsForNode(node?: SearchCriterionNodeOutput): readonly OrOptionChip[] {
  if (!node || node.operator !== "in" || !Array.isArray(node.value) || node.value.length < 2) {
    return [];
  }
  const values = node.value.map(String);
  const labels = splitOrDisplayLabels(node.display_label, values.length);
  return values.map((key, idx) => ({
    key,
    label: labels[idx] ?? key,
  }));
}

function isPriceValueOutput(val: unknown): val is PriceValueOutput {
  return (
    typeof val === "object" &&
    val !== null &&
    !Array.isArray(val) &&
    ("min_amount" in val || "max_amount" in val || "currency" in val)
  );
}

function buildPriceBoundsForNode(
  node?: SearchCriterionNodeOutput,
): CriteriaGroupItemViewModel["priceBounds"] | undefined {
  if (!node || node.field !== "price" || !isPriceValueOutput(node.value)) {
    return undefined;
  }
  const rawMin = node.value.min_amount ?? null;
  const rawMax = node.value.max_amount ?? null;
  const minStr = rawMin !== null ? String(rawMin) : null;
  const maxStr = rawMax !== null ? String(rawMax) : null;
  return {
    minAmount: minStr !== null && (minStr !== "0" || node.operator === "between") ? minStr : null,
    maxAmount: maxStr,
  };
}

/**
 * Group rendered chips cleanly into AST semantics (`all_of`, `any_of` OR clusters, and `not` exclusions)
 * so OR and NOT groups are never misleadingly flattened into uniform AND chips.
 */
export function buildCriteriaGroupViewModels(
  chips: readonly CriteriaChipViewModel[],
  intent: SearchIntentV2Output | null,
): readonly CriteriaGroupViewModel[] {
  if (chips.length === 0) {
    return [];
  }

  const chipMap = new Map(chips.map((c) => [c.criterionId, c]));
  const nodeMap = new Map((intent?.criteria ?? []).map((n) => [n.id, n]));
  const consumedIds = new Set<string>();
  const groups: CriteriaGroupViewModel[] = [];

  const toItem = (chip: CriteriaChipViewModel): CriteriaGroupItemViewModel => {
    const node = nodeMap.get(chip.criterionId);
    return {
      chip,
      orOptions: buildOrOptionsForNode(node),
      priceBounds: buildPriceBoundsForNode(node),
    };
  };

  // 1. Capture explicit OR clusters from ConstraintGroup("any_of") OR multi-value operator="in" nodes.
  const anyOfGroups = (intent?.logic_groups ?? []).filter((g) => g.operator === "any_of");
  let orCounter = 0;
  for (const anyGroup of anyOfGroups) {
    const items = anyGroup.criterion_ids
      .map((id) => chipMap.get(id))
      .filter((c): c is CriteriaChipViewModel => Boolean(c));
    const [primary] = items;
    if (!primary) {
      continue;
    }
    const hasMultiValueOr = buildOrOptionsForNode(nodeMap.get(primary.criterionId)).length >= 2;
    if (items.length === 1 && !hasMultiValueOr) {
      continue;
    }
    orCounter += 1;
    for (const c of items) {
      consumedIds.add(c.criterionId);
    }
    groups.push({
      groupId: `group-any-${orCounter}`,
      kind: "any_of",
      title: OR_GROUP_TITLES[primary.field] ?? "Seçenek Grubu (VEYA)",
      items: items.map(toItem),
    });
  }

  // Fallback for operator="in" or standalone chips rendered without ConstraintGroup wrapper
  for (const chip of chips) {
    if (consumedIds.has(chip.criterionId)) {
      continue;
    }
    const node = nodeMap.get(chip.criterionId);
    const hasOr = chip.operator === "in" && (node ? buildOrOptionsForNode(node).length >= 2 : true);
    if (hasOr) {
      orCounter += 1;
      consumedIds.add(chip.criterionId);
      groups.push({
        groupId: `group-any-${orCounter}`,
        kind: "any_of",
        title: OR_GROUP_TITLES[chip.field] ?? "Seçenek Grubu (VEYA)",
        items: [toItem(chip)],
      });
    }
  }

  // 2. Capture NOT exclusions separately (never mixed into positive active criteria)
  const notChips = chips.filter(
    (chip) =>
      !consumedIds.has(chip.criterionId) &&
      (chip.operator === "not_in" || chip.status === "UNSUPPORTED"),
  );
  for (const c of notChips) {
    consumedIds.add(c.criterionId);
  }

  // 3. Remaining active AND / query criteria
  const allOfChips = chips.filter((chip) => !consumedIds.has(chip.criterionId));

  const ordered: CriteriaGroupViewModel[] = [];
  if (allOfChips.length > 0) {
    ordered.push({
      groupId: "group-all-of",
      kind: "all_of",
      title: "Ana Ölçütler (VE)",
      items: allOfChips.map(toItem),
    });
  }
  ordered.push(...groups);
  if (notChips.length > 0) {
    ordered.push({
      groupId: "group-not",
      kind: "not",
      title: "Hariç Tutulanlar (Desteklenmez)",
      items: notChips.map(toItem),
    });
  }
  return ordered;
}
