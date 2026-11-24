"""Unified exception handlers returning scrubbed `ApiErrorResponse` envelopes."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from heh_api.core.logging import (
    redact_sensitive_text,
    reset_request_id,
    set_request_id,
)
from heh_api.core.middleware import resolve_safe_request_id
from heh_api.schemas.errors import ApiErrorBody, ApiErrorDetail, ApiErrorResponse

_LOGGER = logging.getLogger(__name__)


def _extract_request_id(request: Request) -> str:
    state_request_id = getattr(getattr(request, "state", None), "request_id", None)
    if isinstance(state_request_id, str) and state_request_id:
        return state_request_id
    raw_header = request.headers.get("x-request-id")
    return resolve_safe_request_id(
        raw_header.encode("ascii", errors="ignore") if raw_header else None
    )


def _error_json_response(
    *,
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: tuple[ApiErrorDetail, ...] = (),
) -> JSONResponse:
    request_id = _extract_request_id(request)
    body = ApiErrorResponse(
        error=ApiErrorBody(
            code=code,
            message=message,
            request_id=request_id,
            details=details,
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json"),
        headers={"X-Request-ID": request_id},
    )


def register_exception_handlers(application: FastAPI) -> None:
    """Attach uniform 4xx/500 exception mappers without reflecting raw query strings."""

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        safe_details: list[ApiErrorDetail] = []
        for err in exc.errors():
            loc_parts = [str(part) for part in err.get("loc", ()) if str(part) != "body"]
            field_path = ".".join(loc_parts) if loc_parts else "body"
            safe_details.append(
                ApiErrorDetail(
                    field=field_path,
                    reason=redact_sensitive_text(str(err.get("msg", "Invalid field"))),
                    code=str(err.get("type", "validation_error")),
                )
            )
        return _error_json_response(
            request=request,
            status_code=422,
            code="VALIDATION_ERROR",
            message="İstek alanlarını kontrol et.",
            details=tuple(safe_details),
        )

    @application.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        return _error_json_response(
            request=request,
            status_code=exc.status_code,
            code=f"HTTP_{exc.status_code}",
            message=redact_sensitive_text(str(exc.detail)),
        )

    @application.exception_handler(Exception)
    async def handle_unexpected_exception(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        request_id = _extract_request_id(request)
        token = set_request_id(request_id)
        try:
            _LOGGER.error(
                "unhandled_exception",
                extra={"event": "unhandled_exception", "error_type": type(exc).__name__},
            )
        finally:
            reset_request_id(token)
        return _error_json_response(
            request=request,
            status_code=500,
            code="INTERNAL_ERROR",
            message="Beklenmeyen bir hata oluştu.",
        )
