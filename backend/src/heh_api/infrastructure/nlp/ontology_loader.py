"""Loader for the frozen D32 provider-independent Turkish commerce ontology catalog."""

from functools import lru_cache
from importlib import resources

import yaml

from heh_api.domain.taxonomy import OntologyCatalogV1


@lru_cache(maxsize=1)
def load_ontology_catalog() -> OntologyCatalogV1:
    """Load and Pydantic-validate `ontology.v1.yaml` once from package data."""
    raw_yaml = (
        resources.files("heh_api.data.ontology")
        .joinpath("ontology.v1.yaml")
        .read_text(encoding="utf-8")
    )
    loaded = yaml.safe_load(raw_yaml)
    return OntologyCatalogV1.model_validate(loaded)
