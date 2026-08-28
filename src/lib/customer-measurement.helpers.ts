/**
 * Standalone audit 고객 측정 생성용 순수 헬퍼.
 *
 * 여기에는 고객에게 노출되지 않는 내부 용량/비용 계산만 있고,
 * 실제 단가(provider_settings.estimated_cost_per_request_usd)는 서버에서만 읽는다.
 * 프론트 DTO에는 원가/모델/provider 설정이 포함되지 않는다.
 */

/** standalone 고객 측정은 반복 1회 고정 (서버 강제). */
export const CUSTOMER_RUN_REPETITIONS = 1;

/** standalone 고객 측정은 엔진 1개 고정. */
export const CUSTOMER_RUN_ENGINE_COUNT = 1;

/** 실제 비용 오차를 흡수하기 위한 내부 headroom (서버 전용). */
const MAX_COST_HEADROOM_MULTIPLIER = 1.25;

export type CustomerMeasurementErrorCode =
  | "FORBIDDEN"
  | "INVALID_BUSINESS"
  | "INVALID_QUESTION_SET"
  | "NO_ACTIVE_QUESTIONS"
  | "RESTRICTED_QUESTIONS"
  | "DAILY_USAGE_LIMIT"
  | "MONTHLY_USAGE_LIMIT"
  | "MEASUREMENT_NOT_READY"
  | "INTERNAL_ERROR";

export type CreateCustomerMeasurementResult =
  | { ok: true; runId: string; plannedJobs: number }
  | { ok: false; error: CustomerMeasurementErrorCode };

const CUSTOMER_ERROR_MESSAGES: Record<CustomerMeasurementErrorCode, string> = {
  FORBIDDEN: "이 조직에서 AI 측정을 시작할 권한이 없습니다.",
  INVALID_BUSINESS: "선택한 업체 또는 질문 세트를 사용할 수 없습니다.",
  INVALID_QUESTION_SET: "선택한 업체 또는 질문 세트를 사용할 수 없습니다.",
  NO_ACTIVE_QUESTIONS: "측정할 활성 질문이 없습니다.",
  RESTRICTED_QUESTIONS: "측정할 수 없는 질문이 포함되어 있습니다. 질문을 확인해 주세요.",
  DAILY_USAGE_LIMIT: "오늘 가능한 AI 측정 횟수를 모두 사용했습니다.",
  MONTHLY_USAGE_LIMIT: "이번 달 AI 측정 가능량을 모두 사용했습니다.",
  MEASUREMENT_NOT_READY: "AI 측정을 준비할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  INTERNAL_ERROR: "AI 측정을 준비할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

export function customerErrorMessage(code: CustomerMeasurementErrorCode): string {
  return CUSTOMER_ERROR_MESSAGES[code] ?? CUSTOMER_ERROR_MESSAGES.INTERNAL_ERROR;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** 활성 public 질문 수 × 반복 1회 × 엔진 1개 */
export function calcPlannedJobs(activeQuestionCount: number): number {
  if (!Number.isFinite(activeQuestionCount) || activeQuestionCount <= 0) return 0;
  return Math.floor(activeQuestionCount) * CUSTOMER_RUN_REPETITIONS * CUSTOMER_RUN_ENGINE_COUNT;
}

export function calcEstimatedCostUsd(perRequestUsd: number, plannedJobs: number): number {
  if (!Number.isFinite(perRequestUsd) || perRequestUsd < 0) return 0;
  return Math.round(perRequestUsd * plannedJobs * 1e6) / 1e6;
}

/** 내부 max_cost_usd: estimated × 1.25를 센트 단위 올림. estimated보다 작아질 수 없다. */
export function calcInternalMaxCostUsd(estimatedCostUsd: number): number {
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd <= 0) return 0.01;
  const withHeadroom = estimatedCostUsd * MAX_COST_HEADROOM_MULTIPLIER;
  const ceiled = Math.ceil(Math.round(withHeadroom * 1e6) / 1e4) / 100;
  return Math.max(ceiled, Math.ceil(estimatedCostUsd * 100) / 100);
}

export type UsageSnapshot = {
  dailyRequests: number;
  monthlyActualCostUsd: number;
  monthlyReservedCostUsd: number;
};

export type OrgLimits = {
  dailyRequestLimit: number;
  monthlyBudgetUsd: number;
};

/** run insert 이전 fail-closed 용량/예산 판정. */
export function checkUsageAllowance(args: {
  usage: UsageSnapshot;
  limits: OrgLimits;
  plannedJobs: number;
  maxCostUsd: number;
}): CustomerMeasurementErrorCode | null {
  const { usage, limits, plannedJobs, maxCostUsd } = args;
  if (usage.dailyRequests + plannedJobs > limits.dailyRequestLimit) return "DAILY_USAGE_LIMIT";
  const projected = usage.monthlyActualCostUsd + usage.monthlyReservedCostUsd + maxCostUsd;
  if (projected > limits.monthlyBudgetUsd) return "MONTHLY_USAGE_LIMIT";
  return null;
}

export function defaultRunName(businessName: string | null | undefined, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const base = (businessName ?? "").trim();
  return base ? `${base} 측정 ${date}` : `AI 측정 ${date}`;
}
