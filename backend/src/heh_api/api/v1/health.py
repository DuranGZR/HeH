"""Liveness and Zero-DB readiness endpoints."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
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

    status: Literal["ok"]
    version: str
    nlp_mode: Literal["rules", "shadow", "hybrid"]
    mapping_snapshot: Literal["bootstrap", "ready"]
    db_status: DatabaseHealthStatus


@router.get("/live", response_model=LivenessResponse)
def get_liveness() -> LivenessResponse:
    """Return process liveness status."""
    return LivenessResponse(status="ok")


@router.get("/ready", response_model=ReadinessResponse)
def get_readiness(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    db_status: Annotated[DatabaseHealthStatus, Depends(get_db_health_status)],
) -> ReadinessResponse:
    """Return core search readiness status independently of PostgreSQL availability."""
    loaded_snapshot = getattr(request.app.state, "mapping_snapshot", None)
    snapshot_state: Literal["bootstrap", "ready"] = (
        "ready" if isinstance(loaded_snapshot, MappingSnapshot) else "bootstrap"
    )
    return ReadinessResponse(
        status="ok",
        version=__version__,
        nlp_mode=settings.nlp_mode,
        mapping_snapshot=snapshot_state,
        db_status=db_status,
    )
