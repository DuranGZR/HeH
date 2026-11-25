"""D18 Core dictionary, multiword alias matcher, and showcase category router."""

import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from heh_api.infrastructure.nlp.rules.normalize import NormalizationResult

EntityKind = Literal["category", "brand", "color", "size", "attribute"]


class CategoryAliasConfig(BaseModel):
    """Dictionary config for a canonical category independent of Trendyol IDs."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    canonical_key: str
    ontology_id: str
    display_name: str
    showcase: bool
    size_system: Literal["none", "clothing", "footwear"]
    aliases: tuple[str, ...] = Field(min_length=1)


class NamedAliasConfig(BaseModel):
    """Canonical entity entry with Turkish aliases."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    canonical_key: str
    display_label: str
    aliases: tuple[str, ...] = Field(min_length=1)
    color_ambiguous: bool = False


class AliasDictionaryV1(BaseModel):
    """Validated versioned ontology alias dictionary loaded from YAML."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: str
    categories: tuple[CategoryAliasConfig, ...] = Field(min_length=1)
    brands: tuple[NamedAliasConfig, ...] = Field(min_length=1)
    colors: tuple[NamedAliasConfig, ...] = Field(min_length=1)
    clothing_sizes: tuple[NamedAliasConfig, ...] = Field(min_length=1)
    footwear_sizes: tuple[str, ...] = Field(min_length=1)
    attributes: tuple[NamedAliasConfig, ...] = Field(min_length=1)


@dataclass(frozen=True)
class EntityMention:
    """Single matched canonical entity span preserving character offsets for Boolean scope."""

    kind: EntityKind
    canonical_key: str
    display_label: str
    start: int
    end: int
    raw_span: str
    showcase_supported: bool = True


@dataclass(frozen=True)
class EntityExtractionResult:
    """Deterministic entity + category routing output prior to logic grouping."""

    category: CategoryAliasConfig | None
    mentions: tuple[EntityMention, ...]


@lru_cache(maxsize=1)
def load_alias_dictionary() -> AliasDictionaryV1:
    """Load and validate versioned YAML ontology aliases once at startup."""
    raw_yaml = (
        resources.files("heh_api.data.ontology")
        .joinpath("aliases.v1.yaml")
        .read_text(encoding="utf-8")
    )
    loaded = yaml.safe_load(raw_yaml)
    return AliasDictionaryV1.model_validate(loaded)


def _span_overlaps(start: int, end: int, occupied: list[tuple[int, int]]) -> bool:
    return any(not (end <= sp_start or start >= sp_end) for sp_start, sp_end in occupied)


def _find_alias_matches(text: str, alias: str) -> list[re.Match[str]]:
    pattern = re.compile(rf"(?<!\w){re.escape(alias)}(?!\w)")
    return list(pattern.finditer(text))


def _select_best_category(
    text: str,
    categories: tuple[CategoryAliasConfig, ...],
) -> tuple[CategoryAliasConfig | None, tuple[int, int] | None]:
    best: tuple[int, bool, int, CategoryAliasConfig, tuple[int, int]] | None = None
    for cat in categories:
        for alias in cat.aliases:
            for match in _find_alias_matches(text, alias):
                score = (len(alias), cat.showcase, -match.start())
                if best is None or score > best[:3]:
                    best = (*score, cat, (match.start(), match.end()))
    if best is None:
        return None, None
    return best[3], best[4]


def _extract_clothing_sizes(
    text: str,
    dictionary: AliasDictionaryV1,
    occupied: list[tuple[int, int]],
    *,
    category: CategoryAliasConfig | None,
) -> list[EntityMention]:
    mentions: list[EntityMention] = []
    # Multi-letter sizes (`xs`, `xl`, `xxl`) match directly; single-letter (`s`, `m`, `l`)
    # require explicit size context or apparel category so `1 l` / ordinary letters never collide.
    for size_cfg in sorted(
        dictionary.clothing_sizes, key=lambda c: len(c.canonical_key), reverse=True
    ):
        is_single_letter = len(size_cfg.canonical_key) == 1
        for alias in size_cfg.aliases:
            explicit_pattern = re.compile(
                rf"(?<!\w)({re.escape(alias)})\s+beden\b|\bbeden\s+({re.escape(alias)})(?!\w)"
            )
            for match in explicit_pattern.finditer(text):
                if _span_overlaps(match.start(), match.end(), occupied):
                    continue
                occupied.append((match.start(), match.end()))
                mentions.append(
                    EntityMention(
                        kind="size",
                        canonical_key=size_cfg.canonical_key,
                        display_label=size_cfg.display_label,
                        start=match.start(),
                        end=match.end(),
                        raw_span=match.group(0),
                    )
                )

            if is_single_letter and (category is None or category.size_system != "clothing"):
                continue

            if not is_single_letter or (
                category is not None and category.size_system == "clothing"
            ):
                for match in _find_alias_matches(text, alias):
                    if _span_overlaps(match.start(), match.end(), occupied):
                        continue
                    mentions.append(
                        EntityMention(
                            kind="size",
                            canonical_key=size_cfg.canonical_key,
                            display_label=size_cfg.display_label,
                            start=match.start(),
                            end=match.end(),
                            raw_span=match.group(0),
                        )
                    )
                    occupied.append((match.start(), match.end()))
    return mentions


def _extract_footwear_sizes(
    text: str,
    dictionary: AliasDictionaryV1,
    occupied: list[tuple[int, int]],
    *,
    category: CategoryAliasConfig | None,
) -> list[EntityMention]:
    mentions: list[EntityMention] = []
    footwear_set = set(dictionary.footwear_sizes)

    explicit_pattern = re.compile(r"(?<!\w)(\d{2})\s*(?:numara|no)\b")
    for match in explicit_pattern.finditer(text):
        size_token = match.group(1)
        if size_token not in footwear_set or _span_overlaps(match.start(), match.end(), occupied):
            continue
        occupied.append((match.start(), match.end()))
        mentions.append(
            EntityMention(
                kind="size",
                canonical_key=size_token,
                display_label=size_token,
                start=match.start(),
                end=match.end(),
                raw_span=match.group(0),
            )
        )

    if category is not None and category.size_system == "footwear":
        for size_token in dictionary.footwear_sizes:
            for match in _find_alias_matches(text, size_token):
                if _span_overlaps(match.start(), match.end(), occupied):
                    continue
                occupied.append((match.start(), match.end()))
                mentions.append(
                    EntityMention(
                        kind="size",
                        canonical_key=size_token,
                        display_label=size_token,
                        start=match.start(),
                        end=match.end(),
                        raw_span=match.group(0),
                    )
                )
    return mentions


def extract_entities_and_category(
    norm: NormalizationResult,
    *,
    consumed_spans: tuple[tuple[int, int], ...] = (),
    dictionary: AliasDictionaryV1 | None = None,
) -> EntityExtractionResult:
    """Extract canonical category, brand, color, size, and attribute mentions safely."""
    text = norm.canonical_for_matching
    if not text:
        return EntityExtractionResult(category=None, mentions=())

    vocab = dictionary or load_alias_dictionary()
    # Keep protected model phrases eligible for brand/category recognition;
    # only exclude measurement spans so model numbers never become prices/sizes.
    occupied: list[tuple[int, int]] = []
    # Keep measurement spans (16 gb, 15.6 inç, 1 litre) occupied for entity sizing/color checks
    non_model_consumed = [
        sp
        for sp in consumed_spans
        if not any(m.start == sp[0] and m.end == sp[1] for m in norm.protected_spans)
    ]
    occupied.extend(non_model_consumed)
    # Brands can co-trigger on category cues like 'iphone' or 'macbook'
    brand_occupied = list(non_model_consumed)

    category, category_span = _select_best_category(text, vocab.categories)
    mentions: list[EntityMention] = []

    if category is not None and category_span is not None:
        mentions.append(
            EntityMention(
                kind="category",
                canonical_key=category.canonical_key,
                display_label=category.display_name,
                start=category_span[0],
                end=category_span[1],
                raw_span=text[category_span[0] : category_span[1]],
                showcase_supported=category.showcase,
            )
        )
        occupied.append(category_span)

    # First check unambiguous colors excluding ambiguous 'mavi' until brand vs color resolves
    matched_non_ambiguous_colors = 0
    for color_cfg in vocab.colors:
        if color_cfg.canonical_key == "mavi":
            continue
        for alias in sorted(color_cfg.aliases, key=len, reverse=True):
            for match in _find_alias_matches(text, alias):
                if _span_overlaps(match.start(), match.end(), occupied):
                    continue
                occupied.append((match.start(), match.end()))
                matched_non_ambiguous_colors += 1
                mentions.append(
                    EntityMention(
                        kind="color",
                        canonical_key=color_cfg.canonical_key,
                        display_label=color_cfg.display_label,
                        start=match.start(),
                        end=match.end(),
                        raw_span=match.group(0),
                    )
                )

    # Match brands longest alias first
    brand_candidates: list[tuple[str, NamedAliasConfig]] = [
        (alias, brand_cfg) for brand_cfg in vocab.brands for alias in brand_cfg.aliases
    ]
    brand_candidates.sort(key=lambda pair: len(pair[0]), reverse=True)

    for alias, brand_cfg in brand_candidates:
        for match in _find_alias_matches(text, alias):
            if _span_overlaps(match.start(), match.end(), brand_occupied):
                continue
            if brand_cfg.color_ambiguous and alias == "mavi":
                trailing = text[match.end() :]
                is_explicit_color = bool(re.match(r"^\s+renk\b", trailing))
                is_apparel_showcase = (
                    category is not None and category.canonical_key == "erkek_mont"
                )
                # Classify 'mavi' as brand on explicit marka cue or apparel without 'mavi renk'
                if is_explicit_color or (
                    not is_apparel_showcase and not re.match(r"^\s+marka\b", trailing)
                ):
                    continue
            brand_span = (match.start(), match.end())
            brand_occupied.append(brand_span)
            occupied.append(brand_span)
            mentions.append(
                EntityMention(
                    kind="brand",
                    canonical_key=brand_cfg.canonical_key,
                    display_label=brand_cfg.display_label,
                    start=match.start(),
                    end=match.end(),
                    raw_span=match.group(0),
                )
            )

    # Finally resolve 'mavi' color if not already consumed as brand Mavi
    mavi_color = next((c for c in vocab.colors if c.canonical_key == "mavi"), None)
    if mavi_color is not None:
        for match in _find_alias_matches(text, "mavi"):
            if _span_overlaps(match.start(), match.end(), occupied):
                continue
            occupied.append((match.start(), match.end()))
            mentions.append(
                EntityMention(
                    kind="color",
                    canonical_key="mavi",
                    display_label="Mavi",
                    start=match.start(),
                    end=match.end(),
                    raw_span=match.group(0),
                )
            )

    # Extract sizes with category & measurement disambiguation
    size_occupied = list(occupied)
    for sp in norm.protected_spans:
        size_occupied.append((sp.start, sp.end))
    mentions.extend(_extract_clothing_sizes(text, vocab, size_occupied, category=category))
    mentions.extend(_extract_footwear_sizes(text, vocab, size_occupied, category=category))

    # Extract multiword attributes cleanly
    attr_candidates = [
        (alias, attr_cfg) for attr_cfg in vocab.attributes for alias in attr_cfg.aliases
    ]
    attr_candidates.sort(key=lambda pair: len(pair[0]), reverse=True)
    for alias, attr_cfg in attr_candidates:
        for match in _find_alias_matches(text, alias):
            if _span_overlaps(match.start(), match.end(), occupied):
                continue
            occupied.append((match.start(), match.end()))
            mentions.append(
                EntityMention(
                    kind="attribute",
                    canonical_key=attr_cfg.canonical_key,
                    display_label=attr_cfg.display_label,
                    start=match.start(),
                    end=match.end(),
                    raw_span=match.group(0),
                )
            )

    mentions.sort(key=lambda m: m.start)
    return EntityExtractionResult(category=category, mentions=tuple(mentions))
