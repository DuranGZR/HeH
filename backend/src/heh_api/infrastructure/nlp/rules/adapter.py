"""D20 M0 deterministic RuleBasedQueryUnderstandingAdapter composing D16-D19."""

from heh_api.domain.search_intent import PARSER_VERSION, InputSourceKind
from heh_api.infrastructure.nlp.rules.entities import (
    AliasDictionaryV1,
    extract_entities_and_category,
)
from heh_api.infrastructure.nlp.rules.logic import LogicAssemblyResult, assemble_search_intent_ast
from heh_api.infrastructure.nlp.rules.normalize import normalize_query_for_m0
from heh_api.infrastructure.nlp.rules.numbers import extract_price_and_units


class RuleBasedQueryUnderstandingAdapter:
    """Pure deterministic Turkish CQU baseline (M0): normalize -> numbers -> entities -> AST."""

    parser_version: str = PARSER_VERSION

    def __init__(self, *, dictionary: AliasDictionaryV1 | None = None) -> None:
        self._dictionary = dictionary

    def parse(
        self,
        raw_query: str,
        *,
        input_source: InputSourceKind = "text",
    ) -> LogicAssemblyResult:
        """Run deterministic D16-D19 rules over normalized Turkish query text."""
        norm = normalize_query_for_m0(raw_query)
        numbers = extract_price_and_units(norm)
        entities = extract_entities_and_category(
            norm,
            consumed_spans=numbers.entity_consumed_spans,
            dictionary=self._dictionary,
        )
        return assemble_search_intent_ast(
            norm=norm,
            numbers=numbers,
            entities=entities,
            input_source=input_source,
        )
