// 서버 전용 Follow-up 실행/확정 로직.
// 이 파일은 브라우저 번들로 나가지 않는다(*.server.ts import 차단).
// Baseline과 완전히 동일한 pinned 조건일 때만 Follow-up을 실행한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { invokeEnqueueRunWithUserJwt } from "./experiments.baseline.server";
import {
  ALLOWED_ROLES,
  ALLOWED_SEARCH_CONTEXT_SIZES,
  BASELINE_EXPECTED_QUESTION_COUNT,
  BASELINE_MAX_COST_USD,
  BASELINE_REPETITIONS,
  computeConditionHash,
  followupFail,
  type ExperimentConditionSnapshotV1,
  type FinalizeExperimentFollowupResult,
  type FollowupErrorCode,
  type FollowupPlanSummary,
  type PreviewExperimentFollowupResult,
  type SnapshotBusinessRef,
  type SnapshotQuestion,
  type StartExperimentFollowupResult,
} from "./experiments.helpers";

type UserClient = SupabaseClient<Database>;

const COST_TOLERANCE_USD = 0.005;

/**
 * Follow-up 실제 실행 게이트.
 * 현재 원격 Edge pipeline(enqueue-run / process-measurement-job) 소스를 이 저장소에서
 * READ 할 수 없고, measurement_jobs에는 question_id / provider_model만 pin되고
 * prompt_text·parser(업체/경쟁사 alias, 도메인)는 처리 시점에 live DB에서 다시 읽히므로
 * "시작 직전 precheck"만으로는 Baseline과의 exact reproducibility를 보장할 수 없다.
 * pipeline이 job/snapshot pin을 사용하도록 확인/보강되기 전까지 실제 시작을 차단한다.
 */
const FOLLOWUP_START_ENABLED = false;

const RUN_COLUMNS =
  "id, org_id, business_id, experiment_id, question_set_id, run_type, phase, status, selected_providers, repetitions, max_cost_usd, estimated_cost_usd, actual_cost_usd, total_jobs, completed_jobs, failed_jobs, started_at, completed_at";

const EXPERIMENT_COLUMNS =
  "id, org_id, business_id, name, status, baseline_run_id, baseline_condition_snapshot, baseline_start_at, baseline_end_at, intervention_at, intervention_confirmed_at, changed_by, action_application_snapshot, followup_run_id, followup_condition_snapshot, followup_start_at, followup_end_at, source_insight_action_id";

type ExperimentRow = {
  id: string;
  org_id: string;
  business_id: string;
  name: string;
  status: string;
  baseline_run_id: string | null;
  baseline_condition_snapshot: unknown;
  baseline_start_at: string | null;
  baseline_end_at: string | null;
  intervention_at: string | null;
  intervention_confirmed_at: string | null;
  changed_by: string | null;
  action_application_snapshot: unknown;
  followup_run_id: string | null;
  followup_condition_snapshot: unknown;
  followup_start_at: string | null;
  followup_end_at: string | null;
  source_insight_action_id: string | null;
};

type RunRow = {
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
  max_cost_usd: number | string;
  estimated_cost_usd: number | string;
  actual_cost_usd: number | string | null;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  started_at: string | null;
  completed_at: string | null;
};

async function hasStaffRole(
  supabase: UserClient,
  orgId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: FollowupErrorCode }> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: "INTERNAL_ERROR" };
  if (!data) return { ok: false, error: "FORBIDDEN" };
  if (!ALLOWED_ROLES.includes(data.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: "FORBIDDEN" };
  }
  return { ok: true };
}

async function loadExperiment(
  orgId: string,
  experimentId: string,
): Promise<{ ok: true; experiment: ExperimentRow } | { ok: false; error: FollowupErrorCode }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("experiments")
    .select(EXPERIMENT_COLUMNS)
    .eq("id", experimentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return { ok: false, error: "INTERNAL_ERROR" };
  if (!data) return { ok: false, error: "EXPERIMENT_NOT_FOUND" };
  return { ok: true, experiment: data as unknown as ExperimentRow };
}

/** snapshot에서 client-safe summary만 추출 + planned 무결성 확인. */
function summaryFromSnapshot(
  snapshot: ExperimentConditionSnapshotV1 | null,
): { ok: true; summary: FollowupPlanSummary } | { ok: false; error: FollowupErrorCode } {
  if (!snapshot || snapshot.snapshot_version !== "1") {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
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
    planned.planned_jobs !== BASELINE_EXPECTED_QUESTION_COUNT * BASELINE_REPETITIONS ||
    !Number.isFinite(Number(planned.estimated_cost_usd)) ||
    (snapshot.questions?.length ?? 0) !== BASELINE_EXPECTED_QUESTION_COUNT
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  return {
    ok: true,
    summary: {
      questionCount: snapshot.questions.length,
      provider: "openai",
      model,
      repetitions: planned.repetitions,
      plannedJobs: planned.planned_jobs,
      estimatedCostUsd: Number(planned.estimated_cost_usd),
      maxCostUsd: planned.max_cost_usd,
    },
  };
}

/** ISO timestamp 두 개가 같은 instant인지. parse 실패는 false. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta === tb;
}

/** Action Applied 기록이 완전한지 검증 (자동 보정/덮어쓰기 금지). */
function requireCompleteActionApplied(
  experiment: ExperimentRow,
  baseline: ExperimentConditionSnapshotV1,
): { ok: true } | { ok: false; error: FollowupErrorCode } {
  if (!experiment.intervention_at || !experiment.intervention_confirmed_at || !experiment.changed_by) {
    return { ok: false, error: "ACTION_NOT_APPLIED" };
  }
  const snap = experiment.action_application_snapshot;
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
    return { ok: false, error: "ACTION_NOT_APPLIED" };
  }
  const s = snap as Record<string, unknown>;
  if (s["snapshot_version"] !== "1") return { ok: false, error: "ACTION_NOT_APPLIED" };
  if (
    s["experiment_id"] !== experiment.id ||
    s["org_id"] !== experiment.org_id ||
    s["business_id"] !== experiment.business_id ||
    s["baseline_run_id"] !== experiment.baseline_run_id
  ) {
    return { ok: false, error: "ACTION_NOT_APPLIED" };
  }
  if (s["baseline_condition_hash"] !== baseline.condition_hash) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }
  if (
    !sameInstant(typeof s["applied_at"] === "string" ? s["applied_at"] : null, experiment.intervention_at) ||
    !sameInstant(
      typeof s["recorded_at"] === "string" ? s["recorded_at"] : null,
      experiment.intervention_confirmed_at,
    )
  ) {
    return { ok: false, error: "ACTION_NOT_APPLIED" };
  }
  return { ok: true };
}

/** Baseline snapshot이 확정(finalize)됐고 scope가 맞는지 검증. canonical run도 실제로 READ 한다. */
async function requireFinalizedBaseline(
  experiment: ExperimentRow,
): Promise<
  { ok: true; snapshot: ExperimentConditionSnapshotV1 } | { ok: false; error: FollowupErrorCode }
> {
  const snap = experiment.baseline_condition_snapshot as ExperimentConditionSnapshotV1 | null;
  if (!snap || snap.snapshot_version !== "1") return { ok: false, error: "BASELINE_NOT_FINALIZED" };
  if (
    snap.experiment_id !== experiment.id ||
    snap.org_id !== experiment.org_id ||
    snap.business_id !== experiment.business_id
  ) {
    return { ok: false, error: "BASELINE_NOT_FINALIZED" };
  }
  if (!experiment.baseline_run_id || !experiment.baseline_start_at || !experiment.baseline_end_at) {
    return { ok: false, error: "BASELINE_NOT_FINALIZED" };
  }
  if (!snap.observed?.finalized_at || !snap.condition_hash) {
    return { ok: false, error: "BASELINE_NOT_FINALIZED" };
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
  if (recomputed !== snap.condition_hash) return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };

  // canonical Baseline Run 실제 재검증 (snapshot만 믿지 않는다)
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: baseRun, error: runErr } = await supabaseAdmin
    .from("measurement_runs")
    .select(RUN_COLUMNS)
    .eq("id", experiment.baseline_run_id)
    .eq("org_id", experiment.org_id)
    .maybeSingle();
  if (runErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!baseRun) return { ok: false, error: "BASELINE_NOT_FINALIZED" };
  const br = baseRun as unknown as RunRow;
  if (
    br.org_id !== experiment.org_id ||
    br.business_id !== experiment.business_id ||
    br.experiment_id !== experiment.id ||
    br.question_set_id !== snap.question_set_id ||
    br.run_type !== "experiment" ||
    br.phase !== "baseline" ||
    br.status !== "completed" ||
    !br.started_at ||
    !br.completed_at
  ) {
    return { ok: false, error: "BASELINE_NOT_FINALIZED" };
  }
  if (
    !sameInstant(br.started_at, experiment.baseline_start_at) ||
    !sameInstant(br.completed_at, experiment.baseline_end_at) ||
    !sameInstant(br.started_at, snap.observed.run_started_at) ||
    !sameInstant(br.completed_at, snap.observed.run_completed_at)
  ) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }
  return { ok: true, snapshot: snap };
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

/**
 * 현재 live 조건이 Baseline pinned 조건과 완전히 동일한지 검증한다.
 * 다르면 절대 실행하지 않는다 (조건 변경 시 비교 불가).
 */
async function assertLiveMatchesBaseline(
  orgId: string,
  baseline: ExperimentConditionSnapshotV1,
): Promise<{ ok: true } | { ok: false; error: FollowupErrorCode }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: questionSet, error: qsErr } = await supabaseAdmin
    .from("question_sets")
    .select("id, business_id, active")
    .eq("id", baseline.question_set_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (qsErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!questionSet || !questionSet.active || questionSet.business_id !== baseline.business_id) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }

  const { data: questionRows, error: qErr } = await supabaseAdmin
    .from("questions")
    .select(
      "id, prompt_text, prompt_hash, intent_type, language, country_code, region, city, weight, data_class, active",
    )
    .eq("org_id", orgId)
    .eq("question_set_id", baseline.question_set_id)
    .eq("active", true);
  if (qErr) return { ok: false, error: "INTERNAL_ERROR" };
  const questions: SnapshotQuestion[] = (questionRows ?? []).map((q) => ({
    id: q.id,
    prompt_text: q.prompt_text,
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

  const { data: ps, error: psErr } = await supabaseAdmin
    .from("provider_settings")
    .select(
      "enabled, model_name, search_context_size, paid_account_confirmed, terms_reviewed, automated_benchmark_approved, estimated_cost_per_request_usd",
    )
    .eq("org_id", orgId)
    .eq("provider", "openai")
    .maybeSingle();
  if (psErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (
    !ps ||
    !ps.enabled ||
    !ps.paid_account_confirmed ||
    !ps.terms_reviewed ||
    !ps.automated_benchmark_approved ||
    !ps.model_name ||
    !ALLOWED_SEARCH_CONTEXT_SIZES.includes(
      String(ps.search_context_size).trim() as (typeof ALLOWED_SEARCH_CONTEXT_SIZES)[number],
    )
  ) {
    return { ok: false, error: "PROVIDER_NOT_READY" };
  }

  // 현재 live 단가 기준 예상 비용이 실험 비용 한도 이내인지 확인한다.
  const unitCost = Number(ps.estimated_cost_per_request_usd);
  const plannedJobs = Number(baseline.planned.planned_jobs);
  if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(plannedJobs) || plannedJobs <= 0) {
    return { ok: false, error: "PROVIDER_NOT_READY" };
  }
  const liveEstimate = unitCost * plannedJobs;
  if (
    !Number.isFinite(liveEstimate) ||
    liveEstimate < 0 ||
    liveEstimate > Number(baseline.planned.max_cost_usd) + COST_TOLERANCE_USD
  ) {
    return { ok: false, error: "FOLLOWUP_COST_LIMIT_EXCEEDED" };
  }


  const { data: targetBiz, error: bizErr } = await supabaseAdmin
    .from("businesses")
    .select("id, name, aliases, official_domains, website_url, active")
    .eq("id", baseline.business_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (bizErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!targetBiz || !targetBiz.active) return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };

  const { data: links, error: linkErr } = await supabaseAdmin
    .from("business_competitors")
    .select("competitor_business_id")
    .eq("org_id", orgId)
    .eq("target_business_id", baseline.business_id)
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

  const liveHash = await computeConditionHash({
    question_set_id: baseline.question_set_id,
    questions,
    selected_providers: [...baseline.planned.selected_providers],
    provider_models: { openai: String(ps.model_name).trim() },
    repetitions: baseline.planned.repetitions,
    search_context_size: String(ps.search_context_size).trim(),
    store: baseline.planned.store,
    parsing_context: { target: toBusinessRef(targetBiz), competitors },
  });

  if (liveHash !== baseline.condition_hash) return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  return { ok: true };
}

/** Follow-up 실행 전제 상태 검증 (공통). */
async function loadFollowupContext(
  orgId: string,
  experimentId: string,
): Promise<
  | { ok: true; experiment: ExperimentRow; baseline: ExperimentConditionSnapshotV1 }
  | { ok: false; error: FollowupErrorCode }
> {
  const loaded = await loadExperiment(orgId, experimentId);
  if (!loaded.ok) return loaded;
  const experiment = loaded.experiment;

  if (experiment.status !== "action_applied" && experiment.status !== "followup") {
    return { ok: false, error: experiment.status === "baseline" ? "ACTION_NOT_APPLIED" : "INVALID_EXPERIMENT_STATE" };
  }
  if (!experiment.intervention_at) return { ok: false, error: "ACTION_NOT_APPLIED" };

  const baseline = await requireFinalizedBaseline(experiment);
  if (!baseline.ok) return baseline;

  const applied = requireCompleteActionApplied(experiment, baseline.snapshot);
  if (!applied.ok) return applied;

  return { ok: true, experiment, baseline: baseline.snapshot };
}

/** canonical Follow-up run 로더 (experiments.followup_run_id만 신뢰). */
async function loadCanonicalFollowupRun(
  experiment: ExperimentRow,
): Promise<{ ok: true; run: RunRow } | { ok: false; error: FollowupErrorCode }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("measurement_runs")
    .select(RUN_COLUMNS)
    .eq("id", experiment.followup_run_id as string)
    .eq("org_id", experiment.org_id)
    .maybeSingle();
  if (error) return { ok: false, error: "INTERNAL_ERROR" };
  if (!data) return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  const run = data as unknown as RunRow;
  if (
    run.org_id !== experiment.org_id ||
    run.business_id !== experiment.business_id ||
    run.experiment_id !== experiment.id ||
    run.run_type !== "experiment" ||
    run.phase !== "followup"
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  return { ok: true, run };
}

/* ============================ Preview (READ ONLY) ============================ */

export async function previewExperimentFollowupImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<PreviewExperimentFollowupResult> {
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return { ok: false, error: role.error };

  const ctx = await loadFollowupContext(args.orgId, args.experimentId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  // 기존 Follow-up이 있으면 저장된 snapshot summary만 반환 (덮어쓰기 금지)
  if (ctx.experiment.followup_run_id) {
    const stored = ctx.experiment.followup_condition_snapshot as ExperimentConditionSnapshotV1 | null;
    if (!stored || stored.condition_hash !== ctx.baseline.condition_hash) {
      return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
    }
    const summary = summaryFromSnapshot(stored);
    if (!summary.ok) return { ok: false, error: summary.error };
    const live = await assertLiveMatchesBaseline(args.orgId, ctx.baseline);
    if (!live.ok) return { ok: false, error: live.error };
    return { ok: true, summary: summary.summary };
  }

  const live = await assertLiveMatchesBaseline(args.orgId, ctx.baseline);
  if (!live.ok) return { ok: false, error: live.error };

  const summary = summaryFromSnapshot(ctx.baseline);
  if (!summary.ok) return { ok: false, error: summary.error };
  return { ok: true, summary: summary.summary };
}

/* ============================ Start (측정 비용 발생) ============================ */

async function enqueueIfNeeded(args: {
  orgId: string;
  baseline: ExperimentConditionSnapshotV1;
  experiment: ExperimentRow;
  run: RunRow;
  summary: FollowupPlanSummary;
}): Promise<StartExperimentFollowupResult> {
  const { experiment, run, summary } = args;
  const base = {
    experimentId: experiment.id,
    followupRunId: run.id,
    experimentStatus: experiment.status,
    runStatus: run.status,
    summary,
  };

  if (run.status === "queued" || run.status === "running" || run.status === "completed") {
    return { ok: true, followup: base };
  }
  if (run.status !== "draft") {
    return followupFail("FOLLOWUP_RUN_REQUIRES_REVIEW", base) as StartExperimentFollowupResult;
  }

  // draft 재시도 경로에서도 실제 enqueue 직전에 live 조건을 반드시 다시 검증한다.
  const live = await assertLiveMatchesBaseline(args.orgId, args.baseline);
  if (!live.ok) return followupFail(live.error, base) as StartExperimentFollowupResult;

  const enqueued = await invokeEnqueueRunWithUserJwt(run.id);
  if (!enqueued.ok) {
    return followupFail("FOLLOWUP_ENQUEUE_FAILED", base) as StartExperimentFollowupResult;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: refreshed } = await supabaseAdmin
    .from("measurement_runs")
    .select("status")
    .eq("id", run.id)
    .eq("org_id", experiment.org_id)
    .maybeSingle();

  return { ok: true, followup: { ...base, runStatus: refreshed?.status ?? run.status } };
}

export async function startExperimentFollowupImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<StartExperimentFollowupResult> {
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return followupFail(role.error) as StartExperimentFollowupResult;

  const ctx = await loadFollowupContext(args.orgId, args.experimentId);
  if (!ctx.ok) return followupFail(ctx.error) as StartExperimentFollowupResult;
  const experiment = ctx.experiment;

  // 파이프라인 재현성 보장 전까지 실제 시작(Run 생성/enqueue) 차단
  if (!FOLLOWUP_START_ENABLED) {
    return followupFail("FOLLOWUP_START_DISABLED") as StartExperimentFollowupResult;
  }

  // 기존 canonical Follow-up 재사용 (새 Run 생성 금지)
  if (experiment.followup_run_id) {
    const stored = experiment.followup_condition_snapshot as ExperimentConditionSnapshotV1 | null;
    if (!stored || stored.condition_hash !== ctx.baseline.condition_hash) {
      return followupFail("FOLLOWUP_CONDITION_DRIFT") as StartExperimentFollowupResult;
    }
    const summary = summaryFromSnapshot(stored);
    if (!summary.ok) return followupFail(summary.error) as StartExperimentFollowupResult;
    const run = await loadCanonicalFollowupRun(experiment);
    if (!run.ok) return followupFail(run.error) as StartExperimentFollowupResult;
    return enqueueIfNeeded({
      orgId: args.orgId,
      baseline: ctx.baseline,
      experiment,
      run: run.run,
      summary: summary.summary,
    });
  }

  if (experiment.status !== "action_applied") {
    return followupFail("INVALID_EXPERIMENT_STATE") as StartExperimentFollowupResult;
  }

  // 현재 조건이 Baseline과 동일할 때만 실행
  const live = await assertLiveMatchesBaseline(args.orgId, ctx.baseline);
  if (!live.ok) return followupFail(live.error) as StartExperimentFollowupResult;


  const summaryRes = summaryFromSnapshot(ctx.baseline);
  if (!summaryRes.ok) return followupFail(summaryRes.error) as StartExperimentFollowupResult;
  const summary = summaryRes.summary;

  // Follow-up snapshot = Baseline pinned 조건 그대로 (observed만 초기화)
  const followupSnapshot: ExperimentConditionSnapshotV1 = {
    ...ctx.baseline,
    captured_at: new Date().toISOString(),
    observed: {
      provider_models: null,
      parser_versions: null,
      measurement_count: null,
      valid_measurement_count: null,
      run_started_at: null,
      run_completed_at: null,
      finalized_at: null,
    },
  };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: createdRun, error: runInsErr } = await supabaseAdmin
    .from("measurement_runs")
    .insert({
      org_id: experiment.org_id,
      business_id: experiment.business_id,
      question_set_id: ctx.baseline.question_set_id,
      experiment_id: experiment.id,
      name: `${experiment.name} · Follow-up`,
      run_type: "experiment",
      phase: "followup",
      status: "draft",
      selected_providers: ["openai"],
      repetitions: ctx.baseline.planned.repetitions,
      max_cost_usd: ctx.baseline.planned.max_cost_usd,
      estimated_cost_usd: summary.estimatedCostUsd,
      total_jobs: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      created_by: args.userId,
      scheduled_at: new Date().toISOString(),
    })
    .select(RUN_COLUMNS)
    .maybeSingle();
  if (runInsErr || !createdRun) {
    console.error("[followup] run insert failed", { experimentId: experiment.id });
    return followupFail("FOLLOWUP_RUN_CREATE_FAILED") as StartExperimentFollowupResult;
  }
  const newRun = createdRun as unknown as RunRow;

  // canonical pointer CAS
  const { data: linked, error: linkErr } = await supabaseAdmin
    .from("experiments")
    .update({
      status: "followup",
      followup_run_id: newRun.id,
      followup_condition_snapshot: followupSnapshot as unknown as never,
      followup_start_at: null,
      followup_end_at: null,
    })
    .eq("id", experiment.id)
    .eq("org_id", args.orgId)
    .eq("status", "action_applied")
    .is("followup_run_id", null)
    .select("id");

  const linkedRow = !linkErr && linked && linked.length === 1 ? linked[0] : null;

  if (!linkedRow) {
    const { error: cancelErr } = await supabaseAdmin
      .from("measurement_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", newRun.id)
      .eq("org_id", args.orgId)
      .eq("status", "draft");
    if (cancelErr) console.error("[followup] orphan run candidate", { runId: newRun.id });

    // 경쟁에서 졌다면 기존 canonical 상태로 idempotent 처리
    const reloaded = await loadExperiment(args.orgId, args.experimentId);
    if (reloaded.ok && reloaded.experiment.followup_run_id) {
      const run = await loadCanonicalFollowupRun(reloaded.experiment);
      if (run.ok) {
        return enqueueIfNeeded({
          orgId: args.orgId,
          baseline: ctx.baseline,
          experiment: reloaded.experiment,
          run: run.run,
          summary,
        });
      }
    }
    console.error("[followup] pointer link failed", { experimentId: experiment.id });
    return followupFail("FOLLOWUP_LINK_FAILED") as StartExperimentFollowupResult;
  }

  return enqueueIfNeeded({
    orgId: args.orgId,
    baseline: ctx.baseline,
    experiment: { ...experiment, status: "followup", followup_run_id: newRun.id },
    run: newRun,
    summary,
  });
}

/* ============================ Finalize (측정/비용 없음) ============================ */

function strictCost(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sumStrictCost(rows: { actual_cost_usd: number | string | null }[]): number | null {
  let total = 0;
  for (const r of rows) {
    const n = strictCost(r.actual_cost_usd);
    if (n === null) return null;
    total += n;
  }
  return total;
}

export async function finalizeExperimentFollowupImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<FinalizeExperimentFollowupResult> {
  const role = await hasStaffRole(args.supabase, args.orgId, args.userId);
  if (!role.ok) return { ok: false, error: role.error };

  const ctx = await loadFollowupContext(args.orgId, args.experimentId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const experiment = ctx.experiment;
  if (experiment.status !== "followup" || !experiment.followup_run_id) {
    return { ok: false, error: "INVALID_EXPERIMENT_STATE" };
  }

  const snapshot = experiment.followup_condition_snapshot as ExperimentConditionSnapshotV1 | null;
  if (!snapshot || snapshot.condition_hash !== ctx.baseline.condition_hash) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }
  // Follow-up snapshot 자체 무결성 (hash 필드만 유지되고 내용이 바뀐 경우 차단)
  if (
    snapshot.snapshot_version !== "1" ||
    snapshot.experiment_id !== experiment.id ||
    snapshot.org_id !== experiment.org_id ||
    snapshot.business_id !== experiment.business_id ||
    snapshot.question_set_id !== ctx.baseline.question_set_id
  ) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }
  const recomputedFollowupHash = await computeConditionHash({
    question_set_id: snapshot.question_set_id,
    questions: snapshot.questions,
    selected_providers: [...snapshot.planned.selected_providers],
    provider_models: snapshot.planned.provider_models,
    repetitions: snapshot.planned.repetitions,
    search_context_size: snapshot.planned.search_context_size,
    store: snapshot.planned.store,
    parsing_context: snapshot.parsing_context,
  });
  if (
    recomputedFollowupHash !== snapshot.condition_hash ||
    recomputedFollowupHash !== ctx.baseline.condition_hash
  ) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }

  const summaryRes = summaryFromSnapshot(snapshot);
  if (!summaryRes.ok) return { ok: false, error: summaryRes.error };
  const plannedModel = summaryRes.summary.model;
  const plannedJobs = summaryRes.summary.plannedJobs;

  const runRes = await loadCanonicalFollowupRun(experiment);
  if (!runRes.ok) return { ok: false, error: runRes.error };
  const run = runRes.run;

  if (run.question_set_id !== snapshot.question_set_id) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  if (run.status !== "completed" || !run.started_at || !run.completed_at) {
    return { ok: false, error: "FOLLOWUP_RUN_NOT_COMPLETED" };
  }
  // 인과성: Follow-up 측정은 변경 적용 시점 이후에 시작돼야 한다.
  const runStartedMs = Date.parse(run.started_at);
  const interventionMs = Date.parse(experiment.intervention_at ?? "");
  if (!Number.isFinite(runStartedMs) || !Number.isFinite(interventionMs)) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  if (runStartedMs < interventionMs) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  const runMaxCost = strictCost(run.max_cost_usd);
  const runEstimated = strictCost(run.estimated_cost_usd);
  if (runMaxCost === null || runEstimated === null) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  const runProviders = [...(run.selected_providers ?? [])].sort();
  if (
    runProviders.length !== 1 ||
    runProviders[0] !== "openai" ||
    Number(run.repetitions) !== snapshot.planned.repetitions ||
    Math.abs(runMaxCost - snapshot.planned.max_cost_usd) > COST_TOLERANCE_USD ||
    Math.abs(runEstimated - Number(snapshot.planned.estimated_cost_usd)) > COST_TOLERANCE_USD ||
    Number(run.total_jobs) !== plannedJobs ||
    Number(run.completed_jobs) !== plannedJobs ||
    Number(run.failed_jobs) !== 0
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const snapshotQuestionIds = [...snapshot.questions.map((q) => q.id)].sort();

  const { data: jobs, error: jobErr } = await supabaseAdmin
    .from("measurement_jobs")
    .select("id, question_id, provider, provider_model, status, repetition_no, actual_cost_usd")
    .eq("org_id", args.orgId)
    .eq("run_id", run.id);
  if (jobErr) return { ok: false, error: "INTERNAL_ERROR" };
  const jobRows = jobs ?? [];
  if (jobRows.length !== plannedJobs) return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  if (
    jobRows.some(
      (j) =>
        j.provider !== "openai" ||
        (j.provider_model ?? "").trim() !== plannedModel ||
        j.status !== "completed",
    )
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
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
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  const expectedReps = Array.from({ length: snapshot.planned.repetitions }, (_, i) => i + 1);
  for (const reps of repsByQuestion.values()) {
    const sorted = [...reps].sort((a, b) => a - b);
    if (sorted.length !== expectedReps.length || sorted.some((n, i) => n !== expectedReps[i])) {
      return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
    }
  }
  const jobById = new Map(jobRows.map((j) => [j.id, j]));

  const { data: measurements, error: mErr } = await supabaseAdmin
    .from("measurements")
    .select(
      "id, job_id, question_id, provider, provider_model, valid, parser_version, actual_cost_usd",
    )
    .eq("org_id", args.orgId)
    .eq("run_id", run.id);
  if (mErr) return { ok: false, error: "INTERNAL_ERROR" };
  const mRows = measurements ?? [];
  if (mRows.length !== plannedJobs) return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  if (
    mRows.some(
      (m) =>
        m.provider !== "openai" ||
        (m.provider_model ?? "").trim() !== plannedModel ||
        m.valid !== true ||
        !(m.parser_version ?? "").trim(),
    )
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  for (const m of mRows) {
    const job = jobById.get(m.job_id);
    if (
      !job ||
      m.question_id !== job.question_id ||
      m.provider !== job.provider ||
      (m.provider_model ?? "").trim() !== (job.provider_model ?? "").trim()
    ) {
      return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
    }
  }
  const perQuestion = new Map<string, number>();
  for (const m of mRows) perQuestion.set(m.question_id, (perQuestion.get(m.question_id) ?? 0) + 1);
  if ([...perQuestion.values()].some((c) => c !== snapshot.planned.repetitions)) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  const parserVersions = [...new Set(mRows.map((m) => (m.parser_version ?? "").trim()))].sort();
  const providerModels = [...new Set(mRows.map((m) => (m.provider_model ?? "").trim()))].sort();
  if (parserVersions.length !== 1 || !parserVersions[0]) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  if (providerModels.length !== 1 || providerModels[0] !== plannedModel) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  const jobCost = sumStrictCost(jobRows);
  const measurementCost = sumStrictCost(mRows);
  const runCost = strictCost(run.actual_cost_usd);
  if (jobCost === null || measurementCost === null || runCost === null) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  if (
    Math.abs(jobCost - measurementCost) > COST_TOLERANCE_USD ||
    Math.abs(runCost - jobCost) > COST_TOLERANCE_USD ||
    runCost > snapshot.planned.max_cost_usd + COST_TOLERANCE_USD
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  const expectedObserved = {
    provider_models: providerModels,
    parser_versions: parserVersions,
    measurement_count: mRows.length,
    valid_measurement_count: mRows.filter((m) => m.valid).length,
    run_started_at: run.started_at,
    run_completed_at: run.completed_at,
  };

  const success: FinalizeExperimentFollowupResult = {
    ok: true,
    observed: {
      measurementCount: expectedObserved.measurement_count,
      validMeasurementCount: expectedObserved.valid_measurement_count,
      parserVersions,
      providerModels,
    },
  };

  const observedMatches = (candidate: ExperimentConditionSnapshotV1 | null): boolean => {
    const o = candidate?.observed;
    if (!o?.finalized_at) return false;
    const models = [...(o.provider_models ?? [])].sort();
    const parsers = [...(o.parser_versions ?? [])].sort();
    return (
      models.length === expectedObserved.provider_models.length &&
      models.every((v, i) => v === expectedObserved.provider_models[i]) &&
      parsers.length === expectedObserved.parser_versions.length &&
      parsers.every((v, i) => v === expectedObserved.parser_versions[i]) &&
      o.measurement_count === expectedObserved.measurement_count &&
      o.valid_measurement_count === expectedObserved.valid_measurement_count &&
      o.run_started_at === expectedObserved.run_started_at &&
      o.run_completed_at === expectedObserved.run_completed_at
    );
  };
  const timesMatch = (row: { followup_start_at: string | null; followup_end_at: string | null }) =>
    row.followup_start_at === run.started_at && row.followup_end_at === run.completed_at;

  // 이미 finalize된 경우 — 덮어쓰지 않고 idempotent 반환
  if (snapshot.observed?.finalized_at) {
    if (observedMatches(snapshot) && timesMatch(experiment)) return success;
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }
  if (experiment.followup_start_at || experiment.followup_end_at) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  const finalizedSnapshot: ExperimentConditionSnapshotV1 = {
    ...snapshot,
    observed: { ...expectedObserved, finalized_at: new Date().toISOString() },
  };

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("experiments")
    .update({
      followup_condition_snapshot: finalizedSnapshot as unknown as never,
      followup_start_at: run.started_at,
      followup_end_at: run.completed_at,
    })
    .eq("id", experiment.id)
    .eq("org_id", args.orgId)
    .eq("status", "followup")
    .eq("followup_run_id", run.id)
    .is("followup_start_at", null)
    .is("followup_end_at", null)
    .select("id");
  if (updErr) return { ok: false, error: "INTERNAL_ERROR" };

  if (!updated || updated.length !== 1) {
    const reloaded = await loadExperiment(args.orgId, args.experimentId);
    if (!reloaded.ok) return { ok: false, error: reloaded.error };
    const reSnap = reloaded.experiment.followup_condition_snapshot as ExperimentConditionSnapshotV1 | null;
    if (
      reloaded.experiment.followup_run_id === run.id &&
      observedMatches(reSnap) &&
      timesMatch(reloaded.experiment)
    ) {
      return success;
    }
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  const after = await loadExperiment(args.orgId, args.experimentId);
  if (!after.ok) return { ok: false, error: after.error };
  const afterSnap = after.experiment.followup_condition_snapshot as ExperimentConditionSnapshotV1 | null;
  if (
    after.experiment.status !== "followup" ||
    after.experiment.followup_run_id !== run.id ||
    !timesMatch(after.experiment) ||
    !observedMatches(afterSnap) ||
    afterSnap?.condition_hash !== snapshot.condition_hash
  ) {
    return { ok: false, error: "FOLLOWUP_FINALIZE_MISMATCH" };
  }

  return success;
}
