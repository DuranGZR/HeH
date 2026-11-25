"""D32–D35 Ontology, SearchIntentV2 typed AST round-trip, and annotation validator tests."""

import json
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError
from scripts.nlp.validate_annotations import (
    detect_pii_violations,
    validate_annotation_file,
)

from heh_api.domain.search_intent import (
    ConstraintGroup,
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
)
from heh_api.domain.taxonomy import ONTOLOGY_CATALOG_V1
from heh_api.infrastructure.nlp.ontology_loader import load_ontology_catalog
from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter
from heh_api.infrastructure.nlp.rules.entities import load_alias_dictionary

_REPO_ROOT = Path(__file__).resolve().parents[3]


def test_ontology_yaml_matches_frozen_domain_catalog_and_aliases() -> None:
    """Ensure `ontology.v1.yaml` matches domain `ONTOLOGY_CATALOG_V1` and runtime aliases."""
    yaml_catalog = load_ontology_catalog()
    assert yaml_catalog == ONTOLOGY_CATALOG_V1
    assert len(yaml_catalog.showcase_categories) == 5
    assert len(yaml_catalog.long_tail_categories) == 15

    catalog_by_key = {
        node.canonical_key: node
        for node in (*yaml_catalog.showcase_categories, *yaml_catalog.long_tail_categories)
    }
    alias_dict = load_alias_dictionary()
    for alias_cat in alias_dict.categories:
        matched = catalog_by_key.get(alias_cat.canonical_key)
        assert matched is not None, alias_cat.canonical_key
        assert matched.ontology_id == alias_cat.ontology_id
        assert matched.showcase == alias_cat.showcase
        assert matched.size_system == alias_cat.size_system


def test_search_intent_v2_ast_round_trip_with_or_not_modality_units_and_spans() -> None:
    """Verify full typed AST v2 round-trip preserves OR, NOT, polarity, modality, and spans."""
    query = "Nike veya Adidas olmasın 16 GB laptop 30000 altı"
    intent = SearchIntentV2(
        intent_type="product_search",
        raw_query=query,
        normalized_query=query.lower(),
        input_source="voice",
        category_key="laptop",
        criteria=(
            SearchCriterionNode(
                id="brand-not-1",
                field="brand",
                operator="not_in",
                value=("nike", "adidas"),
                display_label="Nike veya Adidas olmasın",
                explicit=True,
                provenance="rule",
                source_span="Nike veya Adidas",
                span_start=0,
                span_end=16,
            ),
            SearchCriterionNode(
                id="unit-1",
                field="attribute",
                operator="eq",
                value="16 GB",
                display_label="16 GB",
                modality="must",
                explicit=True,
                provenance="ml_candidate",
                confidence=0.92,
                unit="GB",
                source_span="16 GB",
                span_start=25,
                span_end=30,
            ),
            SearchCriterionNode(
                id="price-1",
                field="price",
                operator="lte",
                value=PriceValue(min_amount=Decimal("0"), max_amount=Decimal("30000")),
                display_label="0-30000 TL",
                required=False,
                modality="should",
                unit="TRY",
                source_span="30000 altı",
            ),
        ),
        logic_groups=(
            ConstraintGroup(operator="not", criterion_ids=("brand-not-1",)),
            ConstraintGroup(operator="all_of", criterion_ids=("unit-1", "price-1")),
        ),
    )

    assert intent.criteria[0].polarity == "negative"
    assert intent.criteria[0].modality == "must_not"

    encoded = intent.model_dump_json()
    decoded = SearchIntentV2.model_validate_json(encoded)
    assert decoded == intent


def test_search_intent_v2_rejects_invalid_polarity_spans_and_group_links() -> None:
    """Reject contradictory polarity/modality, half-set spans, out-of-range spans, and NOT leaks."""
    with pytest.raises(ValidationError, match="polarity='negative'"):
        SearchCriterionNode(
            id="bad-neg",
            field="brand",
            operator="not_in",
            value=("nike",),
            display_label="Nike olmasın",
            polarity="positive",
        )

    with pytest.raises(ValidationError, match="Only not_in criteria"):
        SearchCriterionNode(
            id="bad-pos",
            field="color",
            operator="eq",
            value="siyah",
            display_label="Siyah",
            modality="must_not",
        )

    with pytest.raises(ValidationError, match="both be set"):
        SearchCriterionNode(
            id="bad-half-span",
            field="color",
            operator="eq",
            value="siyah",
            display_label="Siyah",
            span_start=0,
        )

    with pytest.raises(ValidationError, match="strictly greater"):
        SearchCriterionNode(
            id="bad-order-span",
            field="color",
            operator="eq",
            value="siyah",
            display_label="Siyah",
            span_start=5,
            span_end=5,
        )

    valid_pos = SearchCriterionNode(
        id="color-1",
        field="color",
        operator="eq",
        value="siyah",
        display_label="Siyah",
        span_start=0,
        span_end=5,
    )
    valid_neg = SearchCriterionNode(
        id="brand-not-1",
        field="brand",
        operator="not_in",
        value=("nike",),
        display_label="Nike olmasın",
    )

    with pytest.raises(ValidationError, match="exceeds query length"):
        SearchIntentV2(
            raw_query="siyah mont",
            normalized_query="siyah mont",
            criteria=(
                SearchCriterionNode(
                    id="too-far",
                    field="color",
                    operator="eq",
                    value="siyah",
                    display_label="Siyah",
                    span_start=0,
                    span_end=99,
                ),
            ),
        )

    with pytest.raises(ValidationError, match="NOT group cannot reference positive"):
        SearchIntentV2(
            raw_query="siyah mont",
            normalized_query="siyah mont",
            criteria=(valid_pos,),
            logic_groups=(ConstraintGroup(operator="not", criterion_ids=("color-1",)),),
        )

    with pytest.raises(ValidationError, match="all_of group cannot reference negative"):
        SearchIntentV2(
            raw_query="nike olmasın",
            normalized_query="nike olmasın",
            criteria=(valid_neg,),
            logic_groups=(ConstraintGroup(operator="all_of", criterion_ids=("brand-not-1",)),),
        )


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def test_annotation_validator_rejects_bad_spans_overlaps_pii_and_duplicates(tmp_path: Path) -> None:
    """Fail-fast catch slice drift, overlaps, Turkish phone/email/TCKN PII, and duplicates."""
    assert detect_pii_violations("ara 0532 555 44 33") == ("tr_phone",)
    assert detect_pii_violations("mail test@example.com") == ("email",)
    assert detect_pii_violations("kimlik 12345678901") == ("tckn_candidate",)

    bad_slice_file = tmp_path / "bad_slice.jsonl"
    _write_jsonl(
        bad_slice_file,
        [
            {
                "id": "w7_t01",
                "query": "3000 altı erkek mont",
                "input_source": "text",
                "intent_type": "product_search",
                "category_key": "erkek_mont",
                "is_showcase": True,
                "provenance": "synthetic_curated",
                "source_id": "unit_test",
                "template_family": "t1",
                "spans": [
                    {
                        "span_id": "sp_1",
                        "field": "category",
                        "canonical_value": "erkek_mont",
                        "surface": "erkek mont",
                        "start": 0,
                        "end": 10,
                    }
                ],
            }
        ],
    )
    res_slice = validate_annotation_file(bad_slice_file)
    assert not res_slice.valid
    assert "slice mismatch" in res_slice.errors[0]

    overlap_file = tmp_path / "overlap.jsonl"
    _write_jsonl(
        overlap_file,
        [
            {
                "id": "w7_t02",
                "query": "Mavi erkek mont",
                "input_source": "text",
                "intent_type": "product_search",
                "category_key": "erkek_mont",
                "is_showcase": True,
                "provenance": "synthetic_curated",
                "source_id": "unit_test",
                "template_family": "t2",
                "spans": [
                    {
                        "span_id": "sp_1",
                        "field": "brand",
                        "canonical_value": "mavi",
                        "surface": "Mavi",
                        "start": 0,
                        "end": 4,
                    },
                    {
                        "span_id": "sp_2",
                        "field": "category",
                        "canonical_value": "erkek_mont",
                        "surface": "Mavi erkek mont",
                        "start": 0,
                        "end": 15,
                    },
                ],
            }
        ],
    )
    res_overlap = validate_annotation_file(overlap_file)
    assert not res_overlap.valid
    assert "overlapping spans" in res_overlap.errors[0]

    pii_file = tmp_path / "pii.jsonl"
    _write_jsonl(
        pii_file,
        [
            {
                "id": "w7_t03",
                "query": "0532 555 44 33 erkek mont",
                "input_source": "text",
                "intent_type": "product_search",
                "category_key": "erkek_mont",
                "is_showcase": True,
                "provenance": "synthetic_curated",
                "source_id": "unit_test",
                "template_family": "t3",
                "spans": [],
            }
        ],
    )
    res_pii = validate_annotation_file(pii_file)
    assert not res_pii.valid
    assert "PII detected" in res_pii.errors[0]

    dup_file = tmp_path / "dup.jsonl"
    base_row = {
        "id": "w7_t04a",
        "query": "3000 altı erkek mont",
        "input_source": "text",
        "intent_type": "product_search",
        "category_key": "erkek_mont",
        "is_showcase": True,
        "provenance": "synthetic_curated",
        "source_id": "unit_test",
        "template_family": "t4a",
        "spans": [],
    }
    second_row = {**base_row, "id": "w7_t04b", "query": "3000 ALTI ERKEK MONT"}
    _write_jsonl(dup_file, [base_row, second_row])
    res_dup = validate_annotation_file(dup_file)
    assert not res_dup.valid
    assert "duplicate normalized query" in res_dup.errors[0]


def test_committed_w7_seed_dataset_and_manifest_match_frozen_gate() -> None:
    """Validate frozen 250-sample seed corpus and manifest parity for Gate-NLP-A."""
    seed_path = _REPO_ROOT / "data" / "annotations" / "seed-v1.jsonl"
    manifest_path = _REPO_ROOT / "data" / "manifests" / "w7-seed-manifest.json"

    report = validate_annotation_file(seed_path, fail_fast=False)
    assert report.valid, report.errors
    assert report.total_records == 250
    assert report.showcase_count >= 100
    assert report.long_tail_count >= 75
    assert report.voice_asr_count >= 35
    assert report.or_record_count >= 30
    assert report.not_record_count >= 35
    assert report.conflict_count >= 10
    assert report.ood_count >= 10

    saved_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert saved_manifest == report.to_manifest_dict()


def test_runtime_m0_emits_d32_modality_units_and_intent_type() -> None:
    """Verify M0 runtime adapter emits D32 unit, should-modality, and OOD intent_type."""
    adapter = RuleBasedQueryUnderstandingAdapter()

    vague_res = adapter.parse("16 GB RAM 3 bin civarı Asus laptop", input_source="voice")
    assert vague_res.intent.intent_type == "product_search"
    price_node = next(c for c in vague_res.intent.criteria if c.field == "price")
    assert price_node.required is False
    assert price_node.modality == "should"
    assert price_node.unit == "TRY"
    unit_node = next(c for c in vague_res.intent.criteria if c.id.startswith("unit-"))
    assert unit_node.unit == "GB"

    ood_res = adapter.parse("bugün hava nasıl", input_source="text")
    assert ood_res.is_ood is True
    assert ood_res.intent.intent_type == "unsupported"
