"""Immutable domain representation of the versioned Trendyol showcase mapping snapshot."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from heh_api.domain.verification import (
    ALLOWED_TRENDYOL_QUERY_PARAMS,
    MAX_SHOWCASE_CATEGORIES,
    MIN_SHOWCASE_CATEGORIES,
    TestPlatformKind,
    VerificationStatus,
)


def _validate_mapping_evidence(
    *,
    status: VerificationStatus,
    evidence_ref: str,
    verified_platforms: tuple[TestPlatformKind, ...],
    verified_at: datetime | None,
    subject: str,
) -> None:
    if status == "FILTER_VERIFIED" and (
        "web" not in verified_platforms
        or "mobile" not in verified_platforms
        or verified_at is None
        or not evidence_ref.strip()
    ):
        raise ValueError(
            f"FILTER_VERIFIED {subject} requires both web and mobile proof with timestamp"
        )
    if status == "WEB_VERIFIED_PENDING_MOBILE" and (
        "web" not in verified_platforms or not evidence_ref.strip()
    ):
        raise ValueError(
            f"WEB_VERIFIED_PENDING_MOBILE {subject} requires web proof and evidence_ref"
        )


class FacetMappingEntry(BaseModel):
    """Single immutable provider parameter entry backed by repo evidence."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    canonical_key: str = Field(min_length=1, max_length=64)
    display_label: str = Field(min_length=1, max_length=80)
    aliases: tuple[str, ...] = Field(min_length=1)
    url_param: str = Field(min_length=1, max_length=32)
    url_value: str = Field(min_length=1, max_length=128)
    status: VerificationStatus
    evidence_ref: str = Field(min_length=1, max_length=160)
    verified_platforms: tuple[TestPlatformKind, ...] = ("web",)
    verified_at: datetime | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def _validate_entry(self) -> "FacetMappingEntry":
        if self.url_param not in ALLOWED_TRENDYOL_QUERY_PARAMS:
            raise ValueError(
                f"Facet param '{self.url_param}' is not in ALLOWED_TRENDYOL_QUERY_PARAMS"
            )
        _validate_mapping_evidence(
            status=self.status,
            evidence_ref=self.evidence_ref,
            verified_platforms=self.verified_platforms,
            verified_at=self.verified_at,
            subject=f"facet '{self.canonical_key}'",
        )
        return self


class ShowcaseCategoryMapping(BaseModel):
    """Verified showcase category configuration inside the in-memory boot snapshot."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    category_key: str = Field(min_length=1, max_length=64)
    ontology_id: str = Field(min_length=1, max_length=96)
    display_name: str = Field(min_length=1, max_length=80)
    aliases: tuple[str, ...] = Field(min_length=1)
    wc_id: str = Field(min_length=1, max_length=32)
    wg_id: str | None = Field(default=None, max_length=32)
    gender_label: str | None = Field(default=None, max_length=40)
    negative_supported: Literal[False] = False
    category_status: VerificationStatus
    evidence_ref: str = Field(min_length=1, max_length=160)
    verified_platforms: tuple[TestPlatformKind, ...] = ("web",)
    verified_at: datetime | None = None
    expires_at: datetime | None = None
    brands: tuple[FacetMappingEntry, ...] = ()
    colors: tuple[FacetMappingEntry, ...] = ()
    sizes: tuple[FacetMappingEntry, ...] = ()

    @model_validator(mode="after")
    def _validate_category(self) -> "ShowcaseCategoryMapping":
        _validate_mapping_evidence(
            status=self.category_status,
            evidence_ref=self.evidence_ref,
            verified_platforms=self.verified_platforms,
            verified_at=self.verified_at,
            subject=f"category '{self.category_key}'",
        )
        return self


class MappingSnapshot(BaseModel):
    """Immutable in-memory snapshot loaded once at API startup (Zero-DB hot path)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["trendyol"] = "trendyol"
    version: str = Field(min_length=1, max_length=64)
    long_tail_policy: Literal["prc_plus_q"] = "prc_plus_q"
    categories: tuple[ShowcaseCategoryMapping, ...] = Field(
        min_length=MIN_SHOWCASE_CATEGORIES,
        max_length=MAX_SHOWCASE_CATEGORIES,
    )
    global_colors: tuple[FacetMappingEntry, ...] = ()

    @model_validator(mode="after")
    def _validate_unique_categories(self) -> "MappingSnapshot":
        seen_keys: set[str] = set()
        for category in self.categories:
            if category.category_key in seen_keys:
                raise ValueError(f"Duplicate showcase category key: {category.category_key}")
            seen_keys.add(category.category_key)
        return self

    def find_category_by_key(self, category_key: str | None) -> ShowcaseCategoryMapping | None:
        """Return matching showcase category by canonical key, or None."""
        if category_key is None:
            return None
        for category in self.categories:
            if category.category_key == category_key:
                return category
        return None
