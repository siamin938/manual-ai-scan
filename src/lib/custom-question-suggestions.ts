import {
  ALLOWED_INTENTS,
  containsTargetBusinessName,
  normalizeQuestion,
  type AllowedIntent,
  type SuggestionCandidate,
} from "@/lib/question-suggestions";

export type CustomQuestionInput = {
  location: string;
  service: string;
  brandModel?: string | null;
  customerNeed?: string | null;
};

export type CustomQuestionValidation =
  | {
      ok: true;
      value: {
        location: string;
        service: string;
        brandModel: string;
        customerNeed: string;
      };
    }
  | {
      ok: false;
      error:
        | "LOCATION_REQUIRED"
        | "SERVICE_REQUIRED"
        | "FIELD_TOO_LONG"
        | "BUSINESS_NAME_INCLUDED";
    };

function clean(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function phrase(value: string): string {
  return value.replace(/[?!.。]+$/u, "").trim();
}

const REGION_SURFACE_ALIASES: Record<string, string> = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};

function naturalizeLocationToken(value: string): string {
  const exact = REGION_SURFACE_ALIASES[value];
  if (exact) return exact;

  if (value === "일산동구" || value === "일산서구") return value;

  for (const suffix of ["특별자치시", "특별시", "광역시", "특별자치도"]) {
    if (value.endsWith(suffix) && value.length > suffix.length) {
      return value.slice(0, -suffix.length);
    }
  }

  for (const suffix of ["시", "군", "구"]) {
    if (!value.endsWith(suffix) || value.length <= suffix.length) continue;
    const base = value.slice(0, -suffix.length);
    if (base.length >= 2) return base;
  }

  return value;
}

/**
 * 질문 문구에서만 행정구역 접미사를 자연스럽게 줄인다.
 * 저장되는 region/city 메타데이터는 원본 등록값을 그대로 사용한다.
 */
export function naturalizeQuestionLocation(value: string): string {
  const location = clean(value);
  if (!location) return "";
  const exact = REGION_SURFACE_ALIASES[location];
  if (exact) return exact;
  return location
    .split(/\s+/u)
    .map((token) => naturalizeLocationToken(token))
    .join(" ");
}

export function validateCustomQuestionInput(
  input: CustomQuestionInput,
  businessName: string,
): CustomQuestionValidation {
  const location = clean(input.location);
  const service = clean(input.service);
  const brandModel = clean(input.brandModel);
  const customerNeed = clean(input.customerNeed);

  if (!location) return { ok: false, error: "LOCATION_REQUIRED" };
  if (!service) return { ok: false, error: "SERVICE_REQUIRED" };
  if ([location, service, brandModel, customerNeed].some((v) => v.length > 80)) {
    return { ok: false, error: "FIELD_TOO_LONG" };
  }

  const combined = [location, service, brandModel, customerNeed].filter(Boolean).join(" ");
  if (containsTargetBusinessName(combined, businessName)) {
    return { ok: false, error: "BUSINESS_NAME_INCLUDED" };
  }

  return {
    ok: true,
    value: {
      location,
      service: phrase(service),
      brandModel: phrase(brandModel),
      customerNeed: phrase(customerNeed),
    },
  };
}

export function parseBrandModelTargets(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of clean(value).split(/[,;\n·|]+/u)) {
    const item = phrase(clean(raw));
    if (!item) continue;
    const key = normalizeQuestion(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 4) break;
  }
  return out;
}

export type CustomQuestionSignatureRow = {
  promptText: string;
  intentType: string;
  region?: string | null;
  city?: string | null;
};

/**
 * 같은 업체에 동일한 맞춤 질문 세트를 중복 저장하지 않기 위한 안정적인 서명.
 * 질문 문구/intent/측정 지역 메타데이터가 모두 같을 때만 동일 세트로 본다.
 */
export function buildCustomQuestionSetSignature(
  rows: readonly CustomQuestionSignatureRow[],
): string {
  return rows
    .map((row) =>
      [
        row.intentType.trim(),
        normalizeQuestion(row.promptText),
        clean(row.region),
        clean(row.city),
      ].join("|"),
    )
    .sort((a, b) => a.localeCompare(b, "ko-KR"))
    .join("\n");
}

function subject(service: string, brandModel: string): string {
  return brandModel ? `${brandModel} ${service}` : service;
}

function makeCandidate(
  index: number,
  promptText: string,
  intentType: AllowedIntent,
  businessName: string,
): SuggestionCandidate {
  const text = clean(promptText);
  return {
    id: `custom-${index}`,
    promptText: text,
    intentType,
    selected: !containsTargetBusinessName(text, businessName),
    containsBusinessName: containsTargetBusinessName(text, businessName),
  };
}

/**
 * 맞춤 질문 v0.1
 * - LLM/웹 추론 없이 사용자가 확인한 입력만 조합한다.
 * - 8개 intent를 정확히 1개씩 생성한다.
 * - 업체명은 질문에 넣지 않는다.
 * - 표준 24문항과 별도 세트로 저장하는 용도다.
 */
export function buildCustomQuestionCandidates(
  input: CustomQuestionInput,
  businessName: string,
): SuggestionCandidate[] {
  const validation = validateCustomQuestionInput(input, businessName);
  if (!validation.ok) return [];

  const { location, service, brandModel, customerNeed } = validation.value;
  const locationSurface = naturalizeQuestionLocation(location);
  const brandTargets = parseBrandModelTargets(brandModel);
  const targetAt = (index: number) =>
    subject(service, brandTargets.length > 0 ? brandTargets[index % brandTargets.length]! : "");
  const need = customerNeed ? `‘${customerNeed}’` : "";

  const rows: Array<{ intent: AllowedIntent; text: string }> = [
    {
      intent: "local",
      text: `${locationSurface}에서 ${targetAt(0)} 맡길 수 있는 곳 어디야?`,
    },
    {
      intent: "recommendation",
      text: customerNeed
        ? `${locationSurface}에서 ${targetAt(1)} 업체 찾을 때 ${need}도 고려해서 추천해줘`
        : `${locationSurface}에서 ${targetAt(1)} 맡길 만한 업체 추천해줘`,
    },
    {
      intent: "service",
      text: `${locationSurface}에서 ${targetAt(2)} 전문으로 하는 곳 알려줘`,
    },
    {
      intent: "review_quality",
      text: `${locationSurface} ${targetAt(3)} 실제 이용 후기 좋은 곳 알려줘`,
    },
    {
      intent: "trust",
      text: `${targetAt(4)} 작업 경험 많은 ${locationSurface} 업체 어디야?`,
    },
    {
      intent: "comparison",
      text: `${locationSurface} ${targetAt(5)} 업체 여러 곳을 작업 범위와 후기 기준으로 비교해줘`,
    },
    {
      intent: "price_value",
      text: `${locationSurface}에서 ${targetAt(6)} 비용 대비 괜찮은 곳 알려줘`,
    },
    {
      intent: "discovery",
      text: customerNeed
        ? `${locationSurface}에서 ${targetAt(7)} 업체 중 ${need} 기준으로 볼 만한 곳 몇 곳 찾아줘`
        : `${locationSurface}에서 ${targetAt(7)} 업체를 처음 알아볼 때 후보로 볼 만한 곳 몇 곳 알려줘`,
    },
  ];

  const seen = new Set<string>();
  return rows
    .map((row, index) => makeCandidate(index, row.text, row.intent, businessName))
    .filter((candidate) => {
      const key = normalizeQuestion(candidate.promptText);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((candidate) => ALLOWED_INTENTS.includes(candidate.intentType));
}
