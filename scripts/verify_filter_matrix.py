"""CLI validator for Trendyol filter verification evidence matrices."""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

from pydantic import ValidationError

from heh_api.domain.verification import EvidenceMatrixDocument

_DEFAULT_MATRIX = (
    Path(__file__).resolve().parent.parent / "evidence" / "W1" / "d02-url-observations.json"
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI file arguments."""
    parser = argparse.ArgumentParser(
        description="Validate Trendyol filter evidence matrix JSON files."
    )
    parser.add_argument(
        "files",
        nargs="*",
        default=[str(_DEFAULT_MATRIX)],
        help="Path(s) to evidence JSON files (default: evidence/W1/d02-url-observations.json)",
    )
    return parser.parse_args(argv)


def validate_matrix_file(path: Path) -> EvidenceMatrixDocument:
    """Load and strictly validate a single evidence JSON file."""
    if not path.is_file():
        raise FileNotFoundError(f"Evidence file not found: {path}")
    return EvidenceMatrixDocument.model_validate_json(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    """Validate all provided evidence matrix files and print status summaries."""
    args = parse_args(argv)
    for raw_path in args.files:
        path = Path(raw_path)
        try:
            doc = validate_matrix_file(path)
        except (OSError, ValidationError, ValueError) as exc:
            print(f"[FAIL] {path}: {exc}", file=sys.stderr)
            return 1

        counts = Counter(record.overall_status for record in doc.records)
        summary = ", ".join(f"{status}={count}" for status, count in sorted(counts.items()))
        print(f"[PASS] {path} ({doc.day_ref}, records={len(doc.records)}): {summary}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
