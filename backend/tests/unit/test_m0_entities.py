"""Unit tests for D18 YAML alias dictionary, disambiguation, and category routing."""

from heh_api.infrastructure.nlp.rules.entities import extract_entities_and_category
from heh_api.infrastructure.nlp.rules.normalize import normalize_query_for_m0
from heh_api.infrastructure.nlp.rules.numbers import extract_price_and_units


def test_disambiguates_apple_jbl_sizes_and_model_numbers() -> None:
    """Verify JBL/Apple/M beden/42 numara vs measurements (1 litre, 40 saat, iPhone 13)."""
    norm1 = normalize_query_for_m0("cey bi el kulaküstü siyah kulaklık 40 saat pil")
    num1 = extract_price_and_units(norm1)
    ent1 = extract_entities_and_category(norm1, consumed_spans=num1.consumed_spans)
    assert ent1.category is not None
    assert ent1.category.canonical_key == "bluetooth_kulaklik"
    assert any(m.kind == "brand" and m.canonical_key == "jbl" for m in ent1.mentions)
    assert any(m.kind == "color" and m.canonical_key == "siyah" for m in ent1.mentions)

    # 1 litre termos must NOT produce clothing size L
    norm2 = normalize_query_for_m0("1 L termos siyah")
    num2 = extract_price_and_units(norm2)
    ent2 = extract_entities_and_category(norm2, consumed_spans=num2.consumed_spans)
    assert ent2.category is not None
    assert ent2.category.showcase is False
    assert not any(m.kind == "size" for m in ent2.mentions)

    # iPhone 13 extracts brand Apple + category cep_telefonu, no numeric shoe size
    norm3 = normalize_query_for_m0("iPhone 13 siyah")
    num3 = extract_price_and_units(norm3)
    ent3 = extract_entities_and_category(norm3, consumed_spans=num3.consumed_spans)
    assert ent3.category is not None
    assert ent3.category.canonical_key == "cep_telefonu"
    assert any(m.kind == "brand" and m.canonical_key == "apple" for m in ent3.mentions)
    assert not any(m.kind == "size" for m in ent3.mentions)


def test_disambiguates_mavi_brand_vs_color_by_category_context() -> None:
    """Treat 'Mavi siyah erkek mont' as Mavi brand + Siyah color, 'mavi kulaklık' as color."""
    mont_norm = normalize_query_for_m0("Mavi siyah m beden erkek mont")
    mont_num = extract_price_and_units(mont_norm)
    mont_ent = extract_entities_and_category(mont_norm, consumed_spans=mont_num.consumed_spans)
    brands = {m.canonical_key for m in mont_ent.mentions if m.kind == "brand"}
    colors = {m.canonical_key for m in mont_ent.mentions if m.kind == "color"}
    sizes = {m.canonical_key for m in mont_ent.mentions if m.kind == "size"}
    assert "mavi" in brands
    assert "siyah" in colors
    assert "m" in sizes

    kulaklik_norm = normalize_query_for_m0("mavi renk sony kulaklık")
    kulaklik_num = extract_price_and_units(kulaklik_norm)
    kulaklik_ent = extract_entities_and_category(
        kulaklik_norm, consumed_spans=kulaklik_num.consumed_spans
    )
    k_colors = {m.canonical_key for m in kulaklik_ent.mentions if m.kind == "color"}
    k_brands = {m.canonical_key for m in kulaklik_ent.mentions if m.kind == "brand"}
    assert "mavi" in k_colors
    assert k_brands == {"sony"}
