"""Unit tests for D16 Turkish normalization, apostrophe folding, and model protection."""

import unicodedata

from heh_api.infrastructure.nlp.rules.normalize import normalize_query_for_m0, turkish_lower


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
