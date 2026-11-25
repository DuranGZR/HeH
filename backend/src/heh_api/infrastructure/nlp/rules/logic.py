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
from heh_api.infrastructure.nlp.rules.normalize import NormalizationResult, ProtectedSpan
from heh_api.infrastructure.nlp.rules.numbers import PriceExtractionResult

_OR_CONNECTOR_PATTERN = re.compile(r"^\s*(?:veya|ya\s+da|yada|/)\s*$")
_LIST_OR_NEG_BRIDGE_PATTERN = re.compile(r"^\s*(?:ve|veya|ya\s+da|yada|,|/)\s*$")
_COMMA_BRIDGE_PATTERN = re.compile(r"^\s*,\s*$")
_HARD_CLAUSE_BREAK_PATTERN = re.compile(r"\b(?:ama|fakat|ancak)\b|[;!?]")
_POST_NEGATION_PATTERN = re.compile(
    r"^\s*(?:da\s+)?(?:olmas[ıi]n|olmayan|hari[çc](?:tir)?|d[ıi][şs][ıi]nda|istemiyorum)\b"
)
_PRE_CLAUSE_BREAK_PATTERN = re.compile(r"\b(?:ama|fakat|ancak)\b|[;,.!?]")
_MODIFIER_NEGATION_DEĞIL_PATTERN = re.compile(r"^\s*de[ğg]il\b")

_ONTOLOGY_UNIT_KEY_MAP: dict[str, str] = {
    "gb": "GB",
    "tb": "TB",
    "inç": "inc",
    "saat": "saat",
    "mah": "mAh",
    "l": "litre",
    "ml": "ml",
    "kg": "kg",
    "g": "gr",
    "hz": "Hz",
    "w": "W",
    "cm": "cm",
    "mm": "mm",
}

_OOD_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"(?:\bhava\s+nas[ıi]l|(?<!ak[ıi]ll[ıi]\s)\bsaat\s+ka[çc]|merhaba|selam|naber|nas[ıi]ls[ıi]n|"
        r"dolar\s+ka[çc]|euro\s+ka[çc]|alt[ıi]n\s+fiyat[ıi]?|yemek\s+tarifi|ma[çc]\s+ka[çc]|"
        r"beni\s+mutlu\s+edecek)"
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


def _compute_negated_indices(
    text: str,
    mentions: list[EntityMention],
    protected_spans: tuple[ProtectedSpan, ...],
) -> set[int]:
    """Resolve Turkish negation scope transitively (supports 3+ lists & model suffixes)."""
    negated: set[int] = set()
    # Pass 1: direct post-positive / contrastive negation (also past touching protected model span)
    for idx, mention in enumerate(mentions):
        if _is_negated_directly(text, mention, protected_spans):
            negated.add(idx)

    # Pass 2: right-to-left transitive propagation across list bridges ('Nike, Puma ve Adidas')
    for idx in range(len(mentions) - 1, -1, -1):
        if idx in negated:
            continue
        mention = mentions[idx]
        for next_idx in range(idx + 1, len(mentions)):
            later = mentions[next_idx]
            if later.kind != mention.kind:
                continue
            between = text[mention.end : later.start]
            if _HARD_CLAUSE_BREAK_PATTERN.search(between):
                break
            # Check gap when adjacent same-kind sibling is directly after mention
            if next_idx in negated and _LIST_OR_NEG_BRIDGE_PATTERN.match(between):
                negated.add(idx)
                break
            # Stop scanning if an un-bridged token blocks propagation to later same-kind items
            if not _LIST_OR_NEG_BRIDGE_PATTERN.match(between):
                break

    return negated


def _is_negated_directly(
    text: str,
    mention: EntityMention,
    protected_spans: tuple[ProtectedSpan, ...] = (),
) -> bool:
    candidate_ends = [mention.end]
    for sp in protected_spans:
        if sp.start <= mention.end <= sp.end and sp.end not in candidate_ends:
            candidate_ends.append(sp.end)
    for end_pos in candidate_ends:
        trailing = text[end_pos:]
        if _POST_NEGATION_PATTERN.match(trailing) or _MODIFIER_NEGATION_DEĞIL_PATTERN.match(
            trailing
        ):
            return True
    return False


def _has_or_connector_between(text: str, first: EntityMention, second: EntityMention) -> bool:
    between = text[first.end : second.start]
    if _HARD_CLAUSE_BREAK_PATTERN.search(between):
        return False
    return bool(_OR_CONNECTOR_PATTERN.match(between))


def _chain_terminates_with_or(
    text: str,
    items: list[EntityMention],
    start_idx: int,
) -> bool:
    """Allow comma-separated list members ('Nike, Puma veya Adidas') into a single OR group."""
    cursor = start_idx
    while cursor + 1 < len(items):
        between = text[items[cursor].end : items[cursor + 1].start]
        if _has_or_connector_between(text, items[cursor], items[cursor + 1]):
            return True
        if _COMMA_BRIDGE_PATTERN.match(between):
            cursor += 1
            continue
        return False
    return False


def _field_from_kind(kind: str) -> CriterionField:
    if kind == "category":
        return "category"
    if kind == "brand":
        return "brand"
    if kind == "color":
        return "color"
    if kind == "size":
        return "size"
    if kind == "gender":
        return "gender"
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

    # Split non-category mentions into positive vs negated strictly using transitive scope
    positive_by_kind: dict[str, list[EntityMention]] = {
        "brand": [],
        "color": [],
        "size": [],
        "gender": [],
        "attribute": [],
    }
    negative_by_kind: dict[str, list[EntityMention]] = {
        "brand": [],
        "color": [],
        "size": [],
        "gender": [],
        "attribute": [],
    }

    non_cat_mentions = [m for m in entities.mentions if m.kind != "category"]
    negated_idx_set = _compute_negated_indices(text, non_cat_mentions, norm.protected_spans)
    for idx, mention in enumerate(non_cat_mentions):
        if idx in negated_idx_set:
            negative_by_kind[mention.kind].append(mention)
        else:
            positive_by_kind[mention.kind].append(mention)

    # Contradiction detection: same (kind, canonical_key) both positive and negated
    conflicted_pairs: set[tuple[str, str]] = set()
    for kind in ("brand", "color", "size", "gender", "attribute"):
        pos_keys = {m.canonical_key: m.display_label for m in positive_by_kind[kind]}
        neg_keys = {m.canonical_key for m in negative_by_kind[kind]}
        for shared_key in sorted(set(pos_keys).intersection(neg_keys)):
            conflicted_pairs.add((kind, shared_key))
            has_conflict = True
            label = pos_keys[shared_key]
            warnings.append(
                f"Çelişkili ölçüt: '{label}' hem istendi hem dışlandı; güvenlik için uygulanmadı."
            )

    # Category node (skip if negated directly e.g. 'erkek mont olmasın')
    cat_mention = next((m for m in entities.mentions if m.kind == "category"), None)
    cat_is_negated = cat_mention is not None and _is_negated_directly(
        text, cat_mention, norm.protected_spans
    )
    active_category = None if cat_is_negated else entities.category
    if cat_mention is not None and cat_is_negated and entities.category is not None:
        criteria.append(
            SearchCriterionNode(
                id="cat-not-1",
                field="category",
                operator="not_in",
                value=(entities.category.canonical_key,),
                display_label=f"{entities.category.display_name} olmasın",
                source_span=cat_mention.raw_span,
                span_start=cat_mention.start,
                span_end=cat_mention.end,
            )
        )
        logic_groups.append(ConstraintGroup(operator="not", criterion_ids=("cat-not-1",)))
        warnings.append(f"'{entities.category.display_name} olmasın' negatif filtresi uygulanamaz.")
    elif cat_mention is not None and active_category is not None:
        criteria.append(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value=active_category.canonical_key,
                display_label=active_category.display_name,
                source_span=cat_mention.raw_span,
                span_start=cat_mention.start,
                span_end=cat_mention.end,
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
                modality="should" if numbers.modality == "approximate" else "must",
                unit="TRY",
                source_span=numbers.source_span,
            )
        )

    # Group OR positive brands/colors (`veya` / `ya da` / comma-OR); keep single AND nodes
    all_of_ids: list[str] = []
    if cat_mention is not None and active_category is not None:
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
            while idx + 1 < len(deduped_pos) and (
                _has_or_connector_between(text, deduped_pos[idx], deduped_pos[idx + 1])
                or _chain_terminates_with_or(text, deduped_pos, idx)
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
                        modality="should",
                        source_span=text[cluster[0].start : cluster[-1].end],
                        span_start=cluster[0].start,
                        span_end=cluster[-1].end,
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
                        span_start=single.start,
                        span_end=single.end,
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

    size_has_or = len(distinct_pos_sizes) > 1 and all(
        _has_or_connector_between(text, distinct_pos_sizes[i], distinct_pos_sizes[i + 1])
        or _chain_terminates_with_or(text, distinct_pos_sizes, i)
        for i in range(len(distinct_pos_sizes) - 1)
    )
    if len(distinct_pos_sizes) > 1 and not size_has_or:
        has_conflict = True
        warnings.append("Birden fazla farklı beden seçildi; hangisini istediğini kontrol et.")
    elif len(distinct_pos_sizes) > 1 and size_has_or:
        criteria.append(
            SearchCriterionNode(
                id="size-or-1",
                field="size",
                operator="in",
                value=tuple(s.canonical_key for s in distinct_pos_sizes),
                display_label=" veya ".join(s.display_label for s in distinct_pos_sizes),
                modality="should",
                source_span=text[distinct_pos_sizes[0].start : distinct_pos_sizes[-1].end],
                span_start=distinct_pos_sizes[0].start,
                span_end=distinct_pos_sizes[-1].end,
            )
        )
        logic_groups.append(ConstraintGroup(operator="any_of", criterion_ids=("size-or-1",)))
        all_of_ids.append("size-or-1")
    elif distinct_pos_sizes:
        sz0 = distinct_pos_sizes[0]
        criteria.append(
            SearchCriterionNode(
                id="size-1",
                field="size",
                operator="eq",
                value=sz0.canonical_key,
                display_label=sz0.display_label,
                source_span=sz0.raw_span,
                span_start=sz0.start,
                span_end=sz0.end,
            )
        )
        all_of_ids.append("size-1")

    # Gender criteria (captured when not implied by showcase erkek_mont)
    for g_idx, g_item in enumerate(positive_by_kind["gender"], start=1):
        if ("gender", g_item.canonical_key) in conflicted_pairs:
            continue
        crit_id = f"gender-{g_idx}"
        criteria.append(
            SearchCriterionNode(
                id=crit_id,
                field="gender",
                operator="eq",
                value=g_item.canonical_key,
                display_label=g_item.display_label,
                source_span=g_item.raw_span,
                span_start=g_item.start,
                span_end=g_item.end,
            )
        )
        all_of_ids.append(crit_id)

    # Negated entities (STRICTLY operator='not_in' + ConstraintGroup('not'))
    neg_counter = 1
    for kind in ("brand", "color", "size", "gender", "attribute"):
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
                    span_start=neg_item.start,
                    span_end=neg_item.end,
                )
            )
            logic_groups.append(ConstraintGroup(operator="not", criterion_ids=(crit_id,)))
            warnings.append(f"'{neg_item.display_label} olmasın' negatif filtresi uygulanamaz.")

    # Measurements & attributes (deduplicated & preserved transparently as query_only / metadata)
    seen_attrs: set[str] = set()
    attr_counter = 1
    for attr in positive_by_kind["attribute"]:
        if (
            "attribute",
            attr.canonical_key,
        ) in conflicted_pairs or attr.canonical_key in seen_attrs:
            continue
        seen_attrs.add(attr.canonical_key)
        crit_id = f"attr-{attr_counter}"
        attr_counter += 1
        criteria.append(
            SearchCriterionNode(
                id=crit_id,
                field="attribute",
                operator="eq",
                value=attr.canonical_key,
                display_label=attr.display_label,
                source_span=attr.raw_span,
                span_start=attr.start,
                span_end=attr.end,
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
                unit=_ONTOLOGY_UNIT_KEY_MAP.get(meas.unit, meas.unit),
                source_span=meas.raw_span,
            )
        )
        all_of_ids.append(crit_id)

    # Detect non-product OOD phrases or empty semantic signals
    is_explicit_ood = any(pat.search(text) for pat in _OOD_PATTERNS)
    is_ood = is_explicit_ood and (
        active_category is None or "beni mutlu edecek" in text or "altın fiyat" in text
    )
    safe_raw_query = norm.raw_display or "arama"
    safe_norm_query = text or safe_raw_query
    if not criteria or is_ood:
        is_ood = True
        warnings.append("Ürün arama ölçütü belirgin değil; genel metin araması hazırlanıyor.")
        if not criteria:
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
    elif active_category is not None and active_category.showcase and not warnings:
        confidence_state = "high"

    intent = SearchIntentV2(
        intent_type="unsupported" if is_ood else "ambiguous" if has_conflict else "product_search",
        raw_query=safe_raw_query,
        normalized_query=safe_norm_query,
        locale="tr-TR",
        input_source="voice" if input_source == "voice" else "text",
        category_key=(
            active_category.canonical_key
            if active_category is not None and active_category.showcase and not is_ood
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
