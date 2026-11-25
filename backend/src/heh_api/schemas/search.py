"""HTTP API request and response transport schemas for 1-RTT search flows."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from heh_api.domain.search_intent import (
    MAX_QUERY_LENGTH,
    ConfidenceState,
    InputSourceKind,
    LinkResolution,
    SearchIntentV2,
    normalize_display_query,
)
from heh_api.domain.verification import VerificationStatus


class SearchParseRequest(BaseModel):
    """Guest-first 1-RTT parse + initial link resolution request."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    locale: Literal["tr-TR"] = "tr-TR"
    input_source: InputSourceKind = "text"
    client_request_id: str | None = Field(default=None, max_length=64)

    @field_validator("text", mode="before")
    @classmethod
    def _strip_and_reject_blank_text(cls, raw_value: object) -> str:
        if not isinstance(raw_value, str):
            raise ValueError("text must be a string")
        cleaned = normalize_display_query(raw_value)
        if not cleaned:
            raise ValueError("text must not be empty or whitespace")
        if len(cleaned) > MAX_QUERY_LENGTH:
            raise ValueError(f"text cannot exceed {MAX_QUERY_LENGTH} characters")
        return cleaned


class SearchParseResponse(BaseModel):
    """1-RTT parse payload bundling canonical AST and initial LinkResolution preview."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    request_id: str = Field(min_length=1, max_length=64)
    parser_version: str = Field(min_length=1, max_length=32)
    nlp_mode: Literal["rules", "shadow", "hybrid"]
    intent: SearchIntentV2
    confidence_state: ConfidenceState
    warnings: tuple[str, ...] = ()
    resolution: LinkResolution


class SearchResolveRequest(BaseModel):
    """Edit-only link resolution request (never re-runs NLP or trusts raw filter IDs)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    intent: SearchIntentV2
    mapping_version: str | None = Field(default=None, max_length=64)
    client_request_id: str | None = Field(default=None, max_length=64)

    @field_validator("intent", mode="before")
    @classmethod
    def _prune_deleted_criteria_from_logic_groups(cls, raw_value: object) -> object:
        if not isinstance(raw_value, dict):
            return raw_value
        raw_criteria = raw_value.get("criteria")
        raw_groups = raw_value.get("logic_groups")
        if not isinstance(raw_criteria, list | tuple) or not isinstance(raw_groups, list | tuple):
            return raw_value

        active_ids = {
            crit["id"]
            for crit in raw_criteria
            if isinstance(crit, dict) and isinstance(crit.get("id"), str)
        }
        pruned_groups: list[object] = []
        for group in raw_groups:
            if not isinstance(group, dict):
                pruned_groups.append(group)
                continue
            raw_ids = group.get("criterion_ids")
            if not isinstance(raw_ids, list | tuple):
                pruned_groups.append(group)
                continue
            kept_ids = [cid for cid in raw_ids if cid in active_ids]
            if kept_ids:
                pruned_groups.append({**group, "criterion_ids": kept_ids})
        return {**raw_value, "logic_groups": pruned_groups}


class SearchResolveResponse(BaseModel):
    """Recomputed Trendyol LinkResolution after user chip edits or deletions."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    request_id: str = Field(min_length=1, max_length=64)
    intent: SearchIntentV2
    resolution: LinkResolution


class CategoryCapabilitySummary(BaseModel):
    """Public capability metadata for a showcase category from the boot snapshot."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    category_key: str
    display_name: str
    status: VerificationStatus
    supports_brand_or: bool
    supports_color: bool
    supports_size: bool
    negative_supported: Literal[False] = False


class ProviderCapabilitiesResponse(BaseModel):
    """Versioned provider capability summary served from memory without DB access."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["trendyol"] = "trendyol"
    mapping_version: str
    long_tail_policy: Literal["prc_plus_q"] = "prc_plus_q"
    showcase_categories: tuple[CategoryCapabilitySummary, ...]
