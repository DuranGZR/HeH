"""D16/D29 Turkish-aware Unicode NFC normalization, ASR YAML aliases, and model protection."""

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

_ZERO_WIDTH_PATTERN = re.compile(r"[\u200b-\u200f\u2060\ufeff]")
_CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_APOSTROPHE_VARIANTS = ("\u2019", "\u2018", "\u02bc", "`", "\u00b4")
_HYPHEN_VARIANTS = ("\u2013", "\u2014", "\u2212")
_ENGLISH_I_TOKEN_PATTERN = re.compile(
    r"\b(IPHONE|IPAD|IPS|INTEL|NIKE|ADIDAS|XIAOMI|PHILIPS|MSI|GARMIN|LOGITECH|"
    r"HISENSE|PANASONIC|COLUMBIA|ASICS|TIMBERLAND|SALOMON|BIRKENSTOCK|CROCS|MINI|WIFI|GIGABIT)\b"
)

AsrCategory = Literal["brand_phonetics", "numeric_currency", "size_units", "commerce_phrases"]


class AsrAliasRule(BaseModel):
    """Single deterministic ASR normalization rule backed by `asr_aliases.yaml`."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    category: AsrCategory
    pattern: str = Field(min_length=1, max_length=240)
    replacement: str = Field(min_length=1, max_length=120)
    example_asr: str = Field(min_length=1, max_length=160)

    @field_validator("pattern")
    @classmethod
    def _validate_regex(cls, raw_pattern: str) -> str:
        re.compile(raw_pattern)
        return raw_pattern


class AsrAliasDictionaryV1(BaseModel):
    """Validated versioned ASR phonetic and spoken-numeric replacement dictionary."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: str
    rules: tuple[AsrAliasRule, ...] = Field(min_length=1)


@lru_cache(maxsize=1)
def load_asr_alias_dictionary() -> AsrAliasDictionaryV1:
    """Load and validate versioned ASR normalization aliases once at startup."""
    raw_yaml = (
        resources.files("heh_api.infrastructure.nlp.rules")
        .joinpath("asr_aliases.yaml")
        .read_text(encoding="utf-8")
    )
    loaded = yaml.safe_load(raw_yaml)
    return AsrAliasDictionaryV1.model_validate(loaded)


@lru_cache(maxsize=1)
def _compiled_asr_rules() -> tuple[tuple[str, re.Pattern[str], str], ...]:
    dictionary = load_asr_alias_dictionary()
    return tuple((rule.id, re.compile(rule.pattern), rule.replacement) for rule in dictionary.rules)


_UNIT_FOLLOWS_LOOKAHEAD = (
    r"(?!\s*(?:gb|tb|mb|mah|hz|in[çc]|inch|kg|kilogram|kilo|gram|gr|g|"
    r"mm|cm|watt|vat|w|mp|ml|pa|db|saat|sa|litre|lt|l)\b)"
)
_ATTACHED_UNIT_MODEL_SKIP_RE = re.compile(
    r"^\d+(?:[.,]\d+)?(?:gb|tb|mb|mah|hz|in[çc]|inch|kg|kilogram|kilo|gram|gr|g|"
    r"mm|cm|watt|vat|w|mp|ml|pa|db|saat|sa|litre|lt|l|tl|lira|xs|xl|xxl|bin(?:den|de|in|[ie])?)$"
)

# Protected brand+model phrases and alphanumeric model tokens (numbers must not become price/size)
_PROTECTED_PHRASE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(rf"\biphone\s+\d+{_UNIT_FOLLOWS_LOOKAHEAD}(?:\s*(?:pro\s+max|pro|plus|mini))?\b"),
    re.compile(
        rf"\b(?:apple\s+)?watch\s+(?:ultra\s*\d*|series\s+\d+|\d+{_UNIT_FOLLOWS_LOOKAHEAD}|se)\b"
    ),
    re.compile(
        rf"\bgalaxy\s+(?:watch\s*\d*{_UNIT_FOLLOWS_LOOKAHEAD}|buds\s*\d*|"
        rf"[aszm]\d+{_UNIT_FOLLOWS_LOOKAHEAD}(?:\s*(?:ultra|plus|fe))?)\b"
    ),
    re.compile(rf"\bredmi\s+(?:note\s+)?\d+{_UNIT_FOLLOWS_LOOKAHEAD}(?:\s*(?:pro|plus))?\b"),
    re.compile(rf"\bairpods\s*(?:pro|max|\d+{_UNIT_FOLLOWS_LOOKAHEAD})?\b"),
    re.compile(r"\bmacbook\s+(?:air|pro)?\s*m\d+\b"),
    re.compile(r"\brtx[-\s]?\d{4}\b"),
    re.compile(r"\bgtx[-\s]?\d{4}\b"),
    re.compile(r"\bsony\s+wh-\d+[a-z0-9-]*\b"),
)

_ALPHANUM_MODEL_PATTERN = re.compile(
    r"\b(?=[a-zçğıöşü]*\d)(?=\d*[a-zçğıöşü])[a-zçğıöşü0-9-]{2,20}\b"
)

_NUMBER_APOSTROPHE_PATTERN = re.compile(
    r"(?<!\w)(\d{1,3}(?:\.\d{3})+,\d+|\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)'([a-zçğıöşü]+)\b"
)
_CURRENCY_APOSTROPHE_PATTERN = re.compile(
    r"\b(tl|lira)'(nın|nin|nun|nün|ın|in|un|ün|ya|ye|a|e|da|de|ta|te|dan|den|tan|ten|yı|yi|yu|yü|ı|i|u|ü)\b"
)
_WORD_PRIVATIVE_APOSTROPHE_PATTERN = re.compile(r"\b([a-zçğıöşü]{2,})'(?:s[ıi]z|suz|s[üu]z)\b")
_WORD_APOSTROPHE_PATTERN = re.compile(
    r"\b([a-zçğıöşü]{2,})'(?:nın|nin|nun|nün|ın|in|un|ün|yla|yle|la|le|"
    r"ya|yi|yu|yü|ı|i|u|ü|ye|a|e|da|de|ta|te|nda|nde|ndan|nden|dan|den|tan|ten)\b"
)
_CLAUSE_PUNCT_SPACING_PATTERN = re.compile(r"\s*((?<!\d),(?!\d)|[;!?()])\s*")
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
    """Immutable normalization output preserving raw query, canonical form, and ASR provenance."""

    raw_display: str
    normalized: str
    canonical_for_matching: str
    protected_spans: tuple[ProtectedSpan, ...]
    tokens: tuple[NormalizedToken, ...]
    applied_asr_rules: tuple[str, ...] = ()


def turkish_lower(text: str) -> str:
    """Apply Unicode NFC + Turkish locale lowercase (`İ -> i`, `I -> ı`) safely."""
    nfc = unicodedata.normalize("NFC", text)
    protected_english = _ENGLISH_I_TOKEN_PATTERN.sub(lambda match: match.group(0).lower(), nfc)
    folded = protected_english.replace("\u0130", "i").replace("I", "ı").lower()
    # Clean residual combining dot above when lowercase engines turn İ into i + \u0307
    return folded.replace("i\u0307", "i")


def strip_control_and_unify_punctuation(text: str) -> str:
    """Remove invisible/control characters and normalize apostrophes/hyphens."""
    nfc = unicodedata.normalize("NFC", text)
    without_zw = _ZERO_WIDTH_PATTERN.sub("", nfc)
    cleaned = _CONTROL_CHAR_PATTERN.sub(" ", without_zw)
    for apo in _APOSTROPHE_VARIANTS:
        cleaned = cleaned.replace(apo, "'")
    for dash in _HYPHEN_VARIANTS:
        cleaned = cleaned.replace(dash, "-")
    return " ".join(cleaned.strip().split())


def _apply_asr_and_compound_aliases(text: str) -> tuple[str, tuple[str, ...]]:
    updated = text
    applied_ids: list[str] = []
    for rule_id, pattern, replacement in _compiled_asr_rules():
        next_text, sub_count = pattern.subn(replacement, updated)
        if sub_count > 0:
            applied_ids.append(rule_id)
            updated = next_text
    return " ".join(updated.split()), tuple(applied_ids)


def _collect_protected_spans(text: str) -> tuple[ProtectedSpan, ...]:
    spans: list[ProtectedSpan] = []
    for pattern in _PROTECTED_PHRASE_PATTERNS:
        for match in pattern.finditer(text):
            spans.append(ProtectedSpan(start=match.start(), end=match.end(), text=match.group(0)))

    for match in _ALPHANUM_MODEL_PATTERN.finditer(text):
        token = match.group(0)
        # Do not protect numeric range tokens or unit-attached measurements (16gb, 1l, 144hz)
        if re.fullmatch(r"\d+-\d+", token) or _ATTACHED_UNIT_MODEL_SKIP_RE.match(token):
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
    # Keep number + currency suffix markers separated (`4500'e kadar`, `3000 TL'den ucuz`)
    step1 = _NUMBER_APOSTROPHE_PATTERN.sub(r"\1 \2", text)
    step2 = _CURRENCY_APOSTROPHE_PATTERN.sub(r"\1 \2", step1)
    step3 = _WORD_PRIVATIVE_APOSTROPHE_PATTERN.sub(r"\1 olmasın", step2)
    return _WORD_APOSTROPHE_PATTERN.sub(r"\1", step3)


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
            applied_asr_rules=(),
        )

    lowered = turkish_lower(raw_display)
    aliased, applied_asr_rules = _apply_asr_and_compound_aliases(lowered)
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
        applied_asr_rules=applied_asr_rules,
    )
