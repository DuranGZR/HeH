"""D34 Fail-fast JSONL annotation validator, PII scanner, and manifest exporter."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from heh_api.domain.search_intent import (
    InputSourceKind,
    normalize_display_query,
    normalize_turkish_text,
)
from heh_api.domain.taxonomy import (
    IntentType,
    ModalityKind,
    OntologyCatalogV1,
    PolarityKind,
)
from heh_api.infrastructure.nlp.ontology_loader import load_ontology_catalog

AnnotationField = Literal[
    "category",
    "brand",
    "color",
    "size",
    "gender",
    "price",
    "material",
    "attribute",
    "model",
    "unit",
]

DatasetProvenance = Literal[
    "synthetic_curated",
    "asr_simulation",
    "handbook_example",
    "seed_golden_derived",
]

_PII_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("url", re.compile(r"https?://|www\.", re.IGNORECASE)),
    (
        "tr_phone",
        re.compile(r"(?<!\d)(?:\+?90[\s-]*)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)"),
    ),
    ("tr_iban", re.compile(r"\bTR\d{2}[0-9 ]{18,26}\b", re.IGNORECASE)),
    ("tckn_candidate", re.compile(r"(?<!\d)[1-9]\d{10}(?!\d)")),
    (
        "card_candidate",
        re.compile(r"(?<!\d)(?:\d{4}[\s-]?){3}\d{4}(?!\d)"),
    ),
    (
        "ipv4_candidate",
        re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"),
    ),
    (
        "address_hint",
        re.compile(
            r"\b(?:mahalle(?:si)?|sokak|cadde(?:si)?|apartman[ıi]|daire\s*no)\b",
            re.IGNORECASE,
        ),
    ),
)


class AnnotationSpanV1(BaseModel):
    """Exact character-aligned entity, price, or boolean constraint span in an annotated query."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    span_id: str = Field(min_length=1, max_length=64)
    field: AnnotationField
    canonical_value: str = Field(min_length=1, max_length=120)
    surface: str = Field(min_length=1, max_length=160)
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    polarity: PolarityKind = "positive"
    modality: ModalityKind = "must"
    explicit: bool = True
    relation_group: str | None = Field(default=None, max_length=64)
    unit: str | None = Field(default=None, max_length=32)
    confidence_note: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def _validate_span_bounds(self) -> AnnotationSpanV1:
        if self.end <= self.start:
            raise ValueError(f"Span '{self.span_id}' end ({self.end}) must exceed start")
        if len(self.surface) != (self.end - self.start):
            raise ValueError(
                f"Span '{self.span_id}' length mismatch: surface='{self.surface}' vs "
                f"{self.end - self.start}"
            )
        if self.polarity == "negative" and self.modality != "must_not":
            raise ValueError(f"Negative span '{self.span_id}' must use modality='must_not'")
        if self.polarity == "positive" and self.modality == "must_not":
            raise ValueError(f"Positive span '{self.span_id}' cannot use modality='must_not'")
        return self


class AnnotationRecordV1(BaseModel):
    """Single frozen schema-validated W7/W8 Turkish CQU annotation sample."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9_]+$")
    query: str = Field(min_length=1, max_length=500)
    input_source: InputSourceKind = "text"
    intended_meaning: str | None = Field(default=None, max_length=500)
    intent_type: IntentType = "product_search"
    category_key: str | None = Field(default=None, max_length=64)
    is_showcase: bool = False
    has_conflict: bool = False
    is_ood: bool = False
    provenance: DatasetProvenance
    source_id: str = Field(min_length=1, max_length=120)
    template_family: str = Field(min_length=1, max_length=96)
    tags: tuple[str, ...] = ()
    spans: tuple[AnnotationSpanV1, ...] = ()

    @model_validator(mode="after")
    def _validate_record_consistency(self) -> AnnotationRecordV1:
        normalized_display = normalize_display_query(self.query)
        if normalized_display != self.query:
            raise ValueError("query must already be NFC normalized without control/edge spaces")

        if self.is_ood:
            if self.intent_type != "unsupported":
                raise ValueError("OOD records must set intent_type='unsupported'")
            if self.category_key is not None or self.spans:
                raise ValueError("OOD records must not assign category_key or product spans")

        if self.has_conflict and self.intent_type != "ambiguous":
            raise ValueError("Conflict records must set intent_type='ambiguous'")

        return self


@dataclass(frozen=True)
class AnnotationValidationReport:
    """Validation result and coverage manifest stats for a JSONL annotation dataset."""

    path: str
    valid: bool
    total_records: int
    showcase_count: int
    long_tail_count: int
    voice_asr_count: int
    or_record_count: int
    not_record_count: int
    conflict_count: int
    ood_count: int
    template_family_count: int
    dataset_sha256: str
    category_distribution: dict[str, int]
    domain_distribution: dict[str, int]
    field_distribution: dict[str, int]
    provenance_distribution: dict[str, int]
    errors: tuple[str, ...]

    def to_manifest_dict(self) -> dict[str, Any]:
        """Serialize manifest statistics cleanly for D34/D35 freeze artifacts."""
        return {
            "manifest_version": "1.0.0",
            "ontology_version": "1.0.0",
            "valid": self.valid,
            "total_records": self.total_records,
            "showcase_count": self.showcase_count,
            "long_tail_count": self.long_tail_count,
            "voice_asr_count": self.voice_asr_count,
            "or_record_count": self.or_record_count,
            "not_record_count": self.not_record_count,
            "conflict_count": self.conflict_count,
            "ood_count": self.ood_count,
            "template_family_count": self.template_family_count,
            "dataset_sha256": self.dataset_sha256,
            "category_distribution": self.category_distribution,
            "domain_distribution": self.domain_distribution,
            "field_distribution": self.field_distribution,
            "provenance_distribution": self.provenance_distribution,
        }


def detect_pii_violations(text: str) -> tuple[str, ...]:
    """Return matching PII rule names if any unsafe personal data appears in text."""
    hits: list[str] = []
    for label, pattern in _PII_PATTERNS:
        if pattern.search(text):
            hits.append(label)
    return tuple(hits)


def _validate_single_record(
    record: AnnotationRecordV1,
    *,
    line_num: int,
    categories_by_key: dict[str, tuple[bool, str]],
    valid_unit_keys: set[str],
    seen_ids: set[str],
    seen_queries: set[str],
) -> list[str]:
    errors: list[str] = []

    if record.id in seen_ids:
        errors.append(f"Line {line_num}: duplicate sample id '{record.id}'")
    seen_ids.add(record.id)

    folded_query = normalize_turkish_text(record.query)
    if folded_query in seen_queries:
        errors.append(f"Line {line_num} ({record.id}): duplicate normalized query '{record.query}'")
    seen_queries.add(folded_query)

    pii_hits = detect_pii_violations(record.query)
    if record.intended_meaning:
        pii_hits = tuple(
            dict.fromkeys((*pii_hits, *detect_pii_violations(record.intended_meaning)))
        )
    if pii_hits:
        errors.append(f"Line {line_num} ({record.id}): PII detected ({', '.join(pii_hits)})")

    if record.category_key is not None:
        cat_meta = categories_by_key.get(record.category_key)
        if cat_meta is None:
            errors.append(
                f"Line {line_num} ({record.id}): unknown category_key '{record.category_key}'"
            )
        else:
            expected_showcase, _ = cat_meta
            if record.is_showcase != expected_showcase:
                errors.append(
                    f"Line {line_num} ({record.id}): is_showcase={record.is_showcase} "
                    f"mismatches ontology showcase={expected_showcase} for '{record.category_key}'"
                )
    elif record.is_showcase:
        errors.append(f"Line {line_num} ({record.id}): is_showcase=True requires category_key")

    seen_span_ids: set[str] = set()
    ordered_spans = sorted(record.spans, key=lambda sp: (sp.start, sp.end))
    prev_span: AnnotationSpanV1 | None = None
    or_groups: dict[str, list[AnnotationSpanV1]] = {}
    pos_keys: set[tuple[str, str]] = set()
    neg_keys: set[tuple[str, str]] = set()

    for span in ordered_spans:
        if span.span_id in seen_span_ids:
            errors.append(f"Line {line_num} ({record.id}): duplicate span_id '{span.span_id}'")
        seen_span_ids.add(span.span_id)

        if span.end > len(record.query):
            errors.append(
                f"Line {line_num} ({record.id}): span '{span.span_id}' end={span.end} exceeds "
                f"query length {len(record.query)}"
            )
            continue

        actual_slice = record.query[span.start : span.end]
        if actual_slice != span.surface:
            errors.append(
                f"Line {line_num} ({record.id}): span '{span.span_id}' slice mismatch "
                f"expected '{span.surface}' got '{actual_slice}'"
            )

        if span.unit is not None and span.unit not in valid_unit_keys:
            errors.append(
                f"Line {line_num} ({record.id}): unknown unit '{span.unit}' on '{span.span_id}'"
            )

        if prev_span is not None and prev_span.end > span.start:
            errors.append(
                f"Line {line_num} ({record.id}): overlapping spans '{prev_span.span_id}' "
                f"[{prev_span.start}:{prev_span.end}] and '{span.span_id}' "
                f"[{span.start}:{span.end}]"
            )
        prev_span = span

        if span.polarity == "negative":
            neg_keys.add((span.field, span.canonical_value))
            if not (span.relation_group and span.relation_group.startswith("not_")):
                errors.append(
                    f"Line {line_num} ({record.id}): negative span '{span.span_id}' must set "
                    "relation_group starting with 'not_'"
                )
        else:
            pos_keys.add((span.field, span.canonical_value))
            if span.relation_group and span.relation_group.startswith("not_"):
                errors.append(
                    f"Line {line_num} ({record.id}): positive span '{span.span_id}' cannot use "
                    f"relation_group '{span.relation_group}'"
                )

        if span.relation_group and span.relation_group.startswith("or_"):
            or_groups.setdefault(span.relation_group, []).append(span)

    for group_name, members in or_groups.items():
        if len(members) < 2:
            errors.append(
                f"Line {line_num} ({record.id}): OR relation_group '{group_name}' "
                "requires >= 2 spans"
            )
        if len({m.field for m in members}) > 1:
            errors.append(
                f"Line {line_num} ({record.id}): OR relation_group '{group_name}' "
                "spans mixed fields"
            )
        if any(m.polarity != "positive" for m in members):
            errors.append(
                f"Line {line_num} ({record.id}): OR relation_group '{group_name}' "
                "cannot mix polarity"
            )

    if (pos_keys & neg_keys) and not record.has_conflict:
        errors.append(
            f"Line {line_num} ({record.id}): contradictory positive+negative spans require "
            "has_conflict=True"
        )

    return errors


def validate_annotation_file(
    path: Path,
    *,
    catalog: OntologyCatalogV1 | None = None,
    fail_fast: bool = True,
) -> AnnotationValidationReport:
    """Validate a JSONL annotation dataset against schema, offsets, PII, and ontology rules."""
    resolved_catalog = catalog or load_ontology_catalog()
    categories_by_key: dict[str, tuple[bool, str]] = {
        node.canonical_key: (node.showcase, node.domain)
        for node in (*resolved_catalog.showcase_categories, *resolved_catalog.long_tail_categories)
    }
    valid_unit_keys = {u.unit_key for u in resolved_catalog.units} | {
        u.display_symbol for u in resolved_catalog.units
    }

    raw_bytes = path.read_bytes()
    dataset_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    raw_lines = raw_bytes.decode("utf-8").splitlines()

    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_queries: set[str] = set()
    template_families: set[str] = set()

    category_dist: Counter[str] = Counter()
    domain_dist: Counter[str] = Counter()
    field_dist: Counter[str] = Counter()
    provenance_dist: Counter[str] = Counter()

    total_records = 0
    showcase_count = 0
    long_tail_count = 0
    voice_asr_count = 0
    or_record_count = 0
    not_record_count = 0
    conflict_count = 0
    ood_count = 0

    for line_num, raw_line in enumerate(raw_lines, start=1):
        stripped = raw_line.strip()
        if not stripped:
            errors.append(f"Line {line_num}: blank lines are forbidden in canonical JSONL")
            if fail_fast:
                break
            continue

        total_records += 1
        try:
            payload = json.loads(stripped)
            record = AnnotationRecordV1.model_validate(payload)
        except (json.JSONDecodeError, ValidationError) as exc:
            errors.append(f"Line {line_num}: schema/JSON error: {exc}")
            if fail_fast:
                break
            continue

        record_errors = _validate_single_record(
            record,
            line_num=line_num,
            categories_by_key=categories_by_key,
            valid_unit_keys=valid_unit_keys,
            seen_ids=seen_ids,
            seen_queries=seen_queries,
        )
        if record_errors:
            errors.extend(record_errors)
            if fail_fast:
                break

        template_families.add(record.template_family)
        provenance_dist[record.provenance] += 1

        if record.input_source == "voice" or record.provenance == "asr_simulation":
            voice_asr_count += 1
        if record.has_conflict:
            conflict_count += 1
        if record.is_ood:
            ood_count += 1
            category_dist["__ood__"] += 1
            domain_dist["ood"] += 1
        elif record.category_key is not None:
            category_dist[record.category_key] += 1
            is_sc, domain = categories_by_key[record.category_key]
            domain_dist[domain] += 1
            if is_sc:
                showcase_count += 1
            else:
                long_tail_count += 1
        else:
            category_dist["__uncategorized__"] += 1
            domain_dist["other"] += 1

        has_or = any(
            sp.relation_group and sp.relation_group.startswith("or_") for sp in record.spans
        )
        has_not = any(sp.polarity == "negative" for sp in record.spans)
        if has_or:
            or_record_count += 1
        if has_not:
            not_record_count += 1

        for sp in record.spans:
            field_dist[sp.field] += 1

    return AnnotationValidationReport(
        path=str(path),
        valid=len(errors) == 0 and total_records > 0,
        total_records=total_records,
        showcase_count=showcase_count,
        long_tail_count=long_tail_count,
        voice_asr_count=voice_asr_count,
        or_record_count=or_record_count,
        not_record_count=not_record_count,
        conflict_count=conflict_count,
        ood_count=ood_count,
        template_family_count=len(template_families),
        dataset_sha256=dataset_sha256,
        category_distribution=dict(sorted(category_dist.items())),
        domain_distribution=dict(sorted(domain_dist.items())),
        field_distribution=dict(sorted(field_dist.items())),
        provenance_distribution=dict(sorted(provenance_dist.items())),
        errors=tuple(errors),
    )


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint validating annotation JSONL and optionally writing manifest stats."""
    parser = argparse.ArgumentParser(description="Validate HEH W7/W8 CQU annotation JSONL.")
    parser.add_argument("dataset", type=Path, help="Path to JSONL annotation file.")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Optional output path to write JSON coverage manifest.",
    )
    parser.add_argument(
        "--min-records",
        type=int,
        default=1,
        help="Minimum required valid records (e.g. 250 for W7 Gate-NLP-A).",
    )
    parser.add_argument(
        "--collect-all",
        action="store_true",
        help="Collect all errors instead of stopping at first line failure.",
    )
    args = parser.parse_args(argv)

    if not args.dataset.is_file():
        print(f"[FAIL] Annotation file not found: {args.dataset}", file=sys.stderr)
        return 1

    report = validate_annotation_file(args.dataset, fail_fast=not args.collect_all)
    if not report.valid:
        for err in report.errors:
            print(f"[FAIL] {err}", file=sys.stderr)
        return 1

    if report.total_records < args.min_records:
        print(
            f"[FAIL] Expected at least {args.min_records} records, found {report.total_records}.",
            file=sys.stderr,
        )
        return 1

    if args.manifest is not None:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(
            json.dumps(report.to_manifest_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print(json.dumps(report.to_manifest_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
