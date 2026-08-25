// Experiment 평가 결과의 UI 계약(타입/DTO)만 정의한다.
// 평가 지표 계산, 질문별 방향 판정, classification rule, threshold, 가중치 등
// 내부 평가 로직은 이 저장소에 존재하지 않으며 Supabase Edge Function
// `experiment-evaluation`이 전담한다.

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

export type QuestionDirection = "up" | "same" | "down";

/** UI 안내 문구(비민감). 판정 규칙이 아니다. */
export const EVALUATION_UI_CAUTION =
  "이 결과는 동일한 측정 조건에서 변경 전후에 관찰된 방향성 비교입니다. 소표본 실험이므로 특정 변경이 결과를 직접 유발했다고 확정하지 않습니다.";

/* ------------------------------------------------------------------ *
 * Edge Function이 반환하는 최소 DTO
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
