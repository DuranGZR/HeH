"""Zero-DB hot-path application service for 1-RTT M0 search parse and edit-only resolve."""

from datetime import datetime
from typing import Literal

from heh_api.domain.mapping import MappingSnapshot
from heh_api.domain.verification import MappingVersionConflictError, is_evidence_expired
from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter
from heh_api.infrastructure.trendyol.url_builder import TrendyolURLBuilder
from heh_api.schemas.search import (
    CategoryCapabilitySummary,
    ProviderCapabilitiesResponse,
    SearchParseRequest,
    SearchParseResponse,
    SearchResolveRequest,
    SearchResolveResponse,
)

_M0_ADAPTER = RuleBasedQueryUnderstandingAdapter()
_URL_BUILDER = TrendyolURLBuilder()
_VERIFIED_MAPPING_STATUSES = frozenset({"FILTER_VERIFIED", "WEB_VERIFIED_PENDING_MOBILE"})


def parse_search_query(
    request: SearchParseRequest,
    *,
    snapshot: MappingSnapshot,
    nlp_mode: Literal["rules", "shadow", "hybrid"],
    request_id: str,
) -> SearchParseResponse:
    """Parse raw Turkish query via deterministic M0 adapter and initial 1-RTT LinkResolution."""
    logic_result = _M0_ADAPTER.parse(request.text, input_source=request.input_source)
    resolution = _URL_BUILDER.build_resolution(logic_result.intent, snapshot)

    return SearchParseResponse(
        request_id=request_id,
        parser_version=_M0_ADAPTER.parser_version,
        nlp_mode=nlp_mode,
        intent=logic_result.intent,
        confidence_state=logic_result.confidence_state,
        warnings=logic_result.warnings,
        resolution=resolution,
    )


def resolve_search_intent(
    request: SearchResolveRequest,
    *,
    snapshot: MappingSnapshot,
    request_id: str,
) -> SearchResolveResponse:
    """Recompute LinkResolution deterministically from edited SearchIntentV2 AST."""
    if request.mapping_version is not None and request.mapping_version != snapshot.version:
        raise MappingVersionConflictError(
            f"İstek mapping sürümü ({request.mapping_version}) güncel sunucu sürümüyle "
            f"({snapshot.version}) eşleşmiyor."
        )
    resolution = _URL_BUILDER.build_resolution(
        request.intent, snapshot, rebuild_query_from_criteria=True
    )
    return SearchResolveResponse(
        request_id=request_id,
        intent=request.intent,
        resolution=resolution,
    )


def list_provider_capabilities(
    snapshot: MappingSnapshot,
    *,
    now: datetime | None = None,
) -> ProviderCapabilitiesResponse:
    """Return active showcase capabilities from the immutable boot snapshot."""
    summaries = []
    for cat in snapshot.categories:
        cat_expired = is_evidence_expired(cat.expires_at, now=now)
        cat_verified = cat.category_status in _VERIFIED_MAPPING_STATUSES
        cat_active = not cat_expired and cat_verified
        active_brands = [
            b
            for b in cat.brands
            if b.status in _VERIFIED_MAPPING_STATUSES
            and not is_evidence_expired(b.expires_at, now=now)
        ]
        active_colors = [
            c
            for c in cat.colors
            if c.status in _VERIFIED_MAPPING_STATUSES
            and not is_evidence_expired(c.expires_at, now=now)
        ]
        active_sizes = [
            s
            for s in cat.sizes
            if s.status in _VERIFIED_MAPPING_STATUSES
            and not is_evidence_expired(s.expires_at, now=now)
        ]
        summaries.append(
            CategoryCapabilitySummary(
                category_key=cat.category_key,
                display_name=cat.display_name,
                status="UNKNOWN" if cat_expired else cat.category_status,
                supports_brand_or=cat_active and len(active_brands) > 1,
                supports_color=cat_active and len(active_colors) > 0,
                supports_size=cat_active and len(active_sizes) > 0,
                negative_supported=cat.negative_supported,
            )
        )
    return ProviderCapabilitiesResponse(
        provider=snapshot.provider,
        mapping_version=snapshot.version,
        long_tail_policy=snapshot.long_tail_policy,
        showcase_categories=tuple(summaries),
    )
