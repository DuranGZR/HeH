"""FastAPI application entrypoint."""

from fastapi import FastAPI

from heh_api import __version__
from heh_api.api.v1 import api_v1_router
from heh_api.core.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the HEH FastAPI application."""
    resolved_settings = settings or get_settings()
    application = FastAPI(
        title="HEH API",
        version=__version__,
        docs_url="/docs" if resolved_settings.env == "development" else None,
        redoc_url=None,
    )
    application.include_router(api_v1_router)
    return application


app = create_app()
