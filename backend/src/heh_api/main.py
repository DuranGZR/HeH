"""FastAPI application entrypoint with Zero-DB boot snapshot and redacted logging."""

from fastapi import FastAPI

from heh_api import __version__
from heh_api.api.v1 import api_v1_router
from heh_api.core.config import Settings, get_settings
from heh_api.core.exceptions import register_exception_handlers
from heh_api.core.logging import configure_logging
from heh_api.core.middleware import RequestContextMiddleware
from heh_api.infrastructure.snapshot_loader import load_mapping_snapshot


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the HEH FastAPI application."""
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)

    application = FastAPI(
        title="HEH API",
        version=__version__,
        docs_url="/docs" if resolved_settings.env == "development" else None,
        redoc_url=None,
    )
    application.state.mapping_snapshot = load_mapping_snapshot()

    if settings is not None:
        application.dependency_overrides[get_settings] = lambda: resolved_settings

    application.add_middleware(RequestContextMiddleware)
    register_exception_handlers(application)
    application.include_router(api_v1_router)
    return application


app = create_app()
