"""Unit tests for health endpoints, PostgreSQL probe resilience, and settings isolation."""

import logging
import socket
from types import TracebackType
from typing import Self

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from heh_api import __version__
from heh_api.core.config import Settings
from heh_api.infrastructure.db import check_database_health, normalize_postgres_dsn
from heh_api.main import create_app


class _FakeCursor:
    def __init__(self) -> None:
        self.executed_sql: list[str] = []

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        return None

    def execute(self, sql: str) -> None:
        self.executed_sql.append(sql)

    def fetchone(self) -> tuple[int]:
        return (1,)


class _FakeConnection:
    def __init__(self, cursor: _FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        return None

    def cursor(self) -> _FakeCursor:
        return self._cursor


def _reserve_closed_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        address = sock.getsockname()
        return int(address[1])


def test_health_live_returns_ok() -> None:
    """Verify liveness endpoint returns 200 OK without dependencies."""
    client = TestClient(create_app(Settings(env="test")))
    response = client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_returns_zero_db_bootstrap_status() -> None:
    """Verify readiness endpoint reports Zero-DB readiness independently of PostgreSQL."""
    client = TestClient(create_app(Settings(env="test", nlp_mode="rules")))
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": __version__,
        "nlp_mode": "rules",
        "mapping_snapshot": "bootstrap",
        "db_status": "not_configured",
    }


def test_health_ready_reports_ok_and_degraded_without_breaking_zero_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify /ready always returns 200 OK even when PostgreSQL health is ok or degraded."""
    fake_cursor = _FakeCursor()
    monkeypatch.setattr(
        psycopg,
        "connect",
        lambda *_args, **_kwargs: _FakeConnection(fake_cursor),
    )

    configured_settings = Settings(
        env="test",
        database_url=SecretStr("postgresql+psycopg://heh:testcred@127.0.0.1:5432/heh"),
    )
    ok_client = TestClient(create_app(configured_settings))
    ok_response = ok_client.get("/api/v1/health/ready")

    assert ok_response.status_code == 200
    assert ok_response.json()["status"] == "ok"
    assert ok_response.json()["db_status"] == "ok"
    assert fake_cursor.executed_sql == ["SELECT 1"]

    def _fail_connect(*_args: object, **_kwargs: object) -> object:
        raise psycopg.OperationalError("simulated outage")

    monkeypatch.setattr(psycopg, "connect", _fail_connect)
    degraded_response = ok_client.get("/api/v1/health/ready")

    assert degraded_response.status_code == 200
    assert degraded_response.json()["status"] == "ok"
    assert degraded_response.json()["db_status"] == "degraded"


def test_check_database_health_fails_open_and_masks_credentials(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Verify failing PostgreSQL probe fails open to degraded without logging secrets."""
    secret_cred = "super-sensitive-db-secret"  # noqa: S105
    dsn = SecretStr(f"postgresql://heh:{secret_cred}@127.0.0.1:5432/heh")

    def _raise_with_secret(*_args: object, **_kwargs: object) -> object:
        raise psycopg.OperationalError(f"connection failed for {secret_cred}")

    monkeypatch.setattr(psycopg, "connect", _raise_with_secret)
    with caplog.at_level(logging.WARNING):
        status = check_database_health(dsn, timeout_seconds=1.0)

    assert status == "degraded"
    assert secret_cred not in caplog.text
    assert "OperationalError" in caplog.text


def test_check_database_health_closed_local_port_returns_degraded() -> None:
    """Verify unreachable closed localhost port degrades cleanly without raising."""
    closed_port = _reserve_closed_local_port()
    dsn = SecretStr(f"postgresql://heh:local@127.0.0.1:{closed_port}/heh")

    status = check_database_health(dsn, timeout_seconds=1.0)
    assert status == "degraded"


def test_normalize_postgres_dsn_handles_sqlalchemy_scheme() -> None:
    """Verify postgresql+psycopg DSNs normalize to postgresql:// while invalid ones raise."""
    assert (
        normalize_postgres_dsn("postgresql+psycopg://heh:local@127.0.0.1:5432/heh")
        == "postgresql://heh:local@127.0.0.1:5432/heh"
    )
    with pytest.raises(ValueError, match="Unsupported PostgreSQL URL scheme"):
        normalize_postgres_dsn("sqlite:///tmp/test.db")


def test_settings_database_url_normalization_and_masking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify blank DB env vars resolve to None and invalid URLs do not leak secrets."""
    monkeypatch.setenv("DATABASE_URL", "   ")
    monkeypatch.delenv("HEH_DATABASE_URL", raising=False)
    blank_settings = Settings(env="test")
    assert blank_settings.database_url is None

    monkeypatch.setenv("DATABASE_URL", "postgresql://heh:aliascred@127.0.0.1:5432/heh")
    alias_settings = Settings(env="test")
    assert alias_settings.database_url is not None
    assert "aliascred" not in repr(alias_settings)
    assert "aliascred" not in str(alias_settings)

    leaked_secret = "never-reflect-this-secret"  # noqa: S105
    with pytest.raises(ValidationError) as exc_info:
        Settings.model_validate({"database_url": f"mysql://heh:{leaked_secret}@127.0.0.1/heh"})
    assert leaked_secret not in str(exc_info.value)


def test_settings_rejects_invalid_nlp_mode() -> None:
    """Verify invalid NLP mode configuration raises a Pydantic validation error."""
    with pytest.raises(ValidationError):
        Settings.model_validate({"nlp_mode": "invalid"})


def test_settings_masks_secret_key() -> None:
    """Verify SecretStr prevents accidental secret exposure in repr or str output."""
    settings = Settings(secret_key=SecretStr("super-secret-value"))
    assert "super-secret-value" not in repr(settings)
    assert "super-secret-value" not in str(settings)


def test_outbound_network_is_blocked_by_default() -> None:
    """Verify the autouse test fixture blocks outbound TCP connections."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(RuntimeError, match="Outbound network access is forbidden"):
            sock.connect(("1.1.1.1", 443))
    finally:
        sock.close()
