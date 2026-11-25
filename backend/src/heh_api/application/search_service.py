"""Zero-DB hot-path application service for 1-RTT search parse and edit-only resolve."""

import re
from decimal import Decimal, InvalidOperation
from typing import Literal

from heh_api.domain.mapping import FacetMappingEntry, MappingSnapshot, ShowcaseCategoryMapping
from heh_api.domain.search_intent import (
    PARSER_VERSION,
    ConstraintGroup,
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
    normalize_display_query,
    normalize_turkish_text,
)
from heh_api.infrastructure.trendyol.url_builder import TrendyolURLBuilder
from heh_api.schemas.search import (
    CategoryCapabilitySummary,
    ProviderCapabilitiesResponse,
    SearchParseRequest,
    SearchParseResponse,
    SearchResolveRequest,
    SearchResolveResponse,
)

_URL_BUILDER = TrendyolURLBuilder()

_RANGE_PATTERN = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(bin)?\s*-\s*(\d+(?:[.,]\d+)?)\s*(bin)?\b")
_UPPER_PATTERN = re.compile(
    r"(?:\b(\d+(?:[.,]\d+)?)\s*(bin)?\s*(?:tl)?\s*alt[ıi]\b|\ben\s+fazla\s+(\d+(?:[.,]\d+)?)\s*(bin)?\b)"
)
_LOWER_PATTERN = re.compile(
    r"(?:\b(\d+(?:[.,]\d+)?)\s*(bin)?\s*(?:tl)?\s*[üu]st[üu]\b|\ben\s+az\s+(\d+(?:[.,]\d+)?)\s*(bin)?\b)"
)
_NEGATION_SUFFIX_PATTERN = re.compile(r"(?:\s+(?:olmasın|hariç|değil|dışında))\b")


def _parse_tr_number(raw_num: str, multiplier: str | None) -> Decimal | None:
    cleaned = raw_num.replace(".", "").replace(",", ".")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    if multiplier:
        value *= Decimal("1000")
    return value


def _extract_price(normalized_text: str) -> PriceValue | None:
    range_match = _RANGE_PATTERN.search(normalized_text)
    if range_match:
        low = _parse_tr_number(range_match.group(1), range_match.group(2))
        high = _parse_tr_number(range_match.group(3), range_match.group(4))
        if low is not None and high is not None and low <= high:
            return PriceValue(min_amount=low, max_amount=high)

    upper_match = _UPPER_PATTERN.search(normalized_text)
    if upper_match:
        num = upper_match.group(1) or upper_match.group(3)
        mult = upper_match.group(2) or upper_match.group(4)
        high = _parse_tr_number(num, mult)
        if high is not None:
            return PriceValue(min_amount=Decimal("0"), max_amount=high)

    lower_match = _LOWER_PATTERN.search(normalized_text)
    if lower_match:
        num = lower_match.group(1) or lower_match.group(3)
        mult = lower_match.group(2) or lower_match.group(4)
        low = _parse_tr_number(num, mult)
        if low is not None:
            return PriceValue(min_amount=low, max_amount=None)

    return None


def _contains_alias(normalized_text: str, alias: str) -> re.Match[str] | None:
    pattern = re.compile(rf"(?<!\w){re.escape(alias)}(?!\w)")
    return pattern.search(normalized_text)


def _match_category(
    normalized_text: str,
    snapshot: MappingSnapshot,
) -> ShowcaseCategoryMapping | None:
    candidates: list[tuple[int, ShowcaseCategoryMapping]] = []
    for category in snapshot.categories:
        for alias in category.aliases:
            if _contains_alias(normalized_text, normalize_turkish_text(alias)):
                candidates.append((len(alias), category))
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return candidates[0][1]


def _match_facet_entries(
    normalized_text: str,
    entries: tuple[FacetMappingEntry, ...],
) -> tuple[list[FacetMappingEntry], list[FacetMappingEntry]]:
    positive: list[FacetMappingEntry] = []
    negated: list[FacetMappingEntry] = []
    for entry in entries:
        matched_span: re.Match[str] | None = None
        for alias in entry.aliases:
            matched_span = _contains_alias(normalized_text, normalize_turkish_text(alias))
            if matched_span is not None:
                break
        if matched_span is None:
            continue
        trailing = normalized_text[matched_span.end() :]
        if _NEGATION_SUFFIX_PATTERN.match(trailing):
            negated.append(entry)
        else:
            positive.append(entry)
    return positive, negated


def parse_search_query(
    request: SearchParseRequest,
    *,
    snapshot: MappingSnapshot,
    nlp_mode: Literal["rules", "shadow", "hybrid"],
    request_id: str,
) -> SearchParseResponse:
    """Parse raw Turkish query into SearchIntentV2 AST and initial 1-RTT LinkResolution."""
    raw_clean = normalize_display_query(request.text)
    normalized = normalize_turkish_text(raw_clean)
    category = _match_category(normalized, snapshot)

    criteria: list[SearchCriterionNode] = []
    logic_groups: list[ConstraintGroup] = []
    warnings: list[str] = []

    if category is not None:
        criteria.append(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value=category.category_key,
                display_label=category.display_name,
            )
        )

    price_val = _extract_price(normalized)
    if price_val is not None:
        price_label = (
            f"{int(price_val.min_amount or 0)}-{int(price_val.max_amount)} TL"
            if price_val.max_amount is not None
            else f"{int(price_val.min_amount or 0)}+ TL"
        )
        criteria.append(
            SearchCriterionNode(
                id="price-1",
                field="price",
                operator="between"
                if price_val.min_amount is not None and price_val.max_amount is not None
                else ("lte" if price_val.max_amount is not None else "gte"),
                value=price_val,
                display_label=price_label,
            )
        )

    if category is not None:
        pos_brands, neg_brands = _match_facet_entries(normalized, category.brands)
        if len(pos_brands) > 1:
            criteria.append(
                SearchCriterionNode(
                    id="brand-or",
                    field="brand",
                    operator="in",
                    value=tuple(b.canonical_key for b in pos_brands),
                    display_label=" veya ".join(b.display_label for b in pos_brands),
                )
            )
            logic_groups.append(ConstraintGroup(operator="any_of", criterion_ids=("brand-or",)))
        elif len(pos_brands) == 1:
            criteria.append(
                SearchCriterionNode(
                    id="brand-1",
                    field="brand",
                    operator="eq",
                    value=pos_brands[0].canonical_key,
                    display_label=pos_brands[0].display_label,
                )
            )

        for idx, neg_brand in enumerate(neg_brands, start=1):
            crit_id = f"brand-not-{idx}"
            criteria.append(
                SearchCriterionNode(
                    id=crit_id,
                    field="brand",
                    operator="not_in",
                    value=(neg_brand.canonical_key,),
                    display_label=f"{neg_brand.display_label} olmasın",
                )
            )
            logic_groups.append(ConstraintGroup(operator="not", criterion_ids=(crit_id,)))
            warnings.append(f"'{neg_brand.display_label} olmasın' negatif filtresi uygulanamaz.")

        pos_colors, neg_colors = _match_facet_entries(
            normalized, category.colors or snapshot.global_colors
        )
        if pos_colors:
            criteria.append(
                SearchCriterionNode(
                    id="color-1",
                    field="color",
                    operator="eq",
                    value=pos_colors[0].canonical_key,
                    display_label=pos_colors[0].display_label,
                )
            )
        for idx, neg_color in enumerate(neg_colors, start=1):
            crit_id = f"color-not-{idx}"
            criteria.append(
                SearchCriterionNode(
                    id=crit_id,
                    field="color",
                    operator="not_in",
                    value=(neg_color.canonical_key,),
                    display_label=f"{neg_color.display_label} olmasın",
                )
            )
            logic_groups.append(ConstraintGroup(operator="not", criterion_ids=(crit_id,)))
            warnings.append(f"'{neg_color.display_label} olmasın' negatif filtresi uygulanamaz.")

        pos_sizes, _ = _match_facet_entries(normalized, category.sizes)
        if pos_sizes:
            criteria.append(
                SearchCriterionNode(
                    id="size-1",
                    field="size",
                    operator="eq",
                    value=pos_sizes[0].canonical_key,
                    display_label=pos_sizes[0].display_label,
                )
            )

    if category is None and not any(c.field == "attribute" for c in criteria):
        # Preserve long-tail search phrases explicitly so UI surfaces QUERY_ONLY transparently.
        criteria.append(
            SearchCriterionNode(
                id="attr-query-1",
                field="attribute",
                operator="eq",
                value=normalized,
                display_label=raw_clean[:80],
                confidence=0.6,
            )
        )

    intent = SearchIntentV2(
        raw_query=raw_clean,
        normalized_query=normalized,
        locale=request.locale,
        input_source=request.input_source,
        category_key=category.category_key if category is not None else None,
        criteria=tuple(criteria),
        logic_groups=tuple(logic_groups),
    )
    resolution = _URL_BUILDER.build_resolution(intent, snapshot)

    return SearchParseResponse(
        request_id=request_id,
        parser_version=PARSER_VERSION,
        nlp_mode=nlp_mode,
        intent=intent,
        confidence_state="review_required",
        warnings=tuple(warnings),
        resolution=resolution,
    )


def resolve_search_intent(
    request: SearchResolveRequest,
    *,
    snapshot: MappingSnapshot,
    request_id: str,
) -> SearchResolveResponse:
    """Recompute LinkResolution deterministically from edited SearchIntentV2 AST."""
    resolution = _URL_BUILDER.build_resolution(request.intent, snapshot)
    return SearchResolveResponse(
        request_id=request_id,
        intent=request.intent,
        resolution=resolution,
    )


def list_provider_capabilities(snapshot: MappingSnapshot) -> ProviderCapabilitiesResponse:
    """Return active showcase capabilities from the immutable boot snapshot."""
    summaries = tuple(
        CategoryCapabilitySummary(
            category_key=cat.category_key,
            display_name=cat.display_name,
            status=cat.category_status,
            supports_brand_or=len(cat.brands) > 1,
            supports_color=len(cat.colors) > 0,
            supports_size=len(cat.sizes) > 0,
            negative_supported=cat.negative_supported,
        )
        for cat in snapshot.categories
    )
    return ProviderCapabilitiesResponse(
        provider=snapshot.provider,
        mapping_version=snapshot.version,
        long_tail_policy=snapshot.long_tail_policy,
        showcase_categories=summaries,
    )
