import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InsightFindingDTO = {
  id: string;
  finding_type: string;
  title: string;
  summary: string;
  priority_score: number;
  evidence_grade: string;
  confidence_score: number;
  claim_type: string;
  sample_size: number;
  numerator: number | null;
  denominator: number | null;
  metric_name: string | null;
  metric_value: number | null;
  question_text: string | null;
  competitor_name: string | null;
  small_sample: boolean;
};

export type ActiveExperimentDTO = {
  id: string;
  status: string;
  baseline_run_id: string | null;
  baseline_run_status: string | null;
};

export type InsightActionDTO = {
  id: string;
  action_type: string;
  title: string;
  rationale: string;
  recommended_action: string;
  validation_plan: string;
  recommendation_mode: string;
  evidence_grade: string;
  confidence_score: number;
  priority_score: number;
  status: string;
  primary_finding_id: string;
  source_finding_count: number;
  /** 진행 중인 Experiment (snapshot 미포함, safe 필드만) */
  active_experiment: ActiveExperimentDTO | null;
};


export type InsightOverviewDTO = {
  run: {
    id: string;
    engine_version: string;
    completed_at: string | null;
    input_measurement_count: number;
    eligible_measurement_count: number;
    excluded_measurement_count: number;
    finding_count: number;
    business_name: string | null;
  } | null;
  evidence_grade: string | null;
  recommendation_mode: string | null;
  findings: InsightFindingDTO[];
  actions: InsightActionDTO[];
};

const GRADE_ORDER = ["insufficient", "directional", "supported", "strong"];

function lowestGrade(values: string[]): string | null {
  if (values.length === 0) return null;
  let best: string | null = null;
  let bestIdx = Number.MAX_SAFE_INTEGER;
  for (const v of values) {
    const i = GRADE_ORDER.indexOf(v);
    const idx = i === -1 ? GRADE_ORDER.length : i;
    if (idx < bestIdx) {
      bestIdx = idx;
      best = v;
    }
  }
  return best;
}

export const getInsightOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId };
  })
  .handler(async ({ data, context }): Promise<InsightOverviewDTO> => {
    // 조직 소속 검증: 사용자 권한 클라이언트로 확인 (RLS 적용)
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error("MEMBERSHIP_CHECK_FAILED");
    if (!membership) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: run, error: runErr } = await supabaseAdmin
      .from("insight_engine_runs")
      .select(
        "id, org_id, business_id, engine_version, completed_at, created_at, input_measurement_count, eligible_measurement_count, excluded_measurement_count, finding_count",
      )
      .eq("org_id", data.orgId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runErr) throw new Error("RUN_QUERY_FAILED");
    if (!run) {
      return { run: null, evidence_grade: null, recommendation_mode: null, findings: [], actions: [] };
    }

    const [businessRes, findingsRes, actionsRes] = await Promise.all([
      supabaseAdmin.from("businesses").select("name").eq("id", run.business_id).eq("org_id", data.orgId).maybeSingle(),
      supabaseAdmin
        .from("insight_findings")
        .select(
          "id, finding_type, title, summary, priority_score, evidence_grade, confidence_score, claim_type, sample_size, numerator, denominator, metric_name, metric_value, question_id, competitor_business_id, evidence_payload",
        )
        .eq("org_id", data.orgId)
        .eq("engine_run_id", run.id)
        .order("priority_score", { ascending: false }),
      supabaseAdmin
        .from("insight_actions")
        .select(
          "id, action_type, title, rationale, recommended_action, validation_plan, recommendation_mode, evidence_grade, confidence_score, priority_score, status, primary_finding_id, source_finding_ids",
        )
        .eq("org_id", data.orgId)
        .eq("engine_run_id", run.id)
        .order("priority_score", { ascending: false }),
    ]);

    const rawFindings = findingsRes.data ?? [];
    const rawActions = actionsRes.data ?? [];

    const questionIds = [...new Set(rawFindings.map((f) => f.question_id).filter(Boolean))] as string[];
    const competitorIds = [
      ...new Set(rawFindings.map((f) => f.competitor_business_id).filter(Boolean)),
    ] as string[];

    const [questionsRes, competitorsRes] = await Promise.all([
      questionIds.length
        ? supabaseAdmin.from("questions").select("id, prompt_text").in("id", questionIds).eq("org_id", data.orgId)
        : Promise.resolve({ data: [] as { id: string; prompt_text: string }[] }),
      competitorIds.length
        ? supabaseAdmin.from("businesses").select("id, name").in("id", competitorIds).eq("org_id", data.orgId)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const questionMap = new Map((questionsRes.data ?? []).map((q) => [q.id, q.prompt_text]));
    const competitorMap = new Map((competitorsRes.data ?? []).map((b) => [b.id, b.name]));

    const findings: InsightFindingDTO[] = rawFindings.map((f) => {
      const payload = (f.evidence_payload ?? {}) as Record<string, unknown>;
      const payloadCompetitor =
        typeof payload["competitor_display_name"] === "string"
          ? (payload["competitor_display_name"] as string)
          : null;
      return {
        id: f.id,
        finding_type: f.finding_type,
        title: f.title,
        summary: f.summary,
        priority_score: Number(f.priority_score),
        evidence_grade: f.evidence_grade,
        confidence_score: Number(f.confidence_score),
        claim_type: f.claim_type,
        sample_size: f.sample_size,
        numerator: f.numerator,
        denominator: f.denominator,
        metric_name: f.metric_name,
        metric_value: f.metric_value === null ? null : Number(f.metric_value),
        question_text: f.question_id ? (questionMap.get(f.question_id) ?? null) : null,
        competitor_name: f.competitor_business_id
          ? (competitorMap.get(f.competitor_business_id) ?? payloadCompetitor)
          : payloadCompetitor,
        small_sample: payload["small_sample"] === true,
      };
    });

    const actions: InsightActionDTO[] = rawActions.map((a) => ({
      id: a.id,
      action_type: a.action_type,
      title: a.title,
      rationale: a.rationale,
      recommended_action: a.recommended_action,
      validation_plan: a.validation_plan,
      recommendation_mode: a.recommendation_mode,
      evidence_grade: a.evidence_grade,
      confidence_score: Number(a.confidence_score),
      priority_score: Number(a.priority_score),
      status: a.status,
      primary_finding_id: a.primary_finding_id,
      source_finding_count: (a.source_finding_ids ?? []).length,
    }));

    return {
      run: {
        id: run.id,
        engine_version: run.engine_version,
        completed_at: run.completed_at,
        input_measurement_count: run.input_measurement_count,
        eligible_measurement_count: run.eligible_measurement_count,
        excluded_measurement_count: run.excluded_measurement_count,
        finding_count: run.finding_count,
        business_name: businessRes.data?.name ?? null,
      },
      evidence_grade: lowestGrade([
        ...findings.map((f) => f.evidence_grade),
        ...actions.map((a) => a.evidence_grade),
      ]),
      recommendation_mode: actions[0]?.recommendation_mode ?? null,
      findings,
      actions,
    };
  });
