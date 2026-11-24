"""Liveness and Zero-DB readiness endpoints."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from heh_api import __version__
from heh_api.core.config import Settings, get_settings

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
    db_status: Literal["not_configured", "ok", "degraded"]


@router.get("/live", response_model=LivenessResponse)
def get_liveness() -> LivenessResponse:
    """Return process liveness status."""
    return LivenessResponse(status="ok")


@router.get("/ready", response_model=ReadinessResponse)
def get_readiness(
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse:
    """Return core search readiness status without requiring PostgreSQL."""
    return ReadinessResponse(
        status="ok",
        version=__version__,
        nlp_mode=settings.nlp_mode,
        mapping_snapshot="bootstrap",
        db_status="not_configured",
    )
