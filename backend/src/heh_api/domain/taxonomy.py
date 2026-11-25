"""Provider-independent canonical Turkish commerce taxonomy ontology (D14 & D32)."""

from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ONTOLOGY_SCHEMA_VERSION: Final[str] = "1.0.0"

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
SizeSystemKey = Literal["none", "clothing", "footwear", "eu_kids_age", "volume_capacity"]
UnitCategory = Literal[
    "currency",
    "storage",
    "display",
    "battery",
    "frequency",
    "volume",
    "weight",
    "length",
    "power",
    "pressure",
    "acoustic",
    "resolution",
]
PolarityKind = Literal["positive", "negative"]
ModalityKind = Literal["must", "should", "must_not"]


class OntologyCategoryNode(BaseModel):
    """Provider-agnostic product taxonomy node (`ontology_id` carries no store IDs)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    ontology_id: str = Field(min_length=1, max_length=96)
    canonical_key: str = Field(min_length=1, max_length=64)
    domain: OntologyDomainKey
    parent_id: str | None = None
    display_name_tr: str = Field(min_length=1, max_length=80)
    showcase: bool = True
    size_system: SizeSystemKey = "none"
    applicable_slots: tuple[SlotFieldName, ...] = Field(min_length=1)


class SizeSystemSpec(BaseModel):
    """Canonical size taxonomy independent of store-specific facet IDs."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    system_key: SizeSystemKey
    display_name_tr: str = Field(min_length=1, max_length=80)
    canonical_values: tuple[str, ...] = ()
    description: str = Field(min_length=1, max_length=200)


class UnitSpec(BaseModel):
    """Canonical commerce measurement or currency unit specification."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    unit_key: str = Field(min_length=1, max_length=32)
    category: UnitCategory
    display_symbol: str = Field(min_length=1, max_length=32)
    aliases: tuple[str, ...] = Field(min_length=1)
    is_monetary: bool = False


class BooleanOperatorSpec(BaseModel):
    """Canonical boolean/polarity metadata recorded in the frozen D32 ontology."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    operator: Literal["all_of", "any_of", "not"]
    default_polarity: PolarityKind
    default_modality: ModalityKind
    description: str = Field(min_length=1, max_length=200)


class OntologyCatalogV1(BaseModel):
    """Frozen versioned taxonomy catalog combining showcase, long-tail, sizes, and units."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: str = Field(min_length=1, max_length=32)
    showcase_categories: tuple[OntologyCategoryNode, ...] = Field(min_length=5)
    long_tail_categories: tuple[OntologyCategoryNode, ...] = Field(min_length=10)
    size_systems: tuple[SizeSystemSpec, ...] = Field(min_length=4)
    units: tuple[UnitSpec, ...] = Field(min_length=10)
    boolean_operators: tuple[BooleanOperatorSpec, ...] = Field(min_length=3)
    provenance_kinds: tuple[Literal["rule", "ml_candidate", "user_edit"], ...] = Field(min_length=3)

    @model_validator(mode="after")
    def _validate_catalog_integrity(self) -> "OntologyCatalogV1":
        seen_ontology_ids: set[str] = set()
        seen_keys: set[str] = set()
        for node in (*self.showcase_categories, *self.long_tail_categories):
            if node.ontology_id in seen_ontology_ids:
                raise ValueError(f"Duplicate ontology_id in catalog: {node.ontology_id}")
            if node.canonical_key in seen_keys:
                raise ValueError(f"Duplicate canonical_key in catalog: {node.canonical_key}")
            seen_ontology_ids.add(node.ontology_id)
            seen_keys.add(node.canonical_key)

        if any(not cat.showcase for cat in self.showcase_categories):
            raise ValueError("showcase_categories entries must set showcase=True")
        if any(cat.showcase for cat in self.long_tail_categories):
            raise ValueError("long_tail_categories entries must set showcase=False")

        seen_systems = {spec.system_key for spec in self.size_systems}
        for node in (*self.showcase_categories, *self.long_tail_categories):
            if node.size_system not in seen_systems:
                raise ValueError(
                    f"Category '{node.canonical_key}' references unknown size_system "
                    f"'{node.size_system}'"
                )

        seen_units: set[str] = set()
        for unit in self.units:
            if unit.unit_key in seen_units:
                raise ValueError(f"Duplicate unit_key in catalog: {unit.unit_key}")
            seen_units.add(unit.unit_key)
        return self


SHOWCASE_ONTOLOGY_V1: Final[tuple[OntologyCategoryNode, ...]] = (
    OntologyCategoryNode(
        ontology_id="apparel.outerwear.mens_coat",
        canonical_key="erkek_mont",
        domain="apparel",
        parent_id="apparel.outerwear",
        display_name_tr="Erkek Mont",
        showcase=True,
        size_system="clothing",
        applicable_slots=("brand", "color", "size", "gender", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.audio.bluetooth_headphones",
        canonical_key="bluetooth_kulaklik",
        domain="electronics",
        parent_id="electronics.audio",
        display_name_tr="Bluetooth Kulaklık",
        showcase=True,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="footwear.athletic.sneakers",
        canonical_key="spor_ayakkabi",
        domain="footwear",
        parent_id="footwear.athletic",
        display_name_tr="Spor Ayakkabı",
        showcase=True,
        size_system="footwear",
        applicable_slots=("brand", "color", "size", "gender", "price", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.computing.laptop",
        canonical_key="laptop",
        domain="electronics",
        parent_id="electronics.computing",
        display_name_tr="Laptop",
        showcase=True,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.mobile.smartphone",
        canonical_key="cep_telefonu",
        domain="electronics",
        parent_id="electronics.mobile",
        display_name_tr="Cep Telefonu",
        showcase=True,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
)

LONG_TAIL_ONTOLOGY_V1: Final[tuple[OntologyCategoryNode, ...]] = (
    OntologyCategoryNode(
        ontology_id="home.furniture.gaming_chair",
        canonical_key="oyuncu_koltugu",
        domain="home",
        parent_id="home.furniture",
        display_name_tr="Oyuncu Koltuğu",
        showcase=False,
        size_system="none",
        applicable_slots=("brand", "color", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="home.kitchen.thermos",
        canonical_key="termos",
        domain="home",
        parent_id="home.kitchen",
        display_name_tr="Termos",
        showcase=False,
        size_system="volume_capacity",
        applicable_slots=("brand", "color", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="home.kitchen.coffee_maker",
        canonical_key="kahve_makinesi",
        domain="home",
        parent_id="home.kitchen",
        display_name_tr="Kahve Makinesi",
        showcase=False,
        size_system="volume_capacity",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.wearables.smartwatch",
        canonical_key="akilli_saat",
        domain="electronics",
        parent_id="electronics.wearables",
        display_name_tr="Akıllı Saat",
        showcase=False,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="apparel.outerwear.womens_coat",
        canonical_key="kadin_mont",
        domain="apparel",
        parent_id="apparel.outerwear",
        display_name_tr="Kadın Mont",
        showcase=False,
        size_system="clothing",
        applicable_slots=("brand", "color", "size", "gender", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="apparel.outerwear.kids_coat",
        canonical_key="cocuk_mont",
        domain="apparel",
        parent_id="apparel.outerwear",
        display_name_tr="Çocuk Mont",
        showcase=False,
        size_system="eu_kids_age",
        applicable_slots=("brand", "color", "size", "gender", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="apparel.activewear.tshirt",
        canonical_key="kosu_tisortu",
        domain="apparel",
        parent_id="apparel.activewear",
        display_name_tr="Koşu Tişörtü",
        showcase=False,
        size_system="clothing",
        applicable_slots=("brand", "color", "size", "gender", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="apparel.bags.backpack",
        canonical_key="sirt_cantasi",
        domain="apparel",
        parent_id="apparel.bags",
        display_name_tr="Sırt Çantası",
        showcase=False,
        size_system="volume_capacity",
        applicable_slots=("brand", "color", "price", "gender", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="footwear.outdoor.boots",
        canonical_key="outdoor_bot",
        domain="footwear",
        parent_id="footwear.outdoor",
        display_name_tr="Outdoor Bot",
        showcase=False,
        size_system="footwear",
        applicable_slots=("brand", "color", "size", "gender", "price", "material", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.computing.tablet",
        canonical_key="tablet",
        domain="electronics",
        parent_id="electronics.computing",
        display_name_tr="Tablet",
        showcase=False,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.computing.monitor",
        canonical_key="monitor",
        domain="electronics",
        parent_id="electronics.computing",
        display_name_tr="Monitör",
        showcase=False,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="electronics.peripherals.mechanical_keyboard",
        canonical_key="mekanik_klavye",
        domain="electronics",
        parent_id="electronics.peripherals",
        display_name_tr="Mekanik Klavye",
        showcase=False,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="home.appliances.robot_vacuum",
        canonical_key="robot_supurge",
        domain="home",
        parent_id="home.appliances",
        display_name_tr="Robot Süpürge",
        showcase=False,
        size_system="none",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="home.kitchen.airfryer",
        canonical_key="airfryer",
        domain="home",
        parent_id="home.kitchen",
        display_name_tr="Airfryer",
        showcase=False,
        size_system="volume_capacity",
        applicable_slots=("brand", "color", "price", "model", "attribute"),
    ),
    OntologyCategoryNode(
        ontology_id="cosmetics.skincare.moisturizer",
        canonical_key="cilt_bakim_kremi",
        domain="cosmetics",
        parent_id="cosmetics.skincare",
        display_name_tr="Cilt Bakım Kremi",
        showcase=False,
        size_system="volume_capacity",
        applicable_slots=("brand", "price", "attribute"),
    ),
)

SIZE_SYSTEM_SPECS_V1: Final[tuple[SizeSystemSpec, ...]] = (
    SizeSystemSpec(
        system_key="none",
        display_name_tr="Bedensiz / Standart",
        canonical_values=(),
        description="Elektronik ve standart ebatlı ürün kategorileri için beden yok.",
    ),
    SizeSystemSpec(
        system_key="clothing",
        display_name_tr="Harfli Giyim Bedeni",
        canonical_values=("xs", "s", "m", "l", "xl", "xxl"),
        description="Standart yetişkin giyim harf bedenleri.",
    ),
    SizeSystemSpec(
        system_key="footwear",
        display_name_tr="EU Ayakkabı Numarası",
        canonical_values=("36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"),
        description="Avrupa ayakkabı numara sistemi.",
    ),
    SizeSystemSpec(
        system_key="eu_kids_age",
        display_name_tr="Çocuk Yaş Grubu",
        canonical_values=("3-4 yas", "5-6 yas", "7-8 yas", "9-10 yas", "11-12 yas", "13-14 yas"),
        description="Çocuk dış giyim yaş aralıkları.",
    ),
    SizeSystemSpec(
        system_key="volume_capacity",
        display_name_tr="Hacim / Kapasite",
        canonical_values=("50 ml", "100 ml", "500 ml", "1 litre", "1.5 litre", "5 litre"),
        description="Termos, kozmetik, çanta veya mutfak aleti hacim basamakları.",
    ),
)

UNIT_SPECS_V1: Final[tuple[UnitSpec, ...]] = (
    UnitSpec(
        unit_key="TRY",
        category="currency",
        display_symbol="TL",
        aliases=("tl", "türk lirası", "lira", "te le", "₺"),
        is_monetary=True,
    ),
    UnitSpec(
        unit_key="GB",
        category="storage",
        display_symbol="GB",
        aliases=("gb", "cigabayt", "gigabayt", "gigabyte"),
    ),
    UnitSpec(
        unit_key="MB",
        category="storage",
        display_symbol="MB",
        aliases=("mb", "megabayt", "megabyte"),
    ),
    UnitSpec(
        unit_key="TB",
        category="storage",
        display_symbol="TB",
        aliases=("tb", "terabayt", "terabyte"),
    ),
    UnitSpec(
        unit_key="inc",
        category="display",
        display_symbol="inç",
        aliases=("inç", "inc", "inch"),
    ),
    UnitSpec(
        unit_key="saat",
        category="battery",
        display_symbol="saat",
        aliases=("saat", "sa"),
    ),
    UnitSpec(
        unit_key="mAh",
        category="battery",
        display_symbol="mAh",
        aliases=("mah", "miliamper"),
    ),
    UnitSpec(
        unit_key="litre",
        category="volume",
        display_symbol="litre",
        aliases=("litre", "lt", "l"),
    ),
    UnitSpec(
        unit_key="ml",
        category="volume",
        display_symbol="ml",
        aliases=("ml", "mililitre"),
    ),
    UnitSpec(
        unit_key="kg",
        category="weight",
        display_symbol="kg",
        aliases=("kg", "kilogram", "kilo"),
    ),
    UnitSpec(
        unit_key="gr",
        category="weight",
        display_symbol="gr",
        aliases=("gr", "g", "gram"),
    ),
    UnitSpec(
        unit_key="Hz",
        category="frequency",
        display_symbol="Hz",
        aliases=("hz", "hertz", "herz"),
    ),
    UnitSpec(
        unit_key="W",
        category="power",
        display_symbol="W",
        aliases=("w", "watt", "vat"),
    ),
    UnitSpec(
        unit_key="cm",
        category="length",
        display_symbol="cm",
        aliases=("cm", "santimetre"),
    ),
    UnitSpec(
        unit_key="mm",
        category="length",
        display_symbol="mm",
        aliases=("mm", "milimetre"),
    ),
    UnitSpec(
        unit_key="Pa",
        category="pressure",
        display_symbol="Pa",
        aliases=("pa", "paskal", "pascal"),
    ),
    UnitSpec(
        unit_key="dB",
        category="acoustic",
        display_symbol="dB",
        aliases=("db", "desibel"),
    ),
    UnitSpec(
        unit_key="MP",
        category="resolution",
        display_symbol="MP",
        aliases=("mp", "megapiksel", "megapixel"),
    ),
)

BOOLEAN_OPERATOR_SPECS_V1: Final[tuple[BooleanOperatorSpec, ...]] = (
    BooleanOperatorSpec(
        operator="all_of",
        default_polarity="positive",
        default_modality="must",
        description="Tüm pozitif zorunlu ölçütlerin kesişimi (varsayılan VE).",
    ),
    BooleanOperatorSpec(
        operator="any_of",
        default_polarity="positive",
        default_modality="should",
        description="VEYA / ya da bağlaçlı alternatif seçenek kümesi (marka, renk, beden).",
    ),
    BooleanOperatorSpec(
        operator="not",
        default_polarity="negative",
        default_modality="must_not",
        description=(
            "olmasın / hariç / değil dışlama kapsamı; asla applied_filters içine terfi etmez."
        ),
    ),
)

ONTOLOGY_CATALOG_V1: Final[OntologyCatalogV1] = OntologyCatalogV1(
    version=ONTOLOGY_SCHEMA_VERSION,
    showcase_categories=SHOWCASE_ONTOLOGY_V1,
    long_tail_categories=LONG_TAIL_ONTOLOGY_V1,
    size_systems=SIZE_SYSTEM_SPECS_V1,
    units=UNIT_SPECS_V1,
    boolean_operators=BOOLEAN_OPERATOR_SPECS_V1,
    provenance_kinds=("rule", "ml_candidate", "user_edit"),
)
