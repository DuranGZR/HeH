// Auto-generated from FastAPI OpenAPI schema by backend/scripts/generate_contracts.py.
// Do not edit manually; re-run `uv run python scripts/generate_contracts.py`.

export interface LivenessResponse {
  readonly status: "ok";
}

export interface ReadinessResponse {
  readonly status: "ok" | "degraded";
  readonly version: string;
  readonly nlp_mode: "rules" | "shadow" | "hybrid";
  readonly mapping_snapshot: "bootstrap" | "ready";
  readonly db_status: "not_configured" | "ok" | "degraded";
}

export interface ApiErrorDetail {
  readonly field?: string | null;
  readonly reason: string;
  readonly code?: string | null;
}

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly request_id: string;
  readonly details?: readonly ApiErrorDetail[];
}

export interface ApiErrorResponse {
  readonly error: ApiErrorBody;
}

export interface PriceValueInput {
  readonly min_amount?: number | string | null;
  readonly max_amount?: number | string | null;
  readonly min_inclusive?: boolean;
  readonly max_inclusive?: boolean;
  readonly currency?: "TRY";
}

export interface PriceValueOutput {
  readonly min_amount?: string | null;
  readonly max_amount?: string | null;
  readonly min_inclusive?: boolean;
  readonly max_inclusive?: boolean;
  readonly currency?: "TRY";
}

export interface SearchCriterionNodeInput {
  readonly id: string;
  readonly field: "category" | "brand" | "color" | "size" | "gender" | "price" | "material" | "attribute" | "model" | "sorting";
  readonly operator: "eq" | "in" | "not_in" | "gte" | "lte" | "between";
  readonly value: string | readonly string[] | PriceValueInput;
  readonly display_label: string;
  readonly required?: boolean;
  readonly polarity?: "positive" | "negative";
  readonly modality?: "must" | "should" | "must_not";
  readonly explicit?: boolean;
  readonly provenance?: "rule" | "ml_candidate" | "user_edit";
  readonly confidence?: number;
  readonly source_span?: string | null;
  readonly span_start?: number | null;
  readonly span_end?: number | null;
  readonly unit?: string | null;
}

export interface SearchCriterionNodeOutput {
  readonly id: string;
  readonly field: "category" | "brand" | "color" | "size" | "gender" | "price" | "material" | "attribute" | "model" | "sorting";
  readonly operator: "eq" | "in" | "not_in" | "gte" | "lte" | "between";
  readonly value: string | readonly string[] | PriceValueOutput;
  readonly display_label: string;
  readonly required?: boolean;
  readonly polarity?: "positive" | "negative";
  readonly modality?: "must" | "should" | "must_not";
  readonly explicit?: boolean;
  readonly provenance?: "rule" | "ml_candidate" | "user_edit";
  readonly confidence?: number;
  readonly source_span?: string | null;
  readonly span_start?: number | null;
  readonly span_end?: number | null;
  readonly unit?: string | null;
}

export interface ConstraintGroup {
  readonly operator: "all_of" | "any_of" | "not";
  readonly criterion_ids: readonly string[];
}

export interface SearchIntentV2Input {
  readonly schema_version?: "2.0.0";
  readonly ontology_version?: string;
  readonly intent_type?: "product_search" | "refine_search" | "unsupported" | "ambiguous";
  readonly raw_query: string;
  readonly normalized_query: string;
  readonly locale?: "tr-TR";
  readonly input_source?: "text" | "voice";
  readonly category_key?: string | null;
  readonly criteria?: readonly SearchCriterionNodeInput[];
  readonly logic_groups?: readonly ConstraintGroup[];
}

export interface SearchIntentV2Output {
  readonly schema_version?: "2.0.0";
  readonly ontology_version?: string;
  readonly intent_type?: "product_search" | "refine_search" | "unsupported" | "ambiguous";
  readonly raw_query: string;
  readonly normalized_query: string;
  readonly locale?: "tr-TR";
  readonly input_source?: "text" | "voice";
  readonly category_key?: string | null;
  readonly criteria?: readonly SearchCriterionNodeOutput[];
  readonly logic_groups?: readonly ConstraintGroup[];
}

export interface LinkFilterItem {
  readonly criterion_id: string;
  readonly field: "category" | "brand" | "color" | "size" | "gender" | "price" | "material" | "attribute" | "model" | "sorting";
  readonly label: string;
  readonly operator: "eq" | "in" | "not_in" | "gte" | "lte" | "between";
  readonly status: "FILTER_VERIFIED" | "WEB_VERIFIED_PENDING_MOBILE" | "QUERY_ONLY" | "UNSUPPORTED" | "UNKNOWN";
  readonly url_param?: string | null;
  readonly url_value?: string | null;
  readonly reason: string;
  readonly evidence_ref?: string | null;
}

export interface LinkResolution {
  readonly provider?: "trendyol";
  readonly url: string;
  readonly route_strategy: "canonical_search_query" | "verified_facet_path";
  readonly mapping_version: string;
  readonly applied_filters?: readonly LinkFilterItem[];
  readonly query_only?: readonly LinkFilterItem[];
  readonly unsupported?: readonly LinkFilterItem[];
  readonly warning_level?: "none" | "partial" | "critical";
  readonly verification_notice: string;
  readonly verified_at?: string | null;
}

export interface SearchParseRequest {
  readonly text: string;
  readonly locale?: "tr-TR";
  readonly input_source?: "text" | "voice";
  readonly client_request_id?: string | null;
}

export interface SearchParseResponse {
  readonly request_id: string;
  readonly parser_version: string;
  readonly nlp_mode: "rules" | "shadow" | "hybrid";
  readonly intent: SearchIntentV2Output;
  readonly confidence_state: "high" | "review_required" | "abstain";
  readonly warnings?: readonly string[];
  readonly resolution: LinkResolution;
}

export interface SearchResolveRequest {
  readonly intent: SearchIntentV2Input;
  readonly mapping_version?: string | null;
  readonly client_request_id?: string | null;
}

export interface SearchResolveResponse {
  readonly request_id: string;
  readonly intent: SearchIntentV2Output;
  readonly resolution: LinkResolution;
}

export interface CategoryCapabilitySummary {
  readonly category_key: string;
  readonly display_name: string;
  readonly status: "FILTER_VERIFIED" | "WEB_VERIFIED_PENDING_MOBILE" | "QUERY_ONLY" | "UNSUPPORTED" | "UNKNOWN";
  readonly supports_brand_or: boolean;
  readonly supports_color: boolean;
  readonly supports_size: boolean;
  readonly negative_supported?: false;
}

export interface ProviderCapabilitiesResponse {
  readonly provider?: "trendyol";
  readonly mapping_version: string;
  readonly long_tail_policy?: "prc_plus_q";
  readonly showcase_categories: readonly CategoryCapabilitySummary[];
}
