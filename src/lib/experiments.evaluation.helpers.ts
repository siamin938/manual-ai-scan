// Experiment Baseline vs Follow-up 비교 엔진 v0.1 — pure helpers (client-safe types + 계산).
// 통계적 유의성/인과 판정 없음. 소표본 방향성(directional) 비교만 수행한다.

export type EvaluationErrorCode =
  | "FORBIDDEN"
  | "EXPERIMENT_NOT_FOUND"
  | "EVALUATION_INVALID_STATE"
  | "EVALUATION_BASELINE_NOT_FINALIZED"
  | "EVALUATION_FOLLOWUP_NOT_FINALIZED"
  | "EVALUATION_CONDITION_MISMATCH"
  | "EVALUATION_PARSER_DRIFT"
  | "EVALUATION_DATA_MISMATCH"
  | "EVALUATION_PIPELINE_PROVENANCE_MISMATCH"
  | "EVALUATION_ALREADY_RECORDED"
  | "INTERNAL_ERROR";

export type EvaluationOutcome =
  | "directional_improvement"
  | "directional_decline"
  | "no_clear_change";

export const EVALUATION_VERSION = "evaluation_v0.1";
export const EVALUATION_EVIDENCE_GRADE = "directional";
export const EVALUATION_PRIMARY_METRIC = "inclusion_rate";
export const EVALUATION_CLASSIFICATION_RULE =
  "v0.1: abs net inclusion count >=2 + same-direction >=2/3 questions + no opposite question";
export const EVALUATION_CAUTION =
  "동일 측정 조건에서 변경 전후에 관찰된 방향성 비교이며 인과효과를 확정하지 않습니다.";
export const EVALUATION_UI_CAUTION =
  "이 결과는 동일한 측정 조건에서 변경 전후에 관찰된 방향성 비교입니다. 소표본 실험이므로 특정 변경이 결과를 직접 유발했다고 확정하지 않습니다.";

/** 지표 계산 입력 (server에서만 조립; raw response_text 미포함) */
export type MeasurementFact = {
  measurementId: string;
  questionId: string;
  valid: boolean;
  wasClientMentioned: boolean;
  clientPosition: number | null;
  clientDomainCited: boolean;
  manualReviewRequired: boolean;
  parserVersion: string;
  providerModel: string;
  /** 등록된(pinned) 경쟁업체 mention이 1개 이상 존재하는지 */
  registeredCompetitorMention: boolean;
};

export type PhaseQuestionMetrics = {
  questionId: string;
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
};

export type PhaseMetrics = {
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
  top3Count: number;
  top3Rate: number | null;
  positionObservedCount: number;
  averagePositionAmongPositioned: number | null;
  medianPositionAmongPositioned: number | null;
  clientDomainCitedCount: number;
  clientDomainCitedRate: number | null;
  competitorPresentCount: number;
  competitorPresentRate: number | null;
  substitutionCount: number;
  substitutionRate: number | null;
  manualReviewRequiredCount: number;
  parserVersions: string[];
  providerModels: string[];
  byQuestion: PhaseQuestionMetrics[];
};

function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function isPositiveInt(v: number | null): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** valid measurement만 분모로 사용하는 결정적 지표 계산. */
export function computePhaseMetrics(facts: MeasurementFact[]): PhaseMetrics {
  const valid = facts.filter((f) => f.valid);
  const validCount = valid.length;
  const inclusionCount = valid.filter((f) => f.wasClientMentioned).length;
  const top3Count = valid.filter(
    (f) => f.wasClientMentioned && isPositiveInt(f.clientPosition) && f.clientPosition <= 3,
  ).length;
  const positions = valid
    .filter((f) => f.wasClientMentioned && isPositiveInt(f.clientPosition))
    .map((f) => f.clientPosition as number);
  const domainCited = valid.filter((f) => f.clientDomainCited).length;
  const competitorPresent = valid.filter((f) => f.registeredCompetitorMention).length;
  const substitution = valid.filter(
    (f) => !f.wasClientMentioned && f.registeredCompetitorMention,
  ).length;

  const byQuestionMap = new Map<string, { valid: number; inclusion: number }>();
  for (const f of valid) {
    const cur = byQuestionMap.get(f.questionId) ?? { valid: 0, inclusion: 0 };
    cur.valid += 1;
    if (f.wasClientMentioned) cur.inclusion += 1;
    byQuestionMap.set(f.questionId, cur);
  }

  return {
    validCount,
    inclusionCount,
    inclusionRate: rate(inclusionCount, validCount),
    top3Count,
    top3Rate: rate(top3Count, validCount),
    positionObservedCount: positions.length,
    averagePositionAmongPositioned:
      positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
    medianPositionAmongPositioned: median(positions),
    clientDomainCitedCount: domainCited,
    clientDomainCitedRate: rate(domainCited, validCount),
    competitorPresentCount: competitorPresent,
    competitorPresentRate: rate(competitorPresent, validCount),
    substitutionCount: substitution,
    substitutionRate: rate(substitution, validCount),
    manualReviewRequiredCount: valid.filter((f) => f.manualReviewRequired).length,
    parserVersions: [...new Set(facts.map((f) => f.parserVersion))].sort(),
    providerModels: [...new Set(facts.map((f) => f.providerModel))].sort(),
    byQuestion: [...byQuestionMap.entries()]
      .map(([questionId, v]) => ({
        questionId,
        validCount: v.valid,
        inclusionCount: v.inclusion,
        inclusionRate: rate(v.inclusion, v.valid),
      }))
      .sort((a, b) => (a.questionId < b.questionId ? -1 : 1)),
  };
}

export type QuestionDirection = "up" | "same" | "down";

export type QuestionResult = {
  questionId: string;
  baselineValidCount: number;
  followupValidCount: number;
  baselineInclusionCount: number;
  followupInclusionCount: number;
  deltaCount: number;
  deltaPp: number | null;
  direction: QuestionDirection;
};

/** rate 차이를 %p로. 한쪽이 null이면 null. */
export function deltaPp(baseRate: number | null, followRate: number | null): number | null {
  if (baseRate === null || followRate === null) return null;
  return (followRate - baseRate) * 100;
}

export function buildQuestionResults(
  baseline: PhaseMetrics,
  followup: PhaseMetrics,
): QuestionResult[] {
  const ids = [...new Set([...baseline.byQuestion, ...followup.byQuestion].map((q) => q.questionId))].sort();
  return ids.map((questionId) => {
    const b = baseline.byQuestion.find((q) => q.questionId === questionId);
    const f = followup.byQuestion.find((q) => q.questionId === questionId);
    const bCount = b?.inclusionCount ?? 0;
    const fCount = f?.inclusionCount ?? 0;
    const delta = fCount - bCount;
    return {
      questionId,
      baselineValidCount: b?.validCount ?? 0,
      followupValidCount: f?.validCount ?? 0,
      baselineInclusionCount: bCount,
      followupInclusionCount: fCount,
      deltaCount: delta,
      deltaPp: deltaPp(b?.inclusionRate ?? null, f?.inclusionRate ?? null),
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "same",
    };
  });
}

/**
 * v0.1 소표본 directional heuristic. 통계적 유의성 판정이 아니다.
 * - improvement: 전체 inclusion net count >= +2 AND questions_up >= 2 AND questions_down = 0
 * - decline:     전체 inclusion net count <= -2 AND questions_down >= 2 AND questions_up = 0
 * - 그 외 no_clear_change
 */
export function classifyOutcome(args: {
  inclusionDeltaCount: number;
  questionResults: QuestionResult[];
}): EvaluationOutcome {
  const up = args.questionResults.filter((q) => q.direction === "up").length;
  const down = args.questionResults.filter((q) => q.direction === "down").length;
  if (args.inclusionDeltaCount >= 2 && up >= 2 && down === 0) return "directional_improvement";
  if (args.inclusionDeltaCount <= -2 && down >= 2 && up === 0) return "directional_decline";
  return "no_clear_change";
}

/** DB의 result_classification 허용값으로 매핑. */
export function outcomeToResultClassification(outcome: EvaluationOutcome): string {
  if (outcome === "directional_improvement") return "improved_signal";
  if (outcome === "directional_decline") return "worsened_signal";
  return "no_clear_change";
}

/* ------------------------------------------------------------------ *
 * Client-safe DTO
 * ------------------------------------------------------------------ */

export type EvaluationPhaseDTO = {
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
  top3Count: number;
  top3Rate: number | null;
  substitutionCount: number;
  substitutionRate: number | null;
  domainCitedCount: number;
  domainCitedRate: number | null;
  averagePosition: number | null;
  positionObservedCount: number;
};

export type EvaluationQuestionDTO = {
  label: string;
  promptSnippet: string;
  baselineInclusionCount: number;
  baselineValidCount: number;
  followupInclusionCount: number;
  followupValidCount: number;
  deltaPp: number | null;
  direction: QuestionDirection;
};

export type ExperimentEvaluationDTO = {
  experimentId: string;
  outcome: EvaluationOutcome;
  evidenceGrade: "directional";
  recorded: boolean;
  evaluatedAt: string | null;
  baseline: EvaluationPhaseDTO;
  followup: EvaluationPhaseDTO;
  delta: {
    inclusionCount: number;
    inclusionPp: number | null;
    top3Pp: number | null;
    substitutionPp: number | null;
    domainCitationPp: number | null;
    averagePosition: number | null;
  };
  questionResults: EvaluationQuestionDTO[];
  quality: {
    baselineManualReviewCount: number;
    followupManualReviewCount: number;
    parserVersion: string;
    providerModel: string;
  };
  actionAppliedAt: string | null;
  actualChangeSummary: string | null;
  caution: string;
};

export type PreviewExperimentEvaluationInput = { orgId: string; experimentId: string };
export type FinalizeExperimentEvaluationInput = { orgId: string; experimentId: string };

export type PreviewExperimentEvaluationResult =
  | { ok: true; evaluation: ExperimentEvaluationDTO }
  | { ok: false; error: EvaluationErrorCode };

export type FinalizeExperimentEvaluationResult =
  | { ok: true; evaluation: ExperimentEvaluationDTO }
  | { ok: false; error: EvaluationErrorCode };

export function evaluationFail(
  error: EvaluationErrorCode,
): { ok: false; error: EvaluationErrorCode } {
  return { ok: false, error };
}

/** 질문 prompt는 고객 own-data지만 노출 최소화를 위해 잘라서 반환한다. */
export const PROMPT_SNIPPET_MAX = 120;
export function promptSnippet(text: string): string {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length <= PROMPT_SNIPPET_MAX ? t : `${t.slice(0, PROMPT_SNIPPET_MAX)}…`;
}
