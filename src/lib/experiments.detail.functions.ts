// 실험 상세 화면용 READ ONLY 서버 함수.
// snapshot(조건/평가/액션), raw response_text, provider payload, 경쟁사 목록은 DTO로 절대 반환하지 않는다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computePhaseMetrics,
  deltaPp,
  promptSnippet,
  type MeasurementFact,
} from "@/lib/experiments.evaluation.helpers";
import type { ExperimentSourceType } from "@/lib/experiments.overview.functions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExperimentPhaseMetricsDTO = {
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
  top3Count: number;
  top3Rate: number | null;
  substitutionCount: number;
  substitutionRate: number | null;
  domainCitedCount: number;
  domainCitedRate: number | null;
  averagePosition: number | null;
  positionObservedCount: number;
  manualReviewCount: number;
  parserVersion: string | null;
  providerModel: string | null;
};

export type ExperimentQuestionRowDTO = {
  questionId: string;
  promptSnippet: string;
  baselineValidCount: number;
  baselineInclusionCount: number;
  baselineInclusionRate: number | null;
  followupValidCount: number | null;
  followupInclusionCount: number | null;
  followupInclusionRate: number | null;
  deltaCount: number | null;
};

export type ExperimentDeltaDTO = {
  inclusionPp: number | null;
  top3Pp: number | null;
  substitutionPp: number | null;
  domainCitationPp: number | null;
  averagePositionDelta: number | null;
};

export type ExperimentRunProgressDetailDTO = {
  runId: string | null;
  runStatus: string | null;
  totalJobs: number | null;
  completedJobs: number | null;
  failedJobs: number | null;
  finalized: boolean;
  startAt: string | null;
  endAt: string | null;
};

export type ExperimentDetailDTO = {
  experimentId: string;
  name: string;
  businessName: string | null;
  sourceType: ExperimentSourceType;
  sourceTitle: string | null;
  actionType: string | null;
  status: string;
  createdAt: string;
  baseline: ExperimentRunProgressDetailDTO;
  followup: ExperimentRunProgressDetailDTO;
  interventionDescription: string | null;
  actionAppliedAt: string | null;
  evaluatedAt: string | null;
  resultClassification: string | null;
  evidenceGrade: string | null;
  baselineMetrics: ExperimentPhaseMetricsDTO | null;
  followupMetrics: ExperimentPhaseMetricsDTO | null;
  delta: ExperimentDeltaDTO | null;
  questionRows: ExperimentQuestionRowDTO[];
};

export type GetExperimentDetailResult =
  | { ok: true; detail: ExperimentDetailDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR" };

function single(values: string[]): string | null {
  const cleaned = [...new Set(values.filter((v) => v.length > 0))];
  return cleaned.length === 1 ? cleaned[0]! : null;
}

export const getExperimentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; experimentId: string }) => {
    if (!input?.orgId || !UUID_RE.test(input.orgId)) throw new Error("INVALID_ORG");
    if (!input?.experimentId || !UUID_RE.test(input.experimentId))
      throw new Error("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<GetExperimentDetailResult> => {
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: exp, error: expErr } = await supabaseAdmin
      .from("experiments")
      .select(
        "id, business_id, name, action_type, status, source_type, source_insight_action_id, source_profile_coverage_item_id, baseline_run_id, baseline_start_at, baseline_end_at, baseline_condition_snapshot, intervention_at, intervention_description, followup_run_id, followup_start_at, followup_end_at, followup_condition_snapshot, evaluated_at, result_classification, evidence_grade, created_at",
      )
      .eq("org_id", data.orgId)
      .eq("id", data.experimentId)
      .maybeSingle();
    if (expErr) return { ok: false, error: "INTERNAL_ERROR" };
    if (!exp) return { ok: false, error: "NOT_FOUND" };

    const sourceType: ExperimentSourceType =
      exp.source_type === "profile_coverage_item" || exp.source_type === "insight_action"
        ? exp.source_type
        : exp.source_insight_action_id
          ? "insight_action"
          : "unknown";

    // --- source title -------------------------------------------------
    let sourceTitle: string | null = null;
    if (sourceType === "insight_action" && exp.source_insight_action_id) {
      const { data: action } = await supabaseAdmin
        .from("insight_actions")
        .select("title")
        .eq("org_id", data.orgId)
        .eq("id", exp.source_insight_action_id)
        .maybeSingle();
      sourceTitle = action?.title ?? null;
    } else if (sourceType === "profile_coverage_item" && exp.source_profile_coverage_item_id) {
      const { data: item } = await supabaseAdmin
        .from("profile_coverage_items")
        .select("question_id")
        .eq("org_id", data.orgId)
        .eq("id", exp.source_profile_coverage_item_id)
        .maybeSingle();
      if (item?.question_id) {
        const { data: q } = await supabaseAdmin
          .from("questions")
          .select("prompt_text")
          .eq("org_id", data.orgId)
          .eq("id", item.question_id)
          .maybeSingle();
        sourceTitle = q?.prompt_text ? promptSnippet(q.prompt_text) : null;
      }
    }

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("name")
      .eq("org_id", data.orgId)
      .eq("id", exp.business_id)
      .maybeSingle();

    const runIds = [exp.baseline_run_id, exp.followup_run_id].filter(Boolean) as string[];
    const { data: runs } = runIds.length
      ? await supabaseAdmin
          .from("measurement_runs")
          .select("id, status, total_jobs, completed_jobs, failed_jobs")
          .eq("org_id", data.orgId)
          .in("id", runIds)
      : { data: [] as { id: string; status: string; total_jobs: number; completed_jobs: number; failed_jobs: number }[] };
    const runMap = new Map((runs ?? []).map((r) => [r.id, r]));

    const toProgress = (
      runId: string | null,
      startAt: string | null,
      endAt: string | null,
    ): ExperimentRunProgressDetailDTO => {
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

    // --- phase facts (서버 내부 전용) ------------------------------------
    async function phaseFacts(
      runId: string | null,
      snapshot: unknown,
    ): Promise<MeasurementFact[] | null> {
      if (!runId) return null;
      const { data: mRows, error: mErr } = await supabaseAdmin
        .from("measurements")
        .select(
          "id, question_id, valid, was_client_mentioned, client_position, client_domain_cited, manual_review_required, parser_version, provider_model",
        )
        .eq("org_id", data.orgId)
        .eq("run_id", runId);
      if (mErr || !mRows || mRows.length === 0) return null;

      // snapshot은 서버 내부에서만 읽어 경쟁사 id Set을 만든다 (DTO로 나가지 않음).
      const competitorIds = new Set<string>();
      const snap = snapshot as { parsing_context?: { competitors?: { id?: string }[] } } | null;
      for (const c of snap?.parsing_context?.competitors ?? []) {
        if (c?.id) competitorIds.add(c.id);
      }

      const competitorMeasurementIds = new Set<string>();
      if (competitorIds.size > 0) {
        const { data: mentions } = await supabaseAdmin
          .from("measurement_mentions")
          .select("measurement_id, matched_business_id")
          .eq("org_id", data.orgId)
          .in(
            "measurement_id",
            mRows.map((m) => m.id),
          );
        for (const mention of mentions ?? []) {
          if (mention.matched_business_id && competitorIds.has(mention.matched_business_id)) {
            competitorMeasurementIds.add(mention.measurement_id);
          }
        }
      }

      return mRows.map((m) => ({
        measurementId: m.id,
        questionId: m.question_id,
        valid: m.valid === true,
        wasClientMentioned: m.was_client_mentioned === true,
        clientPosition: m.client_position === null ? null : Number(m.client_position),
        clientDomainCited: m.client_domain_cited === true,
        manualReviewRequired: m.manual_review_required === true,
        parserVersion: (m.parser_version ?? "").trim(),
        providerModel: (m.provider_model ?? "").trim(),
        registeredCompetitorMention: competitorMeasurementIds.has(m.id),
      }));
    }

    const [baselineFacts, followupFacts] = await Promise.all([
      phaseFacts(exp.baseline_run_id, exp.baseline_condition_snapshot),
      phaseFacts(exp.followup_run_id, exp.followup_condition_snapshot),
    ]);

    const baselinePm = baselineFacts ? computePhaseMetrics(baselineFacts) : null;
    const followupPm = followupFacts ? computePhaseMetrics(followupFacts) : null;

    const toMetricsDTO = (
      pm: NonNullable<typeof baselinePm>,
    ): ExperimentPhaseMetricsDTO => ({
      validCount: pm.validCount,
      inclusionCount: pm.inclusionCount,
      inclusionRate: pm.inclusionRate,
      top3Count: pm.top3Count,
      top3Rate: pm.top3Rate,
      substitutionCount: pm.substitutionCount,
      substitutionRate: pm.substitutionRate,
      domainCitedCount: pm.clientDomainCitedCount,
      domainCitedRate: pm.clientDomainCitedRate,
      averagePosition: pm.averagePositionAmongPositioned,
      positionObservedCount: pm.positionObservedCount,
      manualReviewCount: pm.manualReviewRequiredCount,
      parserVersion: single(pm.parserVersions),
      providerModel: single(pm.providerModels),
    });

    const baselineMetrics = baselinePm ? toMetricsDTO(baselinePm) : null;
    const followupMetrics = followupPm ? toMetricsDTO(followupPm) : null;

    const delta: ExperimentDeltaDTO | null =
      baselinePm && followupPm
        ? {
            inclusionPp: deltaPp(baselinePm.inclusionRate, followupPm.inclusionRate),
            top3Pp: deltaPp(baselinePm.top3Rate, followupPm.top3Rate),
            substitutionPp: deltaPp(baselinePm.substitutionRate, followupPm.substitutionRate),
            domainCitationPp: deltaPp(
              baselinePm.clientDomainCitedRate,
              followupPm.clientDomainCitedRate,
            ),
            averagePositionDelta:
              baselinePm.averagePositionAmongPositioned !== null &&
              followupPm.averagePositionAmongPositioned !== null
                ? followupPm.averagePositionAmongPositioned -
                  baselinePm.averagePositionAmongPositioned
                : null,
          }
        : null;

    // --- 질문별 표 -------------------------------------------------------
    const questionIds = [
      ...new Set([
        ...(baselinePm?.byQuestion ?? []).map((q) => q.questionId),
        ...(followupPm?.byQuestion ?? []).map((q) => q.questionId),
      ]),
    ];
    const { data: qRows } = questionIds.length
      ? await supabaseAdmin
          .from("questions")
          .select("id, prompt_text")
          .eq("org_id", data.orgId)
          .in("id", questionIds)
      : { data: [] as { id: string; prompt_text: string }[] };
    const promptMap = new Map((qRows ?? []).map((q) => [q.id, promptSnippet(q.prompt_text ?? "")]));

    const questionRows: ExperimentQuestionRowDTO[] = questionIds
      .map((questionId) => {
        const b = baselinePm?.byQuestion.find((q) => q.questionId === questionId) ?? null;
        const f = followupPm?.byQuestion.find((q) => q.questionId === questionId) ?? null;
        return {
          questionId,
          promptSnippet: promptMap.get(questionId) ?? "질문 정보 없음",
          baselineValidCount: b?.validCount ?? 0,
          baselineInclusionCount: b?.inclusionCount ?? 0,
          baselineInclusionRate: b?.inclusionRate ?? null,
          followupValidCount: followupPm ? (f?.validCount ?? 0) : null,
          followupInclusionCount: followupPm ? (f?.inclusionCount ?? 0) : null,
          followupInclusionRate: followupPm ? (f?.inclusionRate ?? null) : null,
          deltaCount: followupPm ? (f?.inclusionCount ?? 0) - (b?.inclusionCount ?? 0) : null,
        };
      })
      .sort((a, b) => (a.promptSnippet < b.promptSnippet ? -1 : 1));

    return {
      ok: true,
      detail: {
        experimentId: exp.id,
        name: exp.name,
        businessName: business?.name ?? null,
        sourceType,
        sourceTitle,
        actionType: exp.action_type ?? null,
        status: exp.status,
        createdAt: exp.created_at,
        baseline: toProgress(exp.baseline_run_id, exp.baseline_start_at, exp.baseline_end_at),
        followup: toProgress(exp.followup_run_id, exp.followup_start_at, exp.followup_end_at),
        interventionDescription: exp.intervention_description ?? null,
        actionAppliedAt: exp.intervention_at ?? null,
        evaluatedAt: exp.evaluated_at ?? null,
        resultClassification: exp.evaluated_at ? (exp.result_classification ?? null) : null,
        evidenceGrade: exp.evaluated_at ? (exp.evidence_grade ?? null) : null,
        baselineMetrics,
        followupMetrics,
        delta,
        questionRows,
      },
    };
  });
