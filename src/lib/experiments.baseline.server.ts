// 서버 전용 Baseline 준비/검증 로직.
// 이 파일은 브라우저 번들로 나가지 않는다(*.server.ts import 차단).
// 이번 단계에서는 enqueue-run 호출, measurement_runs INSERT, experiments UPDATE(prepare 경로)를 하지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  ALLOWED_ROLES,
  BASELINE_EXPECTED_QUESTION_COUNT,
  BASELINE_MAX_COST_USD,
  BASELINE_PRIMARY_METRIC,
  BASELINE_REPETITIONS,
  BASELINE_SECONDARY_METRICS,
  BASELINE_SELECTED_PROVIDERS,
  baselineFail,
  computeConditionHash,
  type BaselineErrorCode,
  type BaselinePlanSummary,
  type ExperimentConditionSnapshotV1,
  type FinalizeExperimentBaselineResult,
  type SnapshotBusinessRef,
  type SnapshotQuestion,
  type StartExperimentBaselineResult,
} from "./experiments.helpers";

type UserClient = SupabaseClient<Database>;

async function hasStaffRole(supabase: UserClient, orgId: string, userId: string) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false as const, error: "INTERNAL_ERROR" as BaselineErrorCode };
  if (!data) return { ok: false as const, error: "FORBIDDEN" as BaselineErrorCode };
  if (!ALLOWED_ROLES.includes(data.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false as const, error: "FORBIDDEN" as BaselineErrorCode };
  }
  return { ok: true as const };
}

function toBusinessRef(row: {
  id: string;
  name: string;
  aliases: string[] | null;
  official_domains: string[] | null;
  website_url: string | null;
}): SnapshotBusinessRef {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    official_domains: row.official_domains ?? [],
    website_url: row.website_url ?? null,
  };
}

export type BaselinePlan = {
  snapshot: ExperimentConditionSnapshotV1;
  summary: BaselinePlanSummary;
};

/**
 * 실제 DB 데이터로 Baseline snapshot(v1) plan을 구성하는 서버 helper.
 * 순수 read-only. write/enqueue 없음.
 */
export async function prepareBaselineSnapshotData(args: {
  orgId: string;
  experimentId: string;
}): Promise<{ ok: true; plan: BaselinePlan } | { ok: false; error: BaselineErrorCode }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { orgId, experimentId } = args;

  // 1) Experiment (id + org_id)
  const { data: experiment, error: expErr } = await supabaseAdmin
    .from("experiments")
    .select("id, org_id, business_id, status, baseline_run_id, source_insight_action_id")
    .eq("id", experimentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (expErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!experiment) return { ok: false, error: "EXPERIMENT_NOT_FOUND" };
  if (experiment.baseline_run_id) return { ok: false, error: "BASELINE_ALREADY_EXISTS" };
  if (experiment.status !== "draft") return { ok: false, error: "INVALID_EXPERIMENT_STATE" };
  if (!experiment.source_insight_action_id) {
    return { ok: false, error: "SOURCE_ACTION_SCOPE_MISMATCH" };
  }

  // 2) Insight Action → engine run → source measurement run
  const { data: action, error: actErr } = await supabaseAdmin
    .from("insight_actions")
    .select("id, org_id, business_id, engine_run_id")
    .eq("id", experiment.source_insight_action_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (actErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!action || action.business_id !== experiment.business_id) {
    return { ok: false, error: "SOURCE_ACTION_SCOPE_MISMATCH" };
  }

  const { data: engineRun, error: engErr } = await supabaseAdmin
    .from("insight_engine_runs")
    .select("id, source_run_id")
    .eq("id", action.engine_run_id)
    .eq("org_id", orgId)
    .eq("business_id", experiment.business_id)
    .maybeSingle();
  if (engErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!engineRun?.source_run_id) return { ok: false, error: "SOURCE_RUN_NOT_FOUND" };

  const { data: sourceRun, error: srcErr } = await supabaseAdmin
    .from("measurement_runs")
    .select("id, org_id, business_id, question_set_id")
    .eq("id", engineRun.source_run_id)
    .eq("org_id", orgId)
    .eq("business_id", experiment.business_id)
    .maybeSingle();
  if (srcErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!sourceRun) return { ok: false, error: "SOURCE_RUN_NOT_FOUND" };

  // 3) Question set + 현재 active 질문 (서버가 결정, 클라이언트 입력 없음)
  const { data: questionSet, error: qsErr } = await supabaseAdmin
    .from("question_sets")
    .select("id, org_id, business_id, active")
    .eq("id", sourceRun.question_set_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (qsErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!questionSet) return { ok: false, error: "QUESTION_SET_NOT_FOUND" };
  if (questionSet.business_id !== experiment.business_id || !questionSet.active) {
    return { ok: false, error: "QUESTION_SET_CHANGED" };
  }

  const { data: questionRows, error: qErr } = await supabaseAdmin
    .from("questions")
    .select(
      "id, prompt_text, prompt_hash, intent_type, language, country_code, region, city, weight, data_class, active",
    )
    .eq("org_id", orgId)
    .eq("question_set_id", questionSet.id)
    .eq("active", true)
    .order("id", { ascending: true });
  if (qErr) return { ok: false, error: "INTERNAL_ERROR" };
  const questions: SnapshotQuestion[] = (questionRows ?? []).map((q) => ({
    id: q.id,
    prompt_text: q.prompt_text, // 원문 그대로 보존 (정규화 금지)
    prompt_hash: q.prompt_hash ?? null,
    intent_type: q.intent_type,
    language: q.language,
    country_code: q.country_code,
    region: q.region ?? null,
    city: q.city ?? null,
    weight: Number(q.weight),
    data_class: q.data_class,
    active: q.active,
  }));
  if (questions.length !== BASELINE_EXPECTED_QUESTION_COUNT) {
    return { ok: false, error: "QUESTION_SET_CHANGED" };
  }
  if (questions.some((q) => !Number.isFinite(q.weight))) {
    return { ok: false, error: "QUESTION_SET_CHANGED" };
  }
  if (questions.some((q) => q.data_class !== "public")) {
    return { ok: false, error: "NON_PUBLIC_QUESTION" };
  }

  // 4) Provider 준비 상태 (openai 1개만)
  const { data: providerSettings, error: psErr } = await supabaseAdmin
    .from("provider_settings")
    .select(
      "provider, enabled, model_name, search_context_size, estimated_cost_per_request_usd, paid_account_confirmed, terms_reviewed, automated_benchmark_approved",
    )
    .eq("org_id", orgId)
    .eq("provider", "openai")
    .maybeSingle();
  if (psErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (
    !providerSettings ||
    !providerSettings.enabled ||
    !providerSettings.paid_account_confirmed ||
    !providerSettings.terms_reviewed ||
    !providerSettings.automated_benchmark_approved ||
    !providerSettings.model_name ||
    !providerSettings.search_context_size
  ) {
    return { ok: false, error: "PROVIDER_NOT_READY" };
  }

  const modelName = String(providerSettings.model_name).trim();
  const searchContextSize = String(providerSettings.search_context_size).trim();
  const costPerRequest = Number(providerSettings.estimated_cost_per_request_usd);
  if (!modelName) return { ok: false, error: "PROVIDER_NOT_READY" };
  if (
    !ALLOWED_SEARCH_CONTEXT_SIZES.includes(
      searchContextSize as (typeof ALLOWED_SEARCH_CONTEXT_SIZES)[number],
    )
  ) {
    return { ok: false, error: "PROVIDER_NOT_READY" };
  }
  if (!Number.isFinite(costPerRequest) || costPerRequest < 0) {
    return { ok: false, error: "PROVIDER_NOT_READY" };
  }

  const plannedJobs = questions.length * BASELINE_SELECTED_PROVIDERS.length * BASELINE_REPETITIONS;
  const estimatedCostUsd = Math.round(costPerRequest * plannedJobs * 1e6) / 1e6;
  if (estimatedCostUsd > BASELINE_MAX_COST_USD) {
    return { ok: false, error: "RUN_COST_CAP_EXCEEDED" };
  }


  // 5) parsing_context (Provider 전송용 아님 — 로컬 parser 재현성 전용)
  const { data: targetBiz, error: bizErr } = await supabaseAdmin
    .from("businesses")
    .select("id, name, aliases, official_domains, website_url, active")
    .eq("id", experiment.business_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (bizErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!targetBiz || !targetBiz.active) return { ok: false, error: "BASELINE_PREPARE_FAILED" };

  const { data: links, error: linkErr } = await supabaseAdmin
    .from("business_competitors")
    .select("competitor_business_id")
    .eq("org_id", orgId)
    .eq("target_business_id", experiment.business_id)
    .eq("active", true);
  if (linkErr) return { ok: false, error: "INTERNAL_ERROR" };

  let competitors: SnapshotBusinessRef[] = [];
  const competitorIds = (links ?? []).map((l) => l.competitor_business_id);
  if (competitorIds.length > 0) {
    const { data: compRows, error: compErr } = await supabaseAdmin
      .from("businesses")
      .select("id, name, aliases, official_domains, website_url")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("id", competitorIds);
    if (compErr) return { ok: false, error: "INTERNAL_ERROR" };
    competitors = (compRows ?? [])
      .map(toBusinessRef)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const parsingContext = { target: toBusinessRef(targetBiz), competitors };
  const providerModels = { openai: providerSettings.model_name };

  const conditionHash = await computeConditionHash({
    question_set_id: questionSet.id,
    questions,
    selected_providers: BASELINE_SELECTED_PROVIDERS,
    provider_models: providerModels,
    repetitions: BASELINE_REPETITIONS,
    search_context_size: providerSettings.search_context_size,
    store: false,
    parsing_context: parsingContext,
  });

  const snapshot: ExperimentConditionSnapshotV1 = {
    snapshot_version: "1",
    captured_at: new Date().toISOString(),
    experiment_id: experiment.id,
    org_id: orgId,
    business_id: experiment.business_id,
    source_insight_action_id: experiment.source_insight_action_id,
    reference_source_run_id: sourceRun.id,
    question_set_id: questionSet.id,
    questions,
    planned: {
      selected_providers: ["openai"],
      provider_models: providerModels,
      repetitions: BASELINE_REPETITIONS,
      search_context_size: providerSettings.search_context_size,
      store: false,
      planned_jobs: plannedJobs,
      estimated_cost_usd: estimatedCostUsd,
      max_cost_usd: BASELINE_MAX_COST_USD,
    },
    parsing_context: parsingContext,
    condition_hash: conditionHash,
    observed: {
      provider_models: null,
      parser_versions: null,
      measurement_count: null,
      valid_measurement_count: null,
      run_started_at: null,
      run_completed_at: null,
      finalized_at: null,
    },
    primary_metric: BASELINE_PRIMARY_METRIC,
    secondary_metrics: [...BASELINE_SECONDARY_METRICS],
  };

  return {
    ok: true,
    plan: {
      snapshot,
      summary: {
        questionCount: questions.length,
        provider: "openai",
        model: providerSettings.model_name,
        repetitions: BASELINE_REPETITIONS,
        plannedJobs,
        estimatedCostUsd,
        maxCostUsd: BASELINE_MAX_COST_USD,
      },
    },
  };
}

/**
 * Baseline 준비. 이번 단계에서는 어떤 write도, enqueue-run 호출도 하지 않고
 * 검증 + plan 구성 후 BASELINE_ENQUEUE_NOT_READY로 정지한다.
 */
export async function startExperimentBaselineImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<StartExperimentBaselineResult> {
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return baselineFail(role.error) as StartExperimentBaselineResult;

  const prepared = await prepareBaselineSnapshotData({
    orgId: args.orgId,
    experimentId: args.experimentId,
  });
  if (!prepared.ok) return baselineFail(prepared.error) as StartExperimentBaselineResult;

  // 실행 차단: measurement_runs INSERT / experiments UPDATE / enqueue-run 호출 없음.
  // snapshot 전체는 클라이언트로 반환하지 않는다.
  return { ok: false, error: "BASELINE_ENQUEUE_NOT_READY", summary: prepared.plan.summary };
}

/** Baseline 완료 후 실제 실행 조건을 검증하고 observed만 기록한다. Provider 호출 없음. */
export async function finalizeExperimentBaselineImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<FinalizeExperimentBaselineResult> {
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return { ok: false, error: role.error };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: experiment, error: expErr } = await supabaseAdmin
    .from("experiments")
    .select("id, org_id, business_id, baseline_run_id, baseline_condition_snapshot")
    .eq("id", args.experimentId)
    .eq("org_id", args.orgId)
    .maybeSingle();
  if (expErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!experiment) return { ok: false, error: "EXPERIMENT_NOT_FOUND" };
  if (!experiment.baseline_run_id) return { ok: false, error: "INVALID_EXPERIMENT_STATE" };

  const snapshot = experiment.baseline_condition_snapshot as unknown as
    | ExperimentConditionSnapshotV1
    | null;
  if (!snapshot || snapshot.snapshot_version !== "1") {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }

  const { data: run, error: runErr } = await supabaseAdmin
    .from("measurement_runs")
    .select("id, org_id, business_id, run_type, phase, status, experiment_id, started_at, completed_at")
    .eq("id", experiment.baseline_run_id)
    .maybeSingle();
  if (runErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!run) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  if (
    run.org_id !== experiment.org_id ||
    run.business_id !== experiment.business_id ||
    run.run_type !== "experiment" ||
    run.phase !== "baseline" ||
    run.experiment_id !== experiment.id
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  if (run.status !== "completed") return { ok: false, error: "BASELINE_RUN_NOT_COMPLETED" };

  const plannedModel = snapshot.planned.provider_models["openai"];
  const plannedJobs = snapshot.planned.planned_jobs;
  const snapshotQuestionIds = [...snapshot.questions.map((q) => q.id)].sort();

  const { data: jobs, error: jobErr } = await supabaseAdmin
    .from("measurement_jobs")
    .select("id, question_id, provider, provider_model")
    .eq("org_id", args.orgId)
    .eq("run_id", run.id);
  if (jobErr) return { ok: false, error: "INTERNAL_ERROR" };
  const jobRows = jobs ?? [];
  if (jobRows.length !== plannedJobs) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  if (jobRows.some((j) => j.provider !== "openai" || j.provider_model !== plannedModel)) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const perQuestion = new Map<string, number>();
  for (const j of jobRows) perQuestion.set(j.question_id, (perQuestion.get(j.question_id) ?? 0) + 1);
  const jobQuestionIds = [...perQuestion.keys()].sort();
  if (
    jobQuestionIds.length !== snapshotQuestionIds.length ||
    jobQuestionIds.some((id, i) => id !== snapshotQuestionIds[i]) ||
    [...perQuestion.values()].some((count) => count !== snapshot.planned.repetitions)
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }

  const { data: measurements, error: mErr } = await supabaseAdmin
    .from("measurements")
    .select("id, provider, provider_model, valid, parser_version")
    .eq("org_id", args.orgId)
    .eq("run_id", run.id);
  if (mErr) return { ok: false, error: "INTERNAL_ERROR" };
  const mRows = measurements ?? [];
  if (mRows.length !== plannedJobs) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  if (
    mRows.some(
      (m) => m.provider !== "openai" || m.provider_model !== plannedModel || m.valid !== true,
    )
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const parserVersions = [...new Set(mRows.map((m) => m.parser_version))].sort();
  if (parserVersions.length !== 1) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };

  const providerModels = [...new Set(mRows.map((m) => m.provider_model))].sort();
  const observed = {
    provider_models: providerModels,
    parser_versions: parserVersions,
    measurement_count: mRows.length,
    valid_measurement_count: mRows.filter((m) => m.valid).length,
    run_started_at: run.started_at,
    run_completed_at: run.completed_at,
    finalized_at: new Date().toISOString(),
  };

  // structured/planned/parsing_context/condition_hash는 그대로 유지하고 observed만 갱신
  const { error: updErr } = await supabaseAdmin
    .from("experiments")
    .update({
      baseline_condition_snapshot: { ...snapshot, observed } as unknown as never,
      baseline_start_at: run.started_at,
      baseline_end_at: run.completed_at,
    })
    .eq("id", experiment.id)
    .eq("org_id", args.orgId);
  if (updErr) return { ok: false, error: "INTERNAL_ERROR" };

  return {
    ok: true,
    observed: {
      measurementCount: observed.measurement_count,
      validMeasurementCount: observed.valid_measurement_count,
      parserVersions,
      providerModels,
    },
  };
}
