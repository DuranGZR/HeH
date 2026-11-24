"""Pytest configuration and offline network isolation guards."""

import socket
from collections.abc import Iterator
from typing import Any

import pytest

_ALLOWED_LOCAL_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


def _extract_host(address: Any) -> str | None:
    if isinstance(address, tuple) and len(address) >= 1 and isinstance(address[0], str):
        return address[0]
    return None


@pytest.fixture(autouse=True)
def isolate_external_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Block outbound network sockets in unit/offline tests."""
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def guarded_connect(sock: socket.socket, address: Any) -> Any:
        host = _extract_host(address)
        if host is not None and host not in _ALLOWED_LOCAL_HOSTS:
            raise RuntimeError(f"Outbound network access is forbidden in tests: {host}")
        return original_connect(sock, address)

    def guarded_connect_ex(sock: socket.socket, address: Any) -> int:
        host = _extract_host(address)
        if host is not None and host not in _ALLOWED_LOCAL_HOSTS:
            raise RuntimeError(f"Outbound network access is forbidden in tests: {host}")
        return original_connect_ex(sock, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)
    yield
