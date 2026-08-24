import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coverageActionFields, coverageActionTitle } from "./profile-coverage.helpers";
import { compareCustomerActions } from "./customer-report.helpers";


/* =========================================================================
 * 고객 보고서 v0.2 — READ ONLY safe DTO
 * snapshot / raw response_text / provider payload / hypothesis / confounders /
 * 내부 가중치·점수는 절대 반환하지 않는다.
 * ========================================================================= */

export type ReportBusinessDTO = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  city: string | null;
  websiteUrl: string | null;
  hasOfficialDomain: boolean;
};

export type ReportCoverageGapDTO = {
  id: string;
  questionText: string | null;
  coverageStatus: string;
  title: string;
  profileFields: string[];
  measurementCount: number;
  mentionedCount: number;
  mentionRate: number;
};

export type ReportCoverageDTO = {
  completedAt: string | null;
  questionCount: number;
  coveredQuestionCount: number;
  partialQuestionCount: number;
  missingQuestionCount: number;
  questionCoverageRate: number | null;
  measurementCoverageRate: number | null;
  top3CoverageRate: number | null;
  clientDomainCitationRate: number | null;
  clientFirstPartyCitationRate: number | null;
  firstPartyClassifierVersion: string | null;
  coverageScore: number | null;
  evidenceGrade: string | null;
  gaps: ReportCoverageGapDTO[];
};

export type ReportFindingDTO = {
  id: string;
  title: string;
  summary: string;
  findingType: string;
  evidenceGrade: string;
  questionText: string | null;
  competitorName: string | null;
};

export type ReportActionDTO = {
  id: string;
  title: string;
  actionType: string | null;
  recommendedAction: string;
  rationale: string;
  validationPlan: string;
  evidenceGrade: string;
  recommendationMode: string;
};


export type ReportInsightDTO = {
  completedAt: string | null;
  findingCount: number;
  eligibleMeasurementCount: number;
  findings: ReportFindingDTO[];
  actions: ReportActionDTO[];
};

export type ReportPhaseDTO = {
  runId: string | null;
  runStatus: string | null;
  totalJobs: number | null;
  completedJobs: number | null;
  failedJobs: number | null;
  finalized: boolean;
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
};

export type ReportExperimentDTO = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  createdAt: string;
  baseline: ReportPhaseDTO;
  followup: ReportPhaseDTO;
  interventionAt: string | null;
  interventionDescription: string | null;
  evaluatedAt: string | null;
  resultClassification: string | null;
  evidenceGrade: string | null;
  inclusionDeltaPoints: number | null;
};

export type CustomerReportDTO = {
  generatedAt: string;
  businesses: ReportBusinessDTO[];
  business: ReportBusinessDTO | null;
  coverage: ReportCoverageDTO | null;
  insight: ReportInsightDTO | null;
  experiments: ReportExperimentDTO[];
};

const emptyPhase = (): ReportPhaseDTO => ({
  runId: null,
  runStatus: null,
  totalJobs: null,
  completedJobs: null,
  failedJobs: null,
  finalized: false,
  validCount: 0,
  inclusionCount: 0,
  inclusionRate: null,
});

function snippet(value: string | null | undefined, max = 120): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export const getCustomerReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId?: string | null }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    const businessId =
      typeof input.businessId === "string" && input.businessId ? input.businessId : null;
    return { orgId: input.orgId, businessId };
  })
  .handler(async ({ data, context }): Promise<CustomerReportDTO> => {
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error("MEMBERSHIP_CHECK_FAILED");
    if (!membership) throw new Error("FORBIDDEN");

    const generatedAt = new Date().toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: bizRows, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .select("id, name, category, region, city, website_url, official_domains")
      .eq("org_id", data.orgId)
      .eq("is_client_business", true)
      .eq("active", true)
      .order("name", { ascending: true });
    if (bizErr) throw new Error("BUSINESS_QUERY_FAILED");

    const businesses: ReportBusinessDTO[] = (bizRows ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category ?? null,
      region: b.region ?? null,
      city: b.city ?? null,
      websiteUrl: b.website_url ?? null,
      hasOfficialDomain: Array.isArray(b.official_domains) && b.official_domains.length > 0,
    }));

    const business = data.businessId
      ? (businesses.find((b) => b.id === data.businessId) ?? null)
      : (businesses[0] ?? null);

    if (!business) {
      return {
        generatedAt,
        businesses,
        business: null,
        coverage: null,
        insight: null,
        experiments: [],
      };
    }

    /* ---------------- Profile Coverage ---------------- */
    const { data: covRun } = await supabaseAdmin
      .from("profile_coverage_runs")
      .select(
        "id, completed_at, question_count, covered_question_count, partial_question_count, missing_question_count, question_coverage_rate, measurement_coverage_rate, top3_coverage_rate, client_domain_citation_rate, client_first_party_citation_rate, first_party_classifier_version, coverage_score, evidence_grade",
      )
      .eq("org_id", data.orgId)
      .eq("business_id", business.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let coverage: ReportCoverageDTO | null = null;
    if (covRun) {
      const { data: items } = await supabaseAdmin
        .from("profile_coverage_items")
        .select(
          "id, question_id, coverage_status, measurement_count, mentioned_count, mention_rate",
        )
        .eq("org_id", data.orgId)
        .eq("coverage_run_id", covRun.id)
        .in("coverage_status", ["missing", "partial"]);

      const gapRows = items ?? [];
      const qIds = [...new Set(gapRows.map((i) => i.question_id).filter(Boolean))] as string[];
      const qRes = qIds.length
        ? await supabaseAdmin
            .from("questions")
            .select("id, prompt_text, intent_type")
            .eq("org_id", data.orgId)
            .in("id", qIds)
        : { data: [] as { id: string; prompt_text: string; intent_type: string }[] };
      const qMap = new Map((qRes.data ?? []).map((q) => [q.id, q]));

      const gaps = gapRows
        .sort(
          (a, b) =>
            (a.coverage_status === "missing" ? 0 : 1) - (b.coverage_status === "missing" ? 0 : 1) ||
            Number(a.mention_rate) - Number(b.mention_rate),
        )
        .slice(0, 3)
        .map((i) => {
          const q = qMap.get(i.question_id);
          return {
            id: i.id,
            questionText: snippet(q?.prompt_text ?? null),
            coverageStatus: i.coverage_status,
            title: coverageActionTitle(q?.intent_type ?? null),
            profileFields: coverageActionFields(q?.intent_type ?? null),
            measurementCount: i.measurement_count,
            mentionedCount: i.mentioned_count,
            mentionRate: Number(i.mention_rate),
          };
        });

      coverage = {
        completedAt: covRun.completed_at,
        questionCount: covRun.question_count,
        coveredQuestionCount: covRun.covered_question_count,
        partialQuestionCount: covRun.partial_question_count,
        missingQuestionCount: covRun.missing_question_count,
        questionCoverageRate: covRun.question_coverage_rate,
        measurementCoverageRate: covRun.measurement_coverage_rate,
        top3CoverageRate: covRun.top3_coverage_rate,
        clientDomainCitationRate: covRun.client_domain_citation_rate,
        clientFirstPartyCitationRate: covRun.client_first_party_citation_rate,
        firstPartyClassifierVersion: covRun.first_party_classifier_version,
        coverageScore: covRun.coverage_score === null ? null : Number(covRun.coverage_score),
        evidenceGrade: covRun.evidence_grade,
        gaps,
      };
    }

    /* ---------------- Insight ---------------- */
    const { data: insightRun } = await supabaseAdmin
      .from("insight_engine_runs")
      .select("id, completed_at, finding_count, eligible_measurement_count")
      .eq("org_id", data.orgId)
      .eq("business_id", business.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let insight: ReportInsightDTO | null = null;
    if (insightRun) {
      const [findingsRes, actionsRes] = await Promise.all([
        supabaseAdmin
          .from("insight_findings")
          .select(
            "id, title, summary, finding_type, evidence_grade, question_id, competitor_business_id, priority_score",
          )
          .eq("org_id", data.orgId)
          .eq("engine_run_id", insightRun.id)
          .order("priority_score", { ascending: false })
          .limit(3),
        supabaseAdmin
          .from("insight_actions")
          .select(
            "id, title, action_type, recommended_action, rationale, validation_plan, evidence_grade, recommendation_mode, priority_score",
          )
          .eq("org_id", data.orgId)
          .eq("engine_run_id", insightRun.id)
          .order("priority_score", { ascending: false })
          .limit(20),
      ]);


      const findingRows = findingsRes.data ?? [];
      const fqIds = [...new Set(findingRows.map((f) => f.question_id).filter(Boolean))] as string[];
      const cIds = [
        ...new Set(findingRows.map((f) => f.competitor_business_id).filter(Boolean)),
      ] as string[];

      const [fqRes, cRes] = await Promise.all([
        fqIds.length
          ? supabaseAdmin
              .from("questions")
              .select("id, prompt_text")
              .eq("org_id", data.orgId)
              .in("id", fqIds)
          : Promise.resolve({ data: [] as { id: string; prompt_text: string }[] }),
        cIds.length
          ? supabaseAdmin
              .from("businesses")
              .select("id, name")
              .eq("org_id", data.orgId)
              .in("id", cIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const fqMap = new Map((fqRes.data ?? []).map((q) => [q.id, q.prompt_text]));
      const cMap = new Map((cRes.data ?? []).map((b) => [b.id, b.name]));

      insight = {
        completedAt: insightRun.completed_at,
        findingCount: insightRun.finding_count,
        eligibleMeasurementCount: insightRun.eligible_measurement_count,
        findings: findingRows.map((f) => ({
          id: f.id,
          title: f.title,
          summary: f.summary,
          findingType: f.finding_type,
          evidenceGrade: f.evidence_grade,
          questionText: f.question_id ? snippet(fqMap.get(f.question_id) ?? null) : null,
          competitorName: f.competitor_business_id
            ? (cMap.get(f.competitor_business_id) ?? null)
            : null,
        })),
        actions: (actionsRes.data ?? [])
          .slice()
          .sort((a, b) =>
            compareCustomerActions(
              {
                actionType: a.action_type ?? null,
                evidenceGrade: a.evidence_grade ?? null,
                priorityScore: Number(a.priority_score),
              },
              {
                actionType: b.action_type ?? null,
                evidenceGrade: b.evidence_grade ?? null,
                priorityScore: Number(b.priority_score),
              },
            ),
          )
          .slice(0, 3)
          .map((a) => ({
            id: a.id,
            title: a.title,
            actionType: a.action_type ?? null,
            recommendedAction: a.recommended_action,
            rationale: a.rationale,
            validationPlan: a.validation_plan,
            evidenceGrade: a.evidence_grade,
            recommendationMode: a.recommendation_mode,
          })),

      };
    }

    /* ---------------- Experiments ---------------- */
    const { data: expRows } = await supabaseAdmin
      .from("experiments")
      .select(
        "id, name, source_type, status, created_at, baseline_run_id, baseline_start_at, baseline_end_at, followup_run_id, followup_start_at, followup_end_at, intervention_at, intervention_description, evaluated_at, result_classification, evidence_grade",
      )
      .eq("org_id", data.orgId)
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    const experimentsRaw = expRows ?? [];
    const runIds = [
      ...new Set(
        experimentsRaw.flatMap((e) => [e.baseline_run_id, e.followup_run_id]).filter(Boolean),
      ),
    ] as string[];

    const runMap = new Map<
      string,
      { status: string; total_jobs: number; completed_jobs: number; failed_jobs: number }
    >();
    const statsMap = new Map<string, { valid: number; included: number }>();

    if (runIds.length) {
      const [runsRes, measRes] = await Promise.all([
        supabaseAdmin
          .from("measurement_runs")
          .select("id, status, total_jobs, completed_jobs, failed_jobs")
          .eq("org_id", data.orgId)
          .in("id", runIds),
        supabaseAdmin
          .from("measurements")
          .select("run_id, valid, was_client_mentioned")
          .eq("org_id", data.orgId)
          .in("run_id", runIds)
          .limit(10000),
      ]);
      for (const r of runsRes.data ?? []) {
        runMap.set(r.id, {
          status: r.status,
          total_jobs: r.total_jobs,
          completed_jobs: r.completed_jobs,
          failed_jobs: r.failed_jobs,
        });
      }
      for (const m of measRes.data ?? []) {
        if (!m.valid) continue;
        const cur = statsMap.get(m.run_id) ?? { valid: 0, included: 0 };
        cur.valid += 1;
        if (m.was_client_mentioned) cur.included += 1;
        statsMap.set(m.run_id, cur);
      }
    }

    function phase(runId: string | null, finalized: boolean): ReportPhaseDTO {
      if (!runId) return { ...emptyPhase(), finalized };
      const r = runMap.get(runId);
      const s = statsMap.get(runId) ?? { valid: 0, included: 0 };
      return {
        runId,
        runStatus: r?.status ?? null,
        totalJobs: r?.total_jobs ?? null,
        completedJobs: r?.completed_jobs ?? null,
        failedJobs: r?.failed_jobs ?? null,
        finalized,
        validCount: s.valid,
        inclusionCount: s.included,
        inclusionRate: s.valid > 0 ? s.included / s.valid : null,
      };
    }

    const experiments: ReportExperimentDTO[] = experimentsRaw.map((e) => {
      const baseline = phase(e.baseline_run_id, !!e.baseline_start_at && !!e.baseline_end_at);
      const followup = phase(e.followup_run_id, !!e.followup_start_at && !!e.followup_end_at);
      const delta =
        baseline.inclusionRate !== null && followup.inclusionRate !== null
          ? (followup.inclusionRate - baseline.inclusionRate) * 100
          : null;
      return {
        id: e.id,
        name: e.name,
        sourceType: e.source_type ?? "unknown",
        status: e.status,
        createdAt: e.created_at,
        baseline,
        followup,
        interventionAt: e.intervention_at,
        interventionDescription: e.intervention_description,
        evaluatedAt: e.evaluated_at,
        resultClassification: e.evaluated_at ? e.result_classification : null,
        evidenceGrade: e.evaluated_at ? e.evidence_grade : null,
        inclusionDeltaPoints: delta,
      };
    });

    return { generatedAt, businesses, business, coverage, insight, experiments };
  });
