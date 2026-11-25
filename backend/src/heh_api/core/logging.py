"""Structured JSON logging with request_id correlation and PII/query redaction."""

import contextvars
import json
import logging
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

_REQUEST_ID_VAR: contextvars.ContextVar[str] = contextvars.ContextVar(
    "heh_request_id", default="bootstrap"
)

_SENSITIVE_KEY_MARKERS = frozenset(
    {
        "text",
        "query",
        "query_text",
        "raw_query",
        "normalized_query",
        "transcript",
        "password",
        "secret",
        "secret_key",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "email",
        "dsn",
        "database_url",
    }
)

_SAFE_EXTRA_KEYS = frozenset(
    {
        "event",
        "method",
        "path",
        "status_code",
        "duration_ms",
        "error_type",
        "mapping_version",
        "nlp_mode",
        "env",
    }
)

_POSTGRES_CREDENTIAL_PATTERN = re.compile(r"(postgresql(?:\+psycopg)?://)([^/\s]+)@([^/\s@]+)")
_BEARER_TOKEN_PATTERN = re.compile(r"(?i)(Bearer\s+)[A-Za-z0-9._+/=-]+")
_EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_HTTP_URL_PATTERN = re.compile(r"https?://[^\s'\"<>]+")
_IPV4_PATTERN = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
_INLINE_SENSITIVE_KV_PATTERN = re.compile(
    r"(?i)([\"']?)\b(password|secret(?:_key)?|token|api_key|query_text|raw_query|q)\1"
    r"\s*([=:])\s*"
    r"(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|[^\s,;}\]]+)"
)


def get_request_id() -> str:
    """Return current request correlation ID from context."""
    return _REQUEST_ID_VAR.get()


def set_request_id(request_id: str) -> contextvars.Token[str]:
    """Bind request correlation ID for the active execution context."""
    return _REQUEST_ID_VAR.set(request_id)


def reset_request_id(token: contextvars.Token[str]) -> None:
    """Restore previous request correlation context cleanly."""
    _REQUEST_ID_VAR.reset(token)


def _mask_http_url(match: re.Match[str]) -> str:
    raw = match.group(0)
    try:
        parsed = urlparse(raw)
        host = parsed.hostname or "redacted"
        scheme = parsed.scheme.lower()
        return f"{scheme}://{host}/[REDACTED_URL]"
    except ValueError:
        return "[REDACTED_URL]"


def redact_sensitive_text(value: str) -> str:
    """Scrub credentials, bearer tokens, URLs, IPs, inline queries, and emails from logs."""
    masked = _POSTGRES_CREDENTIAL_PATTERN.sub(r"\1[REDACTED]@\3", value)
    masked = _HTTP_URL_PATTERN.sub(_mask_http_url, masked)
    masked = _BEARER_TOKEN_PATTERN.sub(r"\1[REDACTED]", masked)
    masked = _INLINE_SENSITIVE_KV_PATTERN.sub(r"\1\2\1\3[REDACTED]", masked)
    masked = _IPV4_PATTERN.sub("[REDACTED_IP]", masked)
    return _EMAIL_PATTERN.sub("[REDACTED_EMAIL]", masked)


def _is_sensitive_key(key: str | None) -> bool:
    if not key:
        return False
    lowered = key.lower()
    return lowered in _SENSITIVE_KEY_MARKERS or any(
        marker in lowered for marker in ("password", "secret", "token", "dsn", "authorization")
    )


def redact_sensitive_value(value: Any, *, key: str | None = None) -> Any:
    """Recursively mask raw query text, credentials, tokens, and emails in log payloads."""
    if _is_sensitive_key(key):
        return "[REDACTED]"
    if isinstance(value, str):
        return redact_sensitive_text(value)
    if isinstance(value, dict):
        return {str(k): redact_sensitive_value(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_sensitive_value(item) for item in value]
    return value


_LOG_FACTORY_INSTALLED = False
_PREVIOUS_RECORD_FACTORY = logging.getLogRecordFactory()


def _install_request_id_record_factory() -> None:
    global _LOG_FACTORY_INSTALLED
    if _LOG_FACTORY_INSTALLED:
        return

    def _record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = _PREVIOUS_RECORD_FACTORY(*args, **kwargs)
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()
        return record

    logging.setLogRecordFactory(_record_factory)
    _LOG_FACTORY_INSTALLED = True


class JsonRedactingFormatter(logging.Formatter):
    """JSON log formatter guaranteeing request_id tagging and PII/query redaction."""

    def format(self, record: logging.LogRecord) -> str:
        """Render a structured JSON log line without secrets or raw query text."""
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", None) or get_request_id(),
            "message": redact_sensitive_text(record.getMessage()),
        }
        for safe_key in _SAFE_EXTRA_KEYS:
            extra_val = getattr(record, safe_key, None)
            if extra_val is not None:
                payload[safe_key] = redact_sensitive_value(extra_val, key=safe_key)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(log_level: str = "INFO") -> None:
    """Attach structured JSON redacting formatter to HEH and Uvicorn logger hierarchies."""
    _install_request_id_record_factory()
    level = getattr(logging, log_level.upper(), logging.INFO)
    formatter = JsonRedactingFormatter()

    for logger_name in ("heh_api", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        else:
            for existing_handler in logger.handlers:
                existing_handler.setFormatter(formatter)
        logger.propagate = logger_name == "heh_api"
