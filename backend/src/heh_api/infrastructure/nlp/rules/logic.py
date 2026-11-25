"""D19 Deterministic Boolean (AND/OR), NOT negation scope, and contradiction resolver."""

import re
from dataclasses import dataclass

from heh_api.domain.search_intent import (
    ConfidenceState,
    ConstraintGroup,
    CriterionField,
    SearchCriterionNode,
    SearchIntentV2,
)
from heh_api.infrastructure.nlp.rules.entities import (
    EntityExtractionResult,
    EntityMention,
)
from heh_api.infrastructure.nlp.rules.normalize import NormalizationResult
from heh_api.infrastructure.nlp.rules.numbers import PriceExtractionResult

_OR_CONNECTOR_PATTERN = re.compile(r"^\s*(?:veya|ya\s+da|yada|/)\s*$")
_LIST_OR_NEG_BRIDGE_PATTERN = re.compile(r"^\s*(?:ve|veya|ya\s+da|yada|,|/)\s*$")
_HARD_CLAUSE_BREAK_PATTERN = re.compile(r"\b(?:ama|fakat|ancak)\b|[;!?]")
_POST_NEGATION_PATTERN = re.compile(
    r"^\s*(?:da\s+)?(?:olmas[ıi]n|olmayan|hari[çc](?:tir)?|d[ıi][şs][ıi]nda|istemiyorum)\b"
)
_PRE_CLAUSE_BREAK_PATTERN = re.compile(r"\b(?:ama|fakat|ancak)\b|[;,.!?]")
_MODIFIER_NEGATION_DEĞIL_PATTERN = re.compile(r"^\s*de[ğg]il\b")

_OOD_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"\b(?:hava\s+nas[ıi]l|saat\s+ka[çc]|merhaba|selam|naber|nas[ıi]ls[ıi]n|"
        r"dolar\s+ka[çc]|euro\s+ka[çc]|alt[ıi]n\s+fiyat|yemek\s+tarifi|ma[çc]\s+ka[çc])\b"
    ),
)


@dataclass(frozen=True)
class LogicAssemblyResult:
    """Complete canonical SearchIntentV2 AST alongside conflict warnings and abstain state."""

    intent: SearchIntentV2
    confidence_state: ConfidenceState
    warnings: tuple[str, ...]
    has_conflict: bool
    is_ood: bool


def _is_negated_mention(
    text: str,
    mention: EntityMention,
    same_clause_siblings: list[EntityMention],
) -> bool:
    """Return True if mention falls inside Turkish negation scope ('olmasın', 'değil', 'hariç')."""
    trailing = text[mention.end :]

    # Direct post-positive trigger: 'Nike olmasın', 'beyaz hariç', 'Nike olmayan'
    if _POST_NEGATION_PATTERN.match(trailing):
        return True

    # Contrastive negation: 'kırmızı değil bordo' negates the span immediately before 'değil'
    if _MODIFIER_NEGATION_DEĞIL_PATTERN.match(trailing):
        return True

    # Shared list negation propagation: 'Nike ve Puma olmasın' -> negate earlier same-kind siblings
    # when every span between sibling and final negated sibling is a bridge ('ve'/'veya'/',').
    for later in same_clause_siblings:
        if later.start <= mention.end or later.kind != mention.kind:
            continue
        if _HARD_CLAUSE_BREAK_PATTERN.search(text[mention.end : later.start]):
            break
        between = text[mention.end : later.start]
        if _LIST_OR_NEG_BRIDGE_PATTERN.match(between) and _is_negated_directly(text, later):
            return True

    return False


def _is_negated_directly(text: str, mention: EntityMention) -> bool:
    trailing = text[mention.end :]
    return bool(
        _POST_NEGATION_PATTERN.match(trailing) or _MODIFIER_NEGATION_DEĞIL_PATTERN.match(trailing)
    )


def _has_or_connector_between(text: str, first: EntityMention, second: EntityMention) -> bool:
    between = text[first.end : second.start]
    if _HARD_CLAUSE_BREAK_PATTERN.search(between):
        return False
    return bool(_OR_CONNECTOR_PATTERN.match(between))


def _field_from_kind(kind: str) -> CriterionField:
    if kind == "category":
        return "category"
    if kind == "brand":
        return "brand"
    if kind == "color":
        return "color"
    if kind == "size":
        return "size"
    return "attribute"


def assemble_search_intent_ast(
    *,
    norm: NormalizationResult,
    numbers: PriceExtractionResult,
    entities: EntityExtractionResult,
    input_source: str,
) -> LogicAssemblyResult:
    """Build deterministic SearchIntentV2 AST enforcing OR/NOT semantics and conflict detection."""
    text = norm.canonical_for_matching
    warnings: list[str] = []
    criteria: list[SearchCriterionNode] = []
    logic_groups: list[ConstraintGroup] = []
    has_conflict = False

    if numbers.warning:
        warnings.append(numbers.warning)

    if numbers.conflict_message:
        has_conflict = True
        warnings.append(numbers.conflict_message)

    # Split non-category mentions into positive vs negated strictly without flipping NOT -> positive
    positive_by_kind: dict[str, list[EntityMention]] = {
        "brand": [],
        "color": [],
        "size": [],
        "attribute": [],
    }
    negative_by_kind: dict[str, list[EntityMention]] = {
        "brand": [],
        "color": [],
        "size": [],
        "attribute": [],
    }

    non_cat_mentions = [m for m in entities.mentions if m.kind != "category"]
    for mention in non_cat_mentions:
        if _is_negated_mention(text, mention, non_cat_mentions):
            negative_by_kind[mention.kind].append(mention)
        else:
            positive_by_kind[mention.kind].append(mention)

    # Contradiction detection: same (kind, canonical_key) both positive and negated
    conflicted_pairs: set[tuple[str, str]] = set()
    for kind in ("brand", "color", "size"):
        pos_keys = {m.canonical_key: m.display_label for m in positive_by_kind[kind]}
        neg_keys = {m.canonical_key for m in negative_by_kind[kind]}
        for shared_key in sorted(set(pos_keys).intersection(neg_keys)):
            conflicted_pairs.add((kind, shared_key))
            has_conflict = True
            label = pos_keys[shared_key]
            warnings.append(
                f"Çelişkili ölçüt: '{label}' hem istendi hem dışlandı; güvenlik için uygulanmadı."
            )

    # Category node (always first if detected)
    cat_mention = next((m for m in entities.mentions if m.kind == "category"), None)
    if cat_mention is not None and entities.category is not None:
        criteria.append(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value=entities.category.canonical_key,
                display_label=entities.category.display_name,
                source_span=cat_mention.raw_span,
            )
        )

    # Price node from Decimal parser (skip if contradictory min > max)
    if numbers.price is not None and numbers.operator is not None and numbers.display_label:
        criteria.append(
            SearchCriterionNode(
                id="price-1",
                field="price",
                operator=numbers.operator,
                value=numbers.price,
                display_label=numbers.display_label,
                required=numbers.modality != "approximate",
                source_span=numbers.source_span,
            )
        )

    # Group OR positive brands/colors (`veya` / `ya da`), preserve individual AND/OR/NOT nodes
    all_of_ids: list[str] = []
    if cat_mention is not None:
        all_of_ids.append("cat-1")
    if numbers.price is not None:
        all_of_ids.append("price-1")

    for kind in ("brand", "color"):
        clean_positives = [
            m for m in positive_by_kind[kind] if (kind, m.canonical_key) not in conflicted_pairs
        ]
        # Deduplicate preserving order
        deduped_pos: list[EntityMention] = []
        seen_keys: set[str] = set()
        for item in clean_positives:
            if item.canonical_key not in seen_keys:
                seen_keys.add(item.canonical_key)
                deduped_pos.append(item)

        idx = 0
        group_counter = 1
        while idx < len(deduped_pos):
            cluster = [deduped_pos[idx]]
            while idx + 1 < len(deduped_pos) and _has_or_connector_between(
                text, deduped_pos[idx], deduped_pos[idx + 1]
            ):
                idx += 1
                cluster.append(deduped_pos[idx])

            if len(cluster) > 1:
                crit_id = f"{kind}-or-{group_counter}"
                group_counter += 1
                criteria.append(
                    SearchCriterionNode(
                        id=crit_id,
                        field=_field_from_kind(kind),
                        operator="in",
                        value=tuple(c.canonical_key for c in cluster),
                        display_label=" veya ".join(c.display_label for c in cluster),
                        source_span=text[cluster[0].start : cluster[-1].end],
                    )
                )
                logic_groups.append(ConstraintGroup(operator="any_of", criterion_ids=(crit_id,)))
                all_of_ids.append(crit_id)
            else:
                single = cluster[0]
                crit_id = f"{kind}-{group_counter}"
                group_counter += 1
                criteria.append(
                    SearchCriterionNode(
                        id=crit_id,
                        field=_field_from_kind(kind),
                        operator="eq",
                        value=single.canonical_key,
                        display_label=single.display_label,
                        source_span=single.raw_span,
                    )
                )
                all_of_ids.append(crit_id)
            idx += 1

    # Conflicting distinct positive sizes ('M beden ve XL beden') detection
    distinct_pos_sizes: list[EntityMention] = []
    seen_size_keys: set[str] = set()
    for sz in positive_by_kind["size"]:
        if (
            sz.canonical_key not in seen_size_keys
            and ("size", sz.canonical_key) not in conflicted_pairs
        ):
            seen_size_keys.add(sz.canonical_key)
            distinct_pos_sizes.append(sz)

    if len(distinct_pos_sizes) > 1:
        has_or = all(
            _has_or_connector_between(text, distinct_pos_sizes[i], distinct_pos_sizes[i + 1])
            for i in range(len(distinct_pos_sizes) - 1)
        )
        if not has_or:
            has_conflict = True
            warnings.append("Birden fazla farklı beden seçildi; hangisini istediğini kontrol et.")
    if distinct_pos_sizes and not (len(distinct_pos_sizes) > 1 and has_conflict):
        sz0 = distinct_pos_sizes[0]
        criteria.append(
            SearchCriterionNode(
                id="size-1",
                field="size",
                operator="eq",
                value=sz0.canonical_key,
                display_label=sz0.display_label,
                source_span=sz0.raw_span,
            )
        )
        all_of_ids.append("size-1")

    # Negated entities (STRICTLY operator='not_in' + ConstraintGroup('not'))
    neg_counter = 1
    for kind in ("brand", "color", "size", "attribute"):
        seen_neg: set[str] = set()
        for neg_item in negative_by_kind[kind]:
            if (
                kind,
                neg_item.canonical_key,
            ) in conflicted_pairs or neg_item.canonical_key in seen_neg:
                continue
            seen_neg.add(neg_item.canonical_key)
            crit_id = f"{kind}-not-{neg_counter}"
            neg_counter += 1
            criteria.append(
                SearchCriterionNode(
                    id=crit_id,
                    field=_field_from_kind(kind),
                    operator="not_in",
                    value=(neg_item.canonical_key,),
                    display_label=f"{neg_item.display_label} olmasın",
                    source_span=neg_item.raw_span,
                )
            )
            logic_groups.append(ConstraintGroup(operator="not", criterion_ids=(crit_id,)))
            warnings.append(f"'{neg_item.display_label} olmasın' negatif filtresi uygulanamaz.")

    # Measurements & attributes (preserved transparently as query_only / metadata)
    for idx, attr in enumerate(positive_by_kind["attribute"], start=1):
        crit_id = f"attr-{idx}"
        criteria.append(
            SearchCriterionNode(
                id=crit_id,
                field="attribute",
                operator="eq",
                value=attr.canonical_key,
                display_label=attr.display_label,
                source_span=attr.raw_span,
            )
        )
        all_of_ids.append(crit_id)

    for idx, meas in enumerate(numbers.measurements, start=1):
        fixed_dec = format(meas.value.normalize(), "f")
        if "." in fixed_dec:
            fixed_dec = fixed_dec.rstrip("0").rstrip(".")
        val_str = f"{fixed_dec} {meas.unit}".replace(".", ",")
        crit_id = f"unit-{idx}"
        criteria.append(
            SearchCriterionNode(
                id=crit_id,
                field="attribute",
                operator="eq",
                value=meas.raw_span,
                display_label=val_str,
                source_span=meas.raw_span,
            )
        )
        all_of_ids.append(crit_id)

    # Detect non-product OOD phrases or empty semantic signals
    is_ood = any(pat.search(text) for pat in _OOD_PATTERNS) and entities.category is None
    safe_raw_query = norm.raw_display or "arama"
    safe_norm_query = text or safe_raw_query
    if not criteria:
        is_ood = True
        warnings.append("Ürün arama ölçütü belirgin değil; genel metin araması hazırlanıyor.")
        criteria.append(
            SearchCriterionNode(
                id="attr-query-1",
                field="attribute",
                operator="eq",
                value=safe_norm_query,
                display_label=safe_raw_query[:80],
                confidence=0.4,
            )
        )
        all_of_ids.append("attr-query-1")

    if all_of_ids:
        logic_groups.insert(0, ConstraintGroup(operator="all_of", criterion_ids=tuple(all_of_ids)))

    confidence_state: ConfidenceState = "review_required"
    if has_conflict or is_ood:
        confidence_state = "abstain"
    elif entities.category is not None and entities.category.showcase and not warnings:
        confidence_state = "high"

    intent = SearchIntentV2(
        raw_query=safe_raw_query,
        normalized_query=safe_norm_query,
        locale="tr-TR",
        input_source="voice" if input_source == "voice" else "text",
        category_key=(
            entities.category.canonical_key
            if entities.category is not None and entities.category.showcase
            else None
        ),
        criteria=tuple(criteria),
        logic_groups=tuple(logic_groups),
    )

    return LogicAssemblyResult(
        intent=intent,
        confidence_state=confidence_state,
        warnings=tuple(dict.fromkeys(warnings)),
        has_conflict=has_conflict,
        is_ood=is_ood,
    )
