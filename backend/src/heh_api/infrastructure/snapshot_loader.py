"""Startup loader for the immutable in-memory Trendyol mapping snapshot (Zero-DB)."""

from importlib import resources

from fastapi import HTTPException, Request

from heh_api.domain.mapping import MappingSnapshot

_DEFAULT_SNAPSHOT_FILE = "trendyol_showcase.v1.json"


def load_mapping_snapshot(filename: str = _DEFAULT_SNAPSHOT_FILE) -> MappingSnapshot:
    """Load and validate the immutable provider mapping snapshot from package JSON."""
    resource = resources.files("heh_api.mappings").joinpath(filename)
    raw_json = resource.read_text(encoding="utf-8")
    return MappingSnapshot.model_validate_json(raw_json)


def get_mapping_snapshot(request: Request) -> MappingSnapshot:
    """Return the preloaded immutable mapping snapshot stored on app state."""
    snapshot = getattr(request.app.state, "mapping_snapshot", None)
    if not isinstance(snapshot, MappingSnapshot):
        raise HTTPException(
            status_code=503,
            detail="Mapping snapshot is not initialized on application state",
        )
    return snapshot
