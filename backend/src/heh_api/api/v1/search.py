"""Zero-DB search parse, edit-only resolve, and capability endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends

from heh_api.application.search_service import (
    list_provider_capabilities,
    parse_search_query,
    resolve_search_intent,
)
from heh_api.core.config import Settings, get_settings
from heh_api.core.logging import get_request_id
from heh_api.domain.mapping import MappingSnapshot
from heh_api.infrastructure.snapshot_loader import get_mapping_snapshot
from heh_api.schemas.errors import ApiErrorResponse
from heh_api.schemas.search import (
    ProviderCapabilitiesResponse,
    SearchParseRequest,
    SearchParseResponse,
    SearchResolveRequest,
    SearchResolveResponse,
)

router = APIRouter(prefix="/search", tags=["search"])


@router.post(
    "/parse",
    response_model=SearchParseResponse,
    responses={422: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
def post_search_parse(
    payload: SearchParseRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    snapshot: Annotated[MappingSnapshot, Depends(get_mapping_snapshot)],
) -> SearchParseResponse:
    """Parse natural Turkish query into SearchIntentV2 AST + initial LinkResolution (1-RTT)."""
    return parse_search_query(
        payload,
        snapshot=snapshot,
        nlp_mode=settings.nlp_mode,
        request_id=get_request_id(),
    )


@router.post(
    "/resolve",
    response_model=SearchResolveResponse,
    responses={422: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
def post_search_resolve(
    payload: SearchResolveRequest,
    snapshot: Annotated[MappingSnapshot, Depends(get_mapping_snapshot)],
) -> SearchResolveResponse:
    """Recompute LinkResolution deterministically after user chip edit (no NLP rerun)."""
    return resolve_search_intent(
        payload,
        snapshot=snapshot,
        request_id=get_request_id(),
    )


@router.get("/capabilities", response_model=ProviderCapabilitiesResponse)
def get_search_capabilities(
    snapshot: Annotated[MappingSnapshot, Depends(get_mapping_snapshot)],
) -> ProviderCapabilitiesResponse:
    """Return active showcase category support and mapping version from boot snapshot."""
    return list_provider_capabilities(snapshot)
