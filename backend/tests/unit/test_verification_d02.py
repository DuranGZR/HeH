"""Unit tests for Trendyol URL evidence validation, CLI checker, and security invariants."""

import json
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError
from scripts.verify_filter_matrix import main as verify_matrix_main

from heh_api.domain.verification import (
    EvidenceMatrixDocument,
    PriceBoundEvidence,
    UrlObservationRecord,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_LOCAL_EVIDENCE_FILE = _REPO_ROOT / "evidence" / "W1" / "d02-url-observations.json"


def test_evidence_matrix_document_and_cli_validator(tmp_path: Path) -> None:
    """Verify valid evidence matrices pass both schema and CLI validation."""
    payload = {
        "schema_version": "1.0",
        "day_ref": "W1/D02",
        "generated_at": "2026-11-24T19:42:00+03:00",
        "records": [
            {
                "id": "fixture-sr-upper",
                "category_key": "erkek_mont",
                "route_strategy": "canonical_search_query",
                "tested_url": "https://www.trendyol.com/sr?q=erkek+mont&prc=0-3000",
                "resolved_url": "https://www.trendyol.com/sr?q=erkek+mont&prc=0-3000",
                "price_bound": {"raw_param": "0-3000", "min_amount": "0", "max_amount": "3000"},
                "web_filter_active": True,
                "mobile_app_filter_active": None,
                "overall_status": "WEB_VERIFIED_PENDING_MOBILE",
                "tested_at": "2026-11-24T19:36:00+03:00",
                "evidence_ref": "fixture://sr-upper",
                "notes": "Synthetic fixture for CI.",
            },
            {
                "id": "fixture-sr-lower-open",
                "category_key": "erkek_mont",
                "route_strategy": "canonical_search_query",
                "tested_url": "https://www.trendyol.com/sr?wg=2&wc=118&prc=2000-*",
                "resolved_url": "https://www.trendyol.com/sr?wg=2&wc=118&prc=2000-*",
                "price_bound": {"raw_param": "2000-*", "min_amount": "2000", "max_amount": None},
                "web_filter_active": True,
                "mobile_app_filter_active": None,
                "overall_status": "WEB_VERIFIED_PENDING_MOBILE",
                "tested_at": "2026-11-24T19:38:00+03:00",
                "evidence_ref": "fixture://sr-lower",
                "notes": "Synthetic lower-bound fixture for CI.",
            },
            {
                "id": "fixture-x-facet",
                "category_key": "erkek_mont",
                "route_strategy": "verified_facet_path",
                "tested_url": "https://www.trendyol.com/erkek-mont-x-g2-c118?prc=0-3000",
                "resolved_url": "https://www.trendyol.com/erkek-mont-x-g2-c118?prc=0-3000",
                "price_bound": {"raw_param": "0-3000", "min_amount": "0", "max_amount": "3000"},
                "web_filter_active": True,
                "mobile_app_filter_active": None,
                "overall_status": "WEB_VERIFIED_PENDING_MOBILE",
                "tested_at": "2026-11-24T19:39:00+03:00",
                "evidence_ref": "fixture://x-facet",
                "notes": "Synthetic facet-path fixture for CI.",
            },
        ],
    }
    matrix_path = tmp_path / "matrix.json"
    matrix_path.write_text(json.dumps(payload), encoding="utf-8")

    doc = EvidenceMatrixDocument.model_validate_json(matrix_path.read_text(encoding="utf-8"))
    assert len(doc.records) == 3
    assert verify_matrix_main([str(matrix_path)]) == 0
    assert verify_matrix_main([str(tmp_path / "missing.json")]) == 1

    if _LOCAL_EVIDENCE_FILE.is_file():
        assert verify_matrix_main([str(_LOCAL_EVIDENCE_FILE)]) == 0


def test_filter_verified_requires_mobile_app_confirmation() -> None:
    """Verify web-only evidence cannot be marked FILTER_VERIFIED."""
    with pytest.raises(ValidationError, match="requires both web and mobile confirmation"):
        UrlObservationRecord(
            id="bad-promoted",
            category_key="erkek_mont",
            route_strategy="canonical_search_query",
            tested_url="https://www.trendyol.com/sr?q=erkek+mont&prc=0-3000",
            web_filter_active=True,
            mobile_app_filter_active=None,
            overall_status="FILTER_VERIFIED",
            tested_at="2026-11-24T19:40:00+03:00",
            evidence_ref="fixture://web-only",
            notes="Premature promotion must fail.",
        )


def test_web_verified_pending_mobile_rejects_failed_web_check() -> None:
    """Verify failed web check cannot use WEB_VERIFIED_PENDING_MOBILE."""
    with pytest.raises(ValidationError, match="Failed record cannot be promoted"):
        UrlObservationRecord(
            id="bad-web-false",
            category_key="laptop",
            route_strategy="canonical_search_query",
            tested_url="https://www.trendyol.com/sr?q=laptop&prc=20000-30000",
            web_filter_active=False,
            mobile_app_filter_active=None,
            overall_status="WEB_VERIFIED_PENDING_MOBILE",
            tested_at="2026-11-24T19:40:00+03:00",
            evidence_ref="fixture://web-failed",
            notes="Failed web test must fail validation.",
        )


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://www.trendyol.com/sr?q=mont",
        "https://evil.example.com/sr?q=mont",
        "https://user:pass@www.trendyol.com/sr?q=mont",
    ],
)
def test_provider_url_rejects_non_https_or_unlisted_hosts(bad_url: str) -> None:
    """Verify open-redirect, credentialed, and non-HTTPS URLs are rejected."""
    with pytest.raises(ValidationError):
        UrlObservationRecord(
            id="bad-host",
            category_key="erkek_mont",
            route_strategy="canonical_search_query",
            tested_url=bad_url,
            web_filter_active=None,
            mobile_app_filter_active=None,
            overall_status="UNKNOWN",
            notes="Disallowed URL must fail.",
        )


def test_verified_facet_path_requires_x_segment() -> None:
    """Verify verified_facet_path rejects URLs missing '-x-' facet segments."""
    with pytest.raises(ValidationError, match="-x-"):
        UrlObservationRecord(
            id="bad-facet-path",
            category_key="erkek_mont",
            route_strategy="verified_facet_path",
            tested_url="https://www.trendyol.com/erkek-mont?prc=0-3000",
            web_filter_active=None,
            mobile_app_filter_active=None,
            overall_status="UNKNOWN",
            notes="Missing -x- segment must fail.",
        )


def test_price_bound_rejects_negative_and_inverted_ranges() -> None:
    """Verify Decimal price bounds reject negative values and min > max."""
    with pytest.raises(ValidationError, match="negative"):
        PriceBoundEvidence(
            raw_param="-10-100", min_amount=Decimal("-10"), max_amount=Decimal("100")
        )

    with pytest.raises(ValidationError, match="exceed"):
        PriceBoundEvidence(
            raw_param="3000-1500", min_amount=Decimal("3000"), max_amount=Decimal("1500")
        )
