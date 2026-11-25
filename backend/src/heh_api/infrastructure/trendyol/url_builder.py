"""Safe TrendyolRouteStrategy implementations and URLBuilder security guardrails."""

from datetime import datetime
from typing import Protocol
from urllib.parse import quote, urlencode

from heh_api.domain.mapping import FacetMappingEntry, MappingSnapshot, ShowcaseCategoryMapping
from heh_api.domain.search_intent import (
    CriterionField,
    LinkFilterItem,
    LinkResolution,
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
    normalize_display_query,
    normalize_turkish_text,
)
from heh_api.domain.verification import (
    ALLOWED_FACET_SEGMENT_PATTERN,
    ALLOWED_TRENDYOL_QUERY_PARAMS,
    RouteStrategyKind,
    is_evidence_expired,
    validate_provider_url,
)

_SPONSORED_NOTICE = (
    "Doğrulanan ölçütler web kanıtına dayanır; mobil uygulama doğrulaması beklenir ve "
    "Trendyol'daki Sponsorlu alanlar fiyat aralığı dışında kalabilir."
)


class UnsafeUrlConstructionError(ValueError):
    """Raised when URL assembly violates host, scheme, param, or -x- segment allowlists."""


class TrendyolRouteStrategy(Protocol):
    """Strategy interface converting verified resolved criteria into a safe Trendyol URL."""

    strategy_kind: RouteStrategyKind

    def build_url(
        self,
        *,
        intent: SearchIntentV2,
        category: ShowcaseCategoryMapping | None,
        brand_entries: list[FacetMappingEntry],
        color_entries: list[FacetMappingEntry],
        size_entries: list[FacetMappingEntry],
        price_value: PriceValue | None,
        include_source_query: bool,
    ) -> str:
        """Build an allowlisted Trendyol HTTPS URL."""
        ...


def format_price_param(price: PriceValue) -> str:
    """Format monetary PriceValue into Trendyol's canonical `prc` range token."""
    low_str = str(int(price.min_amount)) if price.min_amount is not None else "0"
    high_str = str(int(price.max_amount)) if price.max_amount is not None else "*"
    return f"{low_str}-{high_str}"


def build_safe_query_string(params: list[tuple[str, str]]) -> str:
    """Encode strictly allowlisted query pairs via RFC-safe percent encoding."""
    for key, value in params:
        if key not in ALLOWED_TRENDYOL_QUERY_PARAMS:
            raise UnsafeUrlConstructionError(f"Disallowed query parameter key: '{key}'")
        if any(ch in value for ch in ("\r", "\n", "\x00")):
            raise UnsafeUrlConstructionError("Query parameter contains control characters")
    return urlencode(params, safe="")


class VerifiedFacetPathStrategy:
    """Build proven Trendyol `-x-` SEO paths for single-facet verified showcase queries."""

    strategy_kind: RouteStrategyKind = "verified_facet_path"

    def build_url(
        self,
        *,
        intent: SearchIntentV2,
        category: ShowcaseCategoryMapping | None,
        brand_entries: list[FacetMappingEntry],
        color_entries: list[FacetMappingEntry],
        size_entries: list[FacetMappingEntry],
        price_value: PriceValue | None,
        include_source_query: bool,
    ) -> str:
        """Assemble a proven single-brand or single-color `-x-` path URL."""
        if category is None or size_entries or include_source_query or price_value is not None:
            raise UnsafeUrlConstructionError("VerifiedFacetPathStrategy preconditions not met")

        cat_slug = category.category_key.replace("_", "-")
        if len(brand_entries) == 1 and not color_entries and category.wg_id is None:
            brand = brand_entries[0]
            if not brand.url_value.isdigit() or not category.wc_id.isdigit():
                raise UnsafeUrlConstructionError("Brand/category IDs must be numeric for -x- route")
            segment = f"b{brand.url_value}-c{category.wc_id}"
            prefix = f"{brand.canonical_key}-{cat_slug}"
        elif len(color_entries) == 1 and not brand_entries and category.wg_id is not None:
            color = color_entries[0]
            if not (
                color.url_value.isdigit() and category.wg_id.isdigit() and category.wc_id.isdigit()
            ):
                raise UnsafeUrlConstructionError(
                    "Color/gender/category IDs must be numeric for -x- route"
                )
            segment = f"r{color.url_value}-g{category.wg_id}-c{category.wc_id}"
            prefix = f"{color.canonical_key}-{cat_slug}"
        else:
            raise UnsafeUrlConstructionError(
                "Unsupported filter combination for verified_facet_path"
            )

        if not ALLOWED_FACET_SEGMENT_PATTERN.match(segment):
            raise UnsafeUrlConstructionError(f"Unsafe -x- facet segment: '{segment}'")

        safe_slug = quote(f"{prefix}-x-{segment}", safe="-")
        candidate_url = f"https://www.trendyol.com/{safe_slug}"
        return validate_provider_url(
            candidate_url, self.strategy_kind, enforce_allowlisted_params=True
        )


class CanonicalSearchQueryStrategy:
    """Build canonical `/sr?...` queries supporting OR brands, combined filters, and long-tail q."""

    strategy_kind: RouteStrategyKind = "canonical_search_query"

    def build_url(
        self,
        *,
        intent: SearchIntentV2,
        category: ShowcaseCategoryMapping | None,
        brand_entries: list[FacetMappingEntry],
        color_entries: list[FacetMappingEntry],
        size_entries: list[FacetMappingEntry],
        price_value: PriceValue | None,
        include_source_query: bool,
    ) -> str:
        """Assemble allowlisted `/sr?...` query string preserving source Turkish query text."""
        query_params: list[tuple[str, str]] = []
        if category is not None:
            query_params.append(("wc", category.wc_id))
            if category.wg_id is not None:
                query_params.append(("wg", category.wg_id))

        if include_source_query:
            clean_source = normalize_display_query(intent.raw_query)
            if not clean_source:
                raise UnsafeUrlConstructionError("Source query text cannot be empty for q fallback")
            query_params.append(("q", clean_source))

        if brand_entries:
            query_params.append(("wb", ",".join(item.url_value for item in brand_entries)))
        if color_entries:
            query_params.append(("wcl", color_entries[0].url_value))
        if size_entries:
            query_params.append(("vr", size_entries[0].url_value))
        if price_value is not None:
            query_params.append(("prc", format_price_param(price_value)))

        encoded = build_safe_query_string(query_params)
        candidate_url = f"https://www.trendyol.com/sr?{encoded}"
        return validate_provider_url(
            candidate_url, self.strategy_kind, enforce_allowlisted_params=True
        )


class TrendyolURLBuilder:
    """Construct verified, expiry-aware Trendyol search URLs from immutable snapshot + AST."""

    def __init__(
        self,
        *,
        facet_strategy: TrendyolRouteStrategy | None = None,
        canonical_strategy: TrendyolRouteStrategy | None = None,
    ) -> None:
        self._facet_strategy = facet_strategy or VerifiedFacetPathStrategy()
        self._canonical_strategy = canonical_strategy or CanonicalSearchQueryStrategy()

    @staticmethod
    def _resolve_single_facet(
        *,
        criterion: SearchCriterionNode,
        field: CriterionField,
        pool: tuple[FacetMappingEntry, ...],
        now: datetime | None,
        applied: list[LinkFilterItem],
        query_only: list[LinkFilterItem],
        collector: list[FacetMappingEntry],
        verified_reason: str,
        expired_reason: str,
    ) -> bool:
        key = normalize_turkish_text(str(criterion.value))
        match = next((item for item in pool if item.canonical_key == key), None)
        if match is None:
            return False

        if is_evidence_expired(match.expires_at, now=now):
            query_only.append(
                LinkFilterItem(
                    criterion_id=criterion.id,
                    field=field,
                    label=criterion.display_label,
                    operator=criterion.operator,
                    status="UNKNOWN",
                    reason=expired_reason,
                )
            )
            return True

        collector.append(match)
        applied.append(
            LinkFilterItem(
                criterion_id=criterion.id,
                field=field,
                label=criterion.display_label,
                operator=criterion.operator,
                status=match.status,
                url_param=match.url_param,
                url_value=match.url_value,
                reason=verified_reason,
                evidence_ref=match.evidence_ref,
            )
        )
        return True

    def build_resolution(
        self,
        intent: SearchIntentV2,
        snapshot: MappingSnapshot,
        *,
        now: datetime | None = None,
    ) -> LinkResolution:
        """Resolve an AST into an honest LinkResolution honoring proof and expiry gates."""
        raw_category = snapshot.find_category_by_key(intent.category_key)
        category_expired = raw_category is not None and is_evidence_expired(
            raw_category.expires_at, now=now
        )
        category = None if category_expired else raw_category

        applied: list[LinkFilterItem] = []
        query_only: list[LinkFilterItem] = []
        unsupported: list[LinkFilterItem] = []

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

            if criterion.field == "category":
                if category is not None:
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
                else:
                    query_only.append(
                        LinkFilterItem(
                            criterion_id=criterion.id,
                            field="category",
                            label=criterion.display_label,
                            operator=criterion.operator,
                            status="UNKNOWN" if category_expired else "QUERY_ONLY",
                            reason=(
                                "Kategori doğrulama süresi doldu; metinle aranır."
                                if category_expired
                                else "Uzun kuyruk kategori; sabit kategori ID uydurulmadı."
                            ),
                        )
                    )
                continue

            if criterion.field == "price" and isinstance(criterion.value, PriceValue):
                price_value = criterion.value
                applied.append(
                    LinkFilterItem(
                        criterion_id=criterion.id,
                        field="price",
                        label=criterion.display_label,
                        operator=criterion.operator,
                        status="WEB_VERIFIED_PENDING_MOBILE",
                        url_param="prc",
                        url_value=format_price_param(price_value),
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
                has_expired_brand = any(
                    is_evidence_expired(entry.expires_at, now=now) for entry in matched_brands
                )
                if (
                    len(matched_brands) == len(requested)
                    and matched_brands
                    and not has_expired_brand
                ):
                    brand_entries.extend(matched_brands)
                    applied.append(
                        LinkFilterItem(
                            criterion_id=criterion.id,
                            field="brand",
                            label=criterion.display_label,
                            operator=criterion.operator,
                            status=matched_brands[0].status,
                            url_param="wb",
                            url_value=",".join(item.url_value for item in matched_brands),
                            reason="Marka kimliği web gözlemiyle eşlendi.",
                            evidence_ref=matched_brands[0].evidence_ref,
                        )
                    )
                    continue
                if has_expired_brand:
                    query_only.append(
                        LinkFilterItem(
                            criterion_id=criterion.id,
                            field="brand",
                            label=criterion.display_label,
                            operator=criterion.operator,
                            status="UNKNOWN",
                            reason="Marka doğrulama süresi doldu; metinle aranır.",
                        )
                    )
                    continue

            if criterion.field == "color" and self._resolve_single_facet(
                criterion=criterion,
                field="color",
                pool=(
                    category.colors
                    if category is not None and category.colors
                    else snapshot.global_colors
                ),
                now=now,
                applied=applied,
                query_only=query_only,
                collector=color_entries,
                verified_reason="Renk kodu wcl parametresiyle doğrulandı.",
                expired_reason="Renk parametre doğrulama süresi doldu; metin aramasına alındı.",
            ):
                continue

            if (
                criterion.field == "size"
                and category is not None
                and self._resolve_single_facet(
                    criterion=criterion,
                    field="size",
                    pool=category.sizes,
                    now=now,
                    applied=applied,
                    query_only=query_only,
                    collector=size_entries,
                    verified_reason="Beden parametresi vr kodu ile doğrulandı.",
                    expired_reason="Beden doğrulama süresi doldu; metinle aranır.",
                )
            ):
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

        include_source_query = bool(category is None or query_only or not applied)
        can_use_facet_path = (
            category is not None
            and not include_source_query
            and price_value is None
            and not size_entries
            and (
                (len(brand_entries) == 1 and not color_entries and category.wg_id is None)
                or (len(color_entries) == 1 and not brand_entries and category.wg_id is not None)
            )
        )

        strategy = self._facet_strategy if can_use_facet_path else self._canonical_strategy
        resolved_url = strategy.build_url(
            intent=intent,
            category=category,
            brand_entries=brand_entries,
            color_entries=color_entries,
            size_entries=size_entries,
            price_value=price_value,
            include_source_query=include_source_query,
        )

        warning_level = "none"
        if unsupported or query_only:
            warning_level = "partial"
        if not applied and unsupported:
            warning_level = "critical"

        return LinkResolution(
            provider="trendyol",
            url=resolved_url,
            route_strategy=strategy.strategy_kind,
            mapping_version=snapshot.version,
            applied_filters=tuple(applied),
            query_only=tuple(query_only),
            unsupported=tuple(unsupported),
            warning_level=warning_level,
            verification_notice=_SPONSORED_NOTICE,
        )
