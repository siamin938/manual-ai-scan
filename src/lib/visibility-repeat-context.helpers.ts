/**
 * 반복 측정 보조 컨텍스트의 순수 표시 규칙.
 * 세는 것과 라벨을 만드는 것 외의 판정/점수 계산은 하지 않는다.
 */
import type {
  RepeatContextQuestionDTO,
  RepeatQuestionState,
  RepeatSourceSide,
} from "./visibility-repeat-context.types";

/** lower-case + 선행 www. 제거만 수행한다. */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith("www.") ? trimmed.slice(4) : trimmed;
}

export function resolveSourceSide(
  clientResponseCount: number,
  competitorResponseCount: number,
): RepeatSourceSide | null {
  const client = clientResponseCount > 0;
  const competitor = competitorResponseCount > 0;
  if (client && competitor) return "both";
  if (client) return "client";
  if (competitor) return "competitor";
  return null;
}

export const SOURCE_SIDE_LABEL: Record<RepeatSourceSide, string> = {
  client: "내 업체 중심",
  competitor: "경쟁업체 중심",
  both: "양쪽 관찰",
};

export function repeatQuestionState(validCount: number, mentionCount: number): RepeatQuestionState {
  if (mentionCount <= 0) return "never_visible";
  if (mentionCount >= validCount) return "always_visible";
  return "sometimes_visible";
}

/** 예: 2회 모두 미추천 / 1회 미추천 · 1회 추천 */
export function repeatQuestionLabel(validCount: number, mentionCount: number): string {
  const missingCount = Math.max(validCount - mentionCount, 0);
  if (mentionCount <= 0) return `${validCount}회 모두 미추천`;
  if (missingCount <= 0) return `${validCount}회 모두 추천`;
  return `${missingCount}회 미추천 · ${mentionCount}회 추천`;
}

const STATE_ORDER: Record<RepeatQuestionState, number> = {
  never_visible: 0,
  sometimes_visible: 1,
  always_visible: 2,
};

/** never_visible이 항상 먼저, 그다음 미추천 횟수가 많은 순. */
export function sortRepeatQuestions(
  questions: RepeatContextQuestionDTO[],
): RepeatContextQuestionDTO[] {
  return [...questions].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      b.validCount - b.mentionCount - (a.validCount - a.mentionCount) ||
      a.questionText.localeCompare(b.questionText),
  );
}
