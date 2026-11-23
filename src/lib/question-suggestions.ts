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

function cleanLocation(value: string | null | undefined): string | null {
  const cleaned = value?.normalize("NFKC").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function stripAdministrativeSuffix(value: string): string {
  return value.replace(/(특별자치도|특별자치시|특별시|광역시|자치구|시|군|구|도)$/u, "") || value;
}

function containsLocationSurface(promptKey: string, value: string | null): boolean {
  if (!value) return false;
  const exact = normalizeQuestion(value);
  if (exact && promptKey.includes(exact)) return true;
  const stripped = stripAdministrativeSuffix(value);
  const strippedKey = normalizeQuestion(stripped);
  return strippedKey.length >= 2 && promptKey.includes(strippedKey);
}

function sameLocationSurface(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normalizeQuestion(stripAdministrativeSuffix(a)) === normalizeQuestion(stripAdministrativeSuffix(b));
}

export type ResolvedQuestionLocation = {
  region: string | null;
  city: string | null;
};

/**
 * 고객에게 보이는 질문의 지역 표면과 실제 provider location 메타데이터를 맞춘다.
 * - 서울특별시 + 구로구에서 "서울 ..." 질문은 city를 비워 서울 범위로 보낸다.
 * - "구로구 ..." 질문은 기존 구로구 city를 유지한다.
 * - 고양시 일산동구처럼 city에 시/구가 함께 있으면 "고양 ..."은 고양시,
 *   "일산동구 ..."는 기존 상세 city를 유지한다.
 * - 질문에서 범위를 안전하게 판별할 수 없으면 기존 city를 그대로 유지한다.
 */
export function resolveQuestionLocation(
  promptText: string,
  region: string | null,
  city: string | null,
): ResolvedQuestionLocation {
  const safeRegion = cleanLocation(region);
  const safeCity = cleanLocation(city);
  if (!safeCity) return { region: safeRegion, city: null };

  const promptKey = normalizeQuestion(promptText);
  const cityParts = safeCity.split(/[\s,]+/u).map((part) => part.trim()).filter(Boolean);
  if (cityParts.length === 0) return { region: safeRegion, city: safeCity };

  if (cityParts.length > 1) {
    const broaderCity = cityParts[0]!;
    const localDistrict = cityParts[cityParts.length - 1]!;

    if (containsLocationSurface(promptKey, localDistrict)) {
      return { region: safeRegion, city: safeCity };
    }

    if (containsLocationSurface(promptKey, broaderCity)) {
      const metroRegion = !!safeRegion && /(특별자치시|특별시|광역시)$/u.test(safeRegion);
      return {
        region: safeRegion,
        city: metroRegion && sameLocationSurface(broaderCity, safeRegion) ? null : broaderCity,
      };
    }

    // 도 단위 Core 질문(예: 경기도 + 성남시 분당구에서 "경기 ...")은
    // 상세 city를 숨겨 광역 region 범위로 provider에 전달한다.
    if (containsLocationSurface(promptKey, safeRegion)) {
      return { region: safeRegion, city: null };
    }

    return { region: safeRegion, city: safeCity };
  }

  const onlyCity = cityParts[0]!;
  const metroRegion = !!safeRegion && /(특별자치시|특별시|광역시)$/u.test(safeRegion);
  const districtLikeCity = /(구|군)$/u.test(onlyCity);

  if (metroRegion && districtLikeCity) {
    if (containsLocationSurface(promptKey, onlyCity)) {
      return { region: safeRegion, city: safeCity };
    }
    if (containsLocationSurface(promptKey, safeRegion)) {
      return { region: safeRegion, city: null };
    }
  }

  if (
    !metroRegion &&
    !containsLocationSurface(promptKey, onlyCity) &&
    containsLocationSurface(promptKey, safeRegion)
  ) {
    return { region: safeRegion, city: null };
  }

  return { region: safeRegion, city: safeCity };
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

/** 저장 payload 생성. 고정 필드는 클라이언트 상수로 강제하고 위치는 최종 질문 문구에 맞춘다. */
export function buildInsertPayloads(
  candidates: SuggestionCandidate[],
  ctx: {
    orgId: string;
    questionSetId: string;
    region: string | null;
    city: string | null;
  },
): QuestionInsertPayload[] {
  return candidates.map((c) => {
    const location = resolveQuestionLocation(c.promptText, ctx.region, ctx.city);
    return {
      org_id: ctx.orgId,
      question_set_id: ctx.questionSetId,
      prompt_text: c.promptText.trim(),
      intent_type: c.intentType,
      language: "ko",
      country_code: "KR",
      region: location.region,
      city: location.city,
      weight: 1,
      data_class: "public",
      active: true,
    };
  });
}

/** Edge Function 에러를 사용자 안전 문구로 매핑. */
export function mapSuggestError(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("measurement_question_set_already_exists"))
    return "이미 이 업체의 측정 기준 질문이 만들어져 있습니다. 저장된 질문 세트를 사용해 주세요.";
  if (m.includes("market_first_generation_not_available"))
    return "이 업체는 새 측정 기준 질문을 다시 만들 수 없습니다. 저장된 질문 세트를 확인해 주세요.";
  if (m.includes("public_evidence_not_found"))
    return "공개 웹에서 업체의 서비스 근거를 충분히 확인하지 못했습니다. 업체 정보나 공개 페이지를 확인한 뒤 다시 시도해 주세요.";
  if (m.includes("public_evidence_check_failed"))
    return "업체의 공개 정보를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  if (m.includes("unauthorized") || m.includes("401")) return "권한이 없습니다. 다시 로그인해 주세요.";
  if (m.includes("forbidden") || m.includes("403")) return "이 업체에 대한 권한이 없습니다.";
  if (m.includes("ai_generation_failed") || m.includes("ai_output_invalid"))
    return "질문 후보 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  if (m.includes("server_not_configured")) return "관리자 설정이 필요합니다. 담당자에게 문의해 주세요.";
  return "질문 추천 중 오류가 발생했습니다.";
}
