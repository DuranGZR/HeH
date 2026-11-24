"""Domain AST, LinkResolution invariants, and OpenAPI <-> TS contract parity tests."""

import ast
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError
from scripts.generate_contracts import main as contracts_main

from heh_api.domain.search_intent import (
    ConstraintGroup,
    LinkFilterItem,
    LinkResolution,
    PriceValue,
    SearchCriterionNode,
    SearchIntentV2,
    normalize_turkish_text,
)

_DOMAIN_DIR = Path(__file__).resolve().parents[2] / "src" / "heh_api" / "domain"
_FORBIDDEN_DOMAIN_IMPORTS = frozenset({"fastapi", "sqlalchemy", "psycopg", "starlette", "alembic"})


def test_domain_modules_never_import_framework_or_orm() -> None:
    """Enforce architectural boundary: domain/ stays free of web/DB frameworks."""
    for py_file in _DOMAIN_DIR.glob("*.py"):
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top_pkg = alias.name.split(".", maxsplit=1)[0]
                    assert top_pkg not in _FORBIDDEN_DOMAIN_IMPORTS, py_file.name
            elif isinstance(node, ast.ImportFrom) and node.module:
                top_pkg = node.module.split(".", maxsplit=1)[0]
                assert top_pkg not in _FORBIDDEN_DOMAIN_IMPORTS, py_file.name


def test_turkish_normalization_handles_dotted_and_dotless_i() -> None:
    """Verify Turkish İ->i and I->ı folding works accurately under Unicode NFC."""
    assert normalize_turkish_text("  SİYAH   IRAK  İPHONE  ") == "siyah ırak iphone"


def test_search_intent_v2_validates_referential_integrity() -> None:
    """Reject ConstraintGroup referencing unknown criterion IDs."""
    criterion = SearchCriterionNode(
        id="price-1",
        field="price",
        operator="lte",
        value=PriceValue(min_amount=Decimal("0"), max_amount=Decimal("3000")),
        display_label="0-3000 TL",
    )
    intent = SearchIntentV2(
        raw_query="3000 altı",
        normalized_query="3000 altı",
        criteria=(criterion,),
        logic_groups=(ConstraintGroup(operator="all_of", criterion_ids=("price-1",)),),
    )
    assert intent.schema_version == "2.0.0"

    with pytest.raises(ValidationError, match="unknown criterion id"):
        SearchIntentV2(
            raw_query="3000 altı",
            normalized_query="3000 altı",
            criteria=(criterion,),
            logic_groups=(ConstraintGroup(operator="not", criterion_ids=("missing-id",)),),
        )


def test_link_resolution_blocks_open_redirect_and_negative_applied_filter() -> None:
    """Prevent unsafe hosts and disallow NOT criteria inside applied_filters."""
    with pytest.raises(ValidationError, match="ALLOWED_PROVIDER_HOSTS"):
        LinkResolution(
            url="https://evil.example/sr?q=mont",
            route_strategy="canonical_search_query",
            mapping_version="2026.11.24.1",
            verification_notice="notice",
        )

    with pytest.raises(ValidationError, match="Negative not_in"):
        LinkResolution(
            url="https://www.trendyol.com/sr?q=mont",
            route_strategy="canonical_search_query",
            mapping_version="2026.11.24.1",
            applied_filters=(
                LinkFilterItem(
                    criterion_id="brand-not-1",
                    field="brand",
                    label="Nike olmasın",
                    operator="not_in",
                    status="WEB_VERIFIED_PENDING_MOBILE",
                    url_param="wb",
                    url_value="44",
                    reason="invalid promotion",
                    evidence_ref="evidence/W1/d03-url-observations.json",
                ),
            ),
            verification_notice="notice",
        )


def test_openapi_typescript_contracts_are_synchronized() -> None:
    """Fail if frontend/src/api/generated.ts drifts from FastAPI OpenAPI schema."""
    assert contracts_main(["--check"]) == 0
