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
