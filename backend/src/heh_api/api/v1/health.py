"""Liveness and Zero-DB readiness endpoints."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from heh_api import __version__
from heh_api.core.config import Settings, get_settings
from heh_api.domain.mapping import MappingSnapshot
from heh_api.infrastructure.db import DatabaseHealthStatus, get_db_health_status

router = APIRouter(prefix="/health", tags=["health"])


class LivenessResponse(BaseModel):
    """Process liveness payload independent of external dependencies."""

    status: Literal["ok"]


class ReadinessResponse(BaseModel):
    """Core search readiness payload reflecting Zero-DB hot path status."""

    status: Literal["ok", "degraded"]
    version: str
    nlp_mode: Literal["rules", "shadow", "hybrid"]
    mapping_snapshot: Literal["bootstrap", "ready"]
    db_status: DatabaseHealthStatus


@router.get("/live", response_model=LivenessResponse)
def get_liveness() -> LivenessResponse:
    """Return process liveness status."""
    return LivenessResponse(status="ok")


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse}},
)
def get_readiness(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    db_status: Annotated[DatabaseHealthStatus, Depends(get_db_health_status)],
) -> ReadinessResponse | JSONResponse:
    """Return core search readiness status independently of PostgreSQL availability."""
    loaded_snapshot = getattr(request.app.state, "mapping_snapshot", None)
    snapshot_ready = isinstance(loaded_snapshot, MappingSnapshot)
    payload = ReadinessResponse(
        status="ok" if snapshot_ready else "degraded",
        version=__version__,
        nlp_mode=settings.nlp_mode,
        mapping_snapshot="ready" if snapshot_ready else "bootstrap",
        db_status=db_status,
    )
    if not snapshot_ready:
        return JSONResponse(status_code=503, content=payload.model_dump(mode="json"))
    return payload
