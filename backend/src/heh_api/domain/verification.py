"""Pure domain verification models for Trendyol URL and filter evidence."""

import re
from decimal import Decimal
from typing import Final, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator

ALLOWED_PROVIDER_HOSTS: Final[frozenset[str]] = frozenset({"www.trendyol.com"})

_FACET_PATH_PATTERN: Final[re.Pattern[str]] = re.compile(r"^/[a-z0-9-]+-x-[a-z0-9-]+$")

RouteStrategyKind = Literal["canonical_search_query", "verified_facet_path"]
VerificationStatus = Literal[
    "FILTER_VERIFIED",
    "WEB_VERIFIED_PENDING_MOBILE",
    "QUERY_ONLY",
    "UNSUPPORTED",
    "UNKNOWN",
]


def validate_provider_url(raw_url: str, route_strategy: RouteStrategyKind | None = None) -> str:
    """Validate that a provider URL is HTTPS, allowlisted, credential-free, and route-valid."""
    parsed = urlparse(raw_url)
    if parsed.scheme.lower() != "https":
        raise ValueError(f"Provider URL must use https scheme: {raw_url}")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Provider URL must not contain embedded credentials")

    hostname = (parsed.hostname or "").lower().rstrip(".")
    if hostname not in ALLOWED_PROVIDER_HOSTS:
        raise ValueError(f"Host '{hostname}' is not in ALLOWED_PROVIDER_HOSTS")

    if route_strategy == "canonical_search_query" and parsed.path != "/sr":
        raise ValueError(f"canonical_search_query URL must use /sr path, got '{parsed.path}'")
    if route_strategy == "verified_facet_path" and not _FACET_PATH_PATTERN.match(parsed.path):
        raise ValueError(
            f"verified_facet_path URL must match '/<slug>-x-<codes>', got '{parsed.path}'"
        )

    return raw_url


class PriceBoundEvidence(BaseModel):
    """Typed monetary bounds observed in a Trendyol `prc` parameter."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    raw_param: str = Field(min_length=1)
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None

    @model_validator(mode="after")
    def _validate_bounds(self) -> "PriceBoundEvidence":
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


class UrlObservationRecord(BaseModel):
    """Single manual QA observation entry for a Trendyol search or facet URL."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    category_key: str = Field(min_length=1)
    route_strategy: RouteStrategyKind
    tested_url: str
    resolved_url: str | None = None
    price_bound: PriceBoundEvidence | None = None
    web_filter_active: bool | None = None
    mobile_app_filter_active: bool | None = None
    overall_status: VerificationStatus
    tested_at: str | None = None
    evidence_ref: str | None = None
    notes: str = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_record(self) -> "UrlObservationRecord":
        validate_provider_url(self.tested_url, self.route_strategy)
        if self.resolved_url is not None:
            validate_provider_url(self.resolved_url)

        has_evidence = bool(self.evidence_ref and self.evidence_ref.strip())
        has_timestamp = bool(self.tested_at and self.tested_at.strip())

        if self.overall_status == "FILTER_VERIFIED":
            if self.web_filter_active is not True or self.mobile_app_filter_active is not True:
                raise ValueError(
                    "FILTER_VERIFIED requires both web_filter_active=True and "
                    "mobile_app_filter_active=True"
                )
            if not has_timestamp or not has_evidence:
                raise ValueError("FILTER_VERIFIED requires tested_at and evidence_ref")

        if self.overall_status == "WEB_VERIFIED_PENDING_MOBILE":
            if self.web_filter_active is not True or self.mobile_app_filter_active is not None:
                raise ValueError(
                    "WEB_VERIFIED_PENDING_MOBILE requires web_filter_active=True and "
                    "mobile_app_filter_active=None"
                )
            if not has_timestamp or not has_evidence:
                raise ValueError("WEB_VERIFIED_PENDING_MOBILE requires tested_at and evidence_ref")

        if self.web_filter_active is False and self.overall_status in {
            "FILTER_VERIFIED",
            "WEB_VERIFIED_PENDING_MOBILE",
        }:
            raise ValueError("Failed web verification cannot be promoted to a verified status")

        return self


class EvidenceMatrixDocument(BaseModel):
    """Versioned evidence matrix file validated in CI."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["1.0"]
    day_ref: str = Field(min_length=1)
    generated_at: str = Field(min_length=1)
    records: list[UrlObservationRecord] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_unique_ids(self) -> "EvidenceMatrixDocument":
        seen: set[str] = set()
        for record in self.records:
            if record.id in seen:
                raise ValueError(f"Duplicate observation id: {record.id}")
            seen.add(record.id)
        return self
