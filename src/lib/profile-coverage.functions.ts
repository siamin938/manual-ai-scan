import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COVERAGE_VALIDATION_PLAN,
  coverageActionFields,
  coverageActionPriority,
  coverageActionRationale,
  coverageActionTitle,
} from "./profile-coverage.helpers";
import type { ActiveExperimentDTO } from "./insights.functions";

export type ProfileCoverageItemDTO = {
  id: string;
  question_text: string | null;
  intent_type: string | null;
  coverage_status: string;
  measurement_count: number;
  mentioned_count: number;
  mention_rate: number;
  top3_count: number;
  top3_rate: number;
  domain_citation_rate: number;
  manual_review_count: number;
  best_position: number | null;
  average_position: number | null;
  repeat_stability: number | null;
  /** First-party 출처 인용 (classifier v0.1.0). 미집계면 version이 null */
  first_party_cited_count: number;
  first_party_citation_rate: number;
  first_party_classifier_version: string | null;
};

export type CoverageGapActionDTO = {
  /** safe reference: 실험 생성 시 서버로 전달하는 유일한 식별자 */
  coverage_item_id: string;
  question_text: string | null;
  intent_type: string | null;
  coverage_status: string;
  priority_level: "high" | "medium";
  title: string;
  rationale: string;
  profile_fields: string[];
  validation_plan: string;
  evidence_grade: string | null;
  recommendation_mode: "test";
  measurement_count: number;
  mentioned_count: number;
  mention_rate: number;
  /** 진행 중인 Experiment (snapshot 미포함, safe 필드만) */
  active_experiment: ActiveExperimentDTO | null;
};

export type ProfileCoverageOverviewDTO = {
  run: {
    id: string;
    engine_version: string;
    completed_at: string | null;
    business_name: string | null;
    input_measurement_count: number;
    eligible_measurement_count: number;
    excluded_measurement_count: number;
    question_count: number;
    covered_question_count: number;
    partial_question_count: number;
    missing_question_count: number;
    question_coverage_rate: number | null;
    measurement_coverage_rate: number | null;
    top3_coverage_rate: number | null;
    repeat_stability_rate: number | null;
    client_domain_citation_rate: number | null;
    client_first_party_citation_rate: number | null;
    first_party_classifier_version: string | null;
    coverage_score: number | null;
    manual_review_count: number;
    manual_review_rate: number | null;
    evidence_grade: string | null;
  } | null;
  items: ProfileCoverageItemDTO[];
  actions: CoverageGapActionDTO[];
};


export const getProfileCoverageOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId };
  })
  .handler(async ({ data, context }): Promise<ProfileCoverageOverviewDTO> => {
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
      .from("profile_coverage_runs")
      .select(
        "id, business_id, engine_version, completed_at, input_measurement_count, eligible_measurement_count, excluded_measurement_count, question_count, covered_question_count, partial_question_count, missing_question_count, question_coverage_rate, measurement_coverage_rate, top3_coverage_rate, repeat_stability_rate, client_domain_citation_rate, client_first_party_citation_rate, first_party_classifier_version, coverage_score, manual_review_count, manual_review_rate, evidence_grade",
      )
      .eq("org_id", data.orgId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runErr) throw new Error("RUN_QUERY_FAILED");
    if (!run) return { run: null, items: [], actions: [] };

    const [businessRes, itemsRes] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("name")
        .eq("id", run.business_id)
        .eq("org_id", data.orgId)
        .maybeSingle(),
      supabaseAdmin
        .from("profile_coverage_items")
        .select(
          "id, question_id, coverage_status, measurement_count, mentioned_count, mention_rate, top3_count, top3_rate, domain_citation_rate, first_party_cited_count, first_party_citation_rate, first_party_classifier_version, manual_review_count, best_position, average_position, metrics",
        )
        .eq("org_id", data.orgId)
        .eq("coverage_run_id", run.id),
    ]);

    const rawItems = itemsRes.data ?? [];
    const questionIds = [...new Set(rawItems.map((i) => i.question_id).filter(Boolean))] as string[];

    const questionsRes = questionIds.length
      ? await supabaseAdmin
          .from("questions")
          .select("id, prompt_text, intent_type")
          .in("id", questionIds)
          .eq("org_id", data.orgId)
      : { data: [] as { id: string; prompt_text: string; intent_type: string }[] };

    const qMap = new Map(
      (questionsRes.data ?? []).map((q) => [q.id, { text: q.prompt_text, intent: q.intent_type }]),
    );

    const statusOrder: Record<string, number> = { missing: 0, partial: 1, covered: 2 };

    const items: ProfileCoverageItemDTO[] = rawItems
      .map((i) => {
        const metrics = (i.metrics ?? {}) as Record<string, unknown>;
        const rs = metrics["repeat_stability"];
        const q = qMap.get(i.question_id);
        return {
          id: i.id,
          question_text: q?.text ?? null,
          intent_type: q?.intent ?? null,
          coverage_status: i.coverage_status,
          measurement_count: i.measurement_count,
          mentioned_count: i.mentioned_count,
          mention_rate: Number(i.mention_rate),
          top3_count: i.top3_count,
          top3_rate: Number(i.top3_rate),
          domain_citation_rate: Number(i.domain_citation_rate),
          first_party_cited_count: Number(i.first_party_cited_count ?? 0),
          first_party_citation_rate: Number(i.first_party_citation_rate ?? 0),
          first_party_classifier_version: i.first_party_classifier_version ?? null,
          manual_review_count: i.manual_review_count,
          best_position: i.best_position,
          average_position: i.average_position === null ? null : Number(i.average_position),
          repeat_stability: typeof rs === "number" ? rs : null,
        };
      })
      .sort(
        (a, b) =>
          (statusOrder[a.coverage_status] ?? 9) - (statusOrder[b.coverage_status] ?? 9) ||
          a.mention_rate - b.mention_rate,
      );

    // 진행 중인 coverage experiment (snapshot 미노출, safe 필드만)
    const gapItems = items.filter(
      (it) => it.coverage_status === "missing" || it.coverage_status === "partial",
    );
    const expByItem = new Map<string, ActiveExperimentDTO>();
    if (gapItems.length) {
      const { data: exps } = await supabaseAdmin
        .from("experiments")
        .select(
          "id, status, baseline_run_id, baseline_start_at, baseline_end_at, intervention_at, followup_run_id, followup_start_at, followup_end_at, evaluated_at, result_classification, evidence_grade, source_profile_coverage_item_id, created_at",
        )
        .eq("org_id", data.orgId)
        .eq("source_type", "profile_coverage_item")
        .in(
          "source_profile_coverage_item_id",
          gapItems.map((it) => it.id),
        )
        .in("status", ["draft", "baseline", "action_applied", "followup"])
        .order("created_at", { ascending: false });

      const runIds = [
        ...new Set(
          (exps ?? []).flatMap((e) => [e.baseline_run_id, e.followup_run_id]).filter(Boolean),
        ),
      ] as string[];
      const runStatusMap = new Map<string, string>();
      if (runIds.length) {
        const { data: runs } = await supabaseAdmin
          .from("measurement_runs")
          .select("id, status")
          .eq("org_id", data.orgId)
          .in("id", runIds);
        for (const r of runs ?? []) runStatusMap.set(r.id, r.status);
      }

      for (const e of exps ?? []) {
        const key = e.source_profile_coverage_item_id;
        if (!key || expByItem.has(key)) continue; // 최신 1개만
        expByItem.set(key, {
          id: e.id,
          status: e.status,
          baseline_run_id: e.baseline_run_id,
          baseline_run_status: e.baseline_run_id
            ? (runStatusMap.get(e.baseline_run_id) ?? null)
            : null,
          baseline_finalized: !!e.baseline_start_at && !!e.baseline_end_at,
          action_applied: !!e.intervention_at,
          action_applied_at: e.intervention_at,
          followup_run_id: e.followup_run_id,
          followup_run_status: e.followup_run_id
            ? (runStatusMap.get(e.followup_run_id) ?? null)
            : null,
          followup_finalized: !!e.followup_start_at && !!e.followup_end_at,
          evaluation_recorded: !!e.evaluated_at,
          result_classification: e.evaluated_at ? (e.result_classification ?? null) : null,
          evidence_grade: e.evaluated_at ? (e.evidence_grade ?? null) : null,
        });
      }
    }

    const priorityOrder: Record<string, number> = { high: 0, medium: 1 };
    const actions: CoverageGapActionDTO[] = gapItems
      .map((it) => ({
        coverage_item_id: it.id,
        question_text: it.question_text,
        intent_type: it.intent_type,
        coverage_status: it.coverage_status,
        priority_level: coverageActionPriority(it.coverage_status),
        title: coverageActionTitle(it.intent_type),
        rationale: coverageActionRationale({
          intent_type: it.intent_type,
          coverage_status: it.coverage_status,
          measurement_count: it.measurement_count,
          mentioned_count: it.mentioned_count,
        }),
        profile_fields: coverageActionFields(it.intent_type),
        validation_plan: COVERAGE_VALIDATION_PLAN,
        evidence_grade: run.evidence_grade,
        recommendation_mode: "test" as const,
        measurement_count: it.measurement_count,
        mentioned_count: it.mentioned_count,
        mention_rate: it.mention_rate,
        active_experiment: expByItem.get(it.id) ?? null,
      }))
      .sort(
        (a, b) =>
          (priorityOrder[a.priority_level] ?? 9) - (priorityOrder[b.priority_level] ?? 9) ||
          a.mention_rate - b.mention_rate,
      );


    return {
      run: {
        id: run.id,
        engine_version: run.engine_version,
        completed_at: run.completed_at,
        business_name: businessRes.data?.name ?? null,
        input_measurement_count: run.input_measurement_count,
        eligible_measurement_count: run.eligible_measurement_count,
        excluded_measurement_count: run.excluded_measurement_count,
        question_count: run.question_count,
        covered_question_count: run.covered_question_count,
        partial_question_count: run.partial_question_count,
        missing_question_count: run.missing_question_count,
        question_coverage_rate: run.question_coverage_rate,
        measurement_coverage_rate: run.measurement_coverage_rate,
        top3_coverage_rate: run.top3_coverage_rate,
        repeat_stability_rate: run.repeat_stability_rate,
        client_domain_citation_rate: run.client_domain_citation_rate,
        coverage_score: run.coverage_score === null ? null : Number(run.coverage_score),
        manual_review_count: run.manual_review_count,
        manual_review_rate: run.manual_review_rate,
        evidence_grade: run.evidence_grade,
      },
      items,
      actions,
    };
  });
