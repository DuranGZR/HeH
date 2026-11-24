"""Generate and verify mobile TypeScript API contracts from FastAPI OpenAPI schema."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from heh_api.core.config import Settings
from heh_api.main import create_app

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_TS_TARGET = _REPO_ROOT / "frontend" / "src" / "api" / "generated.ts"
_DEFAULT_OPENAPI_DOC = _REPO_ROOT / "docs" / "contracts" / "openapi.v1.json"

_SCHEMA_ORDER = (
    "LivenessResponse",
    "ReadinessResponse",
    "ApiErrorDetail",
    "ApiErrorBody",
    "ApiErrorResponse",
    "PriceValue-Input",
    "PriceValue-Output",
    "SearchCriterionNode-Input",
    "SearchCriterionNode-Output",
    "ConstraintGroup",
    "SearchIntentV2-Input",
    "SearchIntentV2-Output",
    "LinkFilterItem",
    "LinkResolution",
    "SearchParseRequest",
    "SearchParseResponse",
    "SearchResolveRequest",
    "SearchResolveResponse",
    "CategoryCapabilitySummary",
    "ProviderCapabilitiesResponse",
)


def _to_ts_identifier(raw_name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", raw_name)


def _schema_to_ts(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        raw_ref = str(schema["$ref"]).rsplit("/", maxsplit=1)[-1]
        return _to_ts_identifier(raw_ref)

    if "const" in schema:
        return json.dumps(schema["const"])

    if "enum" in schema:
        return " | ".join(json.dumps(item) for item in schema["enum"])

    if "anyOf" in schema:
        variants = [_schema_to_ts(sub) for sub in schema["anyOf"]]
        deduped: list[str] = []
        for variant in variants:
            if variant not in deduped:
                deduped.append(variant)
        return " | ".join(deduped)

    schema_type = schema.get("type")
    if schema_type == "string":
        return "string"
    if schema_type in {"integer", "number"}:
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    if schema_type == "array":
        items = schema.get("items")
        inner = _schema_to_ts(items) if isinstance(items, dict) else "unknown"
        return f"readonly ({inner})[]" if "|" in inner else f"readonly {inner}[]"
    if schema_type == "object":
        return "Record<string, unknown>"

    return "unknown"


def render_typescript_contracts(openapi_schema: dict[str, Any]) -> str:
    """Render strict TypeScript interfaces matching FastAPI OpenAPI component schemas."""
    schemas: dict[str, dict[str, Any]] = openapi_schema["components"]["schemas"]
    ordered_names = [name for name in _SCHEMA_ORDER if name in schemas]
    for remaining in sorted(schemas):
        if remaining not in ordered_names:
            ordered_names.append(remaining)

    lines: list[str] = [
        "// Auto-generated from FastAPI OpenAPI schema by backend/scripts/generate_contracts.py.",
        "// Do not edit manually; re-run `uv run python scripts/generate_contracts.py`.",
        "",
    ]

    for name in ordered_names:
        definition = schemas[name]
        ts_name = _to_ts_identifier(name)
        properties: dict[str, dict[str, Any]] = definition.get("properties", {})
        required = set(definition.get("required", ()))

        lines.append(f"export interface {ts_name} {{")
        for prop_name, prop_schema in properties.items():
            ts_type = _schema_to_ts(prop_schema)
            optional_marker = "" if prop_name in required else "?"
            lines.append(f"  readonly {prop_name}{optional_marker}: {ts_type};")
        lines.append("}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def build_contracts_bundle() -> tuple[str, str]:
    """Generate deterministic OpenAPI JSON and TypeScript contract definitions."""
    application = create_app(Settings(env="test"))
    openapi_schema = application.openapi()
    openapi_json = json.dumps(openapi_schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ts_source = render_typescript_contracts(openapi_schema)
    return openapi_json, ts_source


def main(argv: list[str] | None = None) -> int:
    """Write or verify OpenAPI + TypeScript contract synchronization."""
    parser = argparse.ArgumentParser(description="Generate/check HEH API contracts.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify generated TypeScript contracts match FastAPI OpenAPI without modifying files.",
    )
    parser.add_argument(
        "--write-docs",
        action="store_true",
        help="Also write local OpenAPI JSON snapshot to docs/contracts/openapi.v1.json.",
    )
    args = parser.parse_args(argv)

    openapi_json, ts_source = build_contracts_bundle()

    if args.check:
        if not _DEFAULT_TS_TARGET.is_file():
            print(f"[FAIL] Missing generated TS contracts: {_DEFAULT_TS_TARGET}", file=sys.stderr)
            return 1
        current = _DEFAULT_TS_TARGET.read_text(encoding="utf-8")
        if current != ts_source:
            print(
                "[FAIL] frontend/src/api/generated.ts is out of sync with FastAPI OpenAPI. "
                "Run `uv run python scripts/generate_contracts.py` from backend/.",
                file=sys.stderr,
            )
            return 1
        print("[PASS] OpenAPI <-> TypeScript contract parity verified.")
        return 0

    _DEFAULT_TS_TARGET.parent.mkdir(parents=True, exist_ok=True)
    _DEFAULT_TS_TARGET.write_text(ts_source, encoding="utf-8")
    print(f"[WROTE] {_DEFAULT_TS_TARGET}")

    if args.write_docs:
        _DEFAULT_OPENAPI_DOC.parent.mkdir(parents=True, exist_ok=True)
        _DEFAULT_OPENAPI_DOC.write_text(openapi_json, encoding="utf-8")
        print(f"[WROTE] {_DEFAULT_OPENAPI_DOC}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
