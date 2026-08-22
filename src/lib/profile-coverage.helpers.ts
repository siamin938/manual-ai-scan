/**
 * Profile Coverage deterministic action helper.
 * UI(대시보드 카드)와 실험 생성(제목/가설)이 같은 규칙을 쓰도록 공유한다.
 * 순수 함수만 포함한다. DB/AI 호출 없음.
 */

export const COVERAGE_VALIDATION_PLAN =
  "공개 페이지/프로필에 해당 정보를 명확히 반영한 뒤 같은 질문 세트와 같은 측정 조건으로 재측정해 노출률, Top 3 노출률, 자사 도메인 인용률의 변화를 비교합니다.";

/** Profile Coverage 기반 실험의 내부 action_type (기존 Insight action_type과 구분) */
export const COVERAGE_EXPERIMENT_ACTION_TYPE = "profile_coverage_test";

/** 실험 생성이 가능한 coverage_status */
export const EXPERIMENTABLE_COVERAGE_STATUSES = ["missing", "partial"] as const;

const TITLE_BY_INTENT: Record<string, string> = {
  trust: "신뢰 근거 보강 테스트",
  review_quality: "후기 근거 구조화 테스트",
  recommendation: "추천 기준 정보 보강 테스트",
};

const FIELDS_BY_INTENT: Record<string, string[]> = {
  trust: [
    "가격·작업 범위의 명확한 안내",
    "정비/서비스 절차",
    "보증·A/S·사후관리 정보",
    "공식 운영 주체·브랜드 근거",
  ],
  review_quality: [
    "실제 작업 내용이 포함된 구체 후기",
    "차량/서비스 항목이 명시된 사례",
    "최근 후기와 작성 시점",
    "공개적으로 확인 가능한 후기 출처",
  ],
  recommendation: [
    "제공 서비스 범위",
    "지역·지점 정보",
    "차종/브랜드 대응 범위",
    "경쟁 업체와 구분되는 특징",
    "공식 페이지에서 확인 가능한 근거",
  ],
};

const DEFAULT_TITLE = "업체 프로필 정보 보강 테스트";
const DEFAULT_FIELDS = [
  "핵심 서비스 범위",
  "지역·지점 정보",
  "대상 고객/차종 범위",
  "차별점",
  "공식 공개 근거",
];

export type CoverageActionInput = {
  intent_type: string | null;
  coverage_status: string;
  measurement_count: number;
  mentioned_count: number;
};

export function coverageActionTitle(intentType: string | null): string {
  return TITLE_BY_INTENT[intentType ?? ""] ?? DEFAULT_TITLE;
}

export function coverageActionFields(intentType: string | null): string[] {
  return FIELDS_BY_INTENT[intentType ?? ""] ?? DEFAULT_FIELDS;
}

export function coverageActionPriority(coverageStatus: string): "high" | "medium" {
  return coverageStatus === "missing" ? "high" : "medium";
}

export function coverageActionRationale(input: CoverageActionInput): string {
  if (input.coverage_status === "missing") {
    return `현재 이 질문은 ${input.measurement_count}회 측정에서 대상 업체가 한 번도 노출되지 않았습니다. 어떤 정보가 노출에 영향을 주는지는 아직 확인되지 않았으므로, 아래 프로필 정보를 보강한 뒤 동일 조건 재측정으로 검증하는 테스트 후보입니다.`;
  }
  return `현재 이 질문은 ${input.measurement_count}회 중 ${input.mentioned_count}회만 대상 업체가 노출되었습니다. 노출이 불안정하게 관찰되어, 아래 프로필 정보를 보강한 뒤 동일 조건 재측정으로 검증하는 테스트 후보입니다.`;
}

/** 실험 이름 (결정적). 인과 확정 표현 없음. */
export function coverageExperimentName(intentType: string | null): string {
  return `실험: ${coverageActionTitle(intentType).slice(0, 120)}`;
}

/** 실험 가설 (결정적). 인과 확정 표현 없음. */
export function coverageExperimentHypothesis(args: {
  intent_type: string | null;
  coverage_status: string;
  measurement_count: number;
  mentioned_count: number;
  question_text: string | null;
}): string {
  const observed =
    args.coverage_status === "missing"
      ? `${args.measurement_count}회 측정에서 노출 0회`
      : `${args.measurement_count}회 중 ${args.mentioned_count}회만 노출`;
  const question = (args.question_text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const scope = question ? `"${question}" 질문에서` : "해당 질문에서";
  return `${scope} 현재 커버리지 공백(${observed})이 관찰되었다. ${coverageActionFields(args.intent_type).join(", ")} 등 공개 프로필 정보를 보강한 뒤 동일한 질문·Provider·측정 조건으로 재측정하면 노출 지표가 개선 방향으로 변화하는지 검증한다. (인과관계 확정이 아니라 방향성 관찰을 목적으로 한다.)`;
}

/* =========================================================================
 * Profile Coverage Experiment Bridge v0.1 — 타입
 * ========================================================================= */

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
