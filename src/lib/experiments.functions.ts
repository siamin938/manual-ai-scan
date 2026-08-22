import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
const ACTIVE_STATUSES = ["draft", "baseline", "action_applied", "followup"] as const;

/** Experiment 생성 권한이 있는 조직 역할 */
const ALLOWED_ROLES = ["owner", "admin", "analyst"] as const;

/** v0.1에서 실험 생성이 가능한 Action recommendation_mode */
const EXPERIMENTABLE_MODES = ["test"] as const;

/** v0.1에서 실험 생성이 가능한 Action status (in_progress 이후는 baseline 신뢰 불가) */
const EXPERIMENTABLE_ACTION_STATUSES = ["proposed", "accepted"] as const;

function fail(
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

function buildName(title: string): string {
  const base = clean(title) || "인사이트 기반 실험";
  return `실험: ${base.slice(0, 120)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 잘못된 입력은 generic 500이 아니라 고정된 400 Bad Request. */
function badRequest(code: "INVALID_ORG" | "INVALID_ACTION"): Response {
  const res = new Response(code, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  (res as Response & { statusCode?: number }).statusCode = 400;
  return res;
}

export const createExperimentFromInsightAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateExperimentInput) => {
    if (!input?.orgId || !UUID_RE.test(input.orgId)) throw badRequest("INVALID_ORG");
    if (!input?.insightActionId || !UUID_RE.test(input.insightActionId)) {
      throw badRequest("INVALID_ACTION");
    }
    return { orgId: input.orgId, insightActionId: input.insightActionId };
  })
  .handler(async ({ data, context }): Promise<CreateExperimentResult> => {
    // 1) 인증: requireSupabaseAuth가 401을 담당. 방어적 확인만 수행.
    if (!context.userId) return fail("FORBIDDEN");

    // 2) 조직 역할 검증 (사용자 권한 클라이언트, RLS 적용)
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) return fail("INTERNAL_ERROR"); // DB 실패를 FORBIDDEN으로 위장하지 않음
    if (!membership) return fail("FORBIDDEN");
    if (!ALLOWED_ROLES.includes(membership.role as (typeof ALLOWED_ROLES)[number])) {
      return fail("FORBIDDEN");
    }

    // 검증 통과 후에만 service_role 사용 (서버 전용, 응답/로그에 노출 금지)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 3) Insight Action 조회 (id + 검증된 org_id 범위)
    const { data: action, error: actErr } = await supabaseAdmin
      .from("insight_actions")
      .select(
        "id, org_id, business_id, engine_run_id, action_type, title, rationale, recommended_action, validation_plan, recommendation_mode, evidence_grade, priority_score, primary_finding_id, source_finding_ids, status",
      )
      .eq("id", data.insightActionId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (actErr) return fail("INTERNAL_ERROR");
    if (!action) return fail("INSIGHT_ACTION_NOT_FOUND");
    if (action.org_id !== data.orgId || !action.business_id || !action.engine_run_id) {
      return fail("ACTION_SCOPE_MISMATCH");
    }

    // 3-1) 실험 가능한 mode / status만 허용
    if (!EXPERIMENTABLE_MODES.includes(action.recommendation_mode as (typeof EXPERIMENTABLE_MODES)[number])) {
      return fail("ACTION_MODE_NOT_EXPERIMENTABLE");
    }
    if (
      !EXPERIMENTABLE_ACTION_STATUSES.includes(
        action.status as (typeof EXPERIMENTABLE_ACTION_STATUSES)[number],
      )
    ) {
      return fail("ACTION_STATUS_NOT_EXPERIMENTABLE");
    }

    // 4) Business 무결성 (클라이언트 값 미신뢰, Action의 business_id 사용)
    const { data: business, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .select("id, org_id")
      .eq("id", action.business_id)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (bizErr) return fail("INTERNAL_ERROR");
    if (!business) return fail("BUSINESS_SCOPE_MISMATCH");

    // 5) Engine Run 무결성 (동일 org + 동일 business)
    const { data: engineRun, error: runErr } = await supabaseAdmin
      .from("insight_engine_runs")
      .select("id, org_id, business_id")
      .eq("id", action.engine_run_id)
      .maybeSingle();
    if (runErr) return fail("INTERNAL_ERROR");
    if (!engineRun) return fail("ENGINE_RUN_SCOPE_MISMATCH");
    if (engineRun.org_id !== data.orgId || engineRun.business_id !== action.business_id) {
      return fail("ENGINE_RUN_SCOPE_MISMATCH");
    }

    // 6) Primary Finding 4중 scope 검증 (우회 진행 금지)
    let metricHint: string | null = null;
    if (action.primary_finding_id) {
      const { data: finding, error: findErr } = await supabaseAdmin
        .from("insight_findings")
        .select("id, title, metric_name")
        .eq("id", action.primary_finding_id)
        .eq("org_id", action.org_id)
        .eq("business_id", action.business_id)
        .eq("engine_run_id", action.engine_run_id)
        .maybeSingle();
      if (findErr) return fail("INTERNAL_ERROR");
      if (!finding) return fail("PRIMARY_FINDING_SCOPE_MISMATCH");
      metricHint = finding.title ?? finding.metric_name ?? null;
    }

    // 7) 사전 active Experiment 조회 (UX 최적화). DB 실패는 "없음"으로 간주하지 않음.
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("experiments")
      .select("id")
      .eq("org_id", action.org_id)
      .eq("source_insight_action_id", action.id)
      .in("status", [...ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existErr) return fail("INTERNAL_ERROR");
    if (existing) return fail("EXPERIMENT_ALREADY_ACTIVE", existing.id);

    // 8) INSERT — snapshot/평가 컬럼은 모두 NULL 유지
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("experiments")
      .insert({
        org_id: action.org_id,
        business_id: action.business_id,
        source_insight_action_id: action.id,
        name: buildName(action.title),
        action_type: action.action_type,
        hypothesis: buildHypothesis({
          recommended_action: action.recommended_action,
          rationale: action.rationale,
          title: action.title,
          metric_hint: metricHint,
        }),
        status: "draft",
        created_by: context.userId,
      })
      .select("id, status, name, business_id, source_insight_action_id")
      .maybeSingle();

    if (insErr) {
      // 최종 중복 보장은 partial UNIQUE index. 오류 메시지 문자열에 의존하지 않고
      // 23505인 경우에만 동일 조건의 active Experiment를 재조회한다.
      if (insErr.code === "23505") {
        const { data: raced, error: raceErr } = await supabaseAdmin
          .from("experiments")
          .select("id")
          .eq("org_id", action.org_id)
          .eq("source_insight_action_id", action.id)
          .in("status", [...ACTIVE_STATUSES])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (raceErr) return fail("INTERNAL_ERROR");
        if (raced) return fail("EXPERIMENT_ALREADY_ACTIVE", raced.id);
        return fail("EXPERIMENT_CREATE_FAILED");
      }
      return fail("EXPERIMENT_CREATE_FAILED");
    }
    if (!inserted) return fail("EXPERIMENT_CREATE_FAILED");

    return {
      ok: true,
      experiment: {
        experimentId: inserted.id,
        status: inserted.status,
        name: inserted.name,
        businessId: inserted.business_id,
        sourceInsightActionId: inserted.source_insight_action_id ?? action.id,
      },
    };
  });
