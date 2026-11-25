"""D20 GATE-M0 golden evaluation + Zero-DB /api/v1/search/parse latency benchmark."""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from heh_api.core.config import Settings
from heh_api.domain.search_intent import InputSourceKind, PriceValue
from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter
from heh_api.main import create_app

DEFAULT_GOLDEN_PATH = Path(__file__).resolve().parents[1] / "tests" / "golden" / "seed.jsonl"

PRICE_F1_THRESHOLD = 0.98
NEGATION_ACC_THRESHOLD = 0.99
OVERALL_F1_THRESHOLD = 0.90
P95_LATENCY_MS_THRESHOLD = 200.0


@dataclass
class _Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    def add(self, pred: set[Any], gold: set[Any]) -> None:
        self.tp += len(pred & gold)
        self.fp += len(pred - gold)
        self.fn += len(gold - pred)

    @property
    def precision(self) -> float:
        denom = self.tp + self.fp
        return 1.0 if denom == 0 else self.tp / denom

    @property
    def recall(self) -> float:
        denom = self.tp + self.fn
        return 1.0 if denom == 0 else self.tp / denom

    @property
    def f1(self) -> float:
        p = self.precision
        r = self.recall
        return 0.0 if (p + r) == 0.0 else (2.0 * p * r) / (p + r)


@dataclass(frozen=True)
class GoldenEvalReport:
    """Structured GATE-M0 evaluation report across accuracy, invariance, and latency."""

    total_queries: int
    price_f1: float
    negation_accuracy: float
    zero_negation_leak: bool
    overall_field_f1: float
    category_f1: float
    brand_f1: float
    brand_or_f1: float
    color_f1: float
    size_f1: float
    attribute_f1: float
    measurement_f1: float
    conflict_accuracy: float
    ood_accuracy: float
    confidence_accuracy: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    latency_max_ms: float
    failures: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return (
            self.total_queries >= 200
            and self.price_f1 >= PRICE_F1_THRESHOLD
            and self.negation_accuracy >= NEGATION_ACC_THRESHOLD
            and self.zero_negation_leak
            and self.overall_field_f1 >= OVERALL_F1_THRESHOLD
            and self.conflict_accuracy >= 0.99
            and self.ood_accuracy >= 0.95
            and self.latency_p95_ms <= P95_LATENCY_MS_THRESHOLD
        )


def _normalize_price_tuple(
    min_val: Decimal | None,
    max_val: Decimal | None,
    operator: str,
    required: bool,
    min_inclusive: bool | None = None,
    max_inclusive: bool | None = None,
) -> tuple[Decimal | None, Decimal | None, str, bool, bool | None, bool | None]:
    return (
        min_val.normalize() if min_val is not None else None,
        max_val.normalize() if max_val is not None else None,
        operator,
        required,
        min_inclusive,
        max_inclusive,
    )


def _gold_price_tuple(
    raw_price: dict[str, Any] | None,
) -> tuple[Decimal | None, Decimal | None, str, bool, bool | None, bool | None] | None:
    if raw_price is None:
        return None
    min_raw = raw_price.get("min")
    max_raw = raw_price.get("max")
    min_inc = raw_price.get("min_inclusive")
    max_inc = raw_price.get("max_inclusive")
    return _normalize_price_tuple(
        Decimal(str(min_raw)) if min_raw is not None else None,
        Decimal(str(max_raw)) if max_raw is not None else None,
        str(raw_price["operator"]),
        bool(raw_price["required"]),
        bool(min_inc) if min_inc is not None else None,
        bool(max_inc) if max_inc is not None else None,
    )


def _extract_predictions(result: Any, gold_price_raw: dict[str, Any] | None) -> dict[str, Any]:
    intent = result.intent
    cat_crits = {str(c.value) for c in intent.criteria if c.field == "category"}
    price_set: set[tuple[Decimal | None, Decimal | None, str, bool, bool | None, bool | None]] = (
        set()
    )
    pos_brands: set[str] = set()
    brand_or_groups: set[frozenset[str]] = set()
    neg_brands: set[str] = set()
    pos_colors: set[str] = set()
    color_or_groups: set[frozenset[str]] = set()
    neg_colors: set[str] = set()
    pos_sizes: set[str] = set()
    size_or_groups: set[frozenset[str]] = set()
    neg_sizes: set[str] = set()
    pos_genders: set[str] = set()
    neg_genders: set[str] = set()
    pos_attrs: set[str] = set()
    neg_attrs: set[str] = set()
    measurements: set[str] = set()
    include_min_inc = gold_price_raw is not None and "min_inclusive" in gold_price_raw
    include_max_inc = gold_price_raw is not None and "max_inclusive" in gold_price_raw

    for crit in intent.criteria:
        if crit.field == "price" and isinstance(crit.value, PriceValue):
            price_set.add(
                _normalize_price_tuple(
                    crit.value.min_amount,
                    crit.value.max_amount,
                    crit.operator,
                    crit.required,
                    crit.value.min_inclusive if include_min_inc else None,
                    crit.value.max_inclusive if include_max_inc else None,
                )
            )
        elif crit.field == "brand":
            vals = (crit.value,) if isinstance(crit.value, str) else tuple(crit.value)
            if crit.operator == "not_in":
                neg_brands.update(vals)
            else:
                pos_brands.update(vals)
                if crit.operator == "in" and len(vals) > 1:
                    brand_or_groups.add(frozenset(vals))
        elif crit.field == "color":
            vals = (crit.value,) if isinstance(crit.value, str) else tuple(crit.value)
            if crit.operator == "not_in":
                neg_colors.update(vals)
            else:
                pos_colors.update(vals)
                if crit.operator == "in" and len(vals) > 1:
                    color_or_groups.add(frozenset(vals))
        elif crit.field == "size":
            vals = (crit.value,) if isinstance(crit.value, str) else tuple(crit.value)
            if crit.operator == "not_in":
                neg_sizes.update(vals)
            else:
                pos_sizes.update(vals)
                if crit.operator == "in" and len(vals) > 1:
                    size_or_groups.add(frozenset(vals))
        elif crit.field == "gender":
            vals = (crit.value,) if isinstance(crit.value, str) else tuple(crit.value)
            if crit.operator == "not_in":
                neg_genders.update(vals)
            else:
                pos_genders.update(vals)
        elif crit.field == "attribute":
            if crit.id.startswith("unit-"):
                measurements.add(crit.display_label.lower())
            elif crit.id == "attr-query-1":
                continue
            elif crit.operator == "not_in":
                vals = (crit.value,) if isinstance(crit.value, str) else tuple(crit.value)
                neg_attrs.update(vals)
            elif isinstance(crit.value, str):
                pos_attrs.add(crit.value)

    return {
        "category_key": {intent.category_key} if intent.category_key else set(),
        "category_criterion": cat_crits,
        "price": price_set,
        "pos_brands": pos_brands,
        "brand_or_groups": brand_or_groups,
        "neg_brands": neg_brands,
        "pos_colors": pos_colors,
        "color_or_groups": color_or_groups,
        "neg_colors": neg_colors,
        "pos_sizes": pos_sizes,
        "size_or_groups": size_or_groups,
        "neg_sizes": neg_sizes,
        "pos_genders": pos_genders,
        "neg_genders": neg_genders,
        "pos_attrs": pos_attrs,
        "neg_attrs": neg_attrs,
        "measurements": measurements,
    }


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    rank = (pct / 100.0) * (len(sorted_values) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = rank - lo
    return sorted_values[lo] * (1.0 - frac) + sorted_values[hi] * frac


def evaluate_golden(
    golden_path: Path = DEFAULT_GOLDEN_PATH,
    *,
    benchmark_http: bool = True,
) -> GoldenEvalReport:
    """Evaluate deterministic M0 adapter and optionally benchmark Zero-DB HTTP /search/parse."""
    rows = [
        json.loads(line)
        for line in golden_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    adapter = RuleBasedQueryUnderstandingAdapter()

    counts: dict[str, _Counts] = {
        name: _Counts()
        for name in (
            "category_crit",
            "price",
            "brand",
            "brand_or",
            "color",
            "color_or",
            "size",
            "attribute",
            "measurement",
            "negation",
        )
    }

    negation_exact_hits = 0
    conflict_hits = 0
    ood_hits = 0
    confidence_hits = 0
    zero_negation_leak = True
    failures: list[str] = []

    latencies_ms: list[float] = []
    client: TestClient | None = None
    if benchmark_http:
        app = create_app(Settings(env="test", nlp_mode="rules"))
        client = TestClient(app)
        # Warmup single request so FastAPI lifespan/JSON serializer caches don't skew p95
        client.post(
            "/api/v1/search/parse",
            json={"text": "siyah erkek mont", "locale": "tr-TR", "input_source": "text"},
        )

    for row in rows:
        qid = str(row["id"])
        query = str(row["query"])
        source: InputSourceKind = "voice" if row.get("input_source") == "voice" else "text"
        exp = row["expected"]

        res = adapter.parse(query, input_source=source)
        pred = _extract_predictions(res, exp.get("price"))

        gold_cat = {exp["category_criterion"]} if exp.get("category_criterion") else set()
        counts["category_crit"].add(pred["category_criterion"], gold_cat)

        gold_price_tuple = _gold_price_tuple(exp.get("price"))
        gold_price = {gold_price_tuple} if gold_price_tuple is not None else set()
        counts["price"].add(pred["price"], gold_price)

        gold_brands = set(exp.get("positive_brands", []))
        counts["brand"].add(pred["pos_brands"], gold_brands)

        gold_brand_or = {frozenset(grp) for grp in exp.get("brand_or_groups", [])}
        counts["brand_or"].add(pred["brand_or_groups"], gold_brand_or)

        gold_colors = set(exp.get("positive_colors", []))
        counts["color"].add(pred["pos_colors"], gold_colors)

        gold_color_or = {frozenset(grp) for grp in exp.get("color_or_groups", [])}
        counts["color_or"].add(pred["color_or_groups"], gold_color_or)

        gold_sizes = set(exp.get("positive_sizes", []))
        counts["size"].add(pred["pos_sizes"], gold_sizes)

        gold_size_or = {frozenset(grp) for grp in exp.get("size_or_groups", [])}

        gold_attrs = set(exp.get("positive_attributes", []))
        counts["attribute"].add(pred["pos_attrs"], gold_attrs)

        gold_genders = set(exp.get("positive_genders", []))

        gold_meas = {str(m).lower() for m in exp.get("measurements", [])}
        counts["measurement"].add(pred["measurements"], gold_meas)

        pred_neg = {
            *(f"brand:{v}" for v in pred["neg_brands"]),
            *(f"color:{v}" for v in pred["neg_colors"]),
            *(f"size:{v}" for v in pred["neg_sizes"]),
            *(f"gender:{v}" for v in pred["neg_genders"]),
            *(f"attr:{v}" for v in pred["neg_attrs"]),
        }
        gold_neg = {
            *(f"brand:{v}" for v in exp.get("negative_brands", [])),
            *(f"color:{v}" for v in exp.get("negative_colors", [])),
            *(f"size:{v}" for v in exp.get("negative_sizes", [])),
            *(f"gender:{v}" for v in exp.get("negative_genders", [])),
            *(f"attr:{v}" for v in exp.get("negative_attributes", [])),
        }
        counts["negation"].add(pred_neg, gold_neg)
        if pred_neg == gold_neg:
            negation_exact_hits += 1

        # Critical invariant: negated values never appear as positive criteria across ALL slots
        if (
            (pred["pos_brands"] & pred["neg_brands"])
            or (pred["pos_colors"] & pred["neg_colors"])
            or (pred["pos_sizes"] & pred["neg_sizes"])
            or (pred["pos_genders"] & pred["neg_genders"])
            or (pred["pos_attrs"] & pred["neg_attrs"])
        ):
            zero_negation_leak = False

        # Validate logic_groups any_of/not invariants directly
        any_of_ids = {
            cid
            for g in res.intent.logic_groups
            if g.operator == "any_of"
            for cid in g.criterion_ids
        }
        for or_grp in pred["brand_or_groups"] | pred["color_or_groups"] | pred["size_or_groups"]:
            matching_or_crit = [
                c.id
                for c in res.intent.criteria
                if c.operator == "in"
                and isinstance(c.value, tuple)
                and frozenset(c.value) == or_grp
            ]
            if not matching_or_crit or not any(cid in any_of_ids for cid in matching_or_crit):
                failures.append(f"{qid}: missing ConstraintGroup('any_of') for OR criterion")

        if res.has_conflict == bool(exp.get("has_conflict", False)):
            conflict_hits += 1
        if res.is_ood == bool(exp.get("is_ood", False)):
            ood_hits += 1
        allowed_conf = set(exp.get("confidence_states", ["high", "review_required"]))
        if res.confidence_state in allowed_conf:
            confidence_hits += 1

        row_mismatches: list[str] = []
        if pred["category_criterion"] != gold_cat:
            row_mismatches.append(f"cat={pred['category_criterion']}!={gold_cat}")
        if (res.intent.category_key or None) != exp.get("category_key"):
            row_mismatches.append(f"cat_key={res.intent.category_key}!={exp.get('category_key')}")
        if pred["price"] != gold_price:
            row_mismatches.append(f"price={pred['price']}!={gold_price}")
        if pred["pos_brands"] != gold_brands:
            row_mismatches.append(f"brands={pred['pos_brands']}!={gold_brands}")
        if pred["brand_or_groups"] != gold_brand_or:
            row_mismatches.append(f"brand_or={pred['brand_or_groups']}!={gold_brand_or}")
        if pred["pos_colors"] != gold_colors:
            row_mismatches.append(f"colors={pred['pos_colors']}!={gold_colors}")
        if pred["color_or_groups"] != gold_color_or:
            row_mismatches.append(f"color_or={pred['color_or_groups']}!={gold_color_or}")
        if pred["pos_sizes"] != gold_sizes:
            row_mismatches.append(f"sizes={pred['pos_sizes']}!={gold_sizes}")
        if gold_size_or and pred["size_or_groups"] != gold_size_or:
            row_mismatches.append(f"size_or={pred['size_or_groups']}!={gold_size_or}")
        if "positive_genders" in exp and pred["pos_genders"] != gold_genders:
            row_mismatches.append(f"genders={pred['pos_genders']}!={gold_genders}")
        if pred["pos_attrs"] != gold_attrs:
            row_mismatches.append(f"attrs={pred['pos_attrs']}!={gold_attrs}")
        if pred["measurements"] != gold_meas:
            row_mismatches.append(f"meas={pred['measurements']}!={gold_meas}")
        if pred_neg != gold_neg:
            row_mismatches.append(f"neg={pred_neg}!={gold_neg}")
        if res.has_conflict != bool(exp.get("has_conflict", False)):
            row_mismatches.append(f"conflict={res.has_conflict}!={exp.get('has_conflict')}")
        if res.is_ood != bool(exp.get("is_ood", False)):
            row_mismatches.append(f"ood={res.is_ood}!={exp.get('is_ood')}")
        if res.confidence_state not in allowed_conf:
            row_mismatches.append(f"conf={res.confidence_state} not in {allowed_conf}")
        if row_mismatches:
            failures.append(f"{qid} ({query}): " + "; ".join(row_mismatches))

        if client is not None:
            t0 = time.perf_counter()
            resp = client.post(
                "/api/v1/search/parse",
                json={"text": query, "locale": "tr-TR", "input_source": source},
            )
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)
            if resp.status_code != 200:
                failures.append(f"{qid} HTTP {resp.status_code}: {resp.text}")
            else:
                body = resp.json()
                not_ids = {
                    c["id"]
                    for grp in body["intent"]["logic_groups"]
                    if grp["operator"] == "not"
                    for c_id in grp["criterion_ids"]
                    for c in body["intent"]["criteria"]
                    if c["id"] == c_id
                }
                applied_ids = {f["criterion_id"] for f in body["resolution"]["applied_filters"]}
                if not_ids & applied_ids:
                    zero_negation_leak = False

    if client is not None:
        client.close()

    total = len(rows)
    overall_tp = sum(
        counts[k].tp
        for k in (
            "category_crit",
            "price",
            "brand",
            "brand_or",
            "color",
            "color_or",
            "size",
            "attribute",
            "measurement",
            "negation",
        )
    )
    overall_fp = sum(
        counts[k].fp
        for k in (
            "category_crit",
            "price",
            "brand",
            "brand_or",
            "color",
            "color_or",
            "size",
            "attribute",
            "measurement",
            "negation",
        )
    )
    overall_fn = sum(
        counts[k].fn
        for k in (
            "category_crit",
            "price",
            "brand",
            "brand_or",
            "color",
            "color_or",
            "size",
            "attribute",
            "measurement",
            "negation",
        )
    )
    overall_prec = 1.0 if (overall_tp + overall_fp) == 0 else overall_tp / (overall_tp + overall_fp)
    overall_rec = 1.0 if (overall_tp + overall_fn) == 0 else overall_tp / (overall_tp + overall_fn)
    overall_f1 = (
        0.0
        if (overall_prec + overall_rec) == 0.0
        else (2.0 * overall_prec * overall_rec) / (overall_prec + overall_rec)
    )

    sorted_lat = sorted(latencies_ms)
    return GoldenEvalReport(
        total_queries=total,
        price_f1=counts["price"].f1,
        negation_accuracy=negation_exact_hits / total if total else 0.0,
        zero_negation_leak=zero_negation_leak,
        overall_field_f1=overall_f1,
        category_f1=counts["category_crit"].f1,
        brand_f1=counts["brand"].f1,
        brand_or_f1=counts["brand_or"].f1,
        color_f1=counts["color"].f1,
        size_f1=counts["size"].f1,
        attribute_f1=counts["attribute"].f1,
        measurement_f1=counts["measurement"].f1,
        conflict_accuracy=conflict_hits / total if total else 0.0,
        ood_accuracy=ood_hits / total if total else 0.0,
        confidence_accuracy=confidence_hits / total if total else 0.0,
        latency_p50_ms=_percentile(sorted_lat, 50.0),
        latency_p95_ms=_percentile(sorted_lat, 95.0),
        latency_p99_ms=_percentile(sorted_lat, 99.0),
        latency_max_ms=max(sorted_lat) if sorted_lat else 0.0,
        failures=tuple(failures),
    )


normalize_price_bounds = _normalize_price_tuple
FieldCounts = _Counts
extract_intent_predictions = _extract_predictions
compute_percentile = _percentile


def _badge(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


def format_markdown_report(report: GoldenEvalReport) -> str:
    """Render deterministic markdown gate summary matching GATE-M0 criteria."""
    status = _badge(report.passed)
    price_ok = _badge(report.price_f1 >= PRICE_F1_THRESHOLD)
    neg_ok = _badge(report.negation_accuracy >= NEGATION_ACC_THRESHOLD)
    leak_ok = _badge(report.zero_negation_leak)
    overall_ok = _badge(report.overall_field_f1 >= OVERALL_F1_THRESHOLD)
    p95_lim = f"{P95_LATENCY_MS_THRESHOLD:.0f} ms"
    lines = [
        "# GATE-M0 Week 4 Golden Benchmark Report",
        "",
        f"- **Gate Status:** `{status}`",
        f"- **Golden Dataset Size:** `{report.total_queries}` curated Turkish queries",
        "",
        "## Accuracy Metrics",
        "",
        "| Metric | Measured | Threshold | Status |",
        "| --- | ---: | ---: | --- |",
        f"| Critical Price F1 | {report.price_f1:.4f} | >= {PRICE_F1_THRESHOLD:.2f} | {price_ok} |",
        f"| Negation Exact Accuracy | {report.negation_accuracy:.4f} | "
        f">= {NEGATION_ACC_THRESHOLD:.2f} | {neg_ok} |",
        f"| Zero Negation -> Applied Filter Leak | "
        f"{report.zero_negation_leak} | True | {leak_ok} |",
        f"| Overall Micro Field F1 | {report.overall_field_f1:.4f} | "
        f">= {OVERALL_F1_THRESHOLD:.2f} | {overall_ok} |",
        f"| Category Criterion F1 | {report.category_f1:.4f} | - | Info |",
        f"| Brand F1 | {report.brand_f1:.4f} | - | Info |",
        f"| Brand OR-Group F1 | {report.brand_or_f1:.4f} | - | Info |",
        f"| Color F1 | {report.color_f1:.4f} | - | Info |",
        f"| Size F1 | {report.size_f1:.4f} | - | Info |",
        f"| Attribute F1 | {report.attribute_f1:.4f} | - | Info |",
        f"| Measurement F1 | {report.measurement_f1:.4f} | - | Info |",
        f"| Conflict Detection Accuracy | {report.conflict_accuracy:.4f} | - | Info |",
        f"| OOD Detection Accuracy | {report.ood_accuracy:.4f} | - | Info |",
        f"| Confidence State Accuracy | {report.confidence_accuracy:.4f} | - | Info |",
        "",
        "## Zero-DB `/api/v1/search/parse` HTTP Latency (200 sequential TestClient calls)",
        "",
        f"- p50: `{report.latency_p50_ms:.2f} ms`",
        f"- p95: `{report.latency_p95_ms:.2f} ms` (threshold `<= {p95_lim}`)",
        f"- p99: `{report.latency_p99_ms:.2f} ms`",
        f"- max: `{report.latency_max_ms:.2f} ms`",
    ]
    if report.failures:
        lines.extend(["", f"## Row Mismatches ({len(report.failures)})", ""])
        for item in report.failures[:25]:
            lines.append(f"- {item}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate M0 golden suite against GATE-M0.")
    parser.add_argument(
        "--golden",
        type=Path,
        default=DEFAULT_GOLDEN_PATH,
        help="Path to golden JSONL benchmark file.",
    )
    parser.add_argument(
        "--write-report",
        type=Path,
        default=None,
        help="Optional path to write markdown gate report.",
    )
    args = parser.parse_args(argv)
    report = evaluate_golden(args.golden, benchmark_http=True)
    rendered = format_markdown_report(report)
    sys.stdout.write(rendered)
    if args.write_report is not None:
        args.write_report.parent.mkdir(parents=True, exist_ok=True)
        args.write_report.write_text(rendered, encoding="utf-8")
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
