// 서버 전용 Baseline 준비/검증 로직.
// 이 파일은 브라우저 번들로 나가지 않는다(*.server.ts import 차단).
// Experiment write는 service_role 서버 경로만 사용하고, enqueue는 사용자 JWT로 호출한다.
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
  ALLOWED_SEARCH_CONTEXT_SIZES,
  baselineFail,
  computeConditionHash,
  type BaselineErrorCode,
  type BaselinePlanSummary,
  type BaselineRunStateDTO,
  type ExperimentConditionSnapshotV1,
  type FinalizeExperimentBaselineResult,
  type PreviewExperimentBaselineResult,
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
  const providerModels = { openai: modelName };

  const conditionHash = await computeConditionHash({
    question_set_id: questionSet.id,
    questions,
    selected_providers: BASELINE_SELECTED_PROVIDERS,
    provider_models: providerModels,
    repetitions: BASELINE_REPETITIONS,
    search_context_size: searchContextSize,
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
      search_context_size: searchContextSize,
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
        model: modelName,
        repetitions: BASELINE_REPETITIONS,
        plannedJobs,
        estimatedCostUsd,
        maxCostUsd: BASELINE_MAX_COST_USD,
      },
    },
  };
}

/* =========================================================================
 * Baseline 실제 실행 흐름 (canonical pointer + CAS + enqueue retry)
 * ========================================================================= */

type CanonicalRunRow = {
  id: string;
  org_id: string;
  business_id: string;
  experiment_id: string | null;
  question_set_id: string;
  run_type: string;
  phase: string;
  status: string;
  selected_providers: string[];
  repetitions: number;
  max_cost_usd: number;
  estimated_cost_usd: number;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  started_at: string | null;
  completed_at: string | null;
};

const CANONICAL_RUN_COLUMNS =
  "id, org_id, business_id, experiment_id, question_set_id, run_type, phase, status, selected_providers, repetitions, max_cost_usd, estimated_cost_usd, total_jobs, completed_jobs, failed_jobs, started_at, completed_at";

/** 저장된 snapshot에서 client-safe summary만 추출 + planned 무결성 확인. */
function summaryFromSnapshot(
  snapshot: ExperimentConditionSnapshotV1 | null,
): { ok: true; summary: BaselinePlanSummary } | { ok: false; error: BaselineErrorCode } {
  if (!snapshot || snapshot.snapshot_version !== "1") {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const planned = snapshot.planned;
  const model = (planned?.provider_models?.["openai"] ?? "").trim();
  if (
    !planned ||
    planned.selected_providers?.length !== 1 ||
    planned.selected_providers[0] !== "openai" ||
    !model ||
    planned.repetitions !== BASELINE_REPETITIONS ||
    planned.max_cost_usd !== BASELINE_MAX_COST_USD ||
    planned.store !== false ||
    !Number.isFinite(Number(planned.estimated_cost_usd)) ||
    !Number.isFinite(Number(planned.planned_jobs))
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  return {
    ok: true,
    summary: {
      questionCount: snapshot.questions?.length ?? 0,
      provider: "openai",
      model,
      repetitions: planned.repetitions,
      plannedJobs: planned.planned_jobs,
      estimatedCostUsd: Number(planned.estimated_cost_usd),
      maxCostUsd: planned.max_cost_usd,
    },
  };
}

/** 저장된 snapshot의 scope + condition_hash 재검증 (덮어쓰기 금지). */
async function validateStoredSnapshot(
  snapshot: ExperimentConditionSnapshotV1 | null,
  experiment: { id: string; org_id: string; business_id: string },
): Promise<{ ok: true; summary: BaselinePlanSummary } | { ok: false; error: BaselineErrorCode }> {
  const summary = summaryFromSnapshot(snapshot);
  if (!summary.ok) return summary;
  const snap = snapshot as ExperimentConditionSnapshotV1;
  if (
    snap.experiment_id !== experiment.id ||
    snap.org_id !== experiment.org_id ||
    snap.business_id !== experiment.business_id
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const recomputed = await computeConditionHash({
    question_set_id: snap.question_set_id,
    questions: snap.questions,
    selected_providers: [...snap.planned.selected_providers],
    provider_models: snap.planned.provider_models,
    repetitions: snap.planned.repetitions,
    search_context_size: snap.planned.search_context_size,
    store: snap.planned.store,
    parsing_context: snap.parsing_context,
  });
  if (recomputed !== snap.condition_hash) {
    return { ok: false, error: "BASELINE_CONDITION_DRIFT" };
  }
  return summary;
}

type ExperimentRow = {
  id: string;
  org_id: string;
  business_id: string;
  name: string;
  status: string;
  baseline_run_id: string | null;
  baseline_condition_snapshot: unknown;
  source_insight_action_id: string | null;
};

async function loadExperimentRow(
  orgId: string,
  experimentId: string,
): Promise<{ ok: true; experiment: ExperimentRow } | { ok: false; error: BaselineErrorCode }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("experiments")
    .select(
      "id, org_id, business_id, name, status, baseline_run_id, baseline_condition_snapshot, source_insight_action_id",
    )
    .eq("id", experimentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return { ok: false, error: "INTERNAL_ERROR" };
  if (!data) return { ok: false, error: "EXPERIMENT_NOT_FOUND" };
  return { ok: true, experiment: data as unknown as ExperimentRow };
}

/**
 * canonical Baseline run 상태 로더.
 * experiments.baseline_run_id만 canonical로 신뢰한다.
 */
export async function loadCanonicalBaselineState(args: {
  orgId: string;
  experimentId: string;
}): Promise<
  | { ok: true; experiment: ExperimentRow; run: CanonicalRunRow; summary: BaselinePlanSummary }
  | { ok: false; error: BaselineErrorCode }
> {
  const loaded = await loadExperimentRow(args.orgId, args.experimentId);
  if (!loaded.ok) return loaded;
  const experiment = loaded.experiment;
  if (!experiment.baseline_run_id) return { ok: false, error: "INVALID_EXPERIMENT_STATE" };

  const snapshot = experiment.baseline_condition_snapshot as ExperimentConditionSnapshotV1 | null;
  const validated = await validateStoredSnapshot(snapshot, experiment);
  if (!validated.ok) return validated;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: run, error: runErr } = await supabaseAdmin
    .from("measurement_runs")
    .select(CANONICAL_RUN_COLUMNS)
    .eq("id", experiment.baseline_run_id)
    .eq("org_id", args.orgId)
    .maybeSingle();
  if (runErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!run) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };

  const r = run as unknown as CanonicalRunRow;
  if (
    r.org_id !== experiment.org_id ||
    r.business_id !== experiment.business_id ||
    r.experiment_id !== experiment.id ||
    r.run_type !== "experiment" ||
    r.phase !== "baseline"
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }

  return { ok: true, experiment, run: r, summary: validated.summary };
}

/**
 * READ ONLY preview. 비용 확인 Dialog용 safe summary만 반환한다.
 * snapshot/parsing_context/aliases/domains/raw response는 절대 반환하지 않는다.
 */
export async function previewExperimentBaselineImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<PreviewExperimentBaselineResult> {
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return { ok: false, error: role.error };

  const loaded = await loadExperimentRow(args.orgId, args.experimentId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const experiment = loaded.experiment;

  // 1) 신규 draft — 현재 live 조건으로 plan summary 계산
  if (experiment.status === "draft" && !experiment.baseline_run_id) {
    const prepared = await prepareBaselineSnapshotData({
      orgId: args.orgId,
      experimentId: args.experimentId,
    });
    if (!prepared.ok) return { ok: false, error: prepared.error };
    return { ok: true, summary: prepared.plan.summary };
  }

  // 2) 기존 baseline — 저장된 snapshot의 summary만 반환 (snapshot 변경 금지)
  if (experiment.status === "baseline" && experiment.baseline_run_id) {
    const state = await loadCanonicalBaselineState({
      orgId: args.orgId,
      experimentId: args.experimentId,
    });
    if (!state.ok) return { ok: false, error: state.error };

    // Provider safety gate가 지금 꺼져 있으면 재시도 자체를 차단한다.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ps, error: psErr } = await supabaseAdmin
      .from("provider_settings")
      .select("enabled, paid_account_confirmed, terms_reviewed, automated_benchmark_approved")
      .eq("org_id", args.orgId)
      .eq("provider", "openai")
      .maybeSingle();
    if (psErr) return { ok: false, error: "INTERNAL_ERROR" };
    if (
      !ps ||
      !ps.enabled ||
      !ps.paid_account_confirmed ||
      !ps.terms_reviewed ||
      !ps.automated_benchmark_approved
    ) {
      return { ok: false, error: "PROVIDER_NOT_READY" };
    }

    return { ok: true, summary: state.summary };
  }

  return { ok: false, error: "INVALID_EXPERIMENT_STATE" };
}

/** canonical run 상태별 enqueue 처리. draft만 enqueue-run을 호출한다. */
async function enqueueIfNeeded(args: {
  supabase: UserClient;
  experiment: ExperimentRow;
  run: CanonicalRunRow;
  summary: BaselinePlanSummary;
}): Promise<StartExperimentBaselineResult> {
  const { experiment, run, summary } = args;
  const base: BaselineRunStateDTO = {
    experimentId: experiment.id,
    baselineRunId: run.id,
    experimentStatus: experiment.status,
    runStatus: run.status,
    summary,
  };

  if (run.status === "queued" || run.status === "running" || run.status === "completed") {
    return { ok: true, baseline: base };
  }

  if (run.status !== "draft") {
    // partial / failed / cancelled — 자동 새 Run 생성 금지
    return baselineFail("BASELINE_RUN_REQUIRES_REVIEW", base) as StartExperimentBaselineResult;
  }

  // draft — 사용자 JWT로 enqueue-run 호출 (service_role key 미전달)
  try {
    const { error } = await args.supabase.functions.invoke("enqueue-run", {
      body: { runId: run.id },
    });
    if (error) {
      console.error("[baseline] enqueue failed", { runId: run.id, experimentId: experiment.id });
      return baselineFail("BASELINE_ENQUEUE_FAILED", base) as StartExperimentBaselineResult;
    }
  } catch {
    console.error("[baseline] enqueue threw", { runId: run.id, experimentId: experiment.id });
    return baselineFail("BASELINE_ENQUEUE_FAILED", base) as StartExperimentBaselineResult;
  }

  // enqueue 성공 후 실제 상태를 다시 읽는다. baseline_start_at은 여기서 기록하지 않는다.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: refreshed } = await supabaseAdmin
    .from("measurement_runs")
    .select("status")
    .eq("id", run.id)
    .eq("org_id", experiment.org_id)
    .maybeSingle();

  return { ok: true, baseline: { ...base, runStatus: refreshed?.status ?? run.status } };
}

/**
 * Baseline 실행 준비 + enqueue.
 * 브라우저 입력은 orgId + experimentId만. 나머지는 서버 상수/snapshot에서 결정한다.
 */
export async function startExperimentBaselineImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<StartExperimentBaselineResult> {
  // A. 권한
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return baselineFail(role.error) as StartExperimentBaselineResult;

  // B. 현재 Experiment 상태
  const loaded = await loadExperimentRow(args.orgId, args.experimentId);
  if (!loaded.ok) return baselineFail(loaded.error) as StartExperimentBaselineResult;
  const experiment = loaded.experiment;

  // 기존 canonical Baseline 재사용 경로 (새 Run 생성 금지)
  if (experiment.status === "baseline" && experiment.baseline_run_id) {
    const state = await loadCanonicalBaselineState({
      orgId: args.orgId,
      experimentId: args.experimentId,
    });
    if (!state.ok) return baselineFail(state.error) as StartExperimentBaselineResult;
    return enqueueIfNeeded({
      supabase: args.supabase,
      experiment: state.experiment,
      run: state.run,
      summary: state.summary,
    });
  }

  // 비정상 조합 포함, 신규 준비는 draft + baseline_run_id NULL만 허용
  if (experiment.status !== "draft" || experiment.baseline_run_id) {
    return baselineFail("INVALID_EXPERIMENT_STATE") as StartExperimentBaselineResult;
  }

  // C. 신규 Baseline plan
  const prepared = await prepareBaselineSnapshotData({
    orgId: args.orgId,
    experimentId: args.experimentId,
  });
  if (!prepared.ok) return baselineFail(prepared.error) as StartExperimentBaselineResult;
  const { snapshot, summary } = prepared.plan;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // D. measurement_runs INSERT (draft) — 값은 snapshot/서버 상수에서만
  const { data: createdRun, error: runInsErr } = await supabaseAdmin
    .from("measurement_runs")
    .insert({
      org_id: snapshot.org_id,
      business_id: snapshot.business_id,
      question_set_id: snapshot.question_set_id,
      experiment_id: experiment.id,
      name: `${experiment.name} · Baseline`,
      run_type: "experiment",
      phase: "baseline",
      status: "draft",
      selected_providers: ["openai"],
      repetitions: BASELINE_REPETITIONS,
      max_cost_usd: BASELINE_MAX_COST_USD,
      estimated_cost_usd: summary.estimatedCostUsd,
      total_jobs: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      created_by: args.userId,
      scheduled_at: new Date().toISOString(),
    })
    .select(CANONICAL_RUN_COLUMNS)
    .maybeSingle();
  if (runInsErr || !createdRun) {
    console.error("[baseline] run insert failed", { experimentId: experiment.id });
    return baselineFail("BASELINE_RUN_CREATE_FAILED") as StartExperimentBaselineResult;
  }
  const newRun = createdRun as unknown as CanonicalRunRow;

  // E. Experiment canonical pointer CAS
  const { data: linked, error: linkErr } = await supabaseAdmin
    .from("experiments")
    .update({
      status: "baseline",
      baseline_run_id: newRun.id,
      baseline_condition_snapshot: snapshot as unknown as never,
      baseline_start_at: null,
      baseline_end_at: null,
      primary_metric: BASELINE_PRIMARY_METRIC,
    })
    .eq("id", experiment.id)
    .eq("org_id", args.orgId)
    .eq("status", "draft")
    .is("baseline_run_id", null)
    .select("id, status, baseline_run_id");

  const linkedRow = !linkErr && linked && linked.length === 1 ? linked[0] : null;

  if (!linkedRow) {
    // CAS 실패 — 방금 만든 run은 canonical이 아니므로 취소 처리
    const { error: cancelErr } = await supabaseAdmin
      .from("measurement_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", newRun.id)
      .eq("org_id", args.orgId)
      .eq("status", "draft");
    if (cancelErr) {
      console.error("[baseline] orphan run candidate", { runId: newRun.id });
    }

    // 경쟁에서 졌다면 기존 canonical 상태를 idempotent하게 반환
    const state = await loadCanonicalBaselineState({
      orgId: args.orgId,
      experimentId: args.experimentId,
    });
    if (state.ok) {
      return enqueueIfNeeded({
        supabase: args.supabase,
        experiment: state.experiment,
        run: state.run,
        summary: state.summary,
      });
    }
    console.error("[baseline] pointer link failed", { experimentId: experiment.id });
    return baselineFail("BASELINE_LINK_FAILED") as StartExperimentBaselineResult;
  }

  // F. CAS 성공 후에만 enqueue
  return enqueueIfNeeded({
    supabase: args.supabase,
    experiment: { ...experiment, status: "baseline", baseline_run_id: newRun.id },
    run: newRun,
    summary,
  });
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

  // A) snapshot scope / 구조 검증
  if (
    snapshot.experiment_id !== experiment.id ||
    snapshot.org_id !== experiment.org_id ||
    snapshot.business_id !== experiment.business_id
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const planned = snapshot.planned;
  const plannedProviders = [...(planned?.selected_providers ?? [])];
  const plannedModel = (planned?.provider_models?.["openai"] ?? "").trim();
  if (
    plannedProviders.length !== 1 ||
    plannedProviders[0] !== "openai" ||
    planned.repetitions !== BASELINE_REPETITIONS ||
    planned.planned_jobs !== BASELINE_EXPECTED_QUESTION_COUNT * BASELINE_REPETITIONS ||
    planned.max_cost_usd !== BASELINE_MAX_COST_USD ||
    planned.store !== false ||
    !plannedModel
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }

  // B) condition_hash 자체 재검증 (snapshot 내용으로 재계산)
  const recomputedHash = await computeConditionHash({
    question_set_id: snapshot.question_set_id,
    questions: snapshot.questions,
    selected_providers: plannedProviders,
    provider_models: planned.provider_models,
    repetitions: planned.repetitions,
    search_context_size: planned.search_context_size,
    store: planned.store,
    parsing_context: snapshot.parsing_context,
  });
  if (recomputedHash !== snapshot.condition_hash) {
    return { ok: false, error: "BASELINE_CONDITION_DRIFT" };
  }

  const { data: run, error: runErr } = await supabaseAdmin
    .from("measurement_runs")
    .select(
      "id, org_id, business_id, run_type, phase, status, experiment_id, question_set_id, started_at, completed_at",
    )
    .eq("id", experiment.baseline_run_id)
    .maybeSingle();
  if (runErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!run) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  if (
    run.org_id !== experiment.org_id ||
    run.business_id !== experiment.business_id ||
    run.run_type !== "experiment" ||
    run.phase !== "baseline" ||
    run.experiment_id !== experiment.id ||
    run.question_set_id !== snapshot.question_set_id
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  if (run.status !== "completed") return { ok: false, error: "BASELINE_RUN_NOT_COMPLETED" };
  // E) 실제 측정 기간이 확정되어야 finalize 가능
  if (!run.started_at || !run.completed_at) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }

  const plannedJobs = planned.planned_jobs;
  const snapshotQuestionIds = [...snapshot.questions.map((q) => q.id)].sort();

  // C) measurement_jobs 검증
  const { data: jobs, error: jobErr } = await supabaseAdmin
    .from("measurement_jobs")
    .select("id, question_id, provider, provider_model, status, repetition_no")
    .eq("org_id", args.orgId)
    .eq("run_id", run.id);
  if (jobErr) return { ok: false, error: "INTERNAL_ERROR" };
  const jobRows = jobs ?? [];
  if (jobRows.length !== plannedJobs) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  if (
    jobRows.some(
      (j) =>
        j.provider !== "openai" ||
        (j.provider_model ?? "").trim() !== plannedModel ||
        j.status !== "completed",
    )
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const repsByQuestion = new Map<string, number[]>();
  for (const j of jobRows) {
    const list = repsByQuestion.get(j.question_id) ?? [];
    list.push(Number(j.repetition_no));
    repsByQuestion.set(j.question_id, list);
  }
  const jobQuestionIds = [...repsByQuestion.keys()].sort();
  if (
    jobQuestionIds.length !== snapshotQuestionIds.length ||
    jobQuestionIds.some((id, i) => id !== snapshotQuestionIds[i])
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const expectedReps = Array.from({ length: planned.repetitions }, (_, i) => i + 1);
  for (const reps of repsByQuestion.values()) {
    const sorted = [...reps].sort((a, b) => a - b);
    if (
      sorted.length !== expectedReps.length ||
      sorted.some((n, i) => n !== expectedReps[i])
    ) {
      return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
    }
  }
  const jobIdSet = new Set(jobRows.map((j) => j.id));

  // D) measurements 검증
  const { data: measurements, error: mErr } = await supabaseAdmin
    .from("measurements")
    .select("id, job_id, question_id, provider, provider_model, valid, parser_version")
    .eq("org_id", args.orgId)
    .eq("run_id", run.id);
  if (mErr) return { ok: false, error: "INTERNAL_ERROR" };
  const mRows = measurements ?? [];
  if (mRows.length !== plannedJobs) return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  if (
    mRows.some(
      (m) =>
        m.provider !== "openai" ||
        (m.provider_model ?? "").trim() !== plannedModel ||
        m.valid !== true,
    )
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const measurementJobIds = new Set(mRows.map((m) => m.job_id));
  if (
    measurementJobIds.size !== jobIdSet.size ||
    [...measurementJobIds].some((id) => !jobIdSet.has(id))
  ) {
    return { ok: false, error: "BASELINE_FINALIZE_MISMATCH" };
  }
  const perQuestionMeasurements = new Map<string, number>();
  for (const m of mRows) {
    perQuestionMeasurements.set(
      m.question_id,
      (perQuestionMeasurements.get(m.question_id) ?? 0) + 1,
    );
  }
  const measurementQuestionIds = [...perQuestionMeasurements.keys()].sort();
  if (
    measurementQuestionIds.length !== snapshotQuestionIds.length ||
    measurementQuestionIds.some((id, i) => id !== snapshotQuestionIds[i]) ||
    [...perQuestionMeasurements.values()].some((c) => c !== planned.repetitions)
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
