"""Unit and Hypothesis property tests for D19 Boolean/NOT scope and conflict detection."""

from hypothesis import given
from hypothesis import strategies as st

from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter


def test_negation_patterns_never_promote_excluded_brands_or_colors() -> None:
    """Verify 'olmayan', 'olmasın', 'hariç', 'değil', and dual exclusions stay not_in."""
    adapter = RuleBasedQueryUnderstandingAdapter()

    res1 = adapter.parse("Nike olmayan Adidas spor ayakkabı")
    not_items = [c for c in res1.intent.criteria if c.operator == "not_in"]
    pos_brands = [c for c in res1.intent.criteria if c.field == "brand" and c.operator != "not_in"]
    assert len(not_items) == 1 and not_items[0].value == ("nike",)
    assert len(pos_brands) == 1 and pos_brands[0].value == "adidas"

    res2 = adapter.parse("kırmızı değil bordo mont")
    not_colors = [c for c in res2.intent.criteria if c.field == "color" and c.operator == "not_in"]
    pos_colors = [c for c in res2.intent.criteria if c.field == "color" and c.operator != "not_in"]
    assert [c.value for c in not_colors] == [("kirmizi",)]
    assert [c.value for c in pos_colors] == ["bordo"]

    res3 = adapter.parse("Nike ve Puma olmasın 42 numara spor ayakkabı")
    neg_brands = [
        c.value for c in res3.intent.criteria if c.field == "brand" and c.operator == "not_in"
    ]
    assert ("nike",) in neg_brands and ("puma",) in neg_brands
    assert not any(c.field == "brand" and c.operator != "not_in" for c in res3.intent.criteria)


def test_or_grouping_preserves_any_of_semantics_and_handles_complex_mix() -> None:
    """Verify (Sony OR JBL) AND ANC AND price<=6000 AND NOT beyaz AST structure."""
    adapter = RuleBasedQueryUnderstandingAdapter()
    res = adapter.parse("Sony veya JBL kulak üstü olsun 6000 altında beyaz olmasın ANC şart")

    brand_or = next(c for c in res.intent.criteria if c.field == "brand")
    assert brand_or.operator == "in"
    assert brand_or.value == ("sony", "jbl")
    assert any(g.operator == "any_of" for g in res.intent.logic_groups)
    assert any(
        c.field == "color" and c.operator == "not_in" and c.value == ("beyaz",)
        for c in res.intent.criteria
    )
    assert any(c.field == "attribute" and c.value == "anc" for c in res.intent.criteria)
    assert any(c.field == "price" for c in res.intent.criteria)


def test_contradictions_and_ood_trigger_abstain_safely() -> None:
    """Detect conflicting positive+negative color or dual sizes without unsafe promotion."""
    adapter = RuleBasedQueryUnderstandingAdapter()

    contradiction = adapter.parse("siyah olsun ama siyah olmasın mont")
    assert contradiction.has_conflict is True
    assert contradiction.confidence_state == "abstain"
    assert not any(c.field == "color" and c.operator == "eq" for c in contradiction.intent.criteria)

    ood = adapter.parse("merhaba bugün hava nasıl")
    assert ood.is_ood is True
    assert ood.confidence_state == "abstain"


@given(
    st.sampled_from(["nike", "puma", "sony", "jbl", "adidas"]),
    st.sampled_from(["olmasın", "hariç", "dışında"]),
)
def test_property_negated_brand_never_appears_positive(brand: str, marker: str) -> None:
    """Property check: any negated brand remains strictly not_in in AST."""
    adapter = RuleBasedQueryUnderstandingAdapter()
    res = adapter.parse(f"2000 üstü {brand} {marker} spor ayakkabı")
    assert any(
        c.field == "brand" and c.operator == "not_in" and c.value == (brand,)
        for c in res.intent.criteria
    )
    assert not any(c.field == "brand" and c.operator in {"eq", "in"} for c in res.intent.criteria)
