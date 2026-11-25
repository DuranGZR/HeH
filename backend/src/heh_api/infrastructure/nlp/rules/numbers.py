"""D17 Deterministic Turkish Decimal price, range, and unit-measurement parser."""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

from heh_api.domain.search_intent import PriceValue
from heh_api.infrastructure.nlp.rules.normalize import NormalizationResult, ProtectedSpan

ModalityKind = Literal["required", "preferred", "prohibited", "approximate"]

_UNIT_CANONICAL_MAP: dict[str, str] = {
    "gb": "gb",
    "tb": "tb",
    "mb": "mb",
    "kg": "kg",
    "kilo": "kg",
    "kilogram": "kg",
    "gr": "g",
    "gram": "g",
    "g": "g",
    "ml": "ml",
    "litre": "l",
    "lt": "l",
    "l": "l",
    "cm": "cm",
    "mm": "mm",
    "inç": "inç",
    "inc": "inç",
    "pa": "pa",
    "db": "db",
    "saat": "saat",
    "w": "w",
    "watt": "w",
    "hz": "hz",
    "mah": "mah",
    "mp": "mp",
}

_UNIT_MEASUREMENT_PATTERN = re.compile(
    r"(?<!\w)(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*"
    r"(gb|tb|mb|kg|kilogram|kilo|gram|gr|g|ml|litre|lt|l|cm|mm|in[çc]|pa|db|saat|watt|w|hz|mah|mp)\b"
)

_SIZE_EXPLICIT_PATTERN = re.compile(r"(?<!\w)(\d{2})\s*(?:numara|no)\b")

_WORD_ONES: dict[str, int] = {
    "bir": 1,
    "iki": 2,
    "üç": 3,
    "uc": 3,
    "dört": 4,
    "dort": 4,
    "beş": 5,
    "bes": 5,
    "altı": 6,
    "alti": 6,
    "yedi": 7,
    "sekiz": 8,
    "dokuz": 9,
}

_WORD_TENS: dict[str, int] = {
    "on": 10,
    "yirmi": 20,
    "otuz": 30,
    "kırk": 40,
    "kirk": 40,
    "elli": 50,
    "altmış": 60,
    "altmis": 60,
    "yetmiş": 70,
    "yetmis": 70,
    "seksen": 80,
    "doksan": 90,
}

_SCALE_WORDS = {"yüz": 100, "yuz": 100, "bin": 1000}

_NUM_REGEX = r"(?:\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)"
_MULTIPLIER_REGEX = r"(?:\s*(?:bin[ie]?(?:den|de|e|i)?))"
_NUMBER_WORD_SEQ = (
    r"(?:on|yirmi|otuz|k[ıi]rk|elli|altm[ıi][şs]|yetmi[şs]|seksen|doksan|"
    r"y[üu]z|bir|iki|[üu][çc]|d[öo]rt|be[şs]|alt[ıi]|yedi|sekiz|dokuz)"
    r"(?:\s+(?:on|yirmi|otuz|k[ıi]rk|elli|altm[ıi][şs]|yetmi[şs]|seksen|doksan|"
    r"y[üu]z|bir|iki|[üu][çc]|d[öo]rt|be[şs]|alt[ıi]|yedi|sekiz|dokuz))*"
)
_PRICE_ATOM_REGEX = (
    rf"(?:{_NUM_REGEX}(?:{_MULTIPLIER_REGEX})?"
    rf"|{_NUMBER_WORD_SEQ}\s+bin(?:[ie]?(?:den|de|e|i)?)?(?:\s+{_NUMBER_WORD_SEQ})?"
    rf"|{_NUMBER_WORD_SEQ}\s+y[üu]z)"
)

_RANGE_PRICE_PATTERN = re.compile(
    rf"({_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?\s*(?:-|ile)\s*"
    rf"({_PRICE_ATOM_REGEX})(?:\s+aras[ıi])?(?:\s*(?:tl|lira))?"
)
_DUAL_NEG_LOWER_PATTERN = re.compile(
    rf"({_PRICE_ATOM_REGEX})\s*(?:tl|lira)?\s*(?:alt[ıi]\s*(?:da\s*)?olmas[ıi]n|den\s*az\s*olmas[ıi]n|dan\s*az\s*olmas[ıi]n)"
)
_UPPER_PRICE_PATTERN = re.compile(
    rf"(?:"
    rf"(?P<val1>{_PRICE_ATOM_REGEX})\s*(?:tl|lira)?(?:\s*(?:ye|ya|e|a))?\s*(?P<op1>alt[ıi](?:nda)?|den\s*ucuz|dan\s*ucuz|den\s*az|dan\s*az|dan\s*d[üu][şs][üu]k|den\s*d[üu][şs][üu]k|ge[çc]mesin|kadar|alt[ıi])"
    rf"|en\s+(?P<op2>fazla|[çc]ok)\s+(?P<val2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|maksimum\s+(?P<val3>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|b[üu]t[çc]e\s+(?P<val4>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf")"
)
_LOWER_PRICE_PATTERN = re.compile(
    rf"(?:"
    rf"(?P<val1>{_PRICE_ATOM_REGEX})\s*(?:tl|lira)?\s*(?P<op1>[üu]st[üu](?:nde)?|üzeri(?:nde)?|den\s*y[üu]ksek|dan\s*y[üu]ksek|dan\s*pahalı|den\s*pahalı|den\s*fazla|dan\s*fazla)"
    rf"|en\s+az\s+(?P<val2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|minimum\s+(?P<val3>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf")"
)
_APPROX_PRICE_PATTERN = re.compile(
    rf"(?:"
    rf"(?P<val1>{_PRICE_ATOM_REGEX})\s*(?:tl|lira)?\s*(?:civar[ıi](?:nda)?|gibi|dolaylar[ıi](?:nda)?|yakla[şs][ıi]k)"
    rf"|yakla[şs][ıi]k\s+(?P<val2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf")"
)


@dataclass(frozen=True)
class UnitMeasurement:
    """Extracted technical/physical measurement kept strictly out of currency bounds."""

    value: Decimal
    unit: str
    raw_span: str
    start: int
    end: int


@dataclass(frozen=True)
class PriceExtractionResult:
    """Deterministic price parsing output with strict operator semantics and conflict flags."""

    price: PriceValue | None
    operator: Literal["lte", "gte", "between"] | None
    strict_upper: bool
    strict_lower: bool
    modality: ModalityKind
    display_label: str | None
    source_span: str | None
    consumed_spans: tuple[tuple[int, int], ...]
    measurements: tuple[UnitMeasurement, ...]
    entity_consumed_spans: tuple[tuple[int, int], ...] = ()
    conflict_message: str | None = None
    warning: str | None = None


def _overlaps_any(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(not (end <= sp_start or start >= sp_end) for sp_start, sp_end in spans)


def _protected_to_tuples(protected: tuple[ProtectedSpan, ...]) -> list[tuple[int, int]]:
    return [(sp.start, sp.end) for sp in protected]


def _parse_numeric_token(raw_num: str) -> Decimal | None:
    cleaned = raw_num.strip()
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", cleaned):
        cleaned = cleaned.replace(".", "")
    elif "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    if not value.is_finite() or value < Decimal("0"):
        return None
    return value


def _parse_turkish_word_number(words: list[str]) -> Decimal | None:
    if not words:
        return None
    total = Decimal("0")
    current = Decimal("0")
    matched_any = False

    for word in words:
        base = re.sub(r"^(bin).*$", r"\1", word) if word.startswith("bin") else word
        if base in _WORD_ONES:
            current += Decimal(_WORD_ONES[base])
            matched_any = True
        elif base in _WORD_TENS:
            current += Decimal(_WORD_TENS[base])
            matched_any = True
        elif base in {"yüz", "yuz"}:
            current = (current if current > 0 else Decimal("1")) * Decimal("100")
            matched_any = True
        elif base == "bin":
            total += (current if current > 0 else Decimal("1")) * Decimal("1000")
            current = Decimal("0")
            matched_any = True
        else:
            return None

    return total + current if matched_any else None


def _parse_price_atom(raw_atom: str) -> tuple[Decimal | None, bool]:
    """Return `(amount, had_explicit_bin_multiplier)` for digit or Turkish word number."""
    cleaned = raw_atom.strip()
    if not cleaned:
        return None, False

    has_bin = bool(re.search(r"\bbin[ie]?(?:den|de|e|i)?\b", cleaned))
    digit_match = re.match(rf"^({_NUM_REGEX})(.*)$", cleaned)
    if digit_match:
        base_val = _parse_numeric_token(digit_match.group(1))
        if base_val is None:
            return None, False
        if has_bin:
            base_val *= Decimal("1000")
        return base_val, has_bin

    word_val = _parse_turkish_word_number(cleaned.split())
    return word_val, has_bin


def extract_unit_measurements(
    text: str,
    *,
    excluded_spans: list[tuple[int, int]],
) -> tuple[list[UnitMeasurement], list[tuple[int, int]]]:
    """Extract measurements (GB, kg, saat, inç, Hz, mAh, ml) and mark their spans consumed."""
    measurements: list[UnitMeasurement] = []
    consumed = list(excluded_spans)

    for match in _UNIT_MEASUREMENT_PATTERN.finditer(text):
        if _overlaps_any(match.start(), match.end(), consumed):
            continue
        parsed_val = _parse_numeric_token(match.group(1))
        unit_norm = _UNIT_CANONICAL_MAP.get(match.group(2).lower())
        if parsed_val is None or unit_norm is None:
            continue
        measurements.append(
            UnitMeasurement(
                value=parsed_val,
                unit=unit_norm,
                raw_span=match.group(0),
                start=match.start(),
                end=match.end(),
            )
        )
        consumed.append((match.start(), match.end()))

    return measurements, consumed


def extract_price_and_units(norm: NormalizationResult) -> PriceExtractionResult:
    """Parse prices, ranges, compound bounds, and non-price unit spans deterministically."""
    text = norm.canonical_for_matching
    if not text:
        return PriceExtractionResult(
            price=None,
            operator=None,
            strict_upper=False,
            strict_lower=False,
            modality="required",
            display_label=None,
            source_span=None,
            consumed_spans=(),
            measurements=(),
        )

    excluded = _protected_to_tuples(norm.protected_spans)
    measurements, consumed = extract_unit_measurements(text, excluded_spans=excluded)
    size_spans: set[tuple[int, int]] = set()

    for size_match in _SIZE_EXPLICIT_PATTERN.finditer(text):
        if not _overlaps_any(size_match.start(), size_match.end(), consumed):
            span = (size_match.start(), size_match.end())
            consumed.append(span)
            size_spans.add(span)

    min_bound: Decimal | None = None
    max_bound: Decimal | None = None
    strict_lower = False
    strict_upper = False
    modality: ModalityKind = "required"
    price_spans: list[tuple[int, int]] = []
    matched_texts: list[str] = []
    warning_msg: str | None = None

    # 1. Explicit dual range e.g. '1500-3000', '20-30 bin', '20 ile 30 bin arası'
    range_match = _RANGE_PRICE_PATTERN.search(text)
    if range_match and not _overlaps_any(range_match.start(), range_match.end(), consumed):
        low_raw, high_raw = range_match.group(1), range_match.group(2)
        low_val, low_bin = _parse_price_atom(low_raw)
        high_val, high_bin = _parse_price_atom(high_raw)
        if low_val is not None and high_val is not None:
            # Propagate multiplier in shorthand ranges like '20-30 bin' -> 20000-30000
            if (
                high_bin
                and not low_bin
                and low_val < Decimal("1000")
                and high_val >= Decimal("1000")
            ):
                low_val *= Decimal("1000")
            min_bound = low_val
            max_bound = high_val
            price_spans.append((range_match.start(), range_match.end()))
            consumed.append((range_match.start(), range_match.end()))
            matched_texts.append(range_match.group(0))

    # 2. Negative phrasing forming lower bound: '1500 altı da olmasın' => >= 1500
    for neg_lower in _DUAL_NEG_LOWER_PATTERN.finditer(text):
        if _overlaps_any(neg_lower.start(), neg_lower.end(), consumed):
            continue
        val, _ = _parse_price_atom(neg_lower.group(1))
        if val is not None:
            min_bound = val if min_bound is None else max(min_bound, val)
            price_spans.append((neg_lower.start(), neg_lower.end()))
            consumed.append((neg_lower.start(), neg_lower.end()))
            matched_texts.append(neg_lower.group(0))

    # 3. Upper bounds ('3000 altı', '3 bini geçmesin', 'en fazla 3000', '4500 e kadar')
    for upper in _UPPER_PRICE_PATTERN.finditer(text):
        if _overlaps_any(upper.start(), upper.end(), consumed):
            continue
        raw_val = (
            upper.group("val1") or upper.group("val2") or upper.group("val3") or upper.group("val4")
        )
        if raw_val is None:
            continue
        val, _ = _parse_price_atom(raw_val)
        if val is None:
            continue
        op_token = upper.group("op1") or ""
        if (
            op_token.startswith("alt")
            or "ucuz" in op_token
            or "az" in op_token
            or "düşük" in op_token
        ):
            strict_upper = True
        max_bound = val if max_bound is None else min(max_bound, val)
        price_spans.append((upper.start(), upper.end()))
        consumed.append((upper.start(), upper.end()))
        matched_texts.append(upper.group(0))

    # 4. Lower bounds ('2000 üstü', 'en az 1500', '1500 den fazla')
    for lower in _LOWER_PRICE_PATTERN.finditer(text):
        if _overlaps_any(lower.start(), lower.end(), consumed):
            continue
        raw_val = lower.group("val1") or lower.group("val2") or lower.group("val3")
        if raw_val is None:
            continue
        val, _ = _parse_price_atom(raw_val)
        if val is None:
            continue
        op_token = lower.group("op1") or ""
        if (
            op_token.startswith("üst")
            or op_token.startswith("üzeri")
            or "yüksek" in op_token
            or "fazla" in op_token
        ):
            strict_lower = True
        min_bound = val if min_bound is None else max(min_bound, val)
        price_spans.append((lower.start(), lower.end()))
        consumed.append((lower.start(), lower.end()))
        matched_texts.append(lower.group(0))

    # 5. Approximate phrases ('3000 civarı') when no strict bounds matched
    if min_bound is None and max_bound is None:
        approx = _APPROX_PRICE_PATTERN.search(text)
        if approx and not _overlaps_any(approx.start(), approx.end(), consumed):
            raw_val = approx.group("val1") or approx.group("val2")
            val, _ = _parse_price_atom(raw_val) if raw_val else (None, False)
            if val is not None and val > Decimal("0"):
                min_bound = (val * Decimal("0.8")).quantize(Decimal("1"))
                max_bound = (val * Decimal("1.2")).quantize(Decimal("1"))
                modality = "approximate"
                price_spans.append((approx.start(), approx.end()))
                consumed.append((approx.start(), approx.end()))
                matched_texts.append(approx.group(0))
                warning_msg = "Yaklaşık fiyat ifadesi ±%20 aralığa çevrildi."

    entity_consumed = tuple(sp for sp in consumed if sp not in size_spans)

    if min_bound is None and max_bound is None:
        return PriceExtractionResult(
            price=None,
            operator=None,
            strict_upper=False,
            strict_lower=False,
            modality=modality,
            display_label=None,
            source_span=None,
            consumed_spans=tuple(consumed),
            measurements=tuple(measurements),
            entity_consumed_spans=entity_consumed,
        )

    # Guard against inverted contradiction (`min > max`) without crashing or dropping signal
    if min_bound is not None and max_bound is not None and min_bound > max_bound:
        return PriceExtractionResult(
            price=None,
            operator=None,
            strict_upper=strict_upper,
            strict_lower=strict_lower,
            modality=modality,
            display_label=None,
            source_span=" | ".join(matched_texts),
            consumed_spans=tuple(consumed),
            measurements=tuple(measurements),
            entity_consumed_spans=entity_consumed,
            conflict_message=(
                f"Çelişkili fiyat aralığı: alt sınır ({int(min_bound)} TL) üst sınırdan "
                f"({int(max_bound)} TL) büyük olamaz."
            ),
        )

    effective_min = Decimal("0") if min_bound is None and max_bound is not None else min_bound
    price_obj = PriceValue(min_amount=effective_min, max_amount=max_bound)
    if effective_min is not None and max_bound is not None:
        op: Literal["lte", "gte", "between"] = "between" if min_bound is not None else "lte"
        label = f"{int(effective_min)}-{int(max_bound)} TL"
    elif min_bound is not None:
        op = "gte"
        label = f"{int(min_bound)}+ TL"
    else:
        raise ValueError("PriceExtractionResult must carry at least one bound")

    if modality == "approximate":
        label = f"~{label}"

    return PriceExtractionResult(
        price=price_obj,
        operator=op,
        strict_upper=strict_upper,
        strict_lower=strict_lower,
        modality=modality,
        display_label=label,
        source_span=" | ".join(matched_texts) if matched_texts else None,
        consumed_spans=tuple(consumed),
        measurements=tuple(measurements),
        entity_consumed_spans=entity_consumed,
        warning=warning_msg,
    )
