"""PostgreSQL readiness probe with fail-open isolation for Zero-DB hot paths."""

import logging
import math
from typing import Annotated, Literal

import psycopg
from fastapi import Depends
from pydantic import SecretStr

from heh_api.core.config import Settings, get_settings

DatabaseHealthStatus = Literal["not_configured", "ok", "degraded"]

_LOGGER = logging.getLogger(__name__)
_SQLALCHEMY_PSYCOPG_PREFIX = "postgresql+psycopg://"
_STANDARD_POSTGRES_PREFIX = "postgresql://"


def normalize_postgres_dsn(raw_dsn: str) -> str:
    """Normalize a validated PostgreSQL DSN into a libpq-compatible URI."""
    cleaned = raw_dsn.strip()
    if cleaned.startswith(_SQLALCHEMY_PSYCOPG_PREFIX):
        return f"{_STANDARD_POSTGRES_PREFIX}{cleaned[len(_SQLALCHEMY_PSYCOPG_PREFIX) :]}"
    if cleaned.startswith(_STANDARD_POSTGRES_PREFIX):
        return cleaned
    raise ValueError("Unsupported PostgreSQL URL scheme")


def check_database_health(
    database_url: SecretStr | None,
    *,
    timeout_seconds: float = 1.0,
) -> DatabaseHealthStatus:
    """Execute a short-timeout `SELECT 1` probe and fail open to `degraded` on error."""
    if database_url is None:
        return "not_configured"

    connect_timeout = max(1, math.ceil(timeout_seconds))
    statement_timeout_ms = max(100, int(timeout_seconds * 1000))

    try:
        dsn = normalize_postgres_dsn(database_url.get_secret_value())
        with (
            psycopg.connect(
                dsn,
                connect_timeout=connect_timeout,
                options=f"-c statement_timeout={statement_timeout_ms}",
            ) as connection,
            connection.cursor() as cursor,
        ):
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except (psycopg.Error, OSError, TimeoutError, ValueError) as exc:
        # Log exception type only so libpq connection errors can never leak credentials.
        _LOGGER.warning(
            "PostgreSQL readiness check failed open (%s); Zero-DB search stays available.",
            type(exc).__name__,
        )
        return "degraded"

    return "ok"


def get_db_health_status(
    settings: Annotated[Settings, Depends(get_settings)],
) -> DatabaseHealthStatus:
    """Resolve current PostgreSQL readiness status from application settings."""
    return check_database_health(
        settings.database_url,
        timeout_seconds=settings.db_health_timeout_seconds,
    )
