import type {
  LinkFilterItem,
  LinkResolution,
  SearchApiTransport,
  SearchCriterionNodeInput,
  SearchIntentV2Input,
  SearchIntentV2Output,
  SearchParseRequest,
  SearchParseResponse,
  SearchResolveRequest,
  SearchResolveResponse,
} from "@/api";

export type { SearchApiTransport } from "@/api";

const DEMO_NOTICE =
  "Doğrulanan ölçütler web kanıtına dayanır; mobil uygulama doğrulaması beklenir ve Trendyol'daki Sponsorlu alanlar fiyat aralığı dışında kalabilir.";

function buildResolutionFromIntent(
  intent: SearchIntentV2Output,
  rebuildQuery = false,
): LinkResolution {
  const criteria = intent.criteria ?? [];
  const applied: LinkFilterItem[] = [];
  const queryOnly: LinkFilterItem[] = [];
  const unsupported: LinkFilterItem[] = [];
  const queryParams: string[] = [];

  const activeCategoryCriterion = criteria.find(
    (crit) => crit.field === "category" && crit.operator !== "not_in",
  );
  const effectiveCategoryKey = activeCategoryCriterion ? intent.category_key : null;

  if (effectiveCategoryKey === "erkek_mont") {
    queryParams.push("wc=118", "wg=2");
  } else if (effectiveCategoryKey === "spor_ayakkabi") {
    queryParams.push("wc=109");
  } else if (effectiveCategoryKey === "bluetooth_kulaklik") {
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

    if (crit.field === "category" && effectiveCategoryKey) {
      const catId =
        effectiveCategoryKey === "erkek_mont"
          ? "118"
          : effectiveCategoryKey === "bluetooth_kulaklik"
            ? "108626"
            : "109";
      applied.push({
        criterion_id: crit.id,
        field: "category",
        label: crit.display_label,
        operator: crit.operator,
        status: "WEB_VERIFIED_PENDING_MOBILE",
        url_param: "wc",
        url_value: catId,
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

    if (crit.field === "color" && effectiveCategoryKey && crit.value === "siyah") {
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

    if (crit.field === "size" && effectiveCategoryKey === "erkek_mont" && crit.value === "m") {
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

    if (crit.field === "brand" && effectiveCategoryKey === "bluetooth_kulaklik") {
      const vals = Array.isArray(crit.value) ? crit.value : [String(crit.value)];
      const brandMap: Record<string, string> = { sony: "795", jbl: "102285" };
      const mappedIds = vals.map((b) => brandMap[b]).filter((id): id is string => Boolean(id));
      if (mappedIds.length === vals.length && mappedIds.length > 0) {
        const ids = mappedIds.join(",");
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

  if (!effectiveCategoryKey || queryOnly.length > 0 || applied.length === 0) {
    const queryText = rebuildQuery
      ? queryOnly
          .map((item) => item.label.trim())
          .filter(Boolean)
          .join(" ")
      : intent.raw_query;
    if (queryText.trim()) {
      queryParams.unshift(`q=${encodeURIComponent(queryText.trim())}`);
    }
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

    if (lowered.includes("siyah") && lowered.includes("beyaz")) {
      criteria.push({
        id: "color-or-1",
        field: "color",
        operator: "in",
        value: ["siyah", "beyaz"],
        display_label: "Siyah veya Beyaz",
      });
    } else if (lowered.includes("siyah") && lowered.includes("mavi")) {
      criteria.push({
        id: "color-or-1",
        field: "color",
        operator: "in",
        value: ["siyah", "mavi"],
        display_label: "Siyah veya Mavi",
      });
    } else if (lowered.includes("siyah")) {
      criteria.push({
        id: "color-1",
        field: "color",
        operator: "eq",
        value: "siyah",
        display_label: "Siyah",
      });
    }

    if (lowered.includes("sony") && lowered.includes("jbl")) {
      criteria.push({
        id: "brand-or-1",
        field: "brand",
        operator: "in",
        value: ["sony", "jbl"],
        display_label: "Sony veya JBL",
      });
    } else if (lowered.includes("sony")) {
      criteria.push({
        id: "brand-1",
        field: "brand",
        operator: "eq",
        value: "sony",
        display_label: "Sony",
      });
    }

    if ((/\bm\b/.test(lowered) || lowered.includes("m beden")) && categoryKey === "erkek_mont") {
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

    const logicGroups: SearchIntentV2Output["logic_groups"] = criteria
      .filter((c) => c.operator === "in" || c.operator === "not_in")
      .map((c) => ({
        operator: c.operator === "not_in" ? ("not" as const) : ("any_of" as const),
        criterion_ids: [c.id],
      }));

    const intent: SearchIntentV2Output = {
      schema_version: "2.0.0",
      raw_query: raw,
      normalized_query: lowered,
      locale: "tr-TR",
      input_source: payload.input_source ?? "text",
      category_key: categoryKey,
      criteria: criteria as SearchIntentV2Output["criteria"],
      logic_groups: logicGroups,
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
      resolution: buildResolutionFromIntent(intent, true),
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
