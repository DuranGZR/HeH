"""Unit tests for health endpoints, configuration validation, and test isolation."""

import socket

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from heh_api import __version__
from heh_api.core.config import Settings
from heh_api.main import create_app


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
