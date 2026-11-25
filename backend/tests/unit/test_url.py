"""D12 TrendyolRouteStrategy and URLBuilder security, expiry, and encoding tests."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from heh_api.domain.search_intent import PriceValue, SearchCriterionNode, SearchIntentV2
from heh_api.domain.verification import validate_provider_url
from heh_api.infrastructure.snapshot_loader import load_mapping_snapshot
from heh_api.infrastructure.trendyol.url_builder import (
    TrendyolURLBuilder,
    UnsafeUrlConstructionError,
    VerifiedFacetPathStrategy,
    build_safe_query_string,
)


def test_host_injection_protocol_smuggling_and_bad_facet_segments_rejected() -> None:
    """Reject open redirects, custom ports, fragments, control chars, and forged -x- paths."""
    bad_urls = [
        "http://www.trendyol.com/sr?q=mont",
        "https://trendyol.com.evil.example/sr?q=mont",
        "https://user:pass@www.trendyol.com/sr?q=mont",
        "https://www.trendyol.com:8443/sr?q=mont",
        "https://www.trendyol.com/sr?q=mont#fragment",
        "https://www.trendyol.com/sr?q=mont\r\nX-Injected: 1",
        "https://www.trendyol.com/mont-x-evil_segment",
    ]
    for bad in bad_urls:
        with pytest.raises(ValueError):
            validate_provider_url(
                bad,
                route_strategy="verified_facet_path" if "-x-" in bad else None,
                enforce_allowlisted_params=True,
            )

    with pytest.raises(ValueError, match="ALLOWED_TRENDYOL_QUERY_PARAMS"):
        validate_provider_url(
            "https://www.trendyol.com/sr?q=mont&next=https://evil.example",
            route_strategy="canonical_search_query",
            enforce_allowlisted_params=True,
        )

    with pytest.raises(UnsafeUrlConstructionError):
        build_safe_query_string([("redirect", "https://evil.example")])


def test_verified_facet_path_vs_canonical_sr_selection() -> None:
    """Use proven -x- path for single showcase brand and /sr?... for OR/multi-filter queries."""
    snapshot = load_mapping_snapshot()
    builder = TrendyolURLBuilder()

    single_brand_intent = SearchIntentV2(
        raw_query="sony bluetooth kulaklık",
        normalized_query="sony bluetooth kulaklık",
        category_key="bluetooth_kulaklik",
        criteria=(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value="bluetooth_kulaklik",
                display_label="Bluetooth Kulaklık",
            ),
            SearchCriterionNode(
                id="brand-1",
                field="brand",
                operator="eq",
                value="sony",
                display_label="Sony",
            ),
        ),
    )
    single_res = builder.build_resolution(single_brand_intent, snapshot)
    assert single_res.route_strategy == "verified_facet_path"
    assert single_res.url == "https://www.trendyol.com/sony-bluetooth-kulaklik-x-b795-c108626"

    or_intent = SearchIntentV2(
        raw_query="sony veya jbl kulaklık",
        normalized_query="sony veya jbl kulaklık",
        category_key="bluetooth_kulaklik",
        criteria=(
            SearchCriterionNode(
                id="cat-1",
                field="category",
                operator="eq",
                value="bluetooth_kulaklik",
                display_label="Bluetooth Kulaklık",
            ),
            SearchCriterionNode(
                id="brand-or",
                field="brand",
                operator="in",
                value=("sony", "jbl"),
                display_label="Sony veya JBL",
            ),
        ),
    )
    or_res = builder.build_resolution(or_intent, snapshot)
    assert or_res.route_strategy == "canonical_search_query"
    qs = parse_qs(urlparse(or_res.url).query)
    assert qs["wb"] == ["795,102285"]
    assert qs["wc"] == ["108626"]


def test_verified_facet_strategy_blocks_non_numeric_forged_brand_ids() -> None:
    """Reject untrusted non-numeric IDs when building -x- segments."""
    snapshot = load_mapping_snapshot()
    cat = snapshot.find_category_by_key("bluetooth_kulaklik")
    assert cat is not None
    tampered_brand = cat.brands[0].model_copy(update={"url_value": "795/../../evil"})
    intent = SearchIntentV2(raw_query="sony kulaklık", normalized_query="sony kulaklık")

    with pytest.raises(UnsafeUrlConstructionError):
        VerifiedFacetPathStrategy().build_url(
            intent=intent,
            category=cat,
            brand_entries=[tampered_brand],
            color_entries=[],
            size_entries=[],
            price_value=None,
            include_source_query=False,
        )


def test_expired_facet_parameter_downgrades_honestly_to_unknown_and_preserves_source_query() -> (
    None
):
    """Ensure expired filter mappings never produce stale facet params; preserve Turkish q."""
    base_snapshot = load_mapping_snapshot()
    now = datetime(2026, 12, 1, 12, 0, tzinfo=UTC)
    expired_time = now - timedelta(hours=1)

    mont = base_snapshot.find_category_by_key("erkek_mont")
    assert mont is not None
    expired_sizes = tuple(
        item.model_copy(update={"expires_at": expired_time}) for item in mont.sizes
    )
    updated_categories = tuple(
        cat.model_copy(update={"sizes": expired_sizes}) if cat.category_key == "erkek_mont" else cat
        for cat in base_snapshot.categories
    )
    expired_snapshot = base_snapshot.model_copy(update={"categories": updated_categories})

    intent = SearchIntentV2(
        raw_query="siyah m beden erkek mont",
        normalized_query="siyah m beden erkek mont",
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
                id="color-1",
                field="color",
                operator="eq",
                value="siyah",
                display_label="Siyah",
            ),
            SearchCriterionNode(
                id="size-1",
                field="size",
                operator="eq",
                value="m",
                display_label="M",
            ),
        ),
    )

    res = TrendyolURLBuilder().build_resolution(intent, expired_snapshot, now=now)
    qs = parse_qs(urlparse(res.url).query)
    assert "vr" not in qs
    assert qs["wcl"] == ["14"]
    assert qs["q"] == ["siyah m beden erkek mont"]
    assert any(item.status == "UNKNOWN" and item.field == "size" for item in res.query_only)
    assert res.warning_level == "partial"


def test_long_tail_category_preserves_source_turkish_query_and_price() -> None:
    """Apply prc + Turkish source q cleanly on non-showcase categories."""
    snapshot = load_mapping_snapshot()
    intent = SearchIntentV2(
        raw_query="5000 altı ergonomik oyuncu koltuğu",
        normalized_query="5000 altı ergonomik oyuncu koltuğu",
        criteria=(
            SearchCriterionNode(
                id="price-1",
                field="price",
                operator="lte",
                value=PriceValue(min_amount=0, max_amount=5000),
                display_label="0-5000 TL",
            ),
            SearchCriterionNode(
                id="attr-query-1",
                field="attribute",
                operator="eq",
                value="ergonomik oyuncu koltuğu",
                display_label="ergonomik oyuncu koltuğu",
            ),
        ),
    )
    res = TrendyolURLBuilder().build_resolution(intent, snapshot)
    assert res.route_strategy == "canonical_search_query"
    qs = parse_qs(urlparse(res.url).query)
    assert qs["prc"] == ["0-5000"]
    assert qs["q"] == ["5000 altı ergonomik oyuncu koltuğu"]
    assert len(res.applied_filters) == 1
    assert res.applied_filters[0].url_param == "prc"
    assert len(res.query_only) == 1
