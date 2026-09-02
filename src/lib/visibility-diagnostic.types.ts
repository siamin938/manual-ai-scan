/**
 * `visibility-diagnostic` Edge Function 응답 계약 (camelCase 그대로).
 * 계산/판정 규칙은 포함하지 않는다 (Core Engine Isolation).
 */

export type VisibilityBusinessDTO = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  city: string | null;
};

export type VisibilityScopeDTO = {
  runId: string;
  runName: string;
  measuredAt: string;
  runType: "audit";
  phase: "standalone";
  providers: string[];
  repetitions: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  experimentRunsExcluded: true;
};

export type VisibilityOverviewDTO = {
  validCount: number;
  invalidCount: number;
  mentionCount: number;
  visibilityRatePct: number | null;
  top3Count: number;
  top3RatePct: number | null;
  questionCount: number;
  coveredQuestionCount: number;
  questionCoverageRatePct: number | null;
};

export type VisibilityQuestionGroupDTO = {
  intentType: string;
  questionCount: number;
  measurementCount: number;
  mentionCount: number;
  visibilityRatePct: number | null;
  top3RatePct: number | null;
};

export type VisibilityCompetitorDTO = {
  name: string;
  mentionCount: number;
  responseCount: number;
  responseRatePct: number | null;
  /** Competitor Significance Gate v0.1 — 계산 규칙은 서버에만 존재 */
  tier: "core" | "notable";
  tierLabel: string;
  questionCount: number;
  top3ResponseCount: number;
  priorRunPresenceCount: number;
  isNew: boolean;
};

/** Competitor Significance Gate v0.1 집계 요약 (watchCount는 목록 미노출). */
export type VisibilityCompetitorGateDTO = {
  version: "0.1";
  coreCount: number;
  notableCount: number;
  watchCount: number;
};

export type VisibilitySourceDTO = {
  domain: string;
  citationCount: number;
  responseCount: number;
  responseRatePct: number | null;
  sampleTitle: string | null;
};

export type VisibilityPriorityAreaDTO = {
  questionId: string;
  questionText: string;
  intentType: string;
  status: "missing" | "partial";
  measurementCount: number;
  mentionCount: number;
  visibilityRatePct: number | null;
};

export type VisibilityDataQualityDTO = {
  measurementRowsCapped: boolean;
  sourceRowsCapped: boolean;
};

export type VisibilityDiagnosticBodyDTO = {
  scope: VisibilityScopeDTO;
  overview: VisibilityOverviewDTO;
  questionGroups: VisibilityQuestionGroupDTO[];
  competitors: VisibilityCompetitorDTO[];
  competitorGate: VisibilityCompetitorGateDTO | null;
  sources: VisibilitySourceDTO[];
  /** 한 번만 함께 관찰된 참고 출처 (서버 판정 결과 그대로) */
  referenceSources: VisibilitySourceDTO[];
  priorityAreas: VisibilityPriorityAreaDTO[];
  dataQuality: VisibilityDataQualityDTO;
};

export type VisibilityTrendPointDTO = {
  measuredAt: string;
  validCount: number;
  mentionCount: number;
  visibilityRatePct: number | null;
  top3RatePct: number | null;
};

export type VisibilityDiagnosticDTO = {
  generatedAt: string;
  business: VisibilityBusinessDTO;
  diagnostic: VisibilityDiagnosticBodyDTO;
  trend: VisibilityTrendPointDTO[];
};

export type VisibilityDiagnosticErrorCode =
  | "NO_DATA"
  | "FORBIDDEN"
  | "INVALID_DTO"
  | "INTERNAL_ERROR";

export type VisibilityDiagnosticResponseDTO =
  | { ok: true; diagnostic: VisibilityDiagnosticDTO }
  | {
      ok: false;
      error: VisibilityDiagnosticErrorCode;
      /** NO_DATA일 때만 채워지는 업체 표시용 최소 정보 */
      business?: VisibilityBusinessDTO;
    };

/** `visibility-repeat-aggregate` Edge Function 응답 계약 (계산 규칙은 서버에만 존재). */
export type VisibilityRepeatAggregateDTO = {
  compatibilityMode: "strict_same_conditions";
  compatibleRunCount: number;
  measurementCount: number;
  validCount: number;
  mentionCount: number;
  visibilityRatePct: number | null;
  top3Count: number;
  top3RatePct: number | null;
  questionCount: number;
  alwaysVisibleQuestionCount: number;
  sometimesVisibleQuestionCount: number;
  neverVisibleQuestionCount: number;
  windowStart: string;
  windowEnd: string;
  latestRunId: string;
};

export type VisibilityRepeatAggregateResponseDTO =
  | {
      ok: true;
      generatedAt: string;
      business: { id: string; name: string };
      aggregate: VisibilityRepeatAggregateDTO | null;
    }
  | { ok: false; error: string };

