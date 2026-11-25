"""D15 12-scenario usability and link output audit over 1-RTT /parse and /resolve."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from heh_api.core.config import Settings
from heh_api.main import create_app


@pytest.mark.parametrize(
    ("scenario_id", "query", "expected_host_path", "required_params", "expect_unsupported"),
    [
        (
            "01_mont_upper_price",
            "3000 altı erkek mont",
            "/sr",
            {"wc": "118", "wg": "2", "prc": "0-3000"},
            False,
        ),
        (
            "02_shoes_full_combo_or",
            "1000-4000 TL nike veya puma siyah 42 numara spor ayakkabı",
            "/sr",
            {"wc": "109", "wcl": "14", "vr": "size|42", "prc": "1000-4000"},
            False,
        ),
        (
            "03_headphones_single_brand_x_route",
            "sony bluetooth kulaklık",
            "/sony-bluetooth-kulaklik-x-b795-c108626",
            {},
            False,
        ),
        (
            "04_headphones_or_price_color",
            "0-6000 sony veya jbl siyah bluetooth kulaklık",
            "/sr",
            {"wc": "108626", "wcl": "14", "prc": "0-6000"},
            False,
        ),
        (
            "05_laptop_or_range",
            "20000-30000 lenovo veya asus laptop",
            "/sr",
            {"wc": "103108", "wb": "102323,101606", "prc": "20000-30000"},
            False,
        ),
        (
            "06_phone_or_color",
            "15000-40000 samsung veya apple siyah cep telefonu",
            "/sr",
            {"wc": "103498", "wb": "794,101470", "wcl": "14", "prc": "15000-40000"},
            False,
        ),
        (
            "07_shoes_negative_brand_not",
            "2000 üstü nike olmasın 42 numara spor ayakkabı",
            "/sr",
            {"wc": "109", "vr": "size|42", "prc": "2000-*"},
            True,
        ),
        (
            "08_mont_negative_color_not",
            "3000 altı siyah olmasın erkek mont",
            "/sr",
            {"wc": "118", "wg": "2", "prc": "0-3000"},
            True,
        ),
        (
            "09_long_tail_with_price",
            "5000 altı ergonomik oyuncu koltuğu",
            "/sr",
            {"prc": "0-5000", "q": "5000 altı ergonomik oyuncu koltuğu"},
            False,
        ),
        (
            "10_long_tail_pure_query",
            "kamp için termos 1 litre",
            "/sr",
            {"q": "kamp için termos 1 litre"},
            False,
        ),
        (
            "11_mont_mavi_color_size_price",
            "3000 altı mavi siyah m beden erkek mont",
            "/sr",
            {
                "wc": "118",
                "wg": "2",
                "wb": "43",
                "wcl": "14",
                "vr": "size|group-m",
                "prc": "0-3000",
            },
            False,
        ),
    ],
)
def test_w3_eleven_parse_scenarios_produce_honest_safe_trendyol_links(
    scenario_id: str,
    query: str,
    expected_host_path: str,
    required_params: dict[str, str],
    expect_unsupported: bool,
) -> None:
    """Audit scenarios 01-11 across showcase categories, OR/NOT logic, and long-tail fallback."""
    client = TestClient(create_app(Settings(env="test")))
    resp = client.post("/api/v1/search/parse", json={"text": query, "locale": "tr-TR"})
    assert resp.status_code == 200, scenario_id

    payload = resp.json()
    res = payload["resolution"]
    parsed = urlparse(res["url"])
    assert parsed.scheme == "https"
    assert parsed.hostname == "www.trendyol.com"
    assert parsed.path == expected_host_path, f"{scenario_id}: got {parsed.path}"

    qs = parse_qs(parsed.query)
    for key, expected_val in required_params.items():
        assert qs.get(key) == [expected_val], f"{scenario_id} param {key}: {qs}"

    assert all(item["status"] != "FILTER_VERIFIED" for item in res["applied_filters"])
    if expect_unsupported:
        assert len(res["unsupported"]) >= 1
        assert all(item["status"] == "UNSUPPORTED" for item in res["unsupported"])


def test_w3_scenario_12_edit_resolve_removes_size_cleanly_without_nlp_rerun() -> None:
    """Audit scenario 12: removing a size chip in /resolve drops vr= cleanly from URL."""
    client = TestClient(create_app(Settings(env="test")))
    parsed = client.post(
        "/api/v1/search/parse",
        json={"text": "3000 altı siyah m beden erkek mont"},
    ).json()

    assert "vr=size%7Cgroup-m" in parsed["resolution"]["url"]

    edited_criteria = [c for c in parsed["intent"]["criteria"] if c["field"] != "size"]
    resolved = client.post(
        "/api/v1/search/resolve",
        json={"intent": {**parsed["intent"], "criteria": edited_criteria}},
    ).json()

    resolved_qs = parse_qs(urlparse(resolved["resolution"]["url"]).query)
    assert "vr" not in resolved_qs
    assert resolved_qs["wcl"] == ["14"]
    assert resolved_qs["prc"] == ["0-3000"]
