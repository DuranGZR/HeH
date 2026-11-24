"""Pure ASGI middleware binding request_id headers and redacted access logging."""

import logging
import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from heh_api.core.logging import reset_request_id, set_request_id

_LOGGER = logging.getLogger(__name__)
_SAFE_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def resolve_safe_request_id(raw_header: bytes | None) -> str:
    """Accept clean caller request IDs or mint a fresh UUID hex string."""
    if raw_header is not None:
        decoded = raw_header.decode("ascii", errors="ignore").strip()
        if _SAFE_REQUEST_ID_PATTERN.match(decoded):
            return decoded
    return uuid.uuid4().hex


class RequestContextMiddleware:
    """Correlate HTTP requests with `X-Request-ID` across 200, 422, and 500 responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Bind `request_id` for HTTP scopes and emit path-only redacted timing logs."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        header_value: bytes | None = None
        for key, value in scope.get("headers", []):
            if key.lower() == b"x-request-id":
                header_value = value
                break

        request_id = resolve_safe_request_id(header_value)
        state = scope.setdefault("state", {})
        if isinstance(state, dict):
            state["request_id"] = request_id
        token = set_request_id(request_id)
        started_at = time.perf_counter()
        status_code = 500
        method = str(scope.get("method", "GET"))
        path = str(scope.get("path", "/"))

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                raw_headers: list[tuple[bytes, bytes]] = list(message.get("headers", []))
                filtered = [(k, v) for k, v in raw_headers if k.lower() != b"x-request-id"]
                filtered.append((b"x-request-id", request_id.encode("ascii")))
                message["headers"] = filtered
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            _LOGGER.info(
                "http_request_completed",
                extra={
                    "event": "http_request_completed",
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                },
            )
            reset_request_id(token)
