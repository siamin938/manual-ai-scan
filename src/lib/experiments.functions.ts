import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CreateExperimentInput = {
  orgId: string;
  insightActionId: string;
};

export type CreateExperimentResultDTO = {
  experimentId: string;
  status: string;
  name: string;
  businessId: string;
  sourceInsightActionId: string;
};

/** 아직 종료되지 않은(진행 중) 실험 상태 */
const ACTIVE_STATUSES = ["draft", "baseline", "action_applied", "followup"] as const;

/** Experiment 생성 권한이 있는 조직 역할 */
const ALLOWED_ROLES = ["owner", "admin", "analyst"] as const;

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** 결정적(재현 가능) 가설 템플릿. AI 호출 없음, 인과 확정 표현 없음. */
export function buildHypothesis(action: {
  recommended_action: string;
  rationale: string;
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

export const createExperimentFromInsightAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateExperimentInput) => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!input?.orgId || !uuid.test(input.orgId)) throw new Error("INVALID_ORG");
    if (!input?.insightActionId || !uuid.test(input.insightActionId)) throw new Error("INVALID_ACTION");
    return { orgId: input.orgId, insightActionId: input.insightActionId };
  })
  .handler(async ({ data, context }): Promise<CreateExperimentResultDTO> => {
    // 1) 인증: requireSupabaseAuth가 없으면 401. userId 없으면 UNAUTHORIZED.
    if (!context.userId) throw new Error("UNAUTHORIZED");

    // 2) 조직 역할 검증 (사용자 권한 클라이언트, RLS 적용)
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error("FORBIDDEN");
    if (!membership || !ALLOWED_ROLES.includes(membership.role as (typeof ALLOWED_ROLES)[number])) {
      throw new Error("FORBIDDEN");
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
    if (actErr) throw new Error("INSIGHT_ACTION_NOT_FOUND");
    if (!action) throw new Error("INSIGHT_ACTION_NOT_FOUND");
    if (action.org_id !== data.orgId || !action.business_id || !action.engine_run_id) {
      throw new Error("ACTION_SCOPE_MISMATCH");
    }

    // 4) Business 무결성 (클라이언트 값 미신뢰, Action의 business_id 사용)
    const { data: business, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .select("id, org_id")
      .eq("id", action.business_id)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (bizErr || !business) throw new Error("BUSINESS_SCOPE_MISMATCH");

    // 5) Engine Run 무결성 (동일 org + 동일 business)
    const { data: engineRun, error: runErr } = await supabaseAdmin
      .from("insight_engine_runs")
      .select("id, org_id, business_id")
      .eq("id", action.engine_run_id)
      .maybeSingle();
    if (runErr || !engineRun) throw new Error("ENGINE_RUN_SCOPE_MISMATCH");
    if (engineRun.org_id !== data.orgId || engineRun.business_id !== action.business_id) {
      throw new Error("ENGINE_RUN_SCOPE_MISMATCH");
    }

    // 6) 중복 active Experiment 방지 (completed/cancelled는 재실험 허용)
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("experiments")
      .select("id, status")
      .eq("org_id", data.orgId)
      .eq("source_insight_action_id", action.id)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existErr) throw new Error("EXPERIMENT_CREATE_FAILED");
    if (existing) {
      const err = new Error("EXPERIMENT_ALREADY_ACTIVE") as Error & { experimentId?: string };
      err.experimentId = existing.id;
      throw err;
    }

    // 7) primary finding에서 지표 힌트 확보 (가설 템플릿 입력용)
    let metricHint: string | null = null;
    if (action.primary_finding_id) {
      const { data: finding } = await supabaseAdmin
        .from("insight_findings")
        .select("title, metric_name")
        .eq("id", action.primary_finding_id)
        .eq("org_id", data.orgId)
        .maybeSingle();
      metricHint = finding?.title ?? finding?.metric_name ?? null;
    }

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

    if (insErr || !inserted) throw new Error("EXPERIMENT_CREATE_FAILED");

    return {
      experimentId: inserted.id,
      status: inserted.status,
      name: inserted.name,
      businessId: inserted.business_id,
      sourceInsightActionId: inserted.source_insight_action_id ?? action.id,
    };
  });
