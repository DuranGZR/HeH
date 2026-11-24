"""Pure domain models for Turkish CQU SearchIntent v2 AST and safe LinkResolution."""

import unicodedata
from datetime import datetime
from decimal import Decimal
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from heh_api.domain.verification import (
    RouteStrategyKind,
    VerificationStatus,
    validate_provider_url,
)

MAX_QUERY_LENGTH: Final[int] = 500
PARSER_VERSION: Final[str] = "1.0.0"
CANONICAL_INTENT_SCHEMA_VERSION: Final[Literal["2.0.0"]] = "2.0.0"

LogicalOperator = Literal["all_of", "any_of", "not"]
CriterionField = Literal[
    "category",
    "brand",
    "color",
    "size",
    "gender",
    "price",
    "attribute",
    "sorting",
]
CriterionOperator = Literal["eq", "in", "not_in", "gte", "lte", "between"]
CriterionProvenance = Literal["rule", "ml_candidate", "user_edit"]
InputSourceKind = Literal["text", "voice"]
ConfidenceState = Literal["high", "review_required", "abstain"]
WarningLevel = Literal["none", "partial", "critical"]


def normalize_display_query(raw: str) -> str:
    """Normalize Unicode NFC and collapse whitespace while preserving Turkish casing."""
    nfc = unicodedata.normalize("NFC", raw)
    return " ".join(nfc.strip().split())


def normalize_turkish_text(raw: str) -> str:
    """Lowercase text using Turkish locale rules (`İ -> i`, `I -> ı`) safely."""
    cleaned = normalize_display_query(raw)
    mapped = cleaned.replace("\u0130", "i").replace("I", "ı")
    return mapped.lower()


class PriceValue(BaseModel):
    """Typed monetary filter constraint in TRY (`prc=` candidate bounds)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    currency: Literal["TRY"] = "TRY"

    @model_validator(mode="after")
    def _validate_bounds(self) -> "PriceValue":
        if self.min_amount is None and self.max_amount is None:
            raise ValueError("PriceValue requires at least one of min_amount or max_amount")
        if self.min_amount is not None and self.min_amount < Decimal("0"):
            raise ValueError("min_amount cannot be negative")
        if self.max_amount is not None and self.max_amount < Decimal("0"):
            raise ValueError("max_amount cannot be negative")
        if (
            self.min_amount is not None
            and self.max_amount is not None
            and self.min_amount > self.max_amount
        ):
            raise ValueError("min_amount cannot exceed max_amount")
        return self


class SearchCriterionNode(BaseModel):
    """Single editable search criterion inside a SearchIntent v2 AST."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    field: CriterionField
    operator: CriterionOperator
    value: str | tuple[str, ...] | PriceValue
    display_label: str = Field(min_length=1, max_length=120)
    required: bool = True
    provenance: CriterionProvenance = "rule"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_span: str | None = Field(default=None, max_length=160)


class ConstraintGroup(BaseModel):
    """Boolean AST node grouping criterion IDs (`all_of`, `any_of`, `not`)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    operator: LogicalOperator
    criterion_ids: tuple[str, ...] = Field(min_length=1)


class SearchIntentV2(BaseModel):
    """Canonical editable SearchIntent v2 AST (provider-independent)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["2.0.0"] = CANONICAL_INTENT_SCHEMA_VERSION
    raw_query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    normalized_query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    locale: Literal["tr-TR"] = "tr-TR"
    input_source: InputSourceKind = "text"
    category_key: str | None = Field(default=None, max_length=64)
    criteria: tuple[SearchCriterionNode, ...] = ()
    logic_groups: tuple[ConstraintGroup, ...] = ()

    @model_validator(mode="after")
    def _validate_ast_integrity(self) -> "SearchIntentV2":
        seen_ids: set[str] = set()
        for criterion in self.criteria:
            if criterion.id in seen_ids:
                raise ValueError(f"Duplicate criterion id in SearchIntentV2: {criterion.id}")
            seen_ids.add(criterion.id)

        for group in self.logic_groups:
            for criterion_id in group.criterion_ids:
                if criterion_id not in seen_ids:
                    raise ValueError(
                        f"ConstraintGroup references unknown criterion id: {criterion_id}"
                    )
        return self


class LinkFilterItem(BaseModel):
    """Transparent classification outcome for a single search criterion."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    criterion_id: str = Field(min_length=1, max_length=64)
    field: CriterionField
    label: str = Field(min_length=1, max_length=160)
    operator: CriterionOperator
    status: VerificationStatus
    url_param: str | None = Field(default=None, max_length=64)
    url_value: str | None = Field(default=None, max_length=256)
    reason: str = Field(min_length=1, max_length=240)
    evidence_ref: str | None = Field(default=None, max_length=160)


class LinkResolution(BaseModel):
    """Allowlisted Trendyol search link paired with per-criterion verification honesty."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["trendyol"] = "trendyol"
    url: str = Field(min_length=1, max_length=2048)
    route_strategy: RouteStrategyKind
    mapping_version: str = Field(min_length=1, max_length=64)
    applied_filters: tuple[LinkFilterItem, ...] = ()
    query_only: tuple[LinkFilterItem, ...] = ()
    unsupported: tuple[LinkFilterItem, ...] = ()
    warning_level: WarningLevel = "none"
    verification_notice: str = Field(min_length=1, max_length=320)
    verified_at: datetime | None = None

    @model_validator(mode="after")
    def _validate_resolution_safety(self) -> "LinkResolution":
        validate_provider_url(self.url, self.route_strategy)

        for item in self.applied_filters:
            if item.operator == "not_in":
                raise ValueError("Negative not_in criteria cannot be placed in applied_filters")
            if item.status not in {"FILTER_VERIFIED", "WEB_VERIFIED_PENDING_MOBILE"}:
                raise ValueError(
                    f"applied_filters requires verified status, received '{item.status}'"
                )
            if not item.url_param or not item.evidence_ref:
                raise ValueError("applied_filters items require url_param and evidence_ref")

        for item in self.unsupported:
            if item.status != "UNSUPPORTED":
                raise ValueError(
                    f"unsupported items must have UNSUPPORTED status, got '{item.status}'"
                )

        return self
