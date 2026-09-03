/**
 * 반복 측정(compatible run) 보조 컨텍스트 DTO.
 * 기존 `visibility-diagnostic` 계약과 분리된 최소 표시용 데이터만 담는다.
 * 점수/threshold/원인 판단은 포함하지 않는다 (Core Engine Isolation).
 */

export type RepeatSourceSide = "client" | "competitor" | "both";

export type RepeatContextSourceDTO = {
  /** lower-case + www 제거 수준으로만 정규화한 도메인 */
  domain: string;
  clientResponseCount: number;
  competitorResponseCount: number;
  side: RepeatSourceSide;
};

export type RepeatQuestionState = "never_visible" | "sometimes_visible" | "always_visible";

export type RepeatContextQuestionDTO = {
  questionId: string;
  questionText: string;
  intentType: string;
  validCount: number;
  mentionCount: number;
  state: RepeatQuestionState;
};

export type VisibilityRepeatContextDTO = {
  compatibleRunCount: number;
  sources: RepeatContextSourceDTO[];
  /** always_visible 질문은 포함하지 않는다. */
  questions: RepeatContextQuestionDTO[];
};

export type VisibilityRepeatContextResponseDTO =
  | { ok: true; context: VisibilityRepeatContextDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };
