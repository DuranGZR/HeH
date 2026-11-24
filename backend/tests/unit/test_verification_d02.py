"""Unit tests for D02 Trendyol URL evidence validation and security invariants."""

from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from heh_api.domain.verification import (
    EvidenceMatrixDocument,
    PriceBoundEvidence,
    UrlObservationRecord,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_EVIDENCE_FILE = _REPO_ROOT / "evidence" / "W1" / "d02-url-observations.json"


def test_d02_evidence_matrix_json_is_valid() -> None:
    """Verify the checked-in W1/D02 evidence matrix passes strict domain validation."""
    doc = EvidenceMatrixDocument.model_validate_json(_EVIDENCE_FILE.read_text(encoding="utf-8"))

    assert doc.schema_version == "1.0"
    assert doc.day_ref == "W1/D02"
    assert len(doc.records) >= 4
    assert all(r.overall_status == "WEB_VERIFIED_PENDING_MOBILE" for r in doc.records)


def test_filter_verified_requires_mobile_app_confirmation() -> None:
    """Verify web-only evidence cannot be marked FILTER_VERIFIED (QG-03)."""
    with pytest.raises(ValidationError, match="mobile_app_filter_active=True"):
        UrlObservationRecord(
            id="bad-promoted",
            category_key="erkek_mont",
            route_strategy="canonical_search_query",
            tested_url="https://www.trendyol.com/sr?q=erkek+mont&prc=0-3000",
            web_filter_active=True,
            mobile_app_filter_active=None,
            overall_status="FILTER_VERIFIED",
            tested_at="2026-11-24T19:40:00+03:00",
            evidence_ref="docs/quality/trendyol-matrix-v0.md",
            notes="Premature promotion must fail.",
        )


def test_web_verified_pending_mobile_rejects_failed_web_check() -> None:
    """Verify failed web check cannot use WEB_VERIFIED_PENDING_MOBILE."""
    with pytest.raises(ValidationError, match="web_filter_active=True"):
        UrlObservationRecord(
            id="bad-web-false",
            category_key="laptop",
            route_strategy="canonical_search_query",
            tested_url="https://www.trendyol.com/sr?q=laptop&prc=20000-30000",
            web_filter_active=False,
            mobile_app_filter_active=None,
            overall_status="WEB_VERIFIED_PENDING_MOBILE",
            tested_at="2026-11-24T19:40:00+03:00",
            evidence_ref="docs/quality/trendyol-matrix-v0.md",
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
