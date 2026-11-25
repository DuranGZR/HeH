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
    "inch": "inç",
    "pa": "pa",
    "db": "db",
    "saat": "saat",
    "sa": "saat",
    "w": "w",
    "watt": "w",
    "vat": "w",
    "hz": "hz",
    "mah": "mah",
    "mp": "mp",
}

_UNIT_MEASUREMENT_PATTERN = re.compile(
    r"(?<!\w)(\d{1,3}(?:\.\d{3})+,\d+|\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*"
    r"(gb|tb|mb|kg|kilogram|kilo|gram|gr|g|ml|litre|lt|l|cm|mm|in[çc]|inch|pa|db|saat|sa|watt|vat|w|hz|mah|mp)\b"
)

_SIZE_EXPLICIT_PATTERN = re.compile(r"(?<!\w)(\d{2}(?:[.,]5)?)\s*(?:numara|no)\b")
_AGE_SIZE_PATTERN = re.compile(r"(?<!\w)\d{1,2}\s*-\s*\d{1,2}\s*ya[şs]\b|\b\d{1,2}\s*ya[şs]\b")
_PERCENT_PATTERN = re.compile(
    r"(?:\by[üu]zde\s+\d+(?:[.,]\d+)?|%\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*%)\b"
)

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

_SCALE_WORDS = {"yüz": 100, "yuz": 100, "bin": 1000, "milyon": 1000000}

_NUM_REGEX = r"(?:\d{1,3}(?:\.\d{3})+,\d+|\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)"
_MULTIPLIER_REGEX = r"(?:\s*(?:bin[ie]?(?:den|de|e|i)?|milyon[au]?))"
_NUMBER_WORD_SEQ = (
    r"(?:on|yirmi|otuz|k[ıi]rk|elli|altm[ıi][şs]|yetmi[şs]|seksen|doksan|"
    r"y[üu]z|bir|iki|[üu][çc]|d[öo]rt|be[şs]|alt[ıi]|yedi|sekiz|dokuz)"
    r"(?:\s+(?:on|yirmi|otuz|k[ıi]rk|elli|altm[ıi][şs]|yetmi[şs]|seksen|doksan|"
    r"y[üu]z|bir|iki|[üu][çc]|d[öo]rt|be[şs]|alt[ıi]|yedi|sekiz|dokuz))*"
)
_PRICE_ATOM_REGEX = (
    rf"(?:{_NUM_REGEX}(?:{_MULTIPLIER_REGEX})?"
    rf"|\b(?:{_NUMBER_WORD_SEQ}\s+)?(?:milyon|bin(?:[ie]?(?:den|de|e|i)?)?|y[üu]z)"
    rf"(?:\s+(?!{_NUMBER_WORD_SEQ}\s+(?:bin|milyon)\b){_NUMBER_WORD_SEQ})?)"
)

_NEGATIVE_PRICE_VALUE_PATTERN = re.compile(r"(?:^|\s)-\s*\d+(?:[.,]\d+)?\s*(?:tl|lira)\b")
_CASE_SUFFIX_RE = r"(?:nın|nin|nun|nün|ın|in|un|ün|ye|ya|yi|yı|yu|yü|den|dan|ten|tan|e|a|i|ı|u|ü)"
_RANGE_PRICE_PATTERN = re.compile(
    rf"(?:"
    rf"(?P<low1>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?\s*(?:-|ile)\s*"
    rf"(?P<high1>{_PRICE_ATOM_REGEX})(?:\s+aras[ıi](?:nda)?)?(?:\s*(?:tl|lira))?"
    rf"|(?P<low2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?(?:\s+(?:den|dan|ten|tan))\s+"
    rf"(?P<high2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?(?:\s+(?:e|a|ye|ya))?\s*kadar\b"
    rf"|(?P<low3>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?\s+"
    rf"(?P<high3>{_PRICE_ATOM_REGEX})\s+aras[ıi](?:nda)?(?:\s*(?:tl|lira))?"
    rf")"
)
_DUAL_NEG_LOWER_PATTERN = re.compile(
    rf"({_PRICE_ATOM_REGEX})\s*(?:tl|lira)?(?:\s*{_CASE_SUFFIX_RE})?\s*"
    rf"(?:alt[ıi](?:nda)?(?:\s+(?:da|de))?\s*(?:olmas[ıi]n|olmayan|istemiyorum|de[ğg]il)"
    rf"|(?:(?:den|dan|ten|tan)\s*)?az\s*(?:da|de)?\s*(?:olmas[ıi]n|olmayan|istemiyorum|de[ğg]il))\b"
)
_DUAL_NEG_UPPER_PATTERN = re.compile(
    rf"({_PRICE_ATOM_REGEX})\s*(?:tl|lira)?(?:\s*{_CASE_SUFFIX_RE})?\s*"
    rf"(?:[üu]st[üu](?:nde)?|[üu]zeri(?:nde)?|(?:(?:den|dan|ten|tan)\s*)?(?:fazla|y[üu]ksek|pahal[ıi]))"
    rf"\s*(?:(?:da|de)\s*)?(?:olmas[ıi]n|olmayan|istemiyorum|de[ğg]il)\b"
)
_UPPER_PRICE_PATTERN = re.compile(
    rf"(?:"
    rf"(?P<val1>{_PRICE_ATOM_REGEX})\s*(?:tl|lira)?(?:\s*{_CASE_SUFFIX_RE})?\s*"
    rf"(?P<op1>alt[ıi](?:nda)?|(?:(?:den|dan|ten|tan)\s*)?ucuz|(?:(?:den|dan|ten|tan)\s*)?az|"
    rf"(?:(?:den|dan|ten|tan)\s*)?d[üu][şs][üu]k|ge[çc]mesin|kadar)\b"
    rf"|en\s+(?P<op2>fazla|[çc]ok)\s+(?P<val2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|(?:maksimum|max)\s+(?P<val3>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|b[üu]t[çc]e(?:m)?\s+(?P<val4>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|(?P<val5>{_PRICE_ATOM_REGEX})\s*(?:tl|lira)?\s*b[üu]t[çc]e(?:m(?:\s+var)?)?"
    rf")"
)
_LOWER_PRICE_PATTERN = re.compile(
    rf"(?:"
    rf"(?P<val1>{_PRICE_ATOM_REGEX})\s*(?:tl|lira)?(?:\s*{_CASE_SUFFIX_RE})?\s*"
    rf"(?P<op1>[üu]st[üu](?:nde)?|[üu]zeri(?:nde)?|(?:(?:den|dan|ten|tan)\s*)?y[üu]ksek|"
    rf"(?:(?:den|dan|ten|tan)\s*)?pahal[ıi]|(?:(?:den|dan|ten|tan)\s*)?fazla)\b"
    rf"|en\s+az\s+(?P<val2>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf"|minimum\s+(?P<val3>{_PRICE_ATOM_REGEX})(?:\s*(?:tl|lira))?"
    rf")"
)
_WORD_UNIT_MEASUREMENT_PATTERN = re.compile(
    rf"(?<!\w)(?P<num>(?:{_NUMBER_WORD_SEQ}(?:\s+bu[çc]uk)?|\d+(?:[.,]\d+)?\s+bu[çc]uk))\s+"
    r"(?P<unit>gb|tb|mb|kg|kilogram|kilo|gram|gr|ml|litre|lt|cm|mm|in[çc]|inch|pa|db|saat|watt|vat|hz|mah|mp)\b"
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
        elif base == "milyon":
            total += (current if current > 0 else Decimal("1")) * Decimal("1000000")
            current = Decimal("0")
            matched_any = True
        else:
            return None

    return total + current if matched_any else None


def _format_try_number(amount: Decimal) -> str:
    fixed = format(amount.normalize(), "f")
    if "." in fixed:
        fixed = fixed.rstrip("0").rstrip(".")
    return fixed.replace(".", ",")


def _parse_price_atom(
    raw_atom: str, *, has_currency_hint: bool = False
) -> tuple[Decimal | None, bool]:
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

    word_list = cleaned.split()
    if word_list in (["yüz"], ["yuz"]) and not has_currency_hint:
        return None, False
    word_val = _parse_turkish_word_number(word_list)
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

    for match in _WORD_UNIT_MEASUREMENT_PATTERN.finditer(text):
        if _overlaps_any(match.start(), match.end(), consumed):
            continue
        raw_num = match.group("num").strip()
        unit_norm = _UNIT_CANONICAL_MAP.get(match.group("unit").lower())
        if unit_norm is None:
            continue
        has_half = False
        if raw_num.endswith("buçuk") or raw_num.endswith("bucuk"):
            has_half = True
            raw_num = re.sub(r"\s+bu[çc]uk$", "", raw_num).strip()
        parsed_val = (
            _parse_numeric_token(raw_num)
            if re.match(r"^\d", raw_num)
            else _parse_turkish_word_number(raw_num.split())
        )
        if parsed_val is None:
            continue
        if has_half:
            parsed_val += Decimal("0.5")
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

    measurements.sort(key=lambda m: m.start)
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

    for age_match in _AGE_SIZE_PATTERN.finditer(text):
        if not _overlaps_any(age_match.start(), age_match.end(), consumed):
            span = (age_match.start(), age_match.end())
            consumed.append(span)
            size_spans.add(span)

    for pct_match in _PERCENT_PATTERN.finditer(text):
        if not _overlaps_any(pct_match.start(), pct_match.end(), consumed):
            consumed.append((pct_match.start(), pct_match.end()))

    min_bound: Decimal | None = None
    max_bound: Decimal | None = None
    strict_lower = False
    strict_upper = False
    modality: ModalityKind = "required"
    matched_texts: list[str] = []
    warning_msg: str | None = None
    conflict_msg: str | None = None

    # Ignore spaced hyphen inside valid bounds like '1500 - 3000 TL' when flagging negative prices
    range_spans = [(m.start(), m.end()) for m in _RANGE_PRICE_PATTERN.finditer(text)]
    for neg_num_match in _NEGATIVE_PRICE_VALUE_PATTERN.finditer(text):
        if _overlaps_any(neg_num_match.start(), neg_num_match.end(), consumed):
            continue
        inside_valid_range = any(
            r_start <= neg_num_match.start() and neg_num_match.end() <= r_end
            for r_start, r_end in range_spans
        )
        if inside_valid_range:
            continue
        return PriceExtractionResult(
            price=None,
            operator=None,
            strict_upper=False,
            strict_lower=False,
            modality=modality,
            display_label=None,
            source_span=neg_num_match.group(0).strip(),
            consumed_spans=tuple(consumed),
            measurements=tuple(measurements),
            entity_consumed_spans=tuple(sp for sp in consumed if sp not in size_spans),
            conflict_message="Negatif fiyat sınırı geçerli değil.",
        )

    # 1. Explicit dual range(s) e.g. '1500-3000', '20-30 bin', 'yirmi bin otuz bin arası'
    for range_match in _RANGE_PRICE_PATTERN.finditer(text):
        if _overlaps_any(range_match.start(), range_match.end(), consumed):
            continue
        low_raw = (
            range_match.group("low1") or range_match.group("low2") or range_match.group("low3")
        )
        high_raw = (
            range_match.group("high1") or range_match.group("high2") or range_match.group("high3")
        )
        if low_raw is None or high_raw is None:
            continue
        has_tl_hint = bool(re.search(r"\b(?:tl|lira)\b", range_match.group(0)))
        low_val, low_bin = _parse_price_atom(low_raw, has_currency_hint=has_tl_hint)
        high_val, high_bin = _parse_price_atom(high_raw, has_currency_hint=has_tl_hint)
        if low_val is not None and high_val is not None:
            if (
                high_bin
                and not low_bin
                and low_val < Decimal("1000")
                and high_val >= Decimal("1000")
            ):
                low_val *= Decimal("1000")
            min_bound = low_val if min_bound is None else max(min_bound, low_val)
            max_bound = high_val if max_bound is None else min(max_bound, high_val)
            if min_bound > max_bound:
                conflict_msg = (
                    f"Çelişkili fiyat aralığı: alt sınır ({_format_try_number(min_bound)} TL) "
                    f"üst sınırdan ({_format_try_number(max_bound)} TL) büyük olamaz."
                )
            consumed.append((range_match.start(), range_match.end()))
            matched_texts.append(range_match.group(0))

    # 2a. Negative phrasing forming lower bound: '1500 altı da olmasın' => >= 1500
    for neg_lower in _DUAL_NEG_LOWER_PATTERN.finditer(text):
        if _overlaps_any(neg_lower.start(), neg_lower.end(), consumed):
            continue
        val, _ = _parse_price_atom(
            neg_lower.group(1),
            has_currency_hint=bool(re.search(r"\b(?:tl|lira)\b", neg_lower.group(0))),
        )
        if val is not None:
            if min_bound is None or val > min_bound:
                strict_lower = False
            min_bound = val if min_bound is None else max(min_bound, val)
            consumed.append((neg_lower.start(), neg_lower.end()))
            matched_texts.append(neg_lower.group(0))

    # 2b. Negative phrasing forming upper bound: '3500 den fazla olmasın' => <= 3500
    for neg_upper in _DUAL_NEG_UPPER_PATTERN.finditer(text):
        if _overlaps_any(neg_upper.start(), neg_upper.end(), consumed):
            continue
        val, _ = _parse_price_atom(
            neg_upper.group(1),
            has_currency_hint=bool(re.search(r"\b(?:tl|lira)\b", neg_upper.group(0))),
        )
        if val is not None:
            if max_bound is None or val < max_bound:
                strict_upper = False
            max_bound = val if max_bound is None else min(max_bound, val)
            consumed.append((neg_upper.start(), neg_upper.end()))
            matched_texts.append(neg_upper.group(0))

    # 3. Upper bounds ('3000 altı', '3 bini geçmesin', '3000 i geçmesin', '4500 e kadar')
    for upper in _UPPER_PRICE_PATTERN.finditer(text):
        if _overlaps_any(upper.start(), upper.end(), consumed):
            continue
        raw_val = (
            upper.group("val1")
            or upper.group("val2")
            or upper.group("val3")
            or upper.group("val4")
            or upper.group("val5")
        )
        if raw_val is None:
            continue
        val, _ = _parse_price_atom(
            raw_val,
            has_currency_hint=bool(re.search(r"\b(?:tl|lira|b[üu]t[çc]e)\b", upper.group(0))),
        )
        if val is None:
            continue
        op_token = upper.group("op1") or ""
        new_strict_upper = (
            op_token.startswith("alt")
            or "ucuz" in op_token
            or "az" in op_token
            or "düşük" in op_token
            or "dusuk" in op_token
        )
        if max_bound is None or val < max_bound:
            max_bound = val
            strict_upper = new_strict_upper
        elif val == max_bound:
            strict_upper = strict_upper or new_strict_upper
        consumed.append((upper.start(), upper.end()))
        matched_texts.append(upper.group(0))

    # 4. Lower bounds ('2000 üstü', 'en az 1500', '1500 den fazla')
    for lower in _LOWER_PRICE_PATTERN.finditer(text):
        if _overlaps_any(lower.start(), lower.end(), consumed):
            continue
        raw_val = lower.group("val1") or lower.group("val2") or lower.group("val3")
        if raw_val is None:
            continue
        val, _ = _parse_price_atom(
            raw_val,
            has_currency_hint=bool(re.search(r"\b(?:tl|lira)\b", lower.group(0))),
        )
        if val is None:
            continue
        op_token = lower.group("op1") or ""
        new_strict_lower = (
            op_token.startswith("üst")
            or op_token.startswith("ust")
            or op_token.startswith("üzeri")
            or op_token.startswith("uzeri")
            or "yüksek" in op_token
            or "yuksek" in op_token
            or "pahalı" in op_token
            or "pahali" in op_token
            or "fazla" in op_token
        )
        if min_bound is None or val > min_bound:
            min_bound = val
            strict_lower = new_strict_lower
        elif val == min_bound:
            strict_lower = strict_lower or new_strict_lower
        consumed.append((lower.start(), lower.end()))
        matched_texts.append(lower.group(0))

    # 5. Approximate phrases ('3000 civarı', 'yaklaşık 20 bin') when no strict bounds matched
    if min_bound is None and max_bound is None:
        approx = _APPROX_PRICE_PATTERN.search(text)
        if approx and not _overlaps_any(approx.start(), approx.end(), consumed):
            raw_val = approx.group("val1") or approx.group("val2")
            val, _ = _parse_price_atom(raw_val) if raw_val else (None, False)
            if val is not None and val > Decimal("0"):
                min_bound = (val * Decimal("0.8")).quantize(Decimal("1"))
                max_bound = (val * Decimal("1.2")).quantize(Decimal("1"))
                modality = "approximate"
                consumed.append((approx.start(), approx.end()))
                matched_texts.append(approx.group(0))
                warning_msg = "Yaklaşık fiyat ifadesi ±%20 aralığa çevrildi."

    entity_consumed = tuple(sp for sp in consumed if sp not in size_spans)

    if conflict_msg or (min_bound is not None and max_bound is not None and min_bound > max_bound):
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
            conflict_message=conflict_msg
            or (
                f"Çelişkili fiyat aralığı: alt sınır "
                f"({_format_try_number(min_bound or Decimal(0))} TL) "
                f"üst sınırdan ({_format_try_number(max_bound or Decimal(0))} TL) büyük olamaz."
            ),
        )

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

    effective_min = Decimal("0") if min_bound is None and max_bound is not None else min_bound
    price_obj = PriceValue(
        min_amount=effective_min,
        max_amount=max_bound,
        min_inclusive=True if min_bound is None else not strict_lower,
        max_inclusive=True if max_bound is None else not strict_upper,
    )
    if effective_min is not None and max_bound is not None:
        op: Literal["lte", "gte", "between"] = "between" if min_bound is not None else "lte"
        label = f"{_format_try_number(effective_min)}-{_format_try_number(max_bound)} TL"
    elif min_bound is not None:
        op = "gte"
        label = f"{_format_try_number(min_bound)}+ TL"
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
