"""Pure domain models for Turkish CQU SearchIntent v2 AST and safe LinkResolution."""

import re
import unicodedata
from datetime import datetime
from decimal import Decimal
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from heh_api.domain.taxonomy import (
    ONTOLOGY_SCHEMA_VERSION,
    IntentType,
    ModalityKind,
    PolarityKind,
)
from heh_api.domain.verification import (
    RouteStrategyKind,
    VerificationStatus,
    validate_provider_url,
)

MAX_QUERY_LENGTH: Final[int] = 500
MAX_CRITERIA_COUNT: Final[int] = 64
MAX_LOGIC_GROUPS: Final[int] = 32
MAX_GROUP_CRITERION_IDS: Final[int] = 32
MAX_CRITERION_VALUE_ITEMS: Final[int] = 32
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
    "material",
    "attribute",
    "model",
    "sorting",
]
CriterionOperator = Literal["eq", "in", "not_in", "gte", "lte", "between"]
CriterionProvenance = Literal["rule", "ml_candidate", "user_edit"]
InputSourceKind = Literal["text", "voice"]
ConfidenceState = Literal["high", "review_required", "abstain"]
WarningLevel = Literal["none", "partial", "critical"]


_ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200f\u2060\ufeff]")
_CONTROL_WHITESPACE_RE = re.compile(r"[\x00-\x1f\x7f]")


def normalize_display_query(raw: str) -> str:
    """Normalize Unicode NFC and strip invisible control characters cleanly."""
    nfc = unicodedata.normalize("NFC", raw)
    without_zero_width = _ZERO_WIDTH_RE.sub("", nfc)
    cleaned = _CONTROL_WHITESPACE_RE.sub(" ", without_zero_width)
    return " ".join(cleaned.strip().split())


def normalize_turkish_text(raw: str) -> str:
    """Lowercase text using Turkish locale rules (`İ -> i`, `I -> ı`) safely."""
    cleaned = normalize_display_query(raw)
    mapped = cleaned.replace("\u0130", "i").replace("I", "ı").lower()
    return mapped.replace("i\u0307", "i")


class PriceValue(BaseModel):
    """Typed monetary filter constraint in TRY (`prc=` candidate bounds)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    min_inclusive: bool = True
    max_inclusive: bool = True
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
    polarity: PolarityKind = "positive"
    modality: ModalityKind = "must"
    explicit: bool = True
    provenance: CriterionProvenance = "rule"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_span: str | None = Field(default=None, max_length=160)
    span_start: int | None = Field(default=None, ge=0)
    span_end: int | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=32)

    @model_validator(mode="before")
    @classmethod
    def _infer_negative_polarity_defaults(cls, raw_data: object) -> object:
        """Default omitted polarity/modality cleanly for `not_in` while catching contradictions."""
        if not isinstance(raw_data, dict):
            return raw_data
        if raw_data.get("operator") == "not_in":
            updated = dict(raw_data)
            if "polarity" not in updated or updated["polarity"] is None:
                updated["polarity"] = "negative"
            if "modality" not in updated or updated["modality"] is None:
                updated["modality"] = "must_not"
            return updated
        return raw_data

    @model_validator(mode="after")
    def _validate_field_value_types(self) -> "SearchCriterionNode":
        if self.field == "price":
            if not isinstance(self.value, PriceValue):
                raise ValueError("price criterion requires PriceValue")
        elif isinstance(self.value, PriceValue):
            raise ValueError("PriceValue is only valid for field='price'")
        if isinstance(self.value, tuple) and len(self.value) > MAX_CRITERION_VALUE_ITEMS:
            raise ValueError(f"criterion tuple cannot exceed {MAX_CRITERION_VALUE_ITEMS} items")

        if self.operator == "not_in":
            if self.polarity != "negative" or self.modality != "must_not":
                raise ValueError(
                    "not_in criteria must have polarity='negative' and modality='must_not'"
                )
        elif self.polarity == "negative" or self.modality == "must_not":
            raise ValueError("Only not_in criteria may use negative polarity or must_not modality")

        if (self.span_start is None) != (self.span_end is None):
            raise ValueError("span_start and span_end must both be set or both None")
        if (
            self.span_start is not None
            and self.span_end is not None
            and self.span_end <= self.span_start
        ):
            raise ValueError("span_end must be strictly greater than span_start")
        return self


class ConstraintGroup(BaseModel):
    """Boolean AST node grouping criterion IDs (`all_of`, `any_of`, `not`)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    operator: LogicalOperator
    criterion_ids: tuple[str, ...] = Field(min_length=1, max_length=MAX_GROUP_CRITERION_IDS)


class SearchIntentV2(BaseModel):
    """Canonical editable SearchIntent v2 AST (provider-independent)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["2.0.0"] = CANONICAL_INTENT_SCHEMA_VERSION
    ontology_version: str = Field(default=ONTOLOGY_SCHEMA_VERSION, min_length=1, max_length=32)
    intent_type: IntentType = "product_search"
    raw_query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    normalized_query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    locale: Literal["tr-TR"] = "tr-TR"
    input_source: InputSourceKind = "text"
    category_key: str | None = Field(default=None, max_length=64)
    criteria: tuple[SearchCriterionNode, ...] = Field(default=(), max_length=MAX_CRITERIA_COUNT)
    logic_groups: tuple[ConstraintGroup, ...] = Field(default=(), max_length=MAX_LOGIC_GROUPS)

    @field_validator("raw_query", "normalized_query", mode="before")
    @classmethod
    def _strip_and_validate_non_blank_query(cls, raw_value: object) -> str:
        if not isinstance(raw_value, str):
            raise ValueError("query must be a string")
        cleaned = normalize_display_query(raw_value)
        if not cleaned:
            raise ValueError("query must not be empty or whitespace")
        if len(cleaned) > MAX_QUERY_LENGTH:
            raise ValueError(f"query cannot exceed {MAX_QUERY_LENGTH} characters")
        return cleaned

    @model_validator(mode="after")
    def _validate_ast_integrity(self) -> "SearchIntentV2":
        max_span_bound = max(len(self.raw_query), len(self.normalized_query))
        nodes_by_id: dict[str, SearchCriterionNode] = {}
        for criterion in self.criteria:
            if criterion.id in nodes_by_id:
                raise ValueError(f"Duplicate criterion id in SearchIntentV2: {criterion.id}")
            if criterion.span_end is not None and criterion.span_end > max_span_bound:
                raise ValueError(
                    f"Criterion '{criterion.id}' span_end ({criterion.span_end}) "
                    "exceeds query length"
                )
            nodes_by_id[criterion.id] = criterion

        for group in self.logic_groups:
            seen_group_ids: set[str] = set()
            for criterion_id in group.criterion_ids:
                if criterion_id in seen_group_ids:
                    raise ValueError(
                        f"ConstraintGroup contains duplicate criterion id: {criterion_id}"
                    )
                seen_group_ids.add(criterion_id)
                node = nodes_by_id.get(criterion_id)
                if node is None:
                    raise ValueError(
                        f"ConstraintGroup references unknown criterion id: {criterion_id}"
                    )
                if group.operator == "not" and (
                    node.operator != "not_in" or node.polarity != "negative"
                ):
                    raise ValueError(
                        f"NOT group cannot reference positive criterion '{criterion_id}'"
                    )
                if group.operator in {"all_of", "any_of"} and (
                    node.operator == "not_in" or node.polarity == "negative"
                ):
                    raise ValueError(
                        f"{group.operator} group cannot reference negative "
                        f"criterion '{criterion_id}'"
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
        validate_provider_url(self.url, self.route_strategy, enforce_allowlisted_params=True)

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
