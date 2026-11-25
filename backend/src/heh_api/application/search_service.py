"""Zero-DB hot-path application service for 1-RTT M0 search parse and edit-only resolve."""

from typing import Literal

from heh_api.domain.mapping import MappingSnapshot
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
