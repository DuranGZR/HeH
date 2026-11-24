"""Zero-DB hot-path application service for 1-RTT search parse and edit-only resolve."""

import re
from decimal import Decimal, InvalidOperation
from typing import Literal
from urllib.parse import quote, urlencode

from heh_api.domain.mapping import FacetMappingEntry, MappingSnapshot, ShowcaseCategoryMapping
from heh_api.domain.search_intent import (
    PARSER_VERSION,
    ConstraintGroup,
    LinkFilterItem,
    LinkResolution,
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
    normalize_display_query,
    normalize_turkish_text,
)
from heh_api.domain.verification import RouteStrategyKind
from heh_api.schemas.search import (
    CategoryCapabilitySummary,
    ProviderCapabilitiesResponse,
    SearchParseRequest,
    SearchParseResponse,
    SearchResolveRequest,
    SearchResolveResponse,
)

_SPONSORED_NOTICE = (
    "Doğrulanan ölçütler web kanıtına dayanır; mobil uygulama doğrulaması beklenir ve "
    "Trendyol'daki Sponsorlu alanlar fiyat aralığı dışında kalabilir."
)

_RANGE_PATTERN = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(bin)?\s*-\s*(\d+(?:[.,]\d+)?)\s*(bin)?\b")
_UPPER_PATTERN = re.compile(
    r"(?:\b(\d+(?:[.,]\d+)?)\s*(bin)?\s*(?:tl)?\s*alt[ıi]\b|\ben\s+fazla\s+(\d+(?:[.,]\d+)?)\s*(bin)?\b)"
)
_LOWER_PATTERN = re.compile(
    r"(?:\b(\d+(?:[.,]\d+)?)\s*(bin)?\s*(?:tl)?\s*[üu]st[üu]\b|\ben\s+az\s+(\d+(?:[.,]\d+)?)\s*(bin)?\b)"
)
_NEGATION_SUFFIX_PATTERN = re.compile(r"(?:\s+(?:olmasın|hariç|değil))\b")


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


def _format_price_param(price: PriceValue) -> str:
    low_str = str(int(price.min_amount)) if price.min_amount is not None else "0"
    high_str = str(int(price.max_amount)) if price.max_amount is not None else "*"
    return f"{low_str}-{high_str}"


def _build_trendyol_resolution(intent: SearchIntentV2, snapshot: MappingSnapshot) -> LinkResolution:
    """Resolve an edited or parsed SearchIntent v2 AST strictly from in-memory snapshot."""
    category = snapshot.find_category_by_key(intent.category_key)
    applied: list[LinkFilterItem] = []
    query_only: list[LinkFilterItem] = []
    unsupported: list[LinkFilterItem] = []
    query_params: list[tuple[str, str]] = []

    if category is not None:
        query_params.append(("wc", category.wc_id))
        if category.wg_id is not None:
            query_params.append(("wg", category.wg_id))

    brand_entries: list[FacetMappingEntry] = []
    color_entries: list[FacetMappingEntry] = []
    size_entries: list[FacetMappingEntry] = []
    price_value: PriceValue | None = None

    for criterion in intent.criteria:
        if criterion.operator == "not_in":
            unsupported.append(
                LinkFilterItem(
                    criterion_id=criterion.id,
                    field=criterion.field,
                    label=criterion.display_label,
                    operator=criterion.operator,
                    status="UNSUPPORTED",
                    reason="Trendyol yan menü ve URL şemasında negatif dışlama desteği yok.",
                )
            )
            continue

        if criterion.field == "category" and category is not None:
            applied.append(
                LinkFilterItem(
                    criterion_id=criterion.id,
                    field="category",
                    label=category.display_name,
                    operator="eq",
                    status=category.category_status,
                    url_param="wc",
                    url_value=category.wc_id,
                    reason="Vitrin kategori kimliği web gözlemi ile doğrulandı.",
                    evidence_ref=category.evidence_ref,
                )
            )
            continue

        if criterion.field == "price" and isinstance(criterion.value, PriceValue):
            price_value = criterion.value
            prc_param = _format_price_param(price_value)
            applied.append(
                LinkFilterItem(
                    criterion_id=criterion.id,
                    field="price",
                    label=criterion.display_label,
                    operator=criterion.operator,
                    status="WEB_VERIFIED_PENDING_MOBILE",
                    url_param="prc",
                    url_value=prc_param,
                    reason="Fiyat aralığı Trendyol prc parametresine bağlandı.",
                    evidence_ref="evidence/W1/d02-url-observations.json",
                )
            )
            continue

        if criterion.field == "brand" and category is not None:
            requested = (
                list(criterion.value)
                if isinstance(criterion.value, tuple)
                else [str(criterion.value)]
            )
            matched_brands = [
                entry
                for req in requested
                for entry in category.brands
                if entry.canonical_key == normalize_turkish_text(req)
            ]
            if len(matched_brands) == len(requested) and matched_brands:
                brand_entries.extend(matched_brands)
                joined_ids = ",".join(item.url_value for item in matched_brands)
                applied.append(
                    LinkFilterItem(
                        criterion_id=criterion.id,
                        field="brand",
                        label=criterion.display_label,
                        operator=criterion.operator,
                        status=matched_brands[0].status,
                        url_param="wb",
                        url_value=joined_ids,
                        reason="Marka kimliği web gözlemiyle eşlendi.",
                        evidence_ref=matched_brands[0].evidence_ref,
                    )
                )
                continue

        if criterion.field == "color":
            pool = (
                category.colors
                if category is not None and category.colors
                else snapshot.global_colors
            )
            key = normalize_turkish_text(str(criterion.value))
            color_match = next((c for c in pool if c.canonical_key == key), None)
            if color_match is not None:
                color_entries.append(color_match)
                applied.append(
                    LinkFilterItem(
                        criterion_id=criterion.id,
                        field="color",
                        label=criterion.display_label,
                        operator=criterion.operator,
                        status=color_match.status,
                        url_param=color_match.url_param,
                        url_value=color_match.url_value,
                        reason="Renk kodu wcl parametresiyle doğrulandı.",
                        evidence_ref=color_match.evidence_ref,
                    )
                )
                continue

        if criterion.field == "size" and category is not None:
            key = normalize_turkish_text(str(criterion.value))
            size_match = next((s for s in category.sizes if s.canonical_key == key), None)
            if size_match is not None:
                size_entries.append(size_match)
                applied.append(
                    LinkFilterItem(
                        criterion_id=criterion.id,
                        field="size",
                        label=criterion.display_label,
                        operator=criterion.operator,
                        status=size_match.status,
                        url_param=size_match.url_param,
                        url_value=size_match.url_value,
                        reason="Beden parametresi vr kodu ile doğrulandı.",
                        evidence_ref=size_match.evidence_ref,
                    )
                )
                continue

        query_only.append(
            LinkFilterItem(
                criterion_id=criterion.id,
                field=criterion.field,
                label=criterion.display_label,
                operator=criterion.operator,
                status="QUERY_ONLY",
                reason="Doğrulanmış parametre yok; q arama metniyle aktarılır.",
            )
        )

    # Choose verified -x- facet route only for clean single-brand + category showcase case,
    # otherwise construct safe canonical /sr?... query string.
    route_strategy: RouteStrategyKind = "canonical_search_query"
    if (
        category is not None
        and category.wg_id is None
        and price_value is None
        and len(brand_entries) == 1
        and not color_entries
        and not size_entries
        and not query_only
    ):
        route_strategy = "verified_facet_path"
        single_brand = brand_entries[0]
        cat_slug = category.category_key.replace("_", "-")
        raw_slug = (
            f"{single_brand.canonical_key}-{cat_slug}-x-b{single_brand.url_value}-c{category.wc_id}"
        )
        slug = quote(raw_slug, safe="-")
        suffix = f"?{urlencode({'prc': _format_price_param(price_value)})}" if price_value else ""
        resolved_url = f"https://www.trendyol.com/{slug}{suffix}"
    else:
        if category is None or query_only or not applied:
            query_params.append(("q", intent.raw_query))
        if brand_entries:
            query_params.append(("wb", ",".join(item.url_value for item in brand_entries)))
        if color_entries:
            query_params.append(("wcl", color_entries[0].url_value))
        if size_entries:
            query_params.append(("vr", size_entries[0].url_value))
        if price_value is not None:
            query_params.append(("prc", _format_price_param(price_value)))
        resolved_url = f"https://www.trendyol.com/sr?{urlencode(query_params)}"

    warning_level: Literal["none", "partial", "critical"] = "none"
    if unsupported or query_only:
        warning_level = "partial"
    if not applied and unsupported:
        warning_level = "critical"

    return LinkResolution(
        provider="trendyol",
        url=resolved_url,
        route_strategy=route_strategy,
        mapping_version=snapshot.version,
        applied_filters=tuple(applied),
        query_only=tuple(query_only),
        unsupported=tuple(unsupported),
        warning_level=warning_level,
        verification_notice=_SPONSORED_NOTICE,
    )


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

    if not criteria:
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
    resolution = _build_trendyol_resolution(intent, snapshot)

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
    resolution = _build_trendyol_resolution(request.intent, snapshot)
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
