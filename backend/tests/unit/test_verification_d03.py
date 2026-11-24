"""Unit tests for D03 facet, multi-brand OR, combined filter, and honesty invariants."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from scripts.verify_filter_matrix import main as verify_matrix_main

from heh_api.domain.verification import (
    EvidenceMatrixDocument,
    FacetFilterEvidence,
    PriceBoundEvidence,
    UrlObservationRecord,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_LOCAL_D03_EVIDENCE_FILE = _REPO_ROOT / "evidence" / "W1" / "d03-url-observations.json"


def test_d03_combined_or_and_facet_matrix_validates(tmp_path: Path) -> None:
    """Verify multi-brand OR, color, size, price, and unsupported negation validate cleanly."""
    payload = {
        "schema_version": "1.0",
        "day_ref": "W1/D03",
        "generated_at": "2026-11-24T20:47:00+03:00",
        "records": [
            {
                "id": "fixture-kulaklik-or-price",
                "category_key": "bluetooth_kulaklik",
                "route_strategy": "canonical_search_query",
                "tested_url": "https://www.trendyol.com/sr?wb=102285%2C795&wc=108626&prc=0-6000",
                "resolved_url": "https://www.trendyol.com/sr?wb=102285%2C795&wc=108626&prc=0-6000",
                "price_bound": {"raw_param": "0-6000", "min_amount": "0", "max_amount": "6000"},
                "facets": [
                    {
                        "field": "brand",
                        "operator": "in",
                        "canonical_values": ["JBL", "Sony"],
                        "url_param": "wb",
                        "url_values": ["102285", "795"],
                        "web_selected": True,
                        "mobile_app_selected": None,
                        "status": "WEB_VERIFIED_PENDING_MOBILE",
                    },
                    {
                        "field": "category",
                        "operator": "eq",
                        "canonical_values": ["bluetooth_kulaklik"],
                        "url_param": "wc",
                        "url_values": ["108626"],
                        "web_selected": True,
                        "mobile_app_selected": None,
                        "status": "WEB_VERIFIED_PENDING_MOBILE",
                    },
                ],
                "web_filter_active": True,
                "mobile_app_filter_active": None,
                "overall_status": "WEB_VERIFIED_PENDING_MOBILE",
                "tested_at": "2026-11-24T17:42:00+03:00",
                "evidence_ref": "fixture://d03-or",
                "notes": "Synthetic OR + price combination fixture.",
            },
            {
                "id": "fixture-mont-4-filters",
                "category_key": "erkek_mont",
                "route_strategy": "canonical_search_query",
                "tested_url": (
                    "https://www.trendyol.com/sr?wb=43&wcl=14&wg=2&wc=118&vr=size%7Cgroup-m&prc=0-3000"
                ),
                "resolved_url": (
                    "https://www.trendyol.com/sr?wb=43&wcl=14&wg=2&wc=118&vr=size%7Cgroup-m&prc=0-3000"
                ),
                "price_bound": {"raw_param": "0-3000", "min_amount": "0", "max_amount": "3000"},
                "facets": [
                    {
                        "field": "color",
                        "operator": "eq",
                        "canonical_values": ["siyah"],
                        "url_param": "wcl",
                        "url_values": ["14"],
                        "web_selected": True,
                        "mobile_app_selected": None,
                        "status": "WEB_VERIFIED_PENDING_MOBILE",
                    },
                    {
                        "field": "size",
                        "operator": "eq",
                        "canonical_values": ["M"],
                        "url_param": "vr",
                        "url_values": ["size|group-m"],
                        "web_selected": True,
                        "mobile_app_selected": None,
                        "status": "WEB_VERIFIED_PENDING_MOBILE",
                    },
                ],
                "web_filter_active": True,
                "mobile_app_filter_active": None,
                "overall_status": "WEB_VERIFIED_PENDING_MOBILE",
                "tested_at": "2026-11-24T17:44:00+03:00",
                "evidence_ref": "fixture://d03-mont",
                "notes": "Synthetic 4-filter clothing fixture.",
            },
            {
                "id": "fixture-negative-brand-unsupported",
                "category_key": "bluetooth_kulaklik",
                "route_strategy": "canonical_search_query",
                "tested_url": "https://www.trendyol.com/sr?q=bluetooth+kulaklik",
                "resolved_url": "https://www.trendyol.com/sr?q=bluetooth+kulaklik",
                "facets": [
                    {
                        "field": "brand",
                        "operator": "not_in",
                        "canonical_values": ["Nike"],
                        "url_param": None,
                        "url_values": [],
                        "web_selected": False,
                        "mobile_app_selected": None,
                        "status": "UNSUPPORTED",
                    }
                ],
                "web_filter_active": False,
                "mobile_app_filter_active": None,
                "overall_status": "UNSUPPORTED",
                "tested_at": "2026-11-24T17:45:00+03:00",
                "evidence_ref": "fixture://d03-negative",
                "notes": "No negative exclusion filter exists in Trendyol UI.",
            },
        ],
    }
    matrix_path = tmp_path / "d03_matrix.json"
    matrix_path.write_text(json.dumps(payload), encoding="utf-8")

    doc = EvidenceMatrixDocument.model_validate_json(matrix_path.read_text(encoding="utf-8"))
    assert len(doc.records) == 3
    assert verify_matrix_main([str(matrix_path)]) == 0

    if _LOCAL_D03_EVIDENCE_FILE.is_file():
        assert verify_matrix_main([str(_LOCAL_D03_EVIDENCE_FILE)]) == 0


def test_unselected_facet_cannot_be_marked_verified() -> None:
    """Verify unselected UI filters (web_selected=False) cannot be promoted."""
    with pytest.raises(ValidationError, match="Failed facet cannot be promoted"):
        FacetFilterEvidence(
            field="color",
            operator="eq",
            canonical_values=("siyah",),
            url_param="wcl",
            url_values=("14",),
            web_selected=False,
            mobile_app_selected=None,
            status="WEB_VERIFIED_PENDING_MOBILE",
        )


def test_verified_facet_requires_url_param_and_values() -> None:
    """Verify verified facets cannot omit url_param or url_values."""
    with pytest.raises(ValidationError, match="url_param and url_values"):
        FacetFilterEvidence(
            field="brand",
            operator="in",
            canonical_values=("Sony", "JBL"),
            url_param="wb",
            url_values=(),
            web_selected=True,
            mobile_app_selected=None,
            status="WEB_VERIFIED_PENDING_MOBILE",
        )


def test_record_cannot_hide_unsupported_or_unselected_facet() -> None:
    """Verify a record claiming verified status rejects any non-verified child facet."""
    with pytest.raises(ValidationError, match="unselected or unsupported facets"):
        UrlObservationRecord(
            id="mixed-hidden-unsupported",
            category_key="bluetooth_kulaklik",
            route_strategy="canonical_search_query",
            tested_url="https://www.trendyol.com/sr?wb=102285%2C795&wc=108626&prc=0-6000",
            price_bound=PriceBoundEvidence(raw_param="0-6000"),
            facets=(
                FacetFilterEvidence(
                    field="brand",
                    operator="in",
                    canonical_values=("JBL", "Sony"),
                    url_param="wb",
                    url_values=("102285", "795"),
                    web_selected=True,
                    status="WEB_VERIFIED_PENDING_MOBILE",
                ),
                FacetFilterEvidence(
                    field="brand",
                    operator="not_in",
                    canonical_values=("Beats",),
                    web_selected=False,
                    status="UNSUPPORTED",
                ),
            ),
            web_filter_active=True,
            mobile_app_filter_active=None,
            overall_status="WEB_VERIFIED_PENDING_MOBILE",
            tested_at="2026-11-24T20:45:00+03:00",
            evidence_ref="fixture://mixed",
            notes="Must reject records masking unsupported negation under verified status.",
        )


def test_facet_value_operator_constraints() -> None:
    """Verify eq requires 1 value and blank/duplicate values are rejected."""
    with pytest.raises(ValidationError, match="exactly one canonical value"):
        FacetFilterEvidence(
            field="brand",
            operator="eq",
            canonical_values=("Sony", "JBL"),
            status="UNKNOWN",
        )

    with pytest.raises(ValidationError, match="duplicate entry"):
        FacetFilterEvidence(
            field="brand",
            operator="in",
            canonical_values=("Sony", "Sony"),
            status="UNKNOWN",
        )

    with pytest.raises(ValidationError, match="blank entries"):
        FacetFilterEvidence(
            field="color",
            operator="eq",
            canonical_values=("   ",),
            status="UNKNOWN",
        )
