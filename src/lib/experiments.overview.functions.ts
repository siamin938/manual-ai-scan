import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ExperimentSourceType = "insight_action" | "profile_coverage_item" | "unknown";

export type ExperimentRunProgressDTO = {
  runId: string | null;
  runStatus: string | null;
  totalJobs: number | null;
  completedJobs: number | null;
  failedJobs: number | null;
  finalized: boolean;
  startAt: string | null;
  endAt: string | null;
};

export type ExperimentOverviewRowDTO = {
  experimentId: string;
  name: string;
  businessName: string | null;
  actionType: string | null;
  sourceType: ExperimentSourceType;
  sourceTitle: string | null;
  createdAt: string;
  updatedAt: string | null;
  status: string;
  baseline: ExperimentRunProgressDTO;
  actionAppliedAt: string | null;
  interventionDescription: string | null;
  followup: ExperimentRunProgressDTO;
  evaluation: {
    recorded: boolean;
    evaluatedAt: string | null;
    resultClassification: string | null;
    evidenceGrade: string | null;
    primaryMetric: string | null;
    baselineValue: number | null;
    followupValue: number | null;
    deltaValue: number | null;
  };
};

export type ExperimentsOverviewDTO = {
  experiments: ExperimentOverviewRowDTO[];
};

export const getExperimentsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId };
  })
  .handler(async ({ data, context }): Promise<ExperimentsOverviewDTO> => {
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error("MEMBERSHIP_CHECK_FAILED");
    if (!membership) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error: expErr } = await supabaseAdmin
      .from("experiments")
      .select(
        "id, business_id, name, action_type, status, source_type, source_insight_action_id, source_profile_coverage_item_id, baseline_run_id, baseline_start_at, baseline_end_at, intervention_at, intervention_description, followup_run_id, followup_start_at, followup_end_at, primary_metric, baseline_value, followup_value, delta_value, evaluated_at, result_classification, evidence_grade, created_at, updated_at",
      )
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false });
    if (expErr) throw new Error("EXPERIMENTS_QUERY_FAILED");

    const experiments = rows ?? [];
    if (experiments.length === 0) return { experiments: [] };

    const businessIds = [...new Set(experiments.map((e) => e.business_id).filter(Boolean))];
    const runIds = [
      ...new Set(
        experiments.flatMap((e) => [e.baseline_run_id, e.followup_run_id]).filter(Boolean),
      ),
    ] as string[];
    const insightActionIds = [
      ...new Set(experiments.map((e) => e.source_insight_action_id).filter(Boolean)),
    ] as string[];
    const coverageItemIds = [
      ...new Set(experiments.map((e) => e.source_profile_coverage_item_id).filter(Boolean)),
    ] as string[];

    const [businessRes, runRes, actionRes, coverageRes] = await Promise.all([
      businessIds.length
        ? supabaseAdmin
            .from("businesses")
            .select("id, name")
            .eq("org_id", data.orgId)
            .in("id", businessIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      runIds.length
        ? supabaseAdmin
            .from("measurement_runs")
            .select("id, status, total_jobs, completed_jobs, failed_jobs")
            .eq("org_id", data.orgId)
            .in("id", runIds)
        : Promise.resolve(
            { data: [] as { id: string; status: string; total_jobs: number; completed_jobs: number; failed_jobs: number }[] },
          ),
      insightActionIds.length
        ? supabaseAdmin
            .from("insight_actions")
            .select("id, title")
            .eq("org_id", data.orgId)
            .in("id", insightActionIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      coverageItemIds.length
        ? supabaseAdmin
            .from("profile_coverage_items")
            .select("id, question_id")
            .eq("org_id", data.orgId)
            .in("id", coverageItemIds)
        : Promise.resolve({ data: [] as { id: string; question_id: string }[] }),
    ]);

    const coverageItems = coverageRes.data ?? [];
    const questionIds = [...new Set(coverageItems.map((c) => c.question_id).filter(Boolean))];
    const questionRes = questionIds.length
      ? await supabaseAdmin
          .from("questions")
          .select("id, prompt_text")
          .eq("org_id", data.orgId)
          .in("id", questionIds)
      : { data: [] as { id: string; prompt_text: string }[] };

    const bizMap = new Map((businessRes.data ?? []).map((b) => [b.id, b.name]));
    const runMap = new Map((runRes.data ?? []).map((r) => [r.id, r]));
    const actionMap = new Map((actionRes.data ?? []).map((a) => [a.id, a.title]));
    const questionMap = new Map((questionRes.data ?? []).map((q) => [q.id, q.prompt_text]));
    const coverageMap = new Map(
      coverageItems.map((c) => [c.id, questionMap.get(c.question_id) ?? null]),
    );

    const toProgress = (
      runId: string | null,
      startAt: string | null,
      endAt: string | null,
    ): ExperimentRunProgressDTO => {
      const run = runId ? runMap.get(runId) : undefined;
      return {
        runId: runId ?? null,
        runStatus: run?.status ?? null,
        totalJobs: run?.total_jobs ?? null,
        completedJobs: run?.completed_jobs ?? null,
        failedJobs: run?.failed_jobs ?? null,
        finalized: Boolean(startAt && endAt),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
      };
    };

    return {
      experiments: experiments.map((e) => {
        const sourceType: ExperimentSourceType =
          e.source_type === "profile_coverage_item" || e.source_type === "insight_action"
            ? e.source_type
            : e.source_insight_action_id
              ? "insight_action"
              : "unknown";

        const sourceTitle =
          sourceType === "profile_coverage_item"
            ? (e.source_profile_coverage_item_id
                ? (coverageMap.get(e.source_profile_coverage_item_id) ?? null)
                : null)
            : sourceType === "insight_action"
              ? (e.source_insight_action_id
                  ? (actionMap.get(e.source_insight_action_id) ?? null)
                  : null)
              : null;

        return {
          experimentId: e.id,
          name: e.name,
          businessName: bizMap.get(e.business_id) ?? null,
          actionType: e.action_type ?? null,
          sourceType,
          sourceTitle,
          createdAt: e.created_at,
          updatedAt: e.updated_at ?? null,
          status: e.status,
          baseline: toProgress(e.baseline_run_id, e.baseline_start_at, e.baseline_end_at),
          actionAppliedAt: e.intervention_at ?? null,
          interventionDescription: e.intervention_description ?? null,
          followup: toProgress(e.followup_run_id, e.followup_start_at, e.followup_end_at),
          evaluation: {
            recorded: Boolean(e.evaluated_at),
            evaluatedAt: e.evaluated_at ?? null,
            resultClassification: e.result_classification ?? null,
            evidenceGrade: e.evidence_grade ?? null,
            primaryMetric: e.primary_metric ?? null,
            baselineValue: e.baseline_value ?? null,
            followupValue: e.followup_value ?? null,
            deltaValue: e.delta_value ?? null,
          },
        };
      }),
    };
  });
