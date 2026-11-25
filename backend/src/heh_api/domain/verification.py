"""Pure provider verification models, host/param allowlists, and expiry checks."""

import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final, Literal
from urllib.parse import parse_qsl, urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator

ALLOWED_PROVIDER_HOSTS: Final[frozenset[str]] = frozenset({"www.trendyol.com"})
ALLOWED_TRENDYOL_QUERY_PARAMS: Final[frozenset[str]] = frozenset(
    {"q", "wc", "wg", "wb", "wcl", "vr", "prc", "pi", "sst"}
)
ALLOWED_FACET_SEGMENT_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^[bgcr](?:\d+)(?:-[bgcr]\d+)*$"
)
MAX_SHOWCASE_CATEGORIES: Final[int] = 8
MIN_SHOWCASE_CATEGORIES: Final[int] = 5

_FACET_PATH_PATTERN: Final[re.Pattern[str]] = re.compile(r"^/([a-z0-9-]+)-x-([a-z0-9-]+)$")

RouteStrategyKind = Literal["canonical_search_query", "verified_facet_path"]
FacetFieldKind = Literal["brand", "color", "size", "category", "gender", "attribute"]
FacetOperatorKind = Literal["eq", "in", "not_in"]
VerificationStatus = Literal[
    "FILTER_VERIFIED",
    "WEB_VERIFIED_PENDING_MOBILE",
    "QUERY_ONLY",
    "UNSUPPORTED",
    "UNKNOWN",
]
TestPlatformKind = Literal["web", "mobile"]


class UnsafeUrlConstructionError(ValueError):
    """Raised when URL assembly violates host, scheme, param, or -x- segment allowlists."""


class MappingVersionConflictError(ValueError):
    """Raised when client edit request targets an outdated/mismatched snapshot version."""


def validate_provider_url(
    raw_url: str,
    route_strategy: RouteStrategyKind | None = None,
    *,
    enforce_allowlisted_params: bool = False,
) -> str:
    """Validate that a provider URL is HTTPS, allowlisted, credential-free, and route-valid."""
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw_url) or " " in raw_url:
        raise UnsafeUrlConstructionError(
            "Provider URL contains forbidden control characters or unescaped spaces"
        )

    parsed = urlparse(raw_url)
    if parsed.scheme.lower() != "https":
        raise UnsafeUrlConstructionError(f"Provider URL must use https scheme: {raw_url}")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeUrlConstructionError("Provider URL must not contain embedded credentials")
    if parsed.port is not None:
        raise UnsafeUrlConstructionError("Provider URL must not specify custom ports")

    hostname = (parsed.hostname or "").lower().rstrip(".")
    if hostname not in ALLOWED_PROVIDER_HOSTS:
        raise UnsafeUrlConstructionError(f"Host '{hostname}' is not in ALLOWED_PROVIDER_HOSTS")

    if parsed.fragment:
        raise UnsafeUrlConstructionError("Provider URL must not contain fragments")

    if route_strategy == "canonical_search_query" and parsed.path != "/sr":
        raise UnsafeUrlConstructionError(
            f"canonical_search_query URL must use /sr path, got '{parsed.path}'"
        )
    if route_strategy == "verified_facet_path":
        facet_match = _FACET_PATH_PATTERN.match(parsed.path)
        if not facet_match:
            raise UnsafeUrlConstructionError(
                f"verified_facet_path URL must match '/<slug>-x-<codes>', got '{parsed.path}'"
            )
        if not ALLOWED_FACET_SEGMENT_PATTERN.match(facet_match.group(2)):
            raise UnsafeUrlConstructionError(
                f"verified_facet_path contains unverified -x- segment '{facet_match.group(2)}'"
            )

    if enforce_allowlisted_params and parsed.query:
        for param_key, _ in parse_qsl(parsed.query, keep_blank_values=True):
            if param_key not in ALLOWED_TRENDYOL_QUERY_PARAMS:
                raise UnsafeUrlConstructionError(
                    f"Query parameter '{param_key}' is not in ALLOWED_TRENDYOL_QUERY_PARAMS"
                )

    return raw_url


def is_evidence_expired(
    expires_at: datetime | None,
    *,
    now: datetime | None = None,
) -> bool:
    """Return True when an optional mapping expiry timestamp has elapsed."""
    if expires_at is None:
        return False
    reference = now or datetime.now(UTC)
    target = expires_at if expires_at.tzinfo is not None else expires_at.replace(tzinfo=UTC)
    ref_utc = reference if reference.tzinfo is not None else reference.replace(tzinfo=UTC)
    return target <= ref_utc


def _ensure_non_empty_unique_tuple(values: tuple[str, ...], field_name: str) -> tuple[str, ...]:
    """Ensure a string tuple contains non-empty unique entries."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in values:
        stripped = item.strip()
        if not stripped:
            raise ValueError(f"{field_name} cannot contain blank entries")
        if stripped in seen:
            raise ValueError(f"{field_name} contains duplicate entry: {stripped}")
        seen.add(stripped)
        cleaned.append(stripped)
    return tuple(cleaned)


def _validate_promotion_gate(
    *,
    status: VerificationStatus,
    web_ok: bool | None,
    mobile_ok: bool | None,
    has_proof: bool,
    subject: str,
    proof_desc: str,
) -> None:
    """Enforce honest web-before-mobile status promotion for URL and facet records."""
    if web_ok is False and status in {"FILTER_VERIFIED", "WEB_VERIFIED_PENDING_MOBILE"}:
        raise ValueError(f"Failed {subject} cannot be promoted to a verified status")
    if status == "FILTER_VERIFIED":
        if web_ok is not True or mobile_ok is not True:
            raise ValueError(f"FILTER_VERIFIED {subject} requires both web and mobile confirmation")
        if not has_proof:
            raise ValueError(f"FILTER_VERIFIED {subject} requires {proof_desc}")
    if status == "WEB_VERIFIED_PENDING_MOBILE":
        if web_ok is not True or mobile_ok is not None:
            raise ValueError(
                f"WEB_VERIFIED_PENDING_MOBILE {subject} requires web confirmation and "
                "mobile confirmation pending (None)"
            )
        if not has_proof:
            raise ValueError(f"WEB_VERIFIED_PENDING_MOBILE {subject} requires {proof_desc}")


class ShowcaseScopePolicy(BaseModel):
    """Explicit provider scope contract capping showcase size and long-tail behavior."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["trendyol"] = "trendyol"
    min_showcase_categories: int = MIN_SHOWCASE_CATEGORIES
    max_showcase_categories: int = MAX_SHOWCASE_CATEGORIES
    long_tail_fallback: Literal["prc_plus_q"] = "prc_plus_q"
    negative_exclusion_supported: Literal[False] = False
    require_dual_platform_for_verified: Literal[True] = True

    @model_validator(mode="after")
    def _validate_policy_bounds(self) -> "ShowcaseScopePolicy":
        if self.min_showcase_categories > self.max_showcase_categories:
            raise ValueError("min_showcase_categories cannot exceed max_showcase_categories")
        return self


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


class FacetFilterEvidence(BaseModel):
    """Verification evidence for a single non-price facet filter (brand, color, size, etc.)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    field: FacetFieldKind
    operator: FacetOperatorKind
    canonical_values: tuple[str, ...] = Field(min_length=1)
    url_param: str | None = None
    url_values: tuple[str, ...] = ()
    web_selected: bool | None = None
    mobile_app_selected: bool | None = None
    status: VerificationStatus

    @model_validator(mode="after")
    def _validate_facet(self) -> "FacetFilterEvidence":
        cleaned_values = _ensure_non_empty_unique_tuple(self.canonical_values, "canonical_values")
        if self.operator == "eq" and len(cleaned_values) != 1:
            raise ValueError("operator='eq' requires exactly one canonical value")

        if self.url_values:
            _ensure_non_empty_unique_tuple(self.url_values, "url_values")

        has_url_param = bool(self.url_param and self.url_param.strip())
        has_url_values = len(self.url_values) > 0
        if self.status == "UNSUPPORTED" and (self.web_selected is True or has_url_param):
            raise ValueError("UNSUPPORTED facet cannot claim active web_selected or url_param")
        _validate_promotion_gate(
            status=self.status,
            web_ok=self.web_selected,
            mobile_ok=self.mobile_app_selected,
            has_proof=has_url_param and has_url_values,
            subject="facet",
            proof_desc="url_param and url_values",
        )
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
    facets: tuple[FacetFilterEvidence, ...] = ()
    web_filter_active: bool | None = None
    mobile_app_filter_active: bool | None = None
    overall_status: VerificationStatus
    tested_at: str | None = None
    evidence_ref: str | None = None
    notes: str = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_record(self) -> "UrlObservationRecord":
        validate_provider_url(self.tested_url, self.route_strategy, enforce_allowlisted_params=True)
        if self.resolved_url is not None:
            validate_provider_url(self.resolved_url, enforce_allowlisted_params=True)
        if self.tested_at is not None:
            datetime.fromisoformat(self.tested_at)

        has_evidence = bool(self.evidence_ref and self.evidence_ref.strip())
        has_timestamp = bool(self.tested_at and self.tested_at.strip())
        _validate_promotion_gate(
            status=self.overall_status,
            web_ok=self.web_filter_active,
            mobile_ok=self.mobile_app_filter_active,
            has_proof=has_timestamp and has_evidence,
            subject="record",
            proof_desc="tested_at and evidence_ref",
        )

        if self.overall_status == "FILTER_VERIFIED" and any(
            facet.web_selected is not True
            or facet.mobile_app_selected is not True
            or facet.status != "FILTER_VERIFIED"
            for facet in self.facets
        ):
            raise ValueError(
                "FILTER_VERIFIED record requires all listed facets to be mobile+web verified"
            )

        if self.overall_status == "WEB_VERIFIED_PENDING_MOBILE" and any(
            facet.web_selected is not True
            or facet.status not in {"FILTER_VERIFIED", "WEB_VERIFIED_PENDING_MOBILE"}
            for facet in self.facets
        ):
            raise ValueError(
                "WEB_VERIFIED_PENDING_MOBILE record cannot contain unselected or unsupported facets"
            )

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
