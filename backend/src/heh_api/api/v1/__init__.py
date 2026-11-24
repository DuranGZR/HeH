"""API v1 router registration."""

from fastapi import APIRouter

from heh_api.api.v1.health import router as health_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health_router)
