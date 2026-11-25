"""Unit and Hypothesis property-based fuzz tests for D17 price and unit parsing."""

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from heh_api.infrastructure.nlp.rules.normalize import normalize_query_for_m0
from heh_api.infrastructure.nlp.rules.numbers import extract_price_and_units


def test_price_parser_handles_turkish_formats_and_compound_bounds() -> None:
    """Verify binary bounds, shorthand '20-30 bin', apostrophes, and Turkish word numbers."""
    cases = [
        ("3000 altı erkek mont", Decimal("0"), Decimal("3000"), True),
        ("3 bini geçmesin siyah mont", Decimal("0"), Decimal("3000"), False),
        ("2.500 TL altı kulaklık", Decimal("0"), Decimal("2500"), True),
        ("4500'e kadar laptop", Decimal("0"), Decimal("4500"), False),
        ("20-30 bin arası laptop", Decimal("20000"), Decimal("30000"), False),
        ("üç bin altı mont", Decimal("0"), Decimal("3000"), True),
        ("3 bini geçmesin ama 1500 altı da olmasın", Decimal("1500"), Decimal("3000"), False),
        ("en az 2000 TL ayakkabı", Decimal("2000"), None, False),
    ]
    for query, exp_min, exp_max, exp_strict_upper in cases:
        res = extract_price_and_units(normalize_query_for_m0(query))
        assert res.conflict_message is None, query
        assert res.price is not None, query
        assert res.price.min_amount == exp_min, query
        assert res.price.max_amount == exp_max, query
        assert res.strict_upper is exp_strict_upper, query


def test_units_and_model_numbers_never_become_currency_prices() -> None:
    """Protect 40 saat pil, 15,6 inç, 1.5 kg, 144 Hz, and iPhone 13 from false price parsing."""
    queries_without_price = [
        "40 saat pil ömrü kulaklık",
        "15,6 inç laptop",
        "1.5 kg ultrabook",
        "144 Hz ekran laptop",
        "iPhone 13 siyah",
        "Galaxy S24 256 GB telefon",
        "1 litre termos",
    ]
    for query in queries_without_price:
        res = extract_price_and_units(normalize_query_for_m0(query))
        assert res.price is None, f"Unexpected price extracted for: {query}"

    laptop_res = extract_price_and_units(
        normalize_query_for_m0("15,6 inç 1.5 kg 16 GB 25000 altı laptop")
    )
    assert laptop_res.price is not None
    assert laptop_res.price.max_amount == Decimal("25000")
    units = {(m.value, m.unit) for m in laptop_res.measurements}
    assert (Decimal("15.6"), "inç") in units
    assert (Decimal("1.5"), "kg") in units
    assert (Decimal("16"), "gb") in units


def test_contradictory_price_bounds_emit_conflict_never_invalid_price() -> None:
    """Detect min > max contradictions explicitly rather than creating corrupt PriceValue."""
    res1 = extract_price_and_units(normalize_query_for_m0("5000-2000 arası mont"))
    assert res1.price is None
    assert res1.conflict_message is not None

    res2 = extract_price_and_units(normalize_query_for_m0("3000 üstü 2000 altı mont"))
    assert res2.price is None
    assert res2.conflict_message is not None


@given(st.text(max_size=120))
def test_price_parser_fuzz_never_crashes_or_emits_min_gt_max(raw_text: str) -> None:
    """Property-based fuzz: arbitrary Unicode text never throws and always satisfies min <= max."""
    norm = normalize_query_for_m0(raw_text)
    res = extract_price_and_units(norm)
    if res.price is not None:
        if res.price.min_amount is not None:
            assert res.price.min_amount >= Decimal("0")
        if res.price.max_amount is not None:
            assert res.price.max_amount >= Decimal("0")
        if res.price.min_amount is not None and res.price.max_amount is not None:
            assert res.price.min_amount <= res.price.max_amount
