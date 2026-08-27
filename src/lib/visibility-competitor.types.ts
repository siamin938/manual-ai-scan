/**
 * `visibility-competitor-resolve` / `visibility-competitor-detail` Edge Function 응답 계약.
 * 계산/판정 규칙은 포함하지 않는다 (Core Engine Isolation).
 */

export type CompetitorRefDTO = {
  name: string;
  ref: string;
};

export type CompetitorSummaryDTO = {
  ref: string;
  name: string;
  mentionCount: number;
  responseCount: number;
  responseRatePct: number | null;
  top3ResponseCount: number;
  top3RatePct: number | null;
};

export type CompetitorScopeDTO = {
  runId: string;
  runName: string;
  measuredAt: string;
};

export type CompetitorBusinessDTO = {
  id: string;
  name: string;
};

export type CompetitorQuestionGroupDTO = {
  intentType: string;
  questionCount: number;
  measurementCount: number;
  responseCount: number;
  mentionCount: number;
  responseRatePct: number | null;
  top3RatePct: number | null;
};

export type CompetitorQuestionDTO = {
  questionId: string;
  questionText: string;
  intentType: string;
  measurementCount: number;
  responseCount: number;
  mentionCount: number;
  responseRatePct: number | null;
  top3ResponseCount: number;
  top3RatePct: number | null;
  bestPosition: number | null;
};

export type CompetitorSourceDTO = {
  domain: string;
  citationCount: number;
  responseCount: number;
  responseRatePct: number | null;
  sampleTitle: string | null;
};

export type CompetitorDetailDTO = {
  generatedAt: string;
  scope: CompetitorScopeDTO;
  business: CompetitorBusinessDTO;
  competitor: CompetitorSummaryDTO;
  questionGroups: CompetitorQuestionGroupDTO[];
  questions: CompetitorQuestionDTO[];
  sources: CompetitorSourceDTO[];
};

/** 고객에게는 내부 코드를 노출하지 않고 일반 문구로만 표시한다. */
export type CompetitorErrorCode = "NOT_AVAILABLE" | "FORBIDDEN" | "INVALID_DTO" | "INTERNAL_ERROR";

export type CompetitorResolveResponseDTO =
  | { ok: true; competitor: CompetitorRefDTO }
  | { ok: false; error: CompetitorErrorCode };

export type CompetitorDetailResponseDTO =
  | { ok: true; detail: CompetitorDetailDTO }
  | { ok: false; error: CompetitorErrorCode };
