import type {
  LinkFilterItem,
  LinkResolution,
  SearchCriterionNodeInput,
  SearchIntentV2Input,
  SearchIntentV2Output,
  SearchParseRequest,
  SearchParseResponse,
  SearchResolveRequest,
  SearchResolveResponse,
} from "@/api";

export interface SearchApiTransport {
  parseSearch(payload: SearchParseRequest, signal?: AbortSignal): Promise<SearchParseResponse>;
  resolveSearch(
    payload: SearchResolveRequest,
    signal?: AbortSignal,
  ): Promise<SearchResolveResponse>;
}

const DEMO_NOTICE =
  "Doğrulanan ölçütler web kanıtına dayanır; mobil uygulama doğrulaması beklenir ve Trendyol'daki Sponsorlu alanlar fiyat aralığı dışında kalabilir.";

function buildResolutionFromIntent(intent: SearchIntentV2Output): LinkResolution {
  const criteria = intent.criteria ?? [];
  const applied: LinkFilterItem[] = [];
  const queryOnly: LinkFilterItem[] = [];
  const unsupported: LinkFilterItem[] = [];
  const queryParams: string[] = [];

  if (intent.category_key === "erkek_mont") {
    queryParams.push("wc=118", "wg=2");
  } else if (intent.category_key === "spor_ayakkabi") {
    queryParams.push("wc=109");
  } else if (intent.category_key === "bluetooth_kulaklik") {
    queryParams.push("wc=108626");
  }

  for (const crit of criteria) {
    if (crit.operator === "not_in") {
      unsupported.push({
        criterion_id: crit.id,
        field: crit.field,
        label: crit.display_label,
        operator: crit.operator,
        status: "UNSUPPORTED",
        reason: "Trendyol yan menü ve URL şemasında negatif dışlama desteği yok.",
      });
      continue;
    }

    if (crit.field === "category" && intent.category_key) {
      applied.push({
        criterion_id: crit.id,
        field: "category",
        label: crit.display_label,
        operator: crit.operator,
        status: "WEB_VERIFIED_PENDING_MOBILE",
        url_param: "wc",
        url_value: intent.category_key === "erkek_mont" ? "118" : "109",
        reason: "Vitrin kategori kimliği web gözlemi ile doğrulandı.",
        evidence_ref: "evidence/W1/d03-url-observations.json",
      });
      continue;
    }

    if (crit.field === "price") {
      const priceObj =
        typeof crit.value === "object" && !Array.isArray(crit.value) ? crit.value : null;
      const minVal = priceObj && "min_amount" in priceObj ? (priceObj.min_amount ?? "0") : "0";
      const maxVal = priceObj && "max_amount" in priceObj ? (priceObj.max_amount ?? "*") : "*";
      const prcValue = `${minVal}-${maxVal}`;
      queryParams.push(`prc=${encodeURIComponent(prcValue)}`);
      applied.push({
        criterion_id: crit.id,
        field: "price",
        label: crit.display_label,
        operator: crit.operator,
        status: "WEB_VERIFIED_PENDING_MOBILE",
        url_param: "prc",
        url_value: prcValue,
        reason: "Fiyat aralığı Trendyol prc parametresine bağlandı.",
        evidence_ref: "evidence/W1/d02-url-observations.json",
      });
      continue;
    }

    if (crit.field === "color" && crit.value === "siyah") {
      queryParams.push("wcl=14");
      applied.push({
        criterion_id: crit.id,
        field: "color",
        label: crit.display_label,
        operator: crit.operator,
        status: "WEB_VERIFIED_PENDING_MOBILE",
        url_param: "wcl",
        url_value: "14",
        reason: "Renk kodu wcl parametresiyle doğrulandı.",
        evidence_ref: "evidence/W1/d03-url-observations.json",
      });
      continue;
    }

    if (crit.field === "size" && crit.value === "m") {
      queryParams.push(`vr=${encodeURIComponent("size|group-m")}`);
      applied.push({
        criterion_id: crit.id,
        field: "size",
        label: crit.display_label,
        operator: crit.operator,
        status: "WEB_VERIFIED_PENDING_MOBILE",
        url_param: "vr",
        url_value: "size|group-m",
        reason: "Beden parametresi vr kodu ile doğrulandı.",
        evidence_ref: "evidence/W1/d03-url-observations.json",
      });
      continue;
    }

    if (crit.field === "brand" && intent.category_key === "bluetooth_kulaklik") {
      const vals = Array.isArray(crit.value) ? crit.value : [String(crit.value)];
      const ids = vals.map((b) => (b === "sony" ? "795" : "102285")).join(",");
      queryParams.push(`wb=${encodeURIComponent(ids)}`);
      applied.push({
        criterion_id: crit.id,
        field: "brand",
        label: crit.display_label,
        operator: crit.operator,
        status: "WEB_VERIFIED_PENDING_MOBILE",
        url_param: "wb",
        url_value: ids,
        reason: "Marka kimliği web gözlemiyle eşlendi.",
        evidence_ref: "evidence/W1/d03-url-observations.json",
      });
      continue;
    }

    queryOnly.push({
      criterion_id: crit.id,
      field: crit.field,
      label: crit.display_label,
      operator: crit.operator,
      status: "QUERY_ONLY",
      reason: "Doğrulanmış parametre yok; q arama metniyle aktarılır.",
    });
  }

  if (!intent.category_key || queryOnly.length > 0 || applied.length === 0) {
    queryParams.unshift(`q=${encodeURIComponent(intent.raw_query)}`);
  }

  const warningLevel =
    applied.length === 0 && unsupported.length > 0
      ? "critical"
      : unsupported.length > 0 || queryOnly.length > 0
        ? "partial"
        : "none";

  return {
    provider: "trendyol",
    url: `https://www.trendyol.com/sr?${queryParams.join("&")}`,
    route_strategy: "canonical_search_query",
    mapping_version: "2026.11.25.1",
    applied_filters: applied,
    query_only: queryOnly,
    unsupported,
    warning_level: warningLevel,
    verification_notice: DEMO_NOTICE,
  };
}

/**
 * Deterministic in-memory mock transport mirroring backend 1-RTT /parse and edit-only /resolve
 * for offline demos and tests without touching production NLP or DB services.
 */
export class MockSearchTransport implements SearchApiTransport {
  public async parseSearch(payload: SearchParseRequest): Promise<SearchParseResponse> {
    const raw = payload.text.trim();
    const lowered = raw
      .replace(/\u0130/g, "i")
      .replace(/I/g, "ı")
      .toLowerCase();
    const criteria: SearchCriterionNodeInput[] = [];
    let categoryKey: string | null = null;

    if (lowered.includes("mont")) {
      categoryKey = "erkek_mont";
      criteria.push({
        id: "cat-1",
        field: "category",
        operator: "eq",
        value: "erkek_mont",
        display_label: "Erkek Mont",
      });
    } else if (lowered.includes("kulaklık") || lowered.includes("kulaklik")) {
      categoryKey = "bluetooth_kulaklik";
      criteria.push({
        id: "cat-1",
        field: "category",
        operator: "eq",
        value: "bluetooth_kulaklik",
        display_label: "Bluetooth Kulaklık",
      });
    }

    if (lowered.includes("3000 altı") || lowered.includes("0-3000")) {
      criteria.push({
        id: "price-1",
        field: "price",
        operator: "lte",
        value: { min_amount: "0", max_amount: "3000", currency: "TRY" },
        display_label: "0-3000 TL",
      });
    }

    if (lowered.includes("nike olmasın")) {
      criteria.push({
        id: "brand-not-1",
        field: "brand",
        operator: "not_in",
        value: ["nike"],
        display_label: "Nike olmasın",
      });
    }

    if (lowered.includes("siyah")) {
      criteria.push({
        id: "color-1",
        field: "color",
        operator: "eq",
        value: "siyah",
        display_label: "Siyah",
      });
    }

    if (lowered.includes("m beden") && categoryKey === "erkek_mont") {
      criteria.push({
        id: "size-1",
        field: "size",
        operator: "eq",
        value: "m",
        display_label: "M",
      });
    }

    if (criteria.length === 0) {
      criteria.push({
        id: "attr-query-1",
        field: "attribute",
        operator: "eq",
        value: lowered,
        display_label: raw.slice(0, 80),
      });
    }

    const intent: SearchIntentV2Output = {
      schema_version: "2.0.0",
      raw_query: raw,
      normalized_query: lowered,
      locale: "tr-TR",
      input_source: payload.input_source ?? "text",
      category_key: categoryKey,
      criteria: criteria as SearchIntentV2Output["criteria"],
      logic_groups: [],
    };

    return {
      request_id: payload.client_request_id ?? "demo-parse-1rtt",
      parser_version: "1.0.0",
      nlp_mode: "rules",
      intent,
      confidence_state: "review_required",
      warnings: lowered.includes("olmasın")
        ? ["Negatif dışlama Trendyol tarafından desteklenmez."]
        : [],
      resolution: buildResolutionFromIntent(intent),
    };
  }

  public async resolveSearch(payload: SearchResolveRequest): Promise<SearchResolveResponse> {
    const intent = payload.intent as unknown as SearchIntentV2Output;
    return {
      request_id: payload.client_request_id ?? "demo-resolve-edit",
      intent,
      resolution: buildResolutionFromIntent(intent),
    };
  }
}

export function toInputIntent(intent: SearchIntentV2Output): SearchIntentV2Input {
  return {
    schema_version: intent.schema_version,
    raw_query: intent.raw_query,
    normalized_query: intent.normalized_query,
    locale: intent.locale,
    input_source: intent.input_source,
    category_key: intent.category_key,
    criteria: intent.criteria,
    logic_groups: intent.logic_groups,
  };
}
