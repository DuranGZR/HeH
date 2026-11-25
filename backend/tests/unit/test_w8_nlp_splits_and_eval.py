"""W8 D36–D40 Corpus validation, group-split leakage audit, and frozen M0 gate tests."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.nlp.evaluate import format_w8_markdown_report, run_w8_benchmark
from scripts.nlp.split_by_group import (
    DEFAULT_CORPUS_PATHS,
    DEFAULT_SPLITS_PATH,
    LoadedCorpusRecord,
    SplitName,
    audit_split_leakage,
    build_splits_manifest,
    compute_query_skeleton,
    extract_skeleton_tokens,
    load_split_records,
)
from scripts.nlp.validate_annotations import (
    AnnotationRecordV1,
    validate_annotation_file,
    validate_annotation_files,
)

from heh_api.domain.search_intent import normalize_turkish_text

_REPO_ROOT = Path(__file__).resolve().parents[3]


_SHOWCASE_CATS: frozenset[str] = frozenset(
    {"erkek_mont", "bluetooth_kulaklik", "spor_ayakkabi", "laptop", "cep_telefonu"}
)


def _make_record(
    rid: str,
    query: str,
    template_family: str,
    cat: str | None,
) -> LoadedCorpusRecord:
    rec = AnnotationRecordV1(
        id=rid,
        query=query,
        input_source="text",
        intent_type="product_search",
        category_key=cat,
        is_showcase=(cat in _SHOWCASE_CATS) if cat else False,
        provenance="synthetic_curated",
        source_id="unit_test",
        template_family=template_family,
        spans=(),
    )
    skel = compute_query_skeleton(query)
    return LoadedCorpusRecord(
        record=rec,
        source_path="test.jsonl",
        skeleton=skel,
        skeleton_tokens=extract_skeleton_tokens(skel),
        trigrams=frozenset(),
    )


def test_committed_w8_corpus_files_and_combined_manifest_pass_validation() -> None:
    """Validate D36/D37/D38 JSONL files individually and globally without PII or dupes."""
    d36_report = validate_annotation_file(_REPO_ROOT / "data" / "seed" / "natural-v2.jsonl")
    assert d36_report.valid, d36_report.errors
    assert d36_report.total_records >= 150

    d37_report = validate_annotation_file(_REPO_ROOT / "data" / "annotations" / "round2.jsonl")
    assert d37_report.valid, d37_report.errors
    assert d37_report.total_records >= 100

    d38_report = validate_annotation_file(_REPO_ROOT / "data" / "annotations" / "asr.jsonl")
    assert d38_report.valid, d38_report.errors
    assert d38_report.voice_asr_count == d38_report.total_records

    combined = validate_annotation_files(DEFAULT_CORPUS_PATHS, fail_fast=False)
    assert combined.valid, combined.errors
    assert combined.total_records >= 600
    assert combined.voice_asr_count >= 120
    assert combined.or_record_count >= 80
    assert combined.not_record_count >= 80
    assert combined.conflict_count >= 30
    assert combined.ood_count >= 30

    manifest_path = _REPO_ROOT / "data" / "manifests" / "w8-corpus-manifest.json"
    saved = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert saved == combined.to_manifest_dict()


def test_group_split_skeleton_and_leakage_detector_enforce_zero_leak() -> None:
    """Verify numeral masking catches paraphrases and leakage audit rejects overlaps."""
    assert compute_query_skeleton("3000 TL altı siyah erkek mont") == compute_query_skeleton(
        "4500 lira altı siyah erkek mont"
    )
    assert compute_query_skeleton("iki bin beş yüz TL kulaklık") == compute_query_skeleton(
        "3500 TL kulaklık"
    )

    clean_splits: dict[SplitName, list[LoadedCorpusRecord]] = {
        "train": [_make_record("r1", "3000 tl altı siyah erkek mont", "fam_a", "erkek_mont")],
        "dev": [
            _make_record("r2", "sony kablosuz kulak üstü kulaklık", "fam_b", "bluetooth_kulaklik")
        ],
        "test": [_make_record("r3", "asus 16 gb ram notebook", "fam_c", "laptop")],
    }
    clean_res = audit_split_leakage(clean_splits, golden_norm=set(), golden_skel=set())
    assert clean_res["passed"] is True

    # Cross-split skeleton + template_family leak must fail
    leaked_splits: dict[SplitName, list[LoadedCorpusRecord]] = {
        "train": [_make_record("r1", "3000 tl altı siyah erkek mont", "fam_a", "erkek_mont")],
        "dev": [_make_record("r2", "5000 tl altı siyah erkek mont", "fam_a", "erkek_mont")],
        "test": [_make_record("r3", "asus 16 gb ram notebook", "fam_c", "laptop")],
    }
    leaked_res = audit_split_leakage(leaked_splits, golden_norm=set(), golden_skel=set())
    assert leaked_res["passed"] is False
    assert leaked_res["cross_split_template_family_overlap"] >= 1
    assert leaked_res["cross_split_skeleton_overlap"] >= 1

    # W4 golden query leaking into `test` must fail
    golden_res = audit_split_leakage(
        clean_splits,
        golden_norm={normalize_turkish_text("asus 16 gb ram notebook")},
        golden_skel=set(),
    )
    assert golden_res["passed"] is False
    assert golden_res["golden_seed_leak_in_dev_or_test"] == 1


def test_committed_splits_manifest_reproducible_and_leak_free() -> None:
    """Confirm splits-v1.json matches deterministic group split build and test hash lock."""
    committed, by_split = load_split_records(DEFAULT_SPLITS_PATH)
    rebuilt = build_splits_manifest()
    assert committed == rebuilt
    assert committed["leakage_audit"]["passed"] is True
    assert committed["leakage_audit"]["cross_split_template_family_overlap"] == 0
    assert committed["leakage_audit"]["cross_split_skeleton_overlap"] == 0
    assert committed["leakage_audit"]["golden_seed_leak_in_dev_or_test"] == 0
    assert committed["leakage_audit"]["high_jaccard_cross_split_pairs"] == 0
    assert len(by_split["train"]) >= 400
    assert len(by_split["dev"]) >= 85
    assert len(by_split["test"]) >= 85

    for split_name in ("train", "dev", "test"):
        slice_dist = committed["slice_distribution"][split_name]
        assert slice_dist["voice_asr"] >= 15
        assert slice_dist["or"] >= 12
        assert slice_dist["not"] >= 12
        assert slice_dist["conflict"] >= 5
        assert slice_dist["ood"] >= 5
        assert slice_dist["long_tail"] >= 30


def test_w8_frozen_m0_benchmark_and_gate_report_invariants() -> None:
    """Verify frozen M0 baseline evaluation invariants and committed GATE-NLP-B report."""
    manifest, split_reports, slice_reports = run_w8_benchmark(benchmark_http=False)
    for split_name in ("train", "dev", "test"):
        assert split_reports[split_name].zero_negation_leak is True

    dev = split_reports["dev"]
    test = split_reports["test"]
    unseen = slice_reports["unseen_dev_test"]
    assert dev.ood_acc >= 0.95
    assert test.ood_acc >= 0.95
    assert unseen.category_crit_f1 >= 0.95
    assert unseen.core_micro_f1 >= 0.85

    gate_markdown = format_w8_markdown_report(manifest, split_reports, slice_reports)
    assert "**Gate Status:** `PASS`" in gate_markdown
    assert manifest["locked_test_sha256"] in gate_markdown
    assert f"`{manifest['total_records']}` unique Turkish queries" in gate_markdown

    # `/docs/` is gitignored on CI; verify local saved report's non-timing facts when present.
    gate_report = _REPO_ROOT / "docs" / "quality" / "nlp-w8-gate.md"
    if gate_report.is_file():
        saved_report = gate_report.read_text(encoding="utf-8")
        assert "**Gate Status:** `PASS`" in saved_report
        assert manifest["locked_test_sha256"] in saved_report
        assert (
            f"**{split_reports['train'].core_micro_f1:.4f}** | "
            f"**{dev.core_micro_f1:.4f}** | **{test.core_micro_f1:.4f}**"
        ) in saved_report
