import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    coverage_score: number | null;
    manual_review_count: number;
    manual_review_rate: number | null;
    evidence_grade: string | null;
  } | null;
  items: ProfileCoverageItemDTO[];
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
        "id, business_id, engine_version, completed_at, input_measurement_count, eligible_measurement_count, excluded_measurement_count, question_count, covered_question_count, partial_question_count, missing_question_count, question_coverage_rate, measurement_coverage_rate, top3_coverage_rate, repeat_stability_rate, client_domain_citation_rate, coverage_score, manual_review_count, manual_review_rate, evidence_grade",
      )
      .eq("org_id", data.orgId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runErr) throw new Error("RUN_QUERY_FAILED");
    if (!run) return { run: null, items: [] };

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
          "id, question_id, coverage_status, measurement_count, mentioned_count, mention_rate, top3_count, top3_rate, domain_citation_rate, manual_review_count, best_position, average_position, metrics",
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
    };
  });
