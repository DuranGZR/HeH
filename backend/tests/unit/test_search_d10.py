"""D08/D10 integration-style unit tests: 1-RTT search, Zero-DB, 200/422/500, and log redaction."""

import logging
import socket

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from heh_api.application import search_service
from heh_api.core.config import Settings
from heh_api.core.logging import JsonRedactingFormatter, redact_sensitive_text
from heh_api.main import create_app


def _reserve_closed_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        address = sock.getsockname()
        return int(address[1])


def test_parse_1rtt_and_edit_only_resolve_and_capabilities_zero_db() -> None:
    """Verify /search/* works end-to-end returning 200 OK even when PostgreSQL is closed."""
    closed_port = _reserve_closed_local_port()
    dead_db_settings = Settings(
        env="test",
        database_url=SecretStr(f"postgresql://heh:secret@127.0.0.1:{closed_port}/heh"),
    )
    client = TestClient(create_app(dead_db_settings))

    # Readiness keeps status=ok while honestly reporting degraded db_status
    ready_resp = client.get("/api/v1/health/ready")
    assert ready_resp.status_code == 200
    assert ready_resp.json()["status"] == "ok"
    assert ready_resp.json()["mapping_snapshot"] == "ready"
    assert ready_resp.json()["db_status"] == "degraded"

    # Capabilities served strictly from boot snapshot
    caps_resp = client.get("/api/v1/search/capabilities")
    assert caps_resp.status_code == 200
    caps_data = caps_resp.json()
    assert caps_data["provider"] == "trendyol"
    assert len(caps_data["showcase_categories"]) == 5

    # 1-RTT /search/parse returns both AST + initial LinkResolution with OR + NOT honesty
    parse_resp = client.post(
        "/api/v1/search/parse",
        headers={"X-Request-ID": "req-w2-001"},
        json={
            "text": "0-4000 TL sony veya jbl siyah bluetooth kulaklık",
            "locale": "tr-TR",
            "input_source": "text",
        },
    )
    assert parse_resp.status_code == 200
    assert parse_resp.headers["x-request-id"] == "req-w2-001"
    parse_payload = parse_resp.json()
    assert parse_payload["request_id"] == "req-w2-001"
    assert parse_payload["intent"]["category_key"] == "bluetooth_kulaklik"
    url = parse_payload["resolution"]["url"]
    assert url.startswith("https://www.trendyol.com/sr?")
    assert "wc=108626" in url
    assert "wb=795%2C102285" in url or "wb=102285%2C795" in url
    assert "wcl=14" in url
    assert "prc=0-4000" in url

    # Edit-only /search/resolve recomputes URL cleanly after user removes color criterion
    edited_criteria = [c for c in parse_payload["intent"]["criteria"] if c["field"] != "color"]
    edited_intent = {**parse_payload["intent"], "criteria": edited_criteria}

    resolve_resp = client.post(
        "/api/v1/search/resolve",
        json={"intent": edited_intent},
    )
    assert resolve_resp.status_code == 200
    resolve_payload = resolve_resp.json()
    assert "wcl=14" not in resolve_payload["resolution"]["url"]
    assert "wc=108626" in resolve_payload["resolution"]["url"]


def test_parse_negative_exclusion_reports_unsupported_and_never_applied() -> None:
    """Ensure negative brands ('Nike olmasın') classify strictly as UNSUPPORTED."""
    client = TestClient(create_app(Settings(env="test")))
    resp = client.post(
        "/api/v1/search/parse",
        json={"text": "1000-4000 TL nike olmasın siyah 42 numara spor ayakkabı"},
    )
    assert resp.status_code == 200
    resolution = resp.json()["resolution"]
    unsupported = resolution["unsupported"]
    assert len(unsupported) == 1
    assert unsupported[0]["status"] == "UNSUPPORTED"
    assert unsupported[0]["operator"] == "not_in"
    applied_fields = {item["field"] for item in resolution["applied_filters"]}
    assert "brand" not in applied_fields
    assert "size" in applied_fields
    assert "color" in applied_fields


def test_validation_422_and_internal_500_envelopes_preserve_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify uniform ApiErrorResponse contract on 422 and 500 without trace leaks."""
    client = TestClient(create_app(Settings(env="test")), raise_server_exceptions=False)

    # 422 empty/whitespace query
    resp_422 = client.post(
        "/api/v1/search/parse",
        headers={"X-Request-ID": "req-bad-422"},
        json={"text": "    "},
    )
    assert resp_422.status_code == 422
    assert resp_422.headers["x-request-id"] == "req-bad-422"
    err_422 = resp_422.json()["error"]
    assert err_422["code"] == "VALIDATION_ERROR"
    assert err_422["request_id"] == "req-bad-422"

    # 500 unhandled exception masked cleanly
    def _boom(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("sensitive_secret=topsecret_val")

    monkeypatch.setattr(search_service, "list_provider_capabilities", _boom)
    monkeypatch.setattr(
        "heh_api.api.v1.search.list_provider_capabilities",
        _boom,
    )
    resp_500 = client.get(
        "/api/v1/search/capabilities",
        headers={"X-Request-ID": "req-err-500"},
    )
    assert resp_500.status_code == 500
    assert resp_500.headers["x-request-id"] == "req-err-500"
    err_500 = resp_500.json()["error"]
    assert err_500["code"] == "INTERNAL_ERROR"
    assert err_500["request_id"] == "req-err-500"
    assert "topsecret_val" not in resp_500.text


def test_logs_never_leak_raw_query_text_tokens_or_secrets(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Verify access and redaction logs contain zero raw user queries, secrets, or emails."""
    client = TestClient(create_app(Settings(env="test", secret_key=SecretStr("api-secret-xyz"))))
    sensitive_query = "gizli-sorgu-metni-12345"

    with caplog.at_level(logging.INFO, logger="heh_api"):
        resp = client.post(
            "/api/v1/search/parse",
            headers={"Authorization": "Bearer supersecrettoken999", "X-Request-ID": "req-log-test"},
            json={"text": f"{sensitive_query} 3000 altı siyah mont"},
        )
    assert resp.status_code == 200

    formatter = JsonRedactingFormatter()
    formatted_lines = [formatter.format(rec) for rec in caplog.records]
    joined = "\n".join(formatted_lines)

    assert "req-log-test" in joined
    assert sensitive_query not in joined
    assert "supersecrettoken999" not in joined
    assert "api-secret-xyz" not in joined

    scrubbed = redact_sensitive_text(
        "user=ali@example.com Bearer tok123 postgresql://heh:pw123@127.0.0.1:5432/heh"
    )
    assert "ali@example.com" not in scrubbed
    assert "tok123" not in scrubbed
    assert "pw123" not in scrubbed
