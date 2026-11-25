"""D11 ProviderCapabilities showcase bounds, schema gate, and proof promotion tests."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from heh_api.domain.mapping import (
    FacetMappingEntry,
    MappingSnapshot,
    ShowcaseCategoryMapping,
)
from heh_api.domain.verification import MAX_SHOWCASE_CATEGORIES, ShowcaseScopePolicy
from heh_api.infrastructure.snapshot_loader import load_mapping_snapshot


def _sample_category(idx: int) -> ShowcaseCategoryMapping:
    return ShowcaseCategoryMapping(
        category_key=f"cat_{idx}",
        ontology_id=f"domain.group.cat_{idx}",
        display_name=f"Kategori {idx}",
        aliases=(f"kategori {idx}",),
        wc_id=str(100 + idx),
        category_status="WEB_VERIFIED_PENDING_MOBILE",
        evidence_ref="evidence/W1/d03-url-observations.json",
        verified_platforms=("web",),
        verified_at=datetime(2026, 11, 24, tzinfo=UTC),
    )


def test_showcase_policy_and_boot_snapshot_bounds() -> None:
    """Verify boot snapshot strictly complies with 5-8 showcase and long-tail policy."""
    policy = ShowcaseScopePolicy()
    snapshot = load_mapping_snapshot()

    assert len(snapshot.categories) >= policy.min_showcase_categories
    assert len(snapshot.categories) <= policy.max_showcase_categories
    assert snapshot.long_tail_policy == "prc_plus_q"
    assert all(cat.negative_supported is False for cat in snapshot.categories)
    assert all(cat.category_status != "FILTER_VERIFIED" for cat in snapshot.categories)


def test_filter_verified_promotion_is_rejected_without_dual_platform_proof() -> None:
    """Verify domain schema blocks FILTER_VERIFIED without web + mobile proof + timestamp."""
    with pytest.raises(ValidationError, match="requires both web and mobile proof"):
        FacetMappingEntry(
            canonical_key="sony",
            display_label="Sony",
            aliases=("sony",),
            url_param="wb",
            url_value="795",
            status="FILTER_VERIFIED",
            evidence_ref="evidence/W1/d03-url-observations.json",
            verified_platforms=("web",),
            verified_at=datetime(2026, 11, 24, tzinfo=UTC),
        )


def test_facet_entry_rejects_disallowed_url_parameter() -> None:
    """Prevent inventing unverified Trendyol URL query parameter names in mappings."""
    with pytest.raises(ValidationError, match="ALLOWED_TRENDYOL_QUERY_PARAMS"):
        FacetMappingEntry(
            canonical_key="evil",
            display_label="Evil",
            aliases=("evil",),
            url_param="redirect_to",
            url_value="https://evil.example",
            status="UNKNOWN",
            evidence_ref="evidence/W1/d03-url-observations.json",
        )


def test_mapping_snapshot_rejects_more_than_8_showcase_categories() -> None:
    """Enforce showcase budget cap (`<= 8`) so unverified categories use prc+q fallback."""
    too_many = tuple(_sample_category(i) for i in range(MAX_SHOWCASE_CATEGORIES + 1))
    with pytest.raises(ValidationError):
        MappingSnapshot(version="2026.11.25.1", categories=too_many)
