"""Immutable domain representation of the versioned Trendyol showcase mapping snapshot."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from heh_api.domain.verification import VerificationStatus


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


class ShowcaseCategoryMapping(BaseModel):
    """Verified showcase category configuration inside the in-memory boot snapshot."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    category_key: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=80)
    aliases: tuple[str, ...] = Field(min_length=1)
    wc_id: str = Field(min_length=1, max_length=32)
    wg_id: str | None = Field(default=None, max_length=32)
    gender_label: str | None = Field(default=None, max_length=40)
    negative_supported: Literal[False] = False
    category_status: VerificationStatus
    evidence_ref: str = Field(min_length=1, max_length=160)
    brands: tuple[FacetMappingEntry, ...] = ()
    colors: tuple[FacetMappingEntry, ...] = ()
    sizes: tuple[FacetMappingEntry, ...] = ()


class MappingSnapshot(BaseModel):
    """Immutable in-memory snapshot loaded once at API startup (Zero-DB hot path)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["trendyol"] = "trendyol"
    version: str = Field(min_length=1, max_length=64)
    long_tail_policy: Literal["prc_plus_q"] = "prc_plus_q"
    categories: tuple[ShowcaseCategoryMapping, ...] = Field(min_length=1)
    global_colors: tuple[FacetMappingEntry, ...] = ()

    def find_category_by_key(self, category_key: str | None) -> ShowcaseCategoryMapping | None:
        """Return matching showcase category by canonical key, or None."""
        if category_key is None:
            return None
        for category in self.categories:
            if category.category_key == category_key:
                return category
        return None
