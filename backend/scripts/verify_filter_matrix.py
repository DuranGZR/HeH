"""CLI validator for Trendyol filter verification evidence matrices."""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

from pydantic import ValidationError

from heh_api.domain.verification import EvidenceMatrixDocument

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_MATRICES = [
    _REPO_ROOT / "evidence" / "W1" / "d02-url-observations.json",
    _REPO_ROOT / "evidence" / "W1" / "d03-url-observations.json",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI file arguments."""
    parser = argparse.ArgumentParser(
        description="Validate Trendyol filter evidence matrix JSON files."
    )
    parser.add_argument(
        "files",
        nargs="*",
        default=[str(p) for p in _DEFAULT_MATRICES],
        help="Path(s) to evidence JSON files (default: D02 and D03 matrices)",
    )
    return parser.parse_args(argv)


def validate_matrix_file(path: Path) -> EvidenceMatrixDocument:
    """Load and strictly validate a single evidence JSON file."""
    if not path.is_file():
        raise FileNotFoundError(f"Evidence file not found: {path}")
    doc = EvidenceMatrixDocument.model_validate_json(path.read_text(encoding="utf-8"))
    for record in doc.records:
        if record.evidence_ref and record.evidence_ref.startswith(("evidence/", "docs/")):
            ref_file = record.evidence_ref.split("#", maxsplit=1)[0]
            ref_path = _REPO_ROOT / ref_file
            if not ref_path.is_file():
                raise FileNotFoundError(f"Referenced evidence file missing: {record.evidence_ref}")
    return doc


def main(argv: list[str] | None = None) -> int:
    """Validate all provided evidence matrix files and print status summaries."""
    args = parse_args(argv)
    seen_ids: set[str] = set()
    for raw_path in args.files:
        path = Path(raw_path)
        try:
            doc = validate_matrix_file(path)
            for record in doc.records:
                if record.id in seen_ids:
                    raise ValueError(f"Duplicate observation id across files: {record.id}")
                seen_ids.add(record.id)
        except (OSError, ValidationError, ValueError) as exc:
            print(f"[FAIL] {path}: {exc}", file=sys.stderr)
            return 1

        counts = Counter(record.overall_status for record in doc.records)
        summary = ", ".join(f"{status}={count}" for status, count in sorted(counts.items()))
        print(f"[PASS] {path} ({doc.day_ref}, records={len(doc.records)}): {summary}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
