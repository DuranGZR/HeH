"""D39 Deterministic group-based train/dev/test splitter and leakage auditor."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from heh_api.domain.search_intent import normalize_turkish_text
from scripts.nlp.validate_annotations import (
    AnnotationRecordV1,
    read_canonical_lf_bytes,
    validate_annotation_files,
)

SplitName = Literal["train", "dev", "test"]

_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CORPUS_PATHS: tuple[Path, ...] = (
    _REPO_ROOT / "data" / "annotations" / "seed-v1.jsonl",
    _REPO_ROOT / "data" / "seed" / "natural-v2.jsonl",
    _REPO_ROOT / "data" / "annotations" / "round2.jsonl",
    _REPO_ROOT / "data" / "annotations" / "asr.jsonl",
)
DEFAULT_GOLDEN_PATH = _REPO_ROOT / "backend" / "tests" / "golden" / "seed.jsonl"
DEFAULT_SPLITS_PATH = _REPO_ROOT / "data" / "manifests" / "splits-v1.json"

_DIGITS_RE = re.compile(r"\b\d+(?:[.,]\d+)?\b")
_SPELLED_NUM_RE = re.compile(
    r"\b(?:sıfır|bir|iki|üç|dört|beş|yedi|sekiz|dokuz|"
    r"(?:on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan)(?:\s+altı)?|"
    r"altı(?=\s+(?:bin|yüz|tl|te\s+le|lira|numara|yaş|cigabayt|gigabayt|gb|tb|litre|ml))|"
    r"yüz|bin|buçuk)\b"
)
_CURRENCY_TOKEN_RE = re.compile(r"\b(?:tl|te\s+le|t\s+l|lira(?:yı|ya|dan|sı)?)\b")
_NON_WORD_RE = re.compile(r"[^\w\s]+")
_MULTI_SPACE_RE = re.compile(r"\s+")

_NUM_PLACEHOLDER = "__num__"
_CUR_PLACEHOLDER = "__cur__"
_NEAR_DUP_JACCARD_THRESHOLD = 0.85

_SLICE_WEIGHTS: dict[str, float] = {
    "total": 3.0,
    "voice_asr": 2.0,
    "or": 2.0,
    "not": 2.0,
    "conflict": 2.5,
    "ood": 2.5,
    "long_tail": 1.8,
    "showcase": 1.4,
    "material": 1.5,
    "model": 1.5,
}


def compute_query_skeleton(text: str) -> str:
    """Normalize a Turkish query and mask numerals/currencies to detect template paraphrases."""
    folded = normalize_turkish_text(text)
    folded = _DIGITS_RE.sub(f" {_NUM_PLACEHOLDER} ", folded)
    folded = _SPELLED_NUM_RE.sub(f" {_NUM_PLACEHOLDER} ", folded)
    folded = _CURRENCY_TOKEN_RE.sub(f" {_CUR_PLACEHOLDER} ", folded)
    folded = _NON_WORD_RE.sub(" ", folded)
    collapsed = _MULTI_SPACE_RE.sub(" ", folded).strip()
    collapsed = re.sub(
        rf"(?:{re.escape(_NUM_PLACEHOLDER)}\s*)+",
        f"{_NUM_PLACEHOLDER} ",
        collapsed,
    ).strip()
    return collapsed


def extract_skeleton_tokens(skeleton: str) -> frozenset[str]:
    """Return non-placeholder tokens from a normalized query skeleton."""
    return frozenset(
        tok for tok in skeleton.split() if tok not in {_NUM_PLACEHOLDER, _CUR_PLACEHOLDER}
    )


def _char_trigrams(text: str) -> frozenset[str]:
    padded = f"  {text}  "
    return frozenset(padded[i : i + 3] for i in range(max(0, len(padded) - 2)))


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a and not b:
        return 1.0
    union = len(a | b)
    return 0.0 if union == 0 else len(a & b) / union


class _UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra = self.find(a)
        rb = self.find(b)
        if ra != rb:
            if ra < rb:
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


@dataclass(frozen=True)
class LoadedCorpusRecord:
    """Validated annotation record paired with its relative corpus source path."""

    record: AnnotationRecordV1
    source_path: str
    skeleton: str
    skeleton_tokens: frozenset[str]
    trigrams: frozenset[str]


def load_validated_corpus(
    corpus_paths: Sequence[Path] = DEFAULT_CORPUS_PATHS,
    *,
    repo_root: Path = _REPO_ROOT,
) -> list[LoadedCorpusRecord]:
    """Validate and load one or more JSONL corpus files deterministically."""
    report = validate_annotation_files(corpus_paths, fail_fast=False)
    if not report.valid:
        joined = "; ".join(report.errors[:10])
        raise ValueError(f"Corpus validation failed before split: {joined}")

    loaded: list[LoadedCorpusRecord] = []
    for path in corpus_paths:
        try:
            rel_path = path.resolve().relative_to(repo_root.resolve()).as_posix()
        except ValueError:
            rel_path = path.name
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            stripped = raw_line.strip()
            if not stripped:
                continue
            rec = AnnotationRecordV1.model_validate_json(stripped)
            skel = compute_query_skeleton(rec.query)
            loaded.append(
                LoadedCorpusRecord(
                    record=rec,
                    source_path=rel_path,
                    skeleton=skel,
                    skeleton_tokens=extract_skeleton_tokens(skel),
                    trigrams=_char_trigrams(skel),
                )
            )
    return loaded


def _record_slices(rec: AnnotationRecordV1) -> dict[str, int]:
    has_or = any(sp.relation_group and sp.relation_group.startswith("or_") for sp in rec.spans)
    has_not = any(sp.polarity == "negative" for sp in rec.spans)
    has_mat = any(sp.field == "material" for sp in rec.spans)
    has_mod = any(sp.field == "model" for sp in rec.spans)
    is_voice = rec.input_source == "voice" or rec.provenance == "asr_simulation"
    return {
        "total": 1,
        "showcase": int(rec.is_showcase),
        "long_tail": int((rec.category_key is not None) and (not rec.is_showcase)),
        "voice_asr": int(is_voice),
        "or": int(has_or),
        "not": int(has_not),
        "conflict": int(rec.has_conflict),
        "ood": int(rec.is_ood),
        "material": int(has_mat),
        "model": int(has_mod),
    }


def compute_locked_test_sha256(test_records: Sequence[AnnotationRecordV1]) -> str:
    """Compute a stable SHA-256 lock hash over sorted canonical test queries and labels."""
    canonical_rows = [
        rec.model_dump(mode="json") for rec in sorted(test_records, key=lambda r: r.id)
    ]
    payload = json.dumps(canonical_rows, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def build_splits_manifest(
    corpus_paths: Sequence[Path] = DEFAULT_CORPUS_PATHS,
    *,
    golden_path: Path | None = DEFAULT_GOLDEN_PATH,
    repo_root: Path = _REPO_ROOT,
    train_ratio: float = 0.70,
    dev_ratio: float = 0.15,
    test_ratio: float = 0.15,
) -> dict[str, Any]:
    """Partition corpus by group without near-duplicate or W4-golden leakage into dev/test."""
    if abs((train_ratio + dev_ratio + test_ratio) - 1.0) > 1e-6:
        raise ValueError("Split ratios must sum to 1.0")

    items = load_validated_corpus(corpus_paths, repo_root=repo_root)
    n = len(items)
    uf = _UnionFind(n)

    # 1. Exact equivalence grouping: shared `template_family` or identical `query_skeleton`
    by_family: dict[str, list[int]] = defaultdict(list)
    by_skeleton: dict[str, list[int]] = defaultdict(list)
    for idx, item in enumerate(items):
        by_family[item.record.template_family].append(idx)
        by_skeleton[item.skeleton].append(idx)

    for indices in by_family.values():
        for i in indices[1:]:
            uf.union(indices[0], i)
    for indices in by_skeleton.values():
        for i in indices[1:]:
            uf.union(indices[0], i)

    # 2. Same-category single-hop high-overlap paraphrase clustering (no unbounded chaining)
    near_dup_edges: list[tuple[int, int]] = []
    for i in range(n):
        ti = items[i].skeleton_tokens
        if len(ti) < 4:
            continue
        for j in range(i + 1, n):
            if items[i].record.category_key != items[j].record.category_key:
                continue
            tj = items[j].skeleton_tokens
            if len(tj) < 4:
                continue
            if _jaccard(ti, tj) >= _NEAR_DUP_JACCARD_THRESHOLD:
                near_dup_edges.append((i, j))
    for i, j in near_dup_edges:
        uf.union(i, j)

    # 3. Pin any cluster touching W4 golden queries (`golden/seed.jsonl`) strictly to `train`
    golden_norm: set[str] = set()
    golden_skeletons: set[str] = set()
    golden_tokens: list[tuple[frozenset[str], str | None]] = []
    if golden_path is not None and golden_path.is_file():
        for line in golden_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            q = str(row["query"])
            cat = row.get("expected", {}).get("category_key")
            golden_norm.add(normalize_turkish_text(q))
            skel = compute_query_skeleton(q)
            golden_skeletons.add(skel)
            golden_tokens.append((extract_skeleton_tokens(skel), cat))

    clusters_map: dict[int, list[int]] = defaultdict(list)
    for idx in range(n):
        clusters_map[uf.find(idx)].append(idx)

    pinned_train_roots: set[int] = set()
    for root, idxs in clusters_map.items():
        for idx in idxs:
            item = items[idx]
            norm_q = normalize_turkish_text(item.record.query)
            if norm_q in golden_norm or item.skeleton in golden_skeletons:
                pinned_train_roots.add(root)
                break
            if len(item.skeleton_tokens) >= 4 and any(
                cat == item.record.category_key
                and len(gtok) >= 4
                and _jaccard(item.skeleton_tokens, gtok) >= _NEAR_DUP_JACCARD_THRESHOLD
                for gtok, cat in golden_tokens
            ):
                pinned_train_roots.add(root)
                break

    # 4. Aggregate cluster slice counts and greedily allocate unpinned clusters
    cluster_rows: list[tuple[int, dict[str, int], bool, str]] = []
    total_slices: dict[str, int] = {k: 0 for k in _SLICE_WEIGHTS}
    for root, idxs in clusters_map.items():
        counts = {k: 0 for k in _SLICE_WEIGHTS}
        for idx in idxs:
            rec_s = _record_slices(items[idx].record)
            for k, v in rec_s.items():
                counts[k] += v
                total_slices[k] += v
        rep_id = min(items[i].record.id for i in idxs)
        cluster_rows.append((root, counts, root in pinned_train_roots, rep_id))

    targets: dict[SplitName, dict[str, float]] = {
        "train": {k: total_slices[k] * train_ratio for k in _SLICE_WEIGHTS},
        "dev": {k: total_slices[k] * dev_ratio for k in _SLICE_WEIGHTS},
        "test": {k: total_slices[k] * test_ratio for k in _SLICE_WEIGHTS},
    }
    split_names: tuple[SplitName, ...] = ("train", "dev", "test")
    split_counts: dict[SplitName, dict[str, int]] = {
        split: {k: 0 for k in _SLICE_WEIGHTS} for split in split_names
    }
    cluster_assignment: dict[int, SplitName] = {}

    # Assign pinned clusters to `train` first
    unpinned: list[tuple[int, dict[str, int], str]] = []
    for root, counts, pinned, rep_id in cluster_rows:
        if pinned:
            cluster_assignment[root] = "train"
            for k, v in counts.items():
                split_counts["train"][k] += v
        else:
            unpinned.append((root, counts, rep_id))

    # Deterministic scarcity-aware ordering: clusters containing rarer slices first
    def _cluster_priority(entry: tuple[int, dict[str, int], str]) -> tuple[float, int, str]:
        _, cnt, rep_id = entry
        scarcity = sum(
            cnt[k] * _SLICE_WEIGHTS[k] / max(1, total_slices[k])
            for k in _SLICE_WEIGHTS
            if k != "total"
        )
        return (-scarcity, -cnt["total"], rep_id)

    unpinned.sort(key=_cluster_priority)

    cand_order: tuple[SplitName, ...] = ("dev", "test", "train")
    for root, counts, _ in unpinned:
        best_split: SplitName = "train"
        best_cost = float("inf")
        for cand_split in cand_order:
            cost = 0.0
            for s_typed in split_names:
                for k, w in _SLICE_WEIGHTS.items():
                    new_val = split_counts[s_typed][k] + (counts[k] if s_typed == cand_split else 0)
                    denom = max(1.0, targets[s_typed][k])
                    diff = new_val - targets[s_typed][k]
                    overshoot_penalty = 1.6 if diff > 0 and s_typed != "train" else 1.0
                    cost += w * overshoot_penalty * ((diff / denom) ** 2)
            if cost < best_cost:
                best_cost = cost
                best_split = cand_split

        cluster_assignment[root] = best_split
        for k, v in counts.items():
            split_counts[best_split][k] += v

    split_ids: dict[SplitName, list[str]] = {"train": [], "dev": [], "test": []}
    split_items: dict[SplitName, list[LoadedCorpusRecord]] = {"train": [], "dev": [], "test": []}
    for idx, item in enumerate(items):
        assigned = cluster_assignment[uf.find(idx)]
        split_ids[assigned].append(item.record.id)
        split_items[assigned].append(item)

    for s_list in split_ids.values():
        s_list.sort()

    # 5. Formal cross-split leakage audit
    leakage_audit = audit_split_leakage(
        split_items,
        golden_norm=golden_norm,
        golden_skel=golden_skeletons,
    )
    if not leakage_audit["passed"]:
        raise ValueError(f"Split leakage audit failed: {leakage_audit}")

    source_files: list[dict[str, Any]] = []
    for path in corpus_paths:
        raw_bytes = read_canonical_lf_bytes(path)
        try:
            rel_path = path.resolve().relative_to(repo_root.resolve()).as_posix()
        except ValueError:
            rel_path = path.name
        line_cnt = sum(1 for ln in raw_bytes.decode("utf-8").splitlines() if ln.strip())
        source_files.append(
            {
                "path": rel_path,
                "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                "record_count": line_cnt,
            }
        )

    test_recs = [it.record for it in split_items["test"]]
    return {
        "split_version": "1.0.0",
        "ontology_version": "1.0.0",
        "total_records": n,
        "cluster_count": len(clusters_map),
        "pinned_golden_overlap_clusters": len(pinned_train_roots),
        "target_ratios": {"train": train_ratio, "dev": dev_ratio, "test": test_ratio},
        "source_files": source_files,
        "split_counts": {k: len(v) for k, v in split_ids.items()},
        "slice_distribution": split_counts,
        "leakage_audit": leakage_audit,
        "locked_test_sha256": compute_locked_test_sha256(test_recs),
        "splits": split_ids,
    }


def audit_split_leakage(
    split_items: dict[SplitName, list[LoadedCorpusRecord]],
    *,
    golden_norm: set[str],
    golden_skel: set[str],
) -> dict[str, Any]:
    """Verify zero template_family, skeleton, W4-golden, or high-Jaccard leakage across splits."""
    families = {s: {it.record.template_family for it in lst} for s, lst in split_items.items()}
    skeletons = {s: {it.skeleton for it in lst} for s, lst in split_items.items()}

    cross_family = (
        len(families["train"] & families["dev"])
        + len(families["train"] & families["test"])
        + len(families["dev"] & families["test"])
    )
    cross_skeleton = (
        len(skeletons["train"] & skeletons["dev"])
        + len(skeletons["train"] & skeletons["test"])
        + len(skeletons["dev"] & skeletons["test"])
    )

    golden_leak_dev_test = 0
    for split_name in ("dev", "test"):
        for it in split_items[split_name]:
            if normalize_turkish_text(it.record.query) in golden_norm or it.skeleton in golden_skel:
                golden_leak_dev_test += 1

    high_jaccard_pairs = 0
    max_cross_trigram = 0.0
    pairs_checked: tuple[tuple[SplitName, SplitName], ...] = (
        ("train", "dev"),
        ("train", "test"),
        ("dev", "test"),
    )
    for sa, sb in pairs_checked:
        for ia in split_items[sa]:
            for ib in split_items[sb]:
                sim = _jaccard(ia.trigrams, ib.trigrams)
                if sim > max_cross_trigram:
                    max_cross_trigram = sim
                if (
                    ia.record.category_key == ib.record.category_key
                    and len(ia.skeleton_tokens) >= 4
                    and len(ib.skeleton_tokens) >= 4
                    and _jaccard(ia.skeleton_tokens, ib.skeleton_tokens)
                    >= _NEAR_DUP_JACCARD_THRESHOLD
                ):
                    high_jaccard_pairs += 1

    passed = (
        cross_family == 0
        and cross_skeleton == 0
        and golden_leak_dev_test == 0
        and high_jaccard_pairs == 0
    )
    return {
        "passed": passed,
        "cross_split_template_family_overlap": cross_family,
        "cross_split_skeleton_overlap": cross_skeleton,
        "golden_seed_leak_in_dev_or_test": golden_leak_dev_test,
        "high_jaccard_cross_split_pairs": high_jaccard_pairs,
        "max_cross_split_char_trigram_jaccard": round(max_cross_trigram, 4),
    }


def load_split_records(
    manifest_path: Path = DEFAULT_SPLITS_PATH,
    *,
    repo_root: Path = _REPO_ROOT,
) -> tuple[dict[str, Any], dict[SplitName, list[AnnotationRecordV1]]]:
    """Load split manifest, validate source file SHA-256 hashes and locked test SHA-256."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_paths: list[Path] = []
    for src in manifest["source_files"]:
        full = repo_root / src["path"]
        actual_hash = hashlib.sha256(read_canonical_lf_bytes(full)).hexdigest()
        if actual_hash != src["sha256"]:
            raise ValueError(
                f"Source file hash mismatch for {src['path']}: "
                f"expected {src['sha256']} got {actual_hash}"
            )
        source_paths.append(full)

    items = load_validated_corpus(source_paths, repo_root=repo_root)
    by_id = {it.record.id: it.record for it in items}
    by_split: dict[SplitName, list[AnnotationRecordV1]] = {"train": [], "dev": [], "test": []}
    split_keys: tuple[SplitName, ...] = ("train", "dev", "test")
    for s_key in split_keys:
        for rid in manifest["splits"][s_key]:
            by_split[s_key].append(by_id[rid])

    actual_test_lock = compute_locked_test_sha256(by_split["test"])
    if actual_test_lock != manifest["locked_test_sha256"]:
        raise ValueError("Locked test split SHA-256 mismatch; frozen test records must not drift!")
    return manifest, by_split


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build or verify W8 group splits manifest.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_SPLITS_PATH,
        help="Path to write/verify splits manifest JSON.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify committed splits manifest matches corpus, hashes, and leakage invariants.",
    )
    args = parser.parse_args(argv)

    if args.check:
        if not args.output.is_file():
            print(f"[FAIL] Splits manifest not found: {args.output}", file=sys.stderr)
            return 1
        manifest, _ = load_split_records(args.output)
        expected = build_splits_manifest()
        if manifest != expected:
            print("[FAIL] Splits manifest drifted from deterministic build.", file=sys.stderr)
            return 1
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "split_counts": manifest["split_counts"],
                    "leakage_audit": manifest["leakage_audit"],
                    "locked_test_sha256": manifest["locked_test_sha256"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    manifest = build_splits_manifest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        json.dumps(
            {
                "split_counts": manifest["split_counts"],
                "slice_distribution": manifest["slice_distribution"],
                "leakage_audit": manifest["leakage_audit"],
                "locked_test_sha256": manifest["locked_test_sha256"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
