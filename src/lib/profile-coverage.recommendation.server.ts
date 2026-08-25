// Core Engine Isolation: 이 파일은 Supabase Edge Function `profile-coverage-recommendation`
// 호출 wrapper일 뿐이다. 추천 규칙/우선순위/문구 생성/상태 판정은 이 저장소에 없다.
// 요청은 현재 사용자 JWT로 전송되며 최소 식별자만 보낸다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  CoverageRecommendationActionDTO,
  CreateCoverageExperimentErrorCode,
  CreateCoverageExperimentResult,
} from "./profile-coverage.helpers";

type UserClient = SupabaseClient<Database>;

const RECOMMENDATION_FUNCTION = "profile-coverage-recommendation";

const ERROR_CODES = new Set<CreateCoverageExperimentErrorCode>([
  "FORBIDDEN",
  "COVERAGE_ITEM_NOT_FOUND",
  "COVERAGE_ITEM_SCOPE_MISMATCH",
  "COVERAGE_STATUS_NOT_EXPERIMENTABLE",
  "COVERAGE_RUN_NOT_USABLE",
  "COVERAGE_SOURCE_RUN_NOT_FOUND",
  "QUESTION_SCOPE_MISMATCH",
  "BUSINESS_SCOPE_MISMATCH",
  "EXPERIMENT_ALREADY_ACTIVE",
  "EXPERIMENT_CREATE_FAILED",
  "INTERNAL_ERROR",
]);

function asErrorCode(value: unknown): CreateCoverageExperimentErrorCode {
  return typeof value === "string" && ERROR_CODES.has(value as CreateCoverageExperimentErrorCode)
    ? (value as CreateCoverageExperimentErrorCode)
    : "INTERNAL_ERROR";
}

async function invoke(
  supabase: UserClient,
  body: Record<string, string>,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: CreateCoverageExperimentErrorCode }> {
  const { data, error } = await supabase.functions.invoke(RECOMMENDATION_FUNCTION, { body });

  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const parsed = (await ctx.clone().json()) as { error?: unknown };
        if (parsed?.error !== undefined) return { ok: false, error: asErrorCode(parsed.error) };
      } catch {
        /* body 파싱 실패는 INTERNAL_ERROR로 취급 */
      }
    }
    console.error(`[coverage-recommendation] ${RECOMMENDATION_FUNCTION} invoke failed`);
    return { ok: false, error: "INTERNAL_ERROR" };
  }

  const payload = (data ?? null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return { ok: false, error: "INTERNAL_ERROR" };
  if (payload["ok"] !== true) return { ok: false, error: asErrorCode(payload["error"]) };
  return { ok: true, payload };
}

/** Edge Function이 준 최소 DTO를 형태만 확인하고 통과시킨다. */
function asActionDTO(value: unknown): CoverageRecommendationActionDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  if (typeof a["coverage_item_id"] !== "string") return null;
  if (typeof a["title"] !== "string") return null;
  return {
    coverage_item_id: a["coverage_item_id"] as string,
    question_text: typeof a["question_text"] === "string" ? (a["question_text"] as string) : null,
    intent_type: typeof a["intent_type"] === "string" ? (a["intent_type"] as string) : null,
    coverage_status: typeof a["coverage_status"] === "string" ? (a["coverage_status"] as string) : "",
    priority_level: a["priority_level"] === "medium" ? "medium" : "high",
    title: a["title"] as string,
    rationale: typeof a["rationale"] === "string" ? (a["rationale"] as string) : "",
    profile_fields: Array.isArray(a["profile_fields"])
      ? (a["profile_fields"] as unknown[]).filter((f): f is string => typeof f === "string")
      : [],
    validation_plan: typeof a["validation_plan"] === "string" ? (a["validation_plan"] as string) : "",
    recommendation_mode: "test",
    measurement_count: Number(a["measurement_count"] ?? 0),
    mentioned_count: Number(a["mentioned_count"] ?? 0),
    mention_rate: Number(a["mention_rate"] ?? 0),
  };
}

/** mode: "overview" — 추천 액션 최소 DTO 목록 (정렬은 Edge Function이 결정) */
export async function fetchCoverageRecommendationActions(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
}): Promise<CoverageRecommendationActionDTO[]> {
  const res = await invoke(args.supabase, {
    mode: "overview",
    orgId: args.orgId,
    businessId: args.businessId,
  });
  if (!res.ok) return [];
  const raw = res.payload["actions"];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(asActionDTO)
    .filter((a): a is CoverageRecommendationActionDTO => a !== null);
}

/** mode: "create_experiment" — Experiment 생성은 Edge Function이 전담한다. */
export async function requestCoverageExperimentCreation(args: {
  supabase: UserClient;
  orgId: string;
  profileCoverageItemId: string;
}): Promise<CreateCoverageExperimentResult> {
  const { data, error } = await args.supabase.functions.invoke(RECOMMENDATION_FUNCTION, {
    body: {
      mode: "create_experiment",
      orgId: args.orgId,
      profileCoverageItemId: args.profileCoverageItemId,
    },
  });

  let payload: Record<string, unknown> | null = null;
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        payload = (await ctx.clone().json()) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }
    if (!payload) {
      console.error(`[coverage-recommendation] ${RECOMMENDATION_FUNCTION} invoke failed`);
      return { ok: false, error: "INTERNAL_ERROR" };
    }
  } else {
    payload = (data ?? null) as Record<string, unknown> | null;
  }

  if (!payload || typeof payload !== "object") return { ok: false, error: "INTERNAL_ERROR" };

  if (payload["ok"] === true) {
    const exp = payload["experiment"] as Record<string, unknown> | undefined;
    if (
      !exp ||
      typeof exp["experimentId"] !== "string" ||
      typeof exp["status"] !== "string" ||
      typeof exp["name"] !== "string"
    ) {
      return { ok: false, error: "INTERNAL_ERROR" };
    }
    return {
      ok: true,
      experiment: {
        experimentId: exp["experimentId"] as string,
        status: exp["status"] as string,
        name: exp["name"] as string,
      },
    };
  }

  const code = asErrorCode(payload["error"]);
  const experimentId = payload["experimentId"];
  return typeof experimentId === "string"
    ? { ok: false, error: code, experimentId }
    : { ok: false, error: code };
}
