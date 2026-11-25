"""Comprehensive D01-D20 audit regression tests across W1, W2, W3, and W4."""

from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from starlette.requests import Request

from heh_api.core.config import Settings
from heh_api.domain.search_intent import (
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
    normalize_turkish_text,
)
from heh_api.domain.verification import (
    FacetFilterEvidence,
    ShowcaseScopePolicy,
    UnsafeUrlConstructionError,
    UrlObservationRecord,
    validate_provider_url,
)
from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter
from heh_api.infrastructure.snapshot_loader import (
    get_mapping_snapshot,
    load_mapping_snapshot,
)
from heh_api.infrastructure.trendyol.url_builder import TrendyolURLBuilder
from heh_api.main import create_app


def _make_empty_scope_request(app: object) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/capabilities",
        "headers": [],
        "app": app,
    }
    return Request(scope)


def test_w1_url_security_and_evidence_contract_guards() -> None:
    """Verify control-char blocking, allowlisted param checks, and UNSUPPORTED consistency."""
    with pytest.raises(UnsafeUrlConstructionError):
        validate_provider_url("https://www.trendyol.com/sr?q=mont\x07")
    with pytest.raises(UnsafeUrlConstructionError):
        validate_provider_url("https://www.trendyol.com/sr?q=mont test")
    with pytest.raises(UnsafeUrlConstructionError):
        validate_provider_url(
            "https://www.trendyol.com/sr?q=mont&evil=1",
            "canonical_search_query",
            enforce_allowlisted_params=True,
        )

    safe_url = validate_provider_url(
        "https://www.trendyol.com/sr?q=mont&prc=0-3000&wb=44",
        "canonical_search_query",
        enforce_allowlisted_params=True,
    )
    assert safe_url == "https://www.trendyol.com/sr?q=mont&prc=0-3000&wb=44"

    with pytest.raises(ValidationError):
        UrlObservationRecord(
            id="bad-unsup",
            category_key="erkek_mont",
            route_strategy="verified_facet_path",
            tested_url="https://www.trendyol.com/sr?q=mont",
            facets=(
                FacetFilterEvidence(
                    field="brand",
                    operator="not_in",
                    canonical_values=("nike",),
                    url_param="wb",
                    web_selected=True,
                    status="UNSUPPORTED",
                ),
            ),
            overall_status="UNSUPPORTED",
            notes="UNSUPPORTED entries cannot claim web selection or url_param.",
        )

    with pytest.raises(ValidationError):
        ShowcaseScopePolicy(min_showcase_categories=10, max_showcase_categories=5)


def test_w2_config_redaction_health_readiness_conflict_and_zero_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify short password redaction, 503 readiness, 409 version conflict, and Zero-DB search."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(env="test", secret_key=SecretStr("api"), database_url="pw123")
    assert "pw123" not in str(exc_info.value)

    with pytest.raises(ValidationError):
        Settings(env="test", secret_key=SecretStr("api"), database_url="postgresql://")

    app = create_app(Settings(env="test"))
    with TestClient(app) as client:
        app.state.mapping_snapshot = None
        ready_resp = client.get("/api/v1/health/ready")
        assert ready_resp.status_code == 503
        assert ready_resp.json()["status"] == "degraded"
        assert ready_resp.json()["mapping_snapshot"] == "bootstrap"

        with pytest.raises(HTTPException) as snap_exc:
            get_mapping_snapshot(_make_empty_scope_request(app))
        assert snap_exc.value.status_code == 503

    # Dead PostgreSQL DSN must never break or touch DB during search parse/resolve.
    connect_calls = 0

    def spy_connect(*args: object, **kwargs: object) -> object:
        nonlocal connect_calls
        connect_calls += 1
        raise AssertionError("psycopg.connect must never be invoked by search endpoints")

    monkeypatch.setattr(psycopg, "connect", spy_connect)

    dead_db_settings = Settings(
        env="test",
        database_url=SecretStr("postgresql://heh:bad@127.0.0.1:59999/heh"),
    )
    with TestClient(create_app(dead_db_settings)) as client:
        parse_resp = client.post(
            "/api/v1/search/parse", json={"text": "3000 altı siyah erkek mont"}
        )
        assert parse_resp.status_code == 200
        parsed_intent = parse_resp.json()["intent"]

        resolve_ok = client.post(
            "/api/v1/search/resolve",
            json={"intent": parsed_intent},
        )
        assert resolve_ok.status_code == 200
        assert resolve_ok.json()["resolution"]["verified_at"] is not None

        conflict_resp = client.post(
            "/api/v1/search/resolve",
            json={"intent": parsed_intent, "mapping_version": "0.0.0-stale"},
        )
        assert conflict_resp.status_code == 409
        assert conflict_resp.json()["error"]["code"] == "MAPPING_VERSION_CONFLICT"

    assert connect_calls == 0


def test_w3_mapping_resolution_guards_and_expired_downgrades() -> None:
    """Verify category removal clears wc/wg, laptop drops color facet, and expired facets drop."""
    with TestClient(create_app(Settings(env="test"))) as client:
        parsed = client.post(
            "/api/v1/search/parse",
            json={"text": "Nike siyah M beden 3000 altı erkek mont"},
        ).json()
        cat_ids = [c["id"] for c in parsed["intent"]["criteria"] if c["field"] == "category"]
        assert cat_ids == ["cat-1"]

        # Remove cat-1 while intentionally leaving stale category_key to verify server cleanup.
        edited_intent = {
            **parsed["intent"],
            "criteria": [c for c in parsed["intent"]["criteria"] if c["id"] not in cat_ids],
        }
        resolved = client.post(
            "/api/v1/search/resolve",
            json={"intent": edited_intent},
        )
        assert resolved.status_code == 200
        res_data = resolved.json()["resolution"]
        assert "wc=" not in res_data["url"]
        assert "wg=" not in res_data["url"]
        assert "mont" not in res_data["url"].lower()

        # Laptop keeps supports_color=False, so color must stay query-only.
        laptop_parsed = client.post(
            "/api/v1/search/parse", json={"text": "siyah laptop 25000 altı"}
        ).json()
        laptop_resolved = client.post(
            "/api/v1/search/resolve",
            json={"intent": laptop_parsed["intent"]},
        ).json()["resolution"]
        assert "wcl=" not in laptop_resolved["url"]
        assert any(
            item["field"] == "color" and item["status"] == "QUERY_ONLY"
            for item in laptop_resolved["query_only"]
        )

    # Expired category child facet downgrades to UNKNOWN cleanly.
    snapshot = load_mapping_snapshot()
    past_time = datetime(2020, 1, 1, tzinfo=UTC)
    expired_categories = tuple(
        cat.model_copy(
            update={
                "colors": tuple(c.model_copy(update={"expires_at": past_time}) for c in cat.colors)
            }
        )
        if cat.category_key == "erkek_mont"
        else cat
        for cat in snapshot.categories
    )
    expired_snapshot = snapshot.model_copy(update={"categories": expired_categories})
    intent = SearchIntentV2(
        raw_query="siyah erkek mont",
        normalized_query=normalize_turkish_text("siyah erkek mont"),
        input_source="text",
        category_key="erkek_mont",
        criteria=(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value="erkek_mont",
                display_label="Erkek Mont",
                confidence=1.0,
                provenance="rule",
            ),
            SearchCriterionNode(
                id="col-1",
                field="color",
                operator="eq",
                value="siyah",
                display_label="Siyah",
                confidence=1.0,
                provenance="rule",
            ),
        ),
    )
    expired_resolution = TrendyolURLBuilder().build_resolution(
        intent,
        expired_snapshot,
        now=datetime.now(UTC),
    )
    all_items = (
        *expired_resolution.applied_filters,
        *expired_resolution.query_only,
        *expired_resolution.unsupported,
    )
    assert "wcl=" not in expired_resolution.url
    assert any(item.status == "UNKNOWN" for item in all_items)


def test_w4_m0_nlp_edge_cases_and_precision_guards() -> None:
    """Verify Turkish normalization, decimals, strict inequalities, gender, negation, and OOD."""
    adapter = RuleBasedQueryUnderstandingAdapter()

    bluetooth = adapter.parse("blutut kulaklik 2000 altı", input_source="voice")
    assert "bluetooth" in bluetooth.intent.normalized_query
    assert bluetooth.intent.category_key == "bluetooth_kulaklik"

    units = adapter.parse(
        "16gb 144hz 5000mah laptop 1l termos 1.5kg dambıl",
        input_source="text",
    )
    assert "16gb" in units.intent.normalized_query
    assert "1l" in units.intent.normalized_query
    assert "1.5kg" in units.intent.normalized_query

    decimals = adapter.parse("1.500,50 tl ile 3.000 TL arası mont", input_source="text")
    dec_prices = [
        c.value
        for c in decimals.intent.criteria
        if c.field == "price" and isinstance(c.value, PriceValue)
    ]
    assert len(dec_prices) == 1
    assert dec_prices[0].min_amount == Decimal("1500.50")
    assert dec_prices[0].max_amount == Decimal("3000")

    neg_bound = adapter.parse("3500'den fazla olmasın erkek mont", input_source="text")
    neg_prices = [
        c.value
        for c in neg_bound.intent.criteria
        if c.field == "price" and isinstance(c.value, PriceValue)
    ]
    assert neg_prices[0].max_amount == Decimal("3500")

    cap_phrase = adapter.parse(
        "3000'i geçmesin bütçem 4 bin olmayan ayakkabı",
        input_source="text",
    )
    assert any(
        isinstance(c.value, PriceValue) and c.value.max_amount == Decimal("3000")
        for c in cap_phrase.intent.criteria
        if c.field == "price"
    )

    strict_lt = adapter.parse("3000 altı mont", input_source="text")
    inclusive_lte = adapter.parse("en fazla 3000 tl mont", input_source="text")
    lt_val = next(c.value for c in strict_lt.intent.criteria if isinstance(c.value, PriceValue))
    lte_val = next(
        c.value for c in inclusive_lte.intent.criteria if isinstance(c.value, PriceValue)
    )
    assert lt_val.max_inclusive is False
    assert lte_val.max_inclusive is True

    with TestClient(create_app(Settings(env="test"))) as client:
        assert client.post("/api/v1/search/parse", json={"text": "a" * 500}).status_code == 200
        assert client.post("/api/v1/search/parse", json={"text": "a" * 501}).status_code == 422

    negative_price = adapter.parse("-500 TL mont", input_source="text")
    assert negative_price.has_conflict is True

    women_coat = adapter.parse("kadın mont", input_source="text")
    assert women_coat.intent.category_key != "erkek_mont"
    assert any(c.field == "gender" and c.value == "kadin" for c in women_coat.intent.criteria)

    bag = adapter.parse("laptop çantası", input_source="text")
    assert bag.intent.category_key != "laptop"

    multi_neg = adapter.parse(
        "Samsung veya Apple veya Xiaomi olmasın kulaklık",
        input_source="text",
    )
    neg_brands = [
        v
        for c in multi_neg.intent.criteria
        if c.field == "brand" and c.operator == "not_in"
        for v in (c.value if isinstance(c.value, tuple) else (c.value,))
    ]
    assert set(neg_brands) == {"samsung", "apple", "xiaomi"}

    model_neg = adapter.parse("Galaxy S24 olmasın telefon", input_source="text")
    assert any(
        c.field == "brand"
        and c.operator == "not_in"
        and ("samsung" in c.value if isinstance(c.value, tuple) else c.value == "samsung")
        for c in model_neg.intent.criteria
    )

    mavi_color = adapter.parse("mavi değil siyah erkek mont", input_source="text")
    assert any(
        c.field == "color"
        and c.operator == "not_in"
        and ("mavi" in c.value if isinstance(c.value, tuple) else c.value == "mavi")
        for c in mavi_color.intent.criteria
    )
    assert any(
        c.field == "color" and c.operator == "eq" and c.value == "siyah"
        for c in mavi_color.intent.criteria
    )
    assert not any(
        c.field == "brand"
        and ("mavi" in c.value if isinstance(c.value, tuple) else c.value == "mavi")
        for c in mavi_color.intent.criteria
    )

    watch_q = adapter.parse("akıllı saat kaç tl", input_source="text")
    assert watch_q.is_ood is False

    abstract_ood = adapter.parse("beni mutlu edecek mont", input_source="text")
    assert abstract_ood.is_ood is True
