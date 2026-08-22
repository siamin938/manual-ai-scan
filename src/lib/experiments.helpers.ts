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
export function badRequest(code: "INVALID_ORG" | "INVALID_ACTION" | "INVALID_EXPERIMENT"): Error {
  return new Error(code);
}


/* =========================================================================
 * Experiment Baseline v0.1 — 타입 / 순수 helper
 * (DB write, enqueue, Provider 호출 없음)
 * ========================================================================= */

export type StartExperimentBaselineInput = {
  orgId: string;
  experimentId: string;
};

export type FinalizeExperimentBaselineInput = {
  orgId: string;
  experimentId: string;
};

export type BaselineErrorCode =
  | "FORBIDDEN"
  | "EXPERIMENT_NOT_FOUND"
  | "INVALID_EXPERIMENT_STATE"
  | "SOURCE_ACTION_SCOPE_MISMATCH"
  | "SOURCE_RUN_NOT_FOUND"
  | "QUESTION_SET_NOT_FOUND"
  | "QUESTION_SET_CHANGED"
  | "NON_PUBLIC_QUESTION"
  | "PROVIDER_NOT_READY"
  | "RUN_COST_CAP_EXCEEDED"
  | "BASELINE_ALREADY_EXISTS"
  | "BASELINE_PREPARE_FAILED"
  | "BASELINE_ENQUEUE_NOT_READY"
  | "BASELINE_RUN_NOT_COMPLETED"
  | "BASELINE_FINALIZE_MISMATCH"
  | "BASELINE_CONDITION_DRIFT"
  | "INTERNAL_ERROR";

export type StartExperimentBaselineErrorCode = BaselineErrorCode;
export type FinalizeExperimentBaselineErrorCode = BaselineErrorCode;

/** 클라이언트에 노출해도 되는 최소 요약. snapshot 전체는 절대 반환하지 않는다. */
export type BaselinePlanSummary = {
  questionCount: number;
  provider: "openai";
  model: string;
  repetitions: number;
  plannedJobs: number;
  estimatedCostUsd: number;
  maxCostUsd: number;
};

export type StartExperimentBaselineResult =
  | { ok: true; summary: BaselinePlanSummary }
  | { ok: false; error: StartExperimentBaselineErrorCode; summary?: BaselinePlanSummary };

export type FinalizeExperimentBaselineResult =
  | {
      ok: true;
      observed: {
        measurementCount: number;
        validMeasurementCount: number;
        parserVersions: string[];
        providerModels: string[];
      };
    }
  | { ok: false; error: FinalizeExperimentBaselineErrorCode };

export type SnapshotQuestion = {
  id: string;
  /** 원문 그대로. NFKC/whitespace 정규화 금지 (실제 LLM 입력 재현성). */
  prompt_text: string;
  prompt_hash: string | null;
  intent_type: string;
  language: string;
  country_code: string;
  region: string | null;
  city: string | null;
  weight: number;
  data_class: string;
  active: boolean;
};

export type SnapshotBusinessRef = {
  id: string;
  name: string;
  aliases: string[];
  official_domains: string[];
  website_url: string | null;
};

export type ExperimentConditionSnapshotV1 = {
  snapshot_version: "1";
  captured_at: string;
  experiment_id: string;
  org_id: string;
  business_id: string;
  source_insight_action_id: string;
  reference_source_run_id: string;
  question_set_id: string;
  questions: SnapshotQuestion[];
  planned: {
    selected_providers: ["openai"];
    provider_models: Record<string, string>;
    repetitions: number;
    search_context_size: string;
    store: false;
    planned_jobs: number;
    estimated_cost_usd: number;
    max_cost_usd: number;
  };
  /**
   * Provider로 전송되지 않는다. Baseline/Followup 파서가 동일한 업체/경쟁사
   * 사전(name/aliases/domains)으로 재현 가능하도록 보관하는 로컬 parser context.
   */
  parsing_context: {
    target: SnapshotBusinessRef;
    competitors: SnapshotBusinessRef[];
  };
  condition_hash: string;
  observed: {
    provider_models: string[] | null;
    parser_versions: string[] | null;
    measurement_count: number | null;
    valid_measurement_count: number | null;
    run_started_at: string | null;
    run_completed_at: string | null;
    finalized_at: string | null;
  };
  primary_metric: "inclusion_rate";
  secondary_metrics: string[];
};

/** 서버 상수 (클라이언트 입력 금지) */
export const BASELINE_REPETITIONS = 5;
export const BASELINE_MAX_COST_USD = 1.0;
export const BASELINE_EXPECTED_QUESTION_COUNT = 3;
export const BASELINE_SELECTED_PROVIDERS = ["openai"] as const;
export const BASELINE_PRIMARY_METRIC = "inclusion_rate" as const;
export const BASELINE_SECONDARY_METRICS = ["top3_rate"] as const;

export function baselineFail(
  error: BaselineErrorCode,
  summary?: BaselinePlanSummary,
): { ok: false; error: BaselineErrorCode; summary?: BaselinePlanSummary } {
  return summary ? { ok: false, error, summary } : { ok: false, error };
}

/**
 * 재귀적으로 object key를 정렬하는 stable stringify.
 * undefined 처리 정책: undefined는 null과 동일하게 'null' 문자열로 직렬화한다.
 * (JSON.stringify(undefined)는 undefined를 반환해 canonical JSON을 깨뜨린다.)
 * 배열 요소 / object 값 / 최상위 값 모두 동일 규칙을 적용하며,
 * Edge Function(Deno)에서도 같은 코드로 재구현 가능한 순수 로직이다.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const out = JSON.stringify(value);
    return out === undefined ? "null" : out;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  // key는 값이 undefined여도 생략하지 않는다 (deterministic).
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** 허용되는 search_context_size 값 (DB 제약과 동일) */
export const ALLOWED_SEARCH_CONTEXT_SIZES = ["low", "medium", "high"] as const;


function canonicalBusiness(b: SnapshotBusinessRef) {
  return {
    id: b.id,
    name: b.name,
    // hash 계산용으로만 정렬. 저장되는 snapshot 원문 배열은 변조하지 않는다.
    aliases: [...(b.aliases ?? [])].sort(),
    official_domains: [...(b.official_domains ?? [])].sort(),
    website_url: b.website_url ?? null,
  };
}

export type ConditionHashInput = {
  question_set_id: string;
  questions: SnapshotQuestion[];
  selected_providers: readonly string[];
  provider_models: Record<string, string>;
  repetitions: number;
  search_context_size: string;
  store: boolean;
  parsing_context: { target: SnapshotBusinessRef; competitors: SnapshotBusinessRef[] };
};

/** condition_hash 계산용 canonical object. prompt_text는 원문 그대로 사용한다. */
export function buildConditionCanonical(input: ConditionHashInput) {
  return {
    question_set_id: input.question_set_id,
    questions: [...input.questions]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((q) => ({
        id: q.id,
        prompt_text: q.prompt_text,
        prompt_hash: q.prompt_hash ?? null,
        intent_type: q.intent_type,
        language: q.language,
        country_code: q.country_code,
        region: q.region ?? null,
        city: q.city ?? null,
        weight: q.weight,
        data_class: q.data_class,
        active: q.active,
      })),
    selected_providers: [...input.selected_providers].sort(),
    provider_models: Object.keys(input.provider_models)
      .sort()
      .reduce<Record<string, string>>((acc, k) => {
        acc[k] = input.provider_models[k]!;
        return acc;
      }, {}),
    repetitions: input.repetitions,
    search_context_size: input.search_context_size,
    store: input.store,
    parsing_context: {
      target: canonicalBusiness(input.parsing_context.target),
      competitors: [...input.parsing_context.competitors]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(canonicalBusiness),
    },
  };
}

/** Web Crypto SHA-256 (외부 패키지 없음). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeConditionHash(input: ConditionHashInput): Promise<string> {
  return sha256Hex(stableStringify(buildConditionCanonical(input)));
}

/**
 * Followup 준비용 순수 비교 helper. 아직 followup server function/UI는 없다.
 * condition_hash가 다르면 BASELINE_CONDITION_DRIFT.
 */
export function compareConditionSnapshots(
  baselineHash: string | null | undefined,
  followupHash: string | null | undefined,
): { match: true } | { match: false; error: "BASELINE_CONDITION_DRIFT" } {
  if (!baselineHash || !followupHash || baselineHash !== followupHash) {
    return { match: false, error: "BASELINE_CONDITION_DRIFT" };
  }
  return { match: true };
}

export function assertBaselineConditionMatch(
  baselineHash: string | null | undefined,
  followupHash: string | null | undefined,
): void {
  const result = compareConditionSnapshots(baselineHash, followupHash);
  if (!result.match) throw new Error(result.error);
}
