"""Regression tests verifying all W1-W7 codebase audit remediation fixes."""

import json
import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path
from types import TracebackType
from typing import Self
from urllib.parse import parse_qs, urlparse

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from scripts.nlp.validate_annotations import detect_pii_violations, validate_annotation_file

from heh_api.application.search_service import list_provider_capabilities
from heh_api.core.config import Settings
from heh_api.core.logging import redact_sensitive_text
from heh_api.domain.search_intent import (
    ConstraintGroup,
    LinkResolution,
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
    normalize_display_query,
)
from heh_api.domain.verification import EvidenceMatrixDocument, FacetFilterEvidence
from heh_api.infrastructure.db import check_database_health
from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter
from heh_api.infrastructure.nlp.rules.normalize import normalize_query_for_m0
from heh_api.infrastructure.snapshot_loader import load_mapping_snapshot
from heh_api.infrastructure.trendyol.url_builder import TrendyolURLBuilder
from heh_api.main import create_app


class _FakeCursor:
    def execute(self, sql: str) -> None:
        del sql

    def fetchone(self) -> tuple[int]:
        return (1,)

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        return None


class _FakeConnection:
    def cursor(self) -> _FakeCursor:
        return _FakeCursor()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        return None


def test_w1_w2_config_port_logging_db_options_and_alembic_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify invalid ports fail config, credentials/@/IPs redact, and DB options merge."""
    with pytest.raises(ValidationError, match="invalid port"):
        Settings(env="test", database_url="postgresql://heh:secret@127.0.0.1:99999/heh")

    scrubbed = redact_sensitive_text(
        'postgresql://heh:p@ssword@10.20.30.40:5432/heh password="multi word secret" '
        '{"query_text": "gizli siyah mont"}'
    )
    assert "p@ssword" not in scrubbed
    assert "10.20.30.40" not in scrubbed
    assert "multi word secret" not in scrubbed
    assert "gizli siyah mont" not in scrubbed

    captured_kwargs: dict[str, object] = {}

    def fake_connect(dsn: str, **kwargs: object) -> _FakeConnection:
        captured_kwargs["dsn"] = dsn
        captured_kwargs.update(kwargs)
        return _FakeConnection()

    monkeypatch.setattr(psycopg, "connect", fake_connect)
    status = check_database_health(
        SecretStr("postgresql://heh:pw@127.0.0.1:5432/heh?options=-c%20search_path%3Dapp"),
        timeout_seconds=1.5,
    )
    assert status == "ok"
    assert "-c search_path=app" in str(captured_kwargs["options"])
    assert "-c statement_timeout=1500" in str(captured_kwargs["options"])

    alembic_env_dict = os.environ.copy()
    alembic_env_dict["HEH_DATABASE_URL"] = ""
    alembic_env_dict["DATABASE_URL"] = "postgresql://heh:pw@127.0.0.1:5432/heh"
    backend_root = Path(__file__).resolve().parents[2]
    alembic_out = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=backend_root,
        env=alembic_env_dict,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "ix_filter_mapping_entries_release_id" in alembic_out.stdout
    assert "ck_redirect_events_outcome" in alembic_out.stdout


def test_w1_w3_api_status_gates_safe_409_and_not_in_only_resolve() -> None:
    """Verify unverified snapshot gates, safe static 409/422 errors, and not_in-only /resolve."""
    with pytest.raises(ValidationError):
        FacetFilterEvidence(
            field="brand",
            operator="not_in",
            canonical_values=("nike",),
            url_param="wb",
            url_values=("44",),
            web_selected=True,
            status="WEB_VERIFIED_PENDING_MOBILE",
        )

    with pytest.raises(ValidationError):
        FacetFilterEvidence(
            field="color",
            operator="eq",
            canonical_values=("siyah",),
            web_selected=True,
            status="QUERY_ONLY",
        )

    with pytest.raises(ValidationError):
        EvidenceMatrixDocument.model_validate(
            {
                "schema_version": "1.0",
                "day_ref": "D02",
                "generated_at": "not-an-iso-timestamp",
                "records": [
                    {
                        "id": "obs-1",
                        "category_key": "erkek_mont",
                        "route_strategy": "canonical_search_query",
                        "tested_url": "https://www.trendyol.com/sr?q=mont",
                        "overall_status": "UNKNOWN",
                        "notes": "Baseline entry.",
                    }
                ],
            }
        )

    base_snap = load_mapping_snapshot()
    unverified_cats = tuple(
        cat.model_copy(
            update={
                "category_status": "UNKNOWN",
                "colors": tuple(c.model_copy(update={"status": "UNKNOWN"}) for c in cat.colors),
            }
        )
        if cat.category_key == "erkek_mont"
        else cat
        for cat in base_snap.categories
    )
    unverified_snap = base_snap.model_copy(update={"categories": unverified_cats})
    caps = list_provider_capabilities(unverified_snap)
    mont_cap = next(c for c in caps.showcase_categories if c.category_key == "erkek_mont")
    assert mont_cap.status == "UNKNOWN"
    assert mont_cap.supports_color is False

    intent = SearchIntentV2(
        raw_query="siyah erkek mont",
        normalized_query="siyah erkek mont",
        category_key="erkek_mont",
        criteria=(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value="erkek_mont",
                display_label="Erkek Mont",
            ),
            SearchCriterionNode(
                id="col-1",
                field="color",
                operator="eq",
                value="siyah",
                display_label="Siyah",
            ),
        ),
    )
    res: LinkResolution = TrendyolURLBuilder().build_resolution(intent, unverified_snap)
    assert "wc=" not in res.url
    assert "wcl=" not in res.url
    assert res.applied_filters == ()

    with TestClient(create_app(Settings(env="test"))) as client:
        parsed = client.post("/api/v1/search/parse", json={"text": "Nike olmasın"}).json()
        resolve_not_only = client.post(
            "/api/v1/search/resolve",
            json={"intent": parsed["intent"]},
        )
        assert resolve_not_only.status_code == 200
        not_qs = parse_qs(urlparse(resolve_not_only.json()["resolution"]["url"]).query)
        assert not_qs.get("q") == ["arama"]

        conflict_resp = client.post(
            "/api/v1/search/resolve",
            json={"intent": parsed["intent"], "mapping_version": "0.0.0-internal-secret"},
        )
        assert conflict_resp.status_code == 409
        assert "0.0.0-internal-secret" not in conflict_resp.text


def test_w4_search_intent_any_of_and_zero_width_hygiene() -> None:
    """Reject negative or duplicate IDs inside any_of and preserve words across zero-width chars."""
    assert normalize_display_query("si\u200byah") == "siyah"

    neg = SearchCriterionNode(
        id="brand-not-1",
        field="brand",
        operator="not_in",
        value=("nike",),
        display_label="Nike olmasın",
    )
    pos = SearchCriterionNode(
        id="brand-1",
        field="brand",
        operator="eq",
        value="sony",
        display_label="Sony",
    )
    with pytest.raises(ValidationError, match="any_of group cannot reference negative"):
        SearchIntentV2(
            raw_query="nike olmasın",
            normalized_query="nike olmasın",
            criteria=(neg,),
            logic_groups=(ConstraintGroup(operator="any_of", criterion_ids=("brand-not-1",)),),
        )
    with pytest.raises(ValidationError, match="duplicate criterion id"):
        SearchIntentV2(
            raw_query="sony",
            normalized_query="sony",
            criteria=(pos,),
            logic_groups=(
                ConstraintGroup(operator="any_of", criterion_ids=("brand-1", "brand-1")),
            ),
        )


def test_w4_turkish_nlp_edge_cases_from_audit_report() -> None:
    """Verify uppercase English brands, ranges, homonyms, negations, and long-tail slots."""
    adapter = RuleBasedQueryUnderstandingAdapter()

    norm_eng = normalize_query_for_m0("IPHONE 15 IPS MONİTÖR NIKE'SIZ")
    assert "iphone 15" in norm_eng.canonical_for_matching
    assert "ips" in norm_eng.canonical_for_matching
    assert "nike olmasın" in norm_eng.canonical_for_matching

    spaced_range = adapter.parse("1500 - 3000 TL arası erkek mont")
    assert spaced_range.has_conflict is False
    price_node = next(
        c.value for c in spaced_range.intent.criteria if isinstance(c.value, PriceValue)
    )
    assert price_node.min_amount == Decimal("1500")
    assert price_node.max_amount == Decimal("3000")

    inv_neg = adapter.parse("3000'in altında olmasın erkek mont")
    inv_price = next(c.value for c in inv_neg.intent.criteria if isinstance(c.value, PriceValue))
    assert inv_price.min_amount == Decimal("3000")
    assert inv_price.max_amount is None

    kids_age = adapter.parse("7-8 yaş çocuk mont")
    assert not any(c.field == "price" for c in kids_age.intent.criteria)
    assert any(c.field == "size" and c.value == "7-8 yas" for c in kids_age.intent.criteria)

    pct_guard = adapter.parse("%40 üzeri indirimli siyah erkek mont")
    assert not any(c.field == "price" for c in pct_guard.intent.criteria)

    cream_guard = adapter.parse("güneş bakım kremi 500 altı")
    assert not any(c.field == "color" and c.value == "bej" for c in cream_guard.intent.criteria)

    face_guard = adapter.parse("yüz bakım kremi 500 altı")
    face_price = next(
        c.value for c in face_guard.intent.criteria if isinstance(c.value, PriceValue)
    )
    assert face_price.max_amount == Decimal("500")

    spoken_range = adapter.parse("yirmi bin otuz bin arası laptop")
    sp_price = next(
        c.value for c in spoken_range.intent.criteria if isinstance(c.value, PriceValue)
    )
    assert sp_price.min_amount == Decimal("20000")
    assert sp_price.max_amount == Decimal("30000")

    word_units = adapter.parse("bir buçuk litre termos otuz saat pil 2000 vat ısıtıcı")
    unit_labels = {c.display_label for c in word_units.intent.criteria if c.unit is not None}
    assert "1,5 l" in unit_labels
    assert "30 saat" in unit_labels
    assert "2000 w" in unit_labels

    neg_meas = adapter.parse("8 gb değil 16 gb laptop")
    assert any(
        c.operator == "not_in" and c.unit == "GB" and c.display_label == "8 gb olmasın"
        for c in neg_meas.intent.criteria
    )
    assert any(
        c.operator == "eq" and c.unit == "GB" and c.display_label == "16 gb"
        for c in neg_meas.intent.criteria
    )

    cross_neg = adapter.parse("Nike ve siyah olmasın spor ayakkabı")
    assert any(
        c.field == "brand" and c.operator == "not_in" and c.value == ("nike",)
        for c in cross_neg.intent.criteria
    )
    assert any(
        c.field == "color" and c.operator == "not_in" and c.value == ("siyah",)
        for c in cross_neg.intent.criteria
    )

    keyword_neg = adapter.parse("Nike marka de olmasın siyah renk olmasın ayakkabı")
    assert any(c.field == "brand" and c.operator == "not_in" for c in keyword_neg.intent.criteria)
    assert any(c.field == "color" and c.operator == "not_in" for c in keyword_neg.intent.criteria)

    gender_or = adapter.parse("kadın veya erkek mont")
    assert gender_or.intent.category_key != "erkek_mont"
    assert any(
        c.field == "gender" and c.operator == "in" and c.value == ("kadin", "erkek")
        for c in gender_or.intent.criteria
    )

    columbia_mavi = adapter.parse("Columbia mavi erkek mont")
    assert any(c.field == "brand" and c.value == "columbia" for c in columbia_mavi.intent.criteria)
    assert any(c.field == "color" and c.value == "mavi" for c in columbia_mavi.intent.criteria)
    assert not any(c.field == "brand" and c.value == "mavi" for c in columbia_mavi.intent.criteria)

    small_tshirt = adapter.parse("small koşu tişörtü")
    assert any(c.field == "size" and c.value == "s" for c in small_tshirt.intent.criteria)

    silicone_case = adapter.parse("iPhone 15 silikon kılıf")
    assert silicone_case.intent.category_key != "cep_telefonu"

    conflict_price = adapter.parse("5000 üstü 3000 altı")
    assert conflict_price.has_conflict is True
    assert conflict_price.is_ood is False
    assert conflict_price.intent.intent_type == "ambiguous"

    asr_em_or = adapter.parse("em veya el beden erkek mont", input_source="voice")
    assert any(
        c.field == "size" and c.operator == "in" and c.value == ("m", "l")
        for c in asr_em_or.intent.criteria
    )
    asr_second_hand = adapter.parse("ikinci el laptop")
    assert not any(c.field == "size" for c in asr_second_hand.intent.criteria)

    with TestClient(create_app(Settings(env="test"))) as client:
        overflow_query = "eyırfrayır " * 45
        overflow_query = overflow_query[:495].strip()
        assert client.post("/api/v1/search/parse", json={"text": overflow_query}).status_code == 200


def test_w7_validator_rejects_bad_groups_conflicts_and_extended_pii(tmp_path: Path) -> None:
    """Verify validate_annotations enforces or_*/not_* integrity, conflicts, and extra PII."""
    assert detect_pii_violations("kart 4543 1111 2222 3333") == ("card_candidate",)
    assert detect_pii_violations("ip 192.168.1.50") == ("ipv4_candidate",)

    bad_path = tmp_path / "bad_groups.jsonl"
    row_bad_or = {
        "id": "w7_bad_or",
        "query": "Sony siyah kulaklık",
        "input_source": "text",
        "intent_type": "product_search",
        "category_key": "bluetooth_kulaklik",
        "is_showcase": True,
        "has_conflict": False,
        "is_ood": False,
        "provenance": "synthetic_curated",
        "source_id": "test",
        "template_family": "bad_or",
        "spans": [
            {
                "span_id": "sp_1",
                "field": "brand",
                "canonical_value": "sony",
                "surface": "Sony",
                "start": 0,
                "end": 4,
                "polarity": "positive",
                "modality": "should",
                "relation_group": "or_brand_1",
            },
            {
                "span_id": "sp_2",
                "field": "color",
                "canonical_value": "beyaz",
                "surface": "siyah",
                "start": 5,
                "end": 10,
                "polarity": "negative",
                "modality": "must_not",
            },
        ],
    }
    bad_path.write_text(json.dumps(row_bad_or, ensure_ascii=False) + "\n", encoding="utf-8")
    report = validate_annotation_file(bad_path, fail_fast=False)
    assert not report.valid
    joined = "\n".join(report.errors)
    assert "requires >= 2 spans" in joined
    assert "must set relation_group starting with 'not_'" in joined
