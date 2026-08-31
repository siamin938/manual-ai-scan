/**
 * AI 질문 추천 v0.1 순수 헬퍼.
 * DB/네트워크 접근 없이 후보 정규화·검증·중복 제거만 담당한다.
 */

export const ALLOWED_INTENTS = [
  "local",
  "recommendation",
  "service",
  "review_quality",
  "trust",
  "comparison",
  "price_value",
  "discovery",
] as const;

export type AllowedIntent = (typeof ALLOWED_INTENTS)[number];

export const INTENT_LABELS: Record<AllowedIntent, string> = {
  local: "지역·접근성",
  recommendation: "추천",
  service: "서비스·작업",
  review_quality: "후기·평판",
  trust: "전문성·신뢰",
  comparison: "비교",
  price_value: "가격·가성비",
  discovery: "탐색·발견",
};

export const MIN_QUESTION_LENGTH = 8;
export const MAX_QUESTION_LENGTH = 220;

export type SuggestionCandidate = {
  id: string;
  promptText: string;
  intentType: AllowedIntent;
  selected: boolean;
  containsBusinessName: boolean;
};

/** 비교용 정규화: 공백 축약/제거 + 소문자 + 기본 문장부호 제거. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?!.,'"`~·\-_/\\()[\]{}]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** 공백 변형까지 포함해 대상 업체명이 질문에 들어있는지 검사. */
export function containsTargetBusinessName(text: string, businessName: string): boolean {
  const name = normalizeQuestion(businessName ?? "");
  if (!name) return false;
  return normalizeQuestion(text ?? "").includes(name);
}

export function isAllowedIntent(value: unknown): value is AllowedIntent {
  return typeof value === "string" && (ALLOWED_INTENTS as readonly string[]).includes(value);
}

export function isValidQuestionLength(text: string): boolean {
  const len = (text ?? "").trim().length;
  return len >= MIN_QUESTION_LENGTH && len <= MAX_QUESTION_LENGTH;
}

/**
 * Edge Function 응답을 신뢰하지 않고 안전한 후보 목록으로 변환한다.
 * 길이/intent 조건을 어기는 항목은 제외하고, 업체명이 포함되면 기본 해제한다.
 */
export function toCandidates(
  raw: unknown,
  businessName: string,
): SuggestionCandidate[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SuggestionCandidate[] = [];
  const seen = new Set<string>();

  list.forEach((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const promptText = typeof obj["prompt_text"] === "string"
      ? obj["prompt_text"]
      : typeof obj["promptText"] === "string"
        ? (obj["promptText"] as string)
        : typeof obj["question"] === "string"
          ? (obj["question"] as string)
          : "";
    const text = promptText.trim();
    if (!isValidQuestionLength(text)) return;

    const intentRaw = obj["intent_type"] ?? obj["intentType"] ?? obj["intent"];
    if (!isAllowedIntent(intentRaw)) return;

    const key = normalizeQuestion(text);
    if (seen.has(key)) return;
    seen.add(key);

    const containsName = containsTargetBusinessName(text, businessName);
    out.push({
      id: `s-${index}`,
      promptText: text,
      intentType: intentRaw,
      selected: !containsName,
      containsBusinessName: containsName,
    });
  });

  return out;
}

export type SaveDedupeResult = {
  kept: SuggestionCandidate[];
  skipped: number;
};

/**
 * 저장 직전 중복 제거.
 * - 기존 세트 질문과 normalized exact duplicate 제거
 * - 선택 후보 간 중복 제거
 * - 길이/intent 위반 항목 제거
 */
export function dedupeForSave(
  candidates: SuggestionCandidate[],
  existingPromptTexts: string[],
): SaveDedupeResult {
  const existing = new Set(existingPromptTexts.map((t) => normalizeQuestion(t)));
  const kept: SuggestionCandidate[] = [];
  let skipped = 0;

  for (const c of candidates) {
    const text = c.promptText.trim();
    if (!isValidQuestionLength(text) || !isAllowedIntent(c.intentType)) {
      skipped += 1;
      continue;
    }
    const key = normalizeQuestion(text);
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    existing.add(key);
    kept.push({ ...c, promptText: text });
  }

  return { kept, skipped };
}

export type QuestionInsertPayload = {
  org_id: string;
  question_set_id: string;
  prompt_text: string;
  intent_type: AllowedIntent;
  language: "ko";
  country_code: "KR";
  region: string | null;
  city: string | null;
  weight: 1;
  data_class: "public";
  active: true;
};

/** 저장 payload 생성. 고정 필드는 항상 클라이언트 상수로 강제한다. */
export function buildInsertPayloads(
  candidates: SuggestionCandidate[],
  ctx: {
    orgId: string;
    questionSetId: string;
    region: string | null;
    city: string | null;
  },
): QuestionInsertPayload[] {
  return candidates.map((c) => ({
    org_id: ctx.orgId,
    question_set_id: ctx.questionSetId,
    prompt_text: c.promptText.trim(),
    intent_type: c.intentType,
    language: "ko",
    country_code: "KR",
    region: ctx.region ?? null,
    city: ctx.city ?? null,
    weight: 1,
    data_class: "public",
    active: true,
  }));
}

/** Edge Function 에러를 사용자 안전 문구로 매핑. */
export function mapSuggestError(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("unauthorized") || m.includes("401")) return "권한이 없습니다. 다시 로그인해 주세요.";
  if (m.includes("forbidden") || m.includes("403")) return "이 업체에 대한 권한이 없습니다.";
  if (m.includes("ai_generation_failed") || m.includes("ai_output_invalid"))
    return "질문 후보 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  if (m.includes("server_not_configured")) return "관리자 설정이 필요합니다. 담당자에게 문의해 주세요.";
  return "질문 추천 중 오류가 발생했습니다.";
}
