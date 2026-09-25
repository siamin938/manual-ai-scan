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
  | { ok: true; value: Required<CustomQuestionInput> }
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
  const target = subject(service, brandModel);
  const need = customerNeed ? `${customerNeed} 기준으로 ` : "";

  const rows: Array<{ intent: AllowedIntent; text: string }> = [
    {
      intent: "local",
      text: `${location}에서 ${target} 가능한 업체 어디가 있어?`,
    },
    {
      intent: "recommendation",
      text: `${location}에서 ${need}${target} 잘하는 업체 추천해줘`,
    },
    {
      intent: "service",
      text: `${location}에서 ${target} 전문으로 하는 곳 알려줘`,
    },
    {
      intent: "review_quality",
      text: `${location} ${target} 실제 이용 후기 좋은 업체 알려줘`,
    },
    {
      intent: "trust",
      text: `${location}에서 ${target} 경험 많고 믿고 맡길 만한 업체 알려줘`,
    },
    {
      intent: "comparison",
      text: `${location} ${target} 업체 몇 곳 비교해줘`,
    },
    {
      intent: "price_value",
      text: `${location} ${target} 가격 대비 괜찮은 업체 알려줘`,
    },
    {
      intent: "discovery",
      text: customerNeed
        ? `${location}에서 ${customerNeed}에 맞는 ${target} 업체 몇 곳 찾아줘`
        : `${location}에서 ${target} 전문 업체 몇 곳 찾아줘`,
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
