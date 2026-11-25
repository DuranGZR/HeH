"""Live PostgreSQL readiness integration tests."""

import os

import pytest
from fastapi.testclient import TestClient

from heh_api.core.config import Settings
from heh_api.main import create_app


@pytest.mark.integration
def test_health_ready_reports_ok_against_live_postgres() -> None:
    """Verify /health/ready executes SELECT 1 cleanly against a live PostgreSQL instance."""
    raw_dsn = os.environ.get("HEH_DATABASE_URL") or os.environ.get("DATABASE_URL")
    assert raw_dsn, "HEH_DATABASE_URL or DATABASE_URL must be set for integration tests"

    settings = Settings(env="test")
    assert settings.database_url is not None

    client = TestClient(create_app(settings))
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["db_status"] == "ok"


@pytest.mark.integration
def test_search_endpoints_never_touch_postgres_even_when_db_dead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify core search endpoints execute without DB calls even when Postgres is dead."""
    import psycopg
    from pydantic import SecretStr

    connect_calls = 0

    def spy_connect(*args: object, **kwargs: object) -> object:
        nonlocal connect_calls
        connect_calls += 1
        raise psycopg.OperationalError("simulated unreachable PostgreSQL")

    monkeypatch.setattr(psycopg, "connect", spy_connect)

    dead_settings = Settings(
        env="test",
        database_url=SecretStr("postgresql://heh:dead@127.0.0.1:59999/heh"),
    )
    with TestClient(create_app(dead_settings)) as client:
        parsed = client.post(
            "/api/v1/search/parse", json={"text": "Nike siyah 3000 altı erkek mont"}
        )
        assert parsed.status_code == 200
        resolved = client.post(
            "/api/v1/search/resolve",
            json={"intent": parsed.json()["intent"]},
        )
        assert resolved.status_code == 200
        resolved_url = resolved.json()["resolution"]["url"]
        assert "wc=118" in resolved_url
        assert "wcl=14" in resolved_url
        assert "prc=0-3000" in resolved_url

    assert connect_calls == 0
