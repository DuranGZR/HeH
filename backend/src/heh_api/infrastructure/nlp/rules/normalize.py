"""D16 Turkish-aware Unicode NFC normalization, suffix handling, and model-name protection."""

import re
import unicodedata
from dataclasses import dataclass

_CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\ufeff]")
_APOSTROPHE_VARIANTS = ("\u2019", "\u2018", "\u02bc", "`", "\u00b4")
_HYPHEN_VARIANTS = ("\u2013", "\u2014", "\u2212")

# Multiword colloquial/ASR canonicalizations preserving Turkish word boundaries
_ASR_PHRASE_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bcey\s*bi\s*el\b"), "jbl"),
    (re.compile(r"\bce\s*bi\s*el\b"), "jbl"),
    (re.compile(r"\bkulak[uü]st[uü]\b"), "kulak üstü"),
    (re.compile(r"\bkulaki[cç]i\b"), "kulak içi"),
    (re.compile(r"\bsuge[cç]irmez\b"), "su geçirmez"),
    (re.compile(r"\bem\s+beden\b"), "m beden"),
    (re.compile(r"\bes\s+beden\b"), "s beden"),
    (re.compile(r"\beks\s*el\s+beden\b"), "xl beden"),
    (re.compile(r"\beks\s*lar[cç]\b"), "xl"),
    (re.compile(r"\bi\s*phone\b"), "iphone"),
    (re.compile(r"\bgurultu\s+engelleme\b"), "gürültü engelleme"),
)

_UNIT_FOLLOWS_LOOKAHEAD = (
    r"(?!\s*(?:gb|tb|mb|mah|hz|in[çc]|kg|mm|cm|watt|w|mp|ml|saat|litre|lt|l)\b)"
)

# Protected brand+model phrases and alphanumeric model tokens (numbers must not become price/size)
_PROTECTED_PHRASE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(rf"\biphone\s+\d+{_UNIT_FOLLOWS_LOOKAHEAD}(?:\s*(?:pro\s+max|pro|plus|mini))?\b"),
    re.compile(rf"\bapple\s+watch\s+(?:ultra\s*\d*|\d+{_UNIT_FOLLOWS_LOOKAHEAD}|se)\b"),
    re.compile(
        rf"\bgalaxy\s+(?:watch\s*\d*{_UNIT_FOLLOWS_LOOKAHEAD}|buds\s*\d*|"
        rf"[aszm]\d+{_UNIT_FOLLOWS_LOOKAHEAD}(?:\s*(?:ultra|plus|fe))?)\b"
    ),
    re.compile(rf"\bredmi\s+(?:note\s+)?\d+{_UNIT_FOLLOWS_LOOKAHEAD}(?:\s*(?:pro|plus))?\b"),
    re.compile(rf"\bairpods\s*(?:pro|max|\d+{_UNIT_FOLLOWS_LOOKAHEAD})?\b"),
    re.compile(r"\bmacbook\s+(?:air|pro)?\s*m\d+\b"),
    re.compile(r"\brtx\s*\d{4}\b"),
    re.compile(r"\bgtx\s*\d{4}\b"),
    re.compile(r"\bsony\s+wh-\d+[a-z0-9]*\b"),
)

_ALPHANUM_MODEL_PATTERN = re.compile(
    r"\b(?=[a-zçğıöşü]*\d)(?=\d*[a-zçğıöşü])[a-zçğıöşü0-9-]{2,20}\b"
)

_NUMBER_APOSTROPHE_PATTERN = re.compile(r"\b(\d+(?:[.,]\d+)?)'([a-zçğıöşü]+)\b")
_WORD_APOSTROPHE_PATTERN = re.compile(
    r"\b([a-zçğıöşü]{2,})'(?:nın|nin|nun|nün|ın|in|un|ün|ya|ye|a|e|da|de|ta|te|dan|den|tan|ten|ı|i|u|ü)\b"
)
_CLAUSE_PUNCT_SPACING_PATTERN = re.compile(r"\s*((?<!\d),(?!\d)|[;!?])\s*")
_TERMINAL_DOT_PATTERN = re.compile(r"(?<!\d)\.(?!\d)")


@dataclass(frozen=True)
class ProtectedSpan:
    """Character range corresponding to a protected model phrase inside normalized text."""

    start: int
    end: int
    text: str


@dataclass(frozen=True)
class NormalizedToken:
    """Single normalized token with character bounds inside `normalized` text."""

    text: str
    start: int
    end: int
    is_protected_model: bool = False


@dataclass(frozen=True)
class NormalizationResult:
    """Immutable D16 normalization output preserving raw query, normalized form, and spans."""

    raw_display: str
    normalized: str
    canonical_for_matching: str
    protected_spans: tuple[ProtectedSpan, ...]
    tokens: tuple[NormalizedToken, ...]


def turkish_lower(text: str) -> str:
    """Apply Unicode NFC + Turkish locale lowercase (`İ -> i`, `I -> ı`)."""
    nfc = unicodedata.normalize("NFC", text)
    folded = nfc.replace("\u0130", "i").replace("I", "ı").lower()
    # Clean residual combining dot above when lowercase engines turn İ into i + \u0307
    return folded.replace("i\u0307", "i")


def strip_control_and_unify_punctuation(text: str) -> str:
    """Remove invisible/control characters and normalize apostrophes/hyphens."""
    nfc = unicodedata.normalize("NFC", text)
    cleaned = _CONTROL_CHAR_PATTERN.sub(" ", nfc)
    for apo in _APOSTROPHE_VARIANTS:
        cleaned = cleaned.replace(apo, "'")
    for dash in _HYPHEN_VARIANTS:
        cleaned = cleaned.replace(dash, "-")
    return " ".join(cleaned.strip().split())


def _apply_asr_and_compound_aliases(text: str) -> str:
    updated = text
    for pattern, replacement in _ASR_PHRASE_REPLACEMENTS:
        updated = pattern.sub(replacement, updated)
    return " ".join(updated.split())


def _collect_protected_spans(text: str) -> tuple[ProtectedSpan, ...]:
    spans: list[ProtectedSpan] = []
    for pattern in _PROTECTED_PHRASE_PATTERNS:
        for match in pattern.finditer(text):
            spans.append(ProtectedSpan(start=match.start(), end=match.end(), text=match.group(0)))

    for match in _ALPHANUM_MODEL_PATTERN.finditer(text):
        token = match.group(0)
        # Do not protect numeric range tokens like 1500-3000 or hyphenated measurements
        if re.fullmatch(r"\d+-\d+", token):
            continue
        if not any(s.start <= match.start() and match.end() <= s.end for s in spans):
            spans.append(ProtectedSpan(start=match.start(), end=match.end(), text=token))

    spans.sort(key=lambda sp: (sp.start, -(sp.end - sp.start)))
    deduped: list[ProtectedSpan] = []
    for span in spans:
        if any(prev.start <= span.start and span.end <= prev.end for prev in deduped):
            continue
        deduped.append(span)
    return tuple(deduped)


def _strip_inflectional_apostrophes(text: str) -> str:
    # Keep number stem + separate suffix for case markers like 4500'e kadar -> 4500 e kadar
    step1 = _NUMBER_APOSTROPHE_PATTERN.sub(r"\1 \2", text)
    return _WORD_APOSTROPHE_PATTERN.sub(r"\1", step1)


def _strip_punctuation_for_matching(text: str) -> str:
    spaced = _CLAUSE_PUNCT_SPACING_PATTERN.sub(r" \1 ", text)
    # Strip sentence-ending/non-thousands periods (keep 2.500 and 15.6 / 15,6 numeric format)
    no_dots = _TERMINAL_DOT_PATTERN.sub(" ", spaced)
    return " ".join(no_dots.split())


def normalize_query_for_m0(raw_query: str) -> NormalizationResult:
    """Normalize arbitrary Turkish query text safely while protecting product models."""
    raw_display = strip_control_and_unify_punctuation(raw_query)
    if not raw_display:
        return NormalizationResult(
            raw_display="",
            normalized="",
            canonical_for_matching="",
            protected_spans=(),
            tokens=(),
        )

    lowered = turkish_lower(raw_display)
    aliased = _apply_asr_and_compound_aliases(lowered)
    de_inflected = _strip_inflectional_apostrophes(aliased)
    canonical = _strip_punctuation_for_matching(de_inflected)
    protected = _collect_protected_spans(canonical)

    token_list: list[NormalizedToken] = []
    for match in re.finditer(r"\S+", canonical):
        tok_start, tok_end = match.start(), match.end()
        is_protected = any(not (tok_end <= sp.start or tok_start >= sp.end) for sp in protected)
        token_list.append(
            NormalizedToken(
                text=match.group(0),
                start=tok_start,
                end=tok_end,
                is_protected_model=is_protected,
            )
        )

    return NormalizationResult(
        raw_display=raw_display,
        normalized=aliased,
        canonical_for_matching=canonical,
        protected_spans=protected,
        tokens=tuple(token_list),
    )
