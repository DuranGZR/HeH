"""Unit tests for D16 Turkish normalization, apostrophe folding, and model protection."""

import unicodedata

from heh_api.infrastructure.nlp.rules.adapter import RuleBasedQueryUnderstandingAdapter
from heh_api.infrastructure.nlp.rules.normalize import (
    load_asr_alias_dictionary,
    normalize_query_for_m0,
    turkish_lower,
)
from heh_api.infrastructure.snapshot_loader import load_mapping_snapshot
from heh_api.infrastructure.trendyol.url_builder import TrendyolURLBuilder


def test_turkish_lower_preserves_dotted_and_dotless_i_from_nfd_and_nfc() -> None:
    """Preserve İ->i and I->ı without ASCII folding corruption even on NFD inputs."""
    nfd_input = unicodedata.normalize("NFD", "İSTANBUL SİYAH IŞIKLI KLAVYE")
    assert turkish_lower(nfd_input) == "istanbul siyah ışıklı klavye"


def test_normalizer_protects_model_names_from_number_slot_collision() -> None:
    """Protect model names like iPhone 13, Apple Watch 9, Galaxy S24, M2, and WH-1000XM5."""
    samples = [
        ("iPhone 13 25000 altı siyah", "iphone 13"),
        ("Apple Watch 9 kordon", "apple watch 9"),
        ("Samsung Galaxy S24 kılıf", "galaxy s24"),
        ("MacBook Air M2 40000 altı", "m2"),
        ("Sony WH-1000XM5 kulaklık", "sony wh-1000xm5"),
    ]
    for raw_text, expected_protected in samples:
        res = normalize_query_for_m0(raw_text)
        protected_texts = [sp.text for sp in res.protected_spans]
        assert any(expected_protected in p for p in protected_texts), raw_text
        assert res.raw_display == raw_text


def test_normalizer_handles_apostrophes_punctuations_and_asr_aliases() -> None:
    """Normalize inflected numeric suffixes, fused words, and phonetic ASR phrases."""
    res1 = normalize_query_for_m0("4500'e kadar Sony'nin kulaküstü cey bi el modeli.")
    assert "4500 e kadar" in res1.canonical_for_matching
    assert "sony " in res1.canonical_for_matching
    assert "kulak üstü" in res1.canonical_for_matching
    assert "jbl" in res1.canonical_for_matching

    # Must not corrupt genuine words like 'el kremi' while fixing 'em beden'
    res2 = normalize_query_for_m0("em beden siyah mont ve el kremi")
    assert "m beden" in res2.canonical_for_matching
    assert "el kremi" in res2.canonical_for_matching


def test_normalizer_handles_control_characters_and_arbitrary_unicode_without_error() -> None:
    """Strip zero-width and control characters cleanly without throwing."""
    res = normalize_query_for_m0("\ufeff\u200b  3.000 TL   \t\n altı — siyah\x00 mont!! ")
    assert "3.000 tl altı - siyah mont" in res.canonical_for_matching


def test_asr_aliases_yaml_loads_and_resolves_phonetic_brand_size_and_number_slips() -> None:
    """Resolve phonetic brand/size/numeric ASR slips cleanly via `asr_aliases.yaml` + M0."""
    dictionary = load_asr_alias_dictionary()
    assert len(dictionary.rules) >= 35

    adapter = RuleBasedQueryUnderstandingAdapter()

    # Brand phonetics + spoken half-thousand ("iki buçuk bin") + spelled currency ("te le")
    parsed_headphones = adapter.parse(
        "cey bi el blutut kulaküstü kulaklık iki buçuk bin te le altı",
        input_source="voice",
    )
    criteria_by_field = {c.field: c for c in parsed_headphones.intent.criteria}
    assert criteria_by_field["brand"].value == "jbl"
    assert criteria_by_field["category"].value == "bluetooth_kulaklik"
    assert criteria_by_field["attribute"].value == "kablosuz"
    assert criteria_by_field["price"].value.max_amount == 2500  # type: ignore[union-attr]

    # Phonetic negation + fused Turkish thousand ("üçbin") + phonetic clothing size ("el beden")
    parsed_coat = adapter.parse(
        "nayk olmasın üçbin altı el beden siyah erkek mont",
        input_source="voice",
    )
    coat_fields = {c.field: c for c in parsed_coat.intent.criteria}
    assert coat_fields["brand"].operator == "not_in"
    assert coat_fields["brand"].value == ("nike",)
    assert coat_fields["size"].value == "l"
    assert coat_fields["price"].value.max_amount == 3000  # type: ignore[union-attr]

    coat_resolution = TrendyolURLBuilder().build_resolution(
        parsed_coat.intent, load_mapping_snapshot()
    )
    assert "nayk" not in coat_resolution.url.lower()
    assert "nike" not in coat_resolution.url.lower()
    assert "olmas" not in coat_resolution.url.lower()

    # Phonetic Xiaomi + unit ASR ("16 cigabayt") without mistaking 16 GB for TRY price
    parsed_phone = normalize_query_for_m0("şayomi 16 cigabayt ram eyrpodz pro")
    assert "xiaomi" in parsed_phone.canonical_for_matching
    assert "16 gb ram" in parsed_phone.canonical_for_matching
    assert "airpods pro" in parsed_phone.canonical_for_matching
    assert "asr_brand_xiaomi_phonetic" in parsed_phone.applied_asr_rules

    # Inflected fused thousand ("üçbinden") and spoken ANC variant ("gürültü engelleyici")
    parsed_voice_anc = adapter.parse(
        "üçbinden ucuz aktif gürültü engelleyici kulaklık", input_source="voice"
    )
    anc_fields = {c.field: c for c in parsed_voice_anc.intent.criteria}
    assert anc_fields["price"].value.max_amount == 3000  # type: ignore[union-attr]
    assert anc_fields["attribute"].value == "anc"
