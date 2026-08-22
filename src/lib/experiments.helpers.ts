export type CreateExperimentInput = {
  orgId: string;
  insightActionId: string;
};

export type CreateExperimentErrorCode =
  | "FORBIDDEN"
  | "INSIGHT_ACTION_NOT_FOUND"
  | "ACTION_SCOPE_MISMATCH"
  | "ACTION_MODE_NOT_EXPERIMENTABLE"
  | "ACTION_STATUS_NOT_EXPERIMENTABLE"
  | "BUSINESS_SCOPE_MISMATCH"
  | "ENGINE_RUN_SCOPE_MISMATCH"
  | "PRIMARY_FINDING_SCOPE_MISMATCH"
  | "EXPERIMENT_ALREADY_ACTIVE"
  | "EXPERIMENT_CREATE_FAILED"
  | "INTERNAL_ERROR";

export type CreateExperimentDTO = {
  experimentId: string;
  status: string;
  name: string;
  businessId: string;
  sourceInsightActionId: string;
};

export type CreateExperimentResult =
  | { ok: true; experiment: CreateExperimentDTO }
  | { ok: false; error: CreateExperimentErrorCode; experimentId?: string | null };

/** 아직 종료되지 않은(진행 중) 실험 상태. completed/cancelled는 재실험 허용. */
export const ACTIVE_STATUSES = ["draft", "baseline", "action_applied", "followup"] as const;

/** Experiment 생성 권한이 있는 조직 역할 */
export const ALLOWED_ROLES = ["owner", "admin", "analyst"] as const;

/** v0.1에서 실험 생성이 가능한 Action recommendation_mode */
export const EXPERIMENTABLE_MODES = ["test"] as const;

/** v0.1에서 실험 생성이 가능한 Action status (in_progress 이후는 baseline 신뢰 불가) */
export const EXPERIMENTABLE_ACTION_STATUSES = ["proposed", "accepted"] as const;

export function fail(
  error: CreateExperimentErrorCode,
  experimentId?: string | null,
): CreateExperimentResult {
  return experimentId ? { ok: false, error, experimentId } : { ok: false, error };
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** 결정적(재현 가능) 가설 템플릿. AI 호출 없음, 인과 확정 표현 없음. */
export function buildHypothesis(action: {
  recommended_action: string | null;
  rationale: string | null;
  title: string;
  metric_hint?: string | null;
}): string {
  const act = clean(action.recommended_action) || clean(action.title);
  const observed = clean(action.metric_hint) || clean(action.rationale) || clean(action.title);
  return `${act}을(를) 적용한 뒤 동일한 질문·Provider·측정 조건으로 재측정하면, 현재 관찰된 "${observed}" 지표가 개선 방향으로 변화하는지 검증한다. (인과관계 확정이 아니라 방향성 관찰을 목적으로 한다.)`;
}

export function buildName(title: string): string {
  const base = clean(title) || "인사이트 기반 실험";
  return `실험: ${base.slice(0, 120)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * 잘못된 입력은 고정 코드만 담은 일반 Error로 던진다.
 * HTTP 400 변환은 커스텀 레이어(src/start.ts errorMiddleware)가 담당한다.
 * generated 파일이나 HTTP API에 의존하지 않는다.
 */
export function badRequest(code: "INVALID_ORG" | "INVALID_ACTION"): Error {
  return new Error(code);
}
