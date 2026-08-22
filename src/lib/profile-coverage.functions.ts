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

export type CoverageGapActionDTO = {
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
        "id, business_id, engine_version, completed_at, input_measurement_count, eligible_measurement_count, excluded_measurement_count, question_count, covered_question_count, partial_question_count, missing_question_count, question_coverage_rate, measurement_coverage_rate, top3_coverage_rate, repeat_stability_rate, client_domain_citation_rate, coverage_score, manual_review_count, manual_review_rate, evidence_grade",
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

    function generateGapActions(
      coverageItems: ProfileCoverageItemDTO[],
      evidenceGrade: string | null,
    ): CoverageGapActionDTO[] {
      const validationPlan =
        "공개 페이지/프로필에 해당 정보를 명확히 반영한 뒤 같은 질문 세트와 같은 측정 조건으로 재측정해 노출률, Top 3 노출률, 자사 도메인 인용률의 변화를 비교합니다.";

      const titleByIntent: Record<string, string> = {
        trust: "신뢰 근거 보강 테스트",
        review_quality: "후기 근거 구조화 테스트",
        recommendation: "추천 기준 정보 보강 테스트",
      };

      const fieldsByIntent: Record<string, string[]> = {
        trust: [
          "가격·작업 범위의 명확한 안내",
          "정비/서비스 절차",
          "보증·A/S·사후관리 정보",
          "공식 운영 주체·브랜드 근거",
        ],
        review_quality: [
          "실제 작업 내용이 포함된 구체 후기",
          "차량/서비스 항목이 명시된 사례",
          "최근 후기와 작성 시점",
          "공개적으로 확인 가능한 후기 출처",
        ],
        recommendation: [
          "제공 서비스 범위",
          "지역·지점 정보",
          "차종/브랜드 대응 범위",
          "경쟁 업체와 구분되는 특징",
          "공식 페이지에서 확인 가능한 근거",
        ],
      };

      const defaultTitle = "업체 프로필 정보 보강 테스트";
      const defaultFields = [
        "핵심 서비스 범위",
        "지역·지점 정보",
        "대상 고객/차종 범위",
        "차별점",
        "공식 공개 근거",
      ];

      const candidates = coverageItems
        .filter((it) => it.coverage_status === "missing" || it.coverage_status === "partial")
        .map((it) => {
          const intent = it.intent_type ?? "";
          const priorityLevel: "high" | "medium" =
            it.coverage_status === "missing" ? "high" : "medium";
          const title = titleByIntent[intent] ?? defaultTitle;
          const profileFields = fieldsByIntent[intent] ?? defaultFields;
          const rationale =
            it.coverage_status === "missing"
              ? `현재 이 질문은 ${it.measurement_count}회 측정에서 대상 업체가 한 번도 노출되지 않았습니다. 어떤 정보가 노출에 영향을 주는지는 아직 확인되지 않았으므로, 아래 프로필 정보를 보강한 뒤 동일 조건 재측정으로 검증하는 테스트 후보입니다.`
              : `현재 이 질문은 ${it.measurement_count}회 중 ${it.mentioned_count}회만 대상 업체가 노출되었습니다. 노출이 불안정하게 관찰되어, 아래 프로필 정보를 보강한 뒤 동일 조건 재측정으로 검증하는 테스트 후보입니다.`;

          return {
            question_text: it.question_text,
            intent_type: it.intent_type,
            coverage_status: it.coverage_status,
            priority_level: priorityLevel,
            title,
            rationale,
            profile_fields: profileFields,
            validation_plan: validationPlan,
            evidence_grade: evidenceGrade,
            recommendation_mode: "test" as const,
            measurement_count: it.measurement_count,
            mentioned_count: it.mentioned_count,
            mention_rate: it.mention_rate,
          };
        });

      const priorityOrder: Record<string, number> = { high: 0, medium: 1 };
      return candidates.sort(
        (a, b) =>
          (priorityOrder[a.priority_level] ?? 9) - (priorityOrder[b.priority_level] ?? 9) ||
          a.mention_rate - b.mention_rate,
      );
    }

    const actions = generateGapActions(items, run.evidence_grade);

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
