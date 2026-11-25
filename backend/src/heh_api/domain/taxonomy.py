"""Provider-independent canonical Turkish commerce taxonomy ontology."""

from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field

SlotFieldName = Literal[
    "brand",
    "color",
    "size",
    "gender",
    "price",
    "material",
    "attribute",
    "model",
]

IntentType = Literal["product_search", "refine_search", "unsupported", "ambiguous"]
OntologyDomainKey = Literal["apparel", "footwear", "electronics", "home", "cosmetics", "other"]


class OntologyCategoryNode(BaseModel):
    """Provider-agnostic product taxonomy node (`taxonomy_id` carries no store IDs)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    ontology_id: str = Field(min_length=1, max_length=96)
    canonical_key: str = Field(min_length=1, max_length=64)
    domain: OntologyDomainKey
    parent_id: str | None = None
    display_name_tr: str = Field(min_length=1, max_length=80)
    size_system: Literal["none", "clothing", "footwear"] = "none"
    applicable_slots: tuple[SlotFieldName, ...] = Field(min_length=1)


SHOWCASE_ONTOLOGY_V1: Final[tuple[OntologyCategoryNode, ...]] = (
    OntologyCategoryNode(
        ontology_id="apparel.outerwear.mens_coat",
        canonical_key="erkek_mont",
        domain="apparel",
        parent_id="apparel.outerwear",
        display_name_tr="Erkek Mont",
        size_system="clothing",
        applicable_slots=("brand", "color", "size", "gender", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.audio.bluetooth_headphones",
        canonical_key="bluetooth_kulaklik",
        domain="electronics",
        parent_id="electronics.audio",
        display_name_tr="Bluetooth Kulaklık",
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="footwear.athletic.sneakers",
        canonical_key="spor_ayakkabi",
        domain="footwear",
        parent_id="footwear.athletic",
        display_name_tr="Spor Ayakkabı",
        size_system="footwear",
        applicable_slots=("brand", "color", "size", "gender", "price", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.computing.laptop",
        canonical_key="laptop",
        domain="electronics",
        parent_id="electronics.computing",
        display_name_tr="Laptop",
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.mobile.smartphone",
        canonical_key="cep_telefonu",
        domain="electronics",
        parent_id="electronics.mobile",
        display_name_tr="Cep Telefonu",
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
)
