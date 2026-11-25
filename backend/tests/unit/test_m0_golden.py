"""D20 CI golden gate and Hypothesis API fuzz tests for M0 deterministic baseline."""

import json
from collections import Counter

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from scripts.eval_m0_golden import (
    DEFAULT_GOLDEN_PATH,
    NEGATION_ACC_THRESHOLD,
    OVERALL_F1_THRESHOLD,
    P95_LATENCY_MS_THRESHOLD,
    PRICE_F1_THRESHOLD,
    evaluate_golden,
)

from heh_api.core.config import Settings
from heh_api.main import create_app

_FUZZ_ALPHABET = (
    "abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ"
    "0123456789 .,;!?/-'\"()\n\t\u0307\u200b₺%"
)


def test_seed_jsonl_coverage_and_uniqueness() -> None:
    """Golden benchmark must contain >=200 unique Turkish queries across all critical buckets."""
    lines = [
        json.loads(line)
        for line in DEFAULT_GOLDEN_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(lines) >= 200
    assert len({row["id"] for row in lines}) == len(lines)
    assert len({row["query"] for row in lines}) == len(lines)

    buckets = Counter(row["bucket"] for row in lines)
    for required_bucket in (
        "showcase",
        "longtail",
        "prices_units",
        "boolean_or",
        "boolean_not",
        "conflicts",
        "locale_asr_voice",
        "ood",
    ):
        assert buckets[required_bucket] >= 15


def test_m0_golden_gate_thresholds_and_latency() -> None:
    """Enforce GATE-M0: price F1>=0.98, negation>=0.99, field F1>=0.90, p95<=200ms."""
    report = evaluate_golden(DEFAULT_GOLDEN_PATH, benchmark_http=True)
    assert report.total_queries >= 200
    assert report.price_f1 >= PRICE_F1_THRESHOLD, f"price_f1={report.price_f1}: {report.failures}"
    assert report.negation_accuracy >= NEGATION_ACC_THRESHOLD
    assert report.zero_negation_leak is True
    assert report.overall_field_f1 >= OVERALL_F1_THRESHOLD
    assert report.latency_p95_ms <= P95_LATENCY_MS_THRESHOLD


_APP = create_app(Settings(app_env="test", nlp_mode="rules"))
_CLIENT = TestClient(_APP)


@given(st.text(alphabet=_FUZZ_ALPHABET, min_size=1, max_size=240))
@settings(max_examples=75, deadline=None)
def test_search_parse_endpoint_never_500s_on_arbitrary_turkish_inputs(raw_text: str) -> None:
    """FastAPI /api/v1/search/parse must never return HTTP 500 on arbitrary inputs."""
    response = _CLIENT.post(
        "/api/v1/search/parse",
        json={"text": raw_text, "locale": "tr-TR", "input_source": "text"},
    )
    assert response.status_code in (200, 422)
