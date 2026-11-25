"""Validated environment settings and feature flags for the HEH API."""

from functools import lru_cache
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_POSTGRES_DSN_PREFIXES = ("postgresql://", "postgresql+psycopg://")


def _extract_non_empty_postgres_dsn(raw_value: Any) -> str | None:
    """Validate optional PostgreSQL URLs without reflecting credential substrings on error."""
    if raw_value is None:
        return None
    if isinstance(raw_value, SecretStr):
        candidate = raw_value.get_secret_value().strip()
    elif isinstance(raw_value, str):
        candidate = raw_value.strip()
    else:
        raise ValueError("database_url must be a PostgreSQL connection string")

    if not candidate:
        return None
    if not candidate.startswith(_POSTGRES_DSN_PREFIXES):
        raise ValueError("database_url must start with 'postgresql://' or 'postgresql+psycopg://'")
    parsed = urlparse(candidate)
    if not parsed.hostname:
        raise ValueError("database_url must include a valid PostgreSQL host")
    return candidate


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="HEH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    env: Literal["development", "test", "staging", "production"] = "development"
    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8000, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    nlp_mode: Literal["rules", "shadow", "hybrid"] = "rules"
    secret_key: SecretStr | None = None
    database_url: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("HEH_DATABASE_URL", "DATABASE_URL"),
    )
    db_health_timeout_seconds: float = Field(default=1.0, gt=0.1, le=10.0)

    # Feature flags (progressive capability gating)
    enable_ml_reranker: bool = False
    enable_account_sync: bool = False
    enable_redirect_telemetry: bool = False

    @field_validator("database_url", mode="before")
    @classmethod
    def _validate_database_url(cls, value: Any) -> str | None:
        return _extract_non_empty_postgres_dsn(value)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached validated application settings."""
    return Settings()
