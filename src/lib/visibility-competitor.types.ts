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

/** `visibility-competitor-compare` Edge Function 응답 계약. */
export type CompetitorCompareOverviewDTO = {
  validCount: number;
  clientResponseCount: number;
  clientResponseRatePct: number | null;
  clientTop3ResponseCount: number;
  clientTop3RatePct: number | null;
  competitorResponseCount: number;
  competitorResponseRatePct: number | null;
  competitorTop3ResponseCount: number;
  competitorTop3RatePct: number | null;
};

export type CompetitorCompareQuestionGroupDTO = {
  intentType: string;
  questionCount: number;
  measurementCount: number;
  clientResponseCount: number;
  clientResponseRatePct: number | null;
  clientTop3ResponseCount: number;
  clientTop3RatePct: number | null;
  competitorResponseCount: number;
  competitorResponseRatePct: number | null;
  competitorTop3ResponseCount: number;
  competitorTop3RatePct: number | null;
};

export type CompetitorCompareQuestionDTO = {
  questionId: string;
  questionText: string;
  intentType: string;
  measurementCount: number;
  clientResponseCount: number;
  clientResponseRatePct: number | null;
  clientTop3ResponseCount: number;
  clientTop3RatePct: number | null;
  clientBestPosition: number | null;
  competitorResponseCount: number;
  competitorResponseRatePct: number | null;
  competitorTop3ResponseCount: number;
  competitorTop3RatePct: number | null;
  competitorBestPosition: number | null;
  bothResponseCount: number;
};

export type CompetitorCompareObservedIn = "both" | "client_only" | "competitor_only";

export type CompetitorCompareSourceDTO = {
  domain: string;
  observedIn: CompetitorCompareObservedIn;
  clientCitationCount: number;
  clientResponseCount: number;
  clientResponseRatePct: number | null;
  competitorCitationCount: number;
  competitorResponseCount: number;
  competitorResponseRatePct: number | null;
  sampleTitle: string | null;
};

export type CompetitorCompareDTO = {
  generatedAt: string;
  scope: CompetitorScopeDTO;
  business: CompetitorBusinessDTO;
  competitor: CompetitorRefDTO;
  overview: CompetitorCompareOverviewDTO;
  questionGroups: CompetitorCompareQuestionGroupDTO[];
  questions: CompetitorCompareQuestionDTO[];
  sources: CompetitorCompareSourceDTO[];
  attributedSources: CompetitorAttributedSourceDTO[];
};

export type CompetitorCompareResponseDTO =
  | { ok: true; compare: CompetitorCompareDTO }
  | { ok: false; error: CompetitorErrorCode };

/**
 * 업체 ↔ citation attribution 집계 (`measurement_citation_attributions` 기반).
 * `direct` = 업체 설명 문장/행에 붙은 citation, `section` = 같은 업체 설명 구간.
 * attribution row가 없으면 0이며, 기존 answer-level `sources`는 그대로 유지된다.
 */
export type CompetitorAttributedSourceDTO = {
  domain: string;
  sampleTitle: string | null;
  clientDirectResponseCount: number;
  clientSectionResponseCount: number;
  clientDirectCitationCount: number;
  clientSectionCitationCount: number;
  competitorDirectResponseCount: number;
  competitorSectionResponseCount: number;
  competitorDirectCitationCount: number;
  competitorSectionCitationCount: number;
};
