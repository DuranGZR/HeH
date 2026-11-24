"""Uniform HTTP error envelope schemas for the HEH API."""

from pydantic import BaseModel, ConfigDict, Field


class ApiErrorDetail(BaseModel):
    """Single structured validation or domain error detail."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    field: str | None = None
    reason: str = Field(min_length=1, max_length=240)
    code: str | None = None


class ApiErrorBody(BaseModel):
    """Consistent error body carrying traceability request_id."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=320)
    request_id: str = Field(min_length=1, max_length=64)
    details: tuple[ApiErrorDetail, ...] = ()


class ApiErrorResponse(BaseModel):
    """Top-level error envelope returned for 4xx/5xx responses."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    error: ApiErrorBody
