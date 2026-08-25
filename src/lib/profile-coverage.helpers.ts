/**
 * Profile Coverage 관련 UI/DTO 타입과 비민감 표시 문구만 포함한다.
 * 추천/우선순위/실험 설계 규칙은 이 저장소에 없다.
 * (Supabase Edge Function `profile-coverage-recommendation`이 전담)
 */

/** Edge Function이 반환하는 추천 액션 최소 DTO */
export type CoverageRecommendationActionDTO = {
  coverage_item_id: string;
  question_text: string | null;
  intent_type: string | null;
  coverage_status: string;
  priority_level: "high" | "medium";
  title: string;
  rationale: string;
  profile_fields: string[];
  validation_plan: string;
  recommendation_mode: "test";
  measurement_count: number;
  mentioned_count: number;
  mention_rate: number;
};

export type CreateCoverageExperimentInput = {
  orgId: string;
  profileCoverageItemId: string;
};

export type CreateCoverageExperimentErrorCode =
  | "FORBIDDEN"
  | "COVERAGE_ITEM_NOT_FOUND"
  | "COVERAGE_ITEM_SCOPE_MISMATCH"
  | "COVERAGE_STATUS_NOT_EXPERIMENTABLE"
  | "COVERAGE_RUN_NOT_USABLE"
  | "COVERAGE_SOURCE_RUN_NOT_FOUND"
  | "QUESTION_SCOPE_MISMATCH"
  | "BUSINESS_SCOPE_MISMATCH"
  | "EXPERIMENT_ALREADY_ACTIVE"
  | "EXPERIMENT_CREATE_FAILED"
  | "INTERNAL_ERROR";

export type CreateCoverageExperimentDTO = {
  experimentId: string;
  status: string;
  name: string;
};

export type CreateCoverageExperimentResult =
  | { ok: true; experiment: CreateCoverageExperimentDTO }
  | { ok: false; error: CreateCoverageExperimentErrorCode; experimentId?: string | null };
