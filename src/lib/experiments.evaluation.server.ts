// 서버 전용 Experiment 비교 엔진 v0.1 (Baseline vs Follow-up).
// READ ONLY 계산 + service_role CAS 저장만 수행한다. Provider/Edge 호출 없음.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  ALLOWED_ROLES,
  BASELINE_EXPECTED_QUESTION_COUNT,
  BASELINE_REPETITIONS,
  buildConditionCanonical,
  computeConditionHash,
  stableStringify,
  type ExperimentConditionSnapshotV1,
} from "./experiments.helpers";
import {
  EVALUATION_CAUTION,
  EVALUATION_CLASSIFICATION_RULE,
  EVALUATION_EVIDENCE_GRADE,
  EVALUATION_PRIMARY_METRIC,
  EVALUATION_VERSION,
  buildQuestionResults,
  classifyOutcome,
  computePhaseMetrics,
  deltaPp,
  outcomeToResultClassification,
  promptSnippet,
  type EvaluationErrorCode,
  type EvaluationOutcome,
  type ExperimentEvaluationDTO,
  type FinalizeExperimentEvaluationResult,
  type MeasurementFact,
  type PhaseMetrics,
  type PreviewExperimentEvaluationResult,
  type QuestionResult,
} from "./experiments.evaluation.helpers";

type UserClient = SupabaseClient<Database>;

const EXECUTION_MODE_PINNED = "experiment_snapshot_v1";
const EXPECTED_JOBS = BASELINE_EXPECTED_QUESTION_COUNT * BASELINE_REPETITIONS;

type ExperimentRow = {
  id: string;
  org_id: string;
  business_id: string;
  status: string;
  baseline_run_id: string | null;
  followup_run_id: string | null;
  baseline_condition_snapshot: unknown;
  followup_condition_snapshot: unknown;
  baseline_start_at: string | null;
  baseline_end_at: string | null;
  followup_start_at: string | null;
  followup_end_at: string | null;
  intervention_at: string | null;
  intervention_confirmed_at: string | null;
  changed_by: string | null;
  action_application_snapshot: unknown;
  source_insight_action_id: string | null;
  source_type: string | null;
  source_profile_coverage_item_id: string | null;

  evaluation_snapshot: unknown;
  evaluated_at: string | null;
  evaluated_by: string | null;
  evaluation_version: string | null;
  evidence_grade: string | null;
  primary_metric: string | null;
  baseline_value: number | null;
  followup_value: number | null;
  delta_value: number | null;
  result_classification: string | null;
};

const EXPERIMENT_COLUMNS =
  "id, org_id, business_id, status, baseline_run_id, followup_run_id, baseline_condition_snapshot, followup_condition_snapshot, baseline_start_at, baseline_end_at, followup_start_at, followup_end_at, intervention_at, intervention_confirmed_at, changed_by, action_application_snapshot, source_insight_action_id, source_type, source_profile_coverage_item_id, evaluation_snapshot, evaluated_at, evaluated_by, evaluation_version, evidence_grade, primary_metric, baseline_value, followup_value, delta_value, result_classification";


/** 두 ISO 문자열이 같은 instant인지(문자열 포맷 차이 허용, parse 실패는 불일치). */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ma = Date.parse(a);
  const mb = Date.parse(b);
  return Number.isFinite(ma) && Number.isFinite(mb) && ma === mb;
}

type RunRow = {
  id: string;
  org_id: string;
  business_id: string;
  experiment_id: string | null;
  question_set_id: string;
  run_type: string;
  phase: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
};

async function hasStaffRole(
  supabase: UserClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return ALLOWED_ROLES.includes(data.role as (typeof ALLOWED_ROLES)[number]);
}

function asSnapshot(value: unknown): ExperimentConditionSnapshotV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as ExperimentConditionSnapshotV1;
  return s.snapshot_version === "1" ? s : null;
}

async function recomputeHash(snap: ExperimentConditionSnapshotV1): Promise<string> {
  return computeConditionHash({
    question_set_id: snap.question_set_id,
    questions: snap.questions,
    selected_providers: [...snap.planned.selected_providers],
    provider_models: snap.planned.provider_models,
    repetitions: snap.planned.repetitions,
    search_context_size: snap.planned.search_context_size,
    store: snap.planned.store,
    parsing_context: snap.parsing_context,
  });
}

/**
 * 두 snapshot의 실행 조건이 완전히 동일한지 확인.
 * condition_hash canonicalization(buildConditionCanonical + stableStringify)을 재사용하므로
 * object key 순서/배열 순서 차이로 false mismatch가 발생하지 않는다.
 */
function conditionCanonicalString(snap: ExperimentConditionSnapshotV1): string {
  return stableStringify(
    buildConditionCanonical({
      question_set_id: snap.question_set_id,
      questions: snap.questions,
      selected_providers: [...snap.planned.selected_providers],
      provider_models: snap.planned.provider_models,
      repetitions: snap.planned.repetitions,
      search_context_size: snap.planned.search_context_size,
      store: snap.planned.store,
      parsing_context: snap.parsing_context,
    }),
  );
}

function snapshotsIdentical(
  a: ExperimentConditionSnapshotV1,
  b: ExperimentConditionSnapshotV1,
): boolean {
  return conditionCanonicalString(a) === conditionCanonicalString(b);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function loadRun(
  orgId: string,
  runId: string,
): Promise<RunRow | null> {
  const db = await admin();
  const { data, error } = await db
    .from("measurement_runs")
    .select(
      "id, org_id, business_id, experiment_id, question_set_id, run_type, phase, status, started_at, completed_at, total_jobs, completed_jobs, failed_jobs",
    )
    .eq("id", runId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as RunRow;
}

/** enqueue-run이 pinned snapshot mode로 작업을 생성했다는 DB evidence 확인. */
async function verifyRunProvenance(args: {
  orgId: string;
  runId: string;
  experimentId: string;
  phase: "baseline" | "followup";
  conditionHash: string;
}): Promise<boolean> {
  const db = await admin();
  const { data, error } = await db
    .from("system_events")
    .select("metadata, created_at")
    .eq("org_id", args.orgId)
    .eq("run_id", args.runId)
    .eq("event_type", "run_enqueued")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return false;
  const meta = (data?.[0]?.metadata ?? null) as Record<string, unknown> | null;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return (
    meta["execution_mode"] === EXECUTION_MODE_PINNED &&
    meta["condition_hash"] === args.conditionHash &&
    meta["experiment_id"] === args.experimentId &&
    meta["experiment_phase"] === args.phase
  );
}

/** 한 phase의 measurement fact 수집 (raw response_text 미조회). */
async function collectPhaseFacts(args: {
  orgId: string;
  run: RunRow;
  snapshot: ExperimentConditionSnapshotV1;
}): Promise<{ ok: true; facts: MeasurementFact[] } | { ok: false; error: EvaluationErrorCode }> {
  const db = await admin();
  const snapshotQuestionIds = [...args.snapshot.questions.map((q) => q.id)].sort();
  const plannedModel = (args.snapshot.planned.provider_models["openai"] ?? "").trim();

  const { data: jobs, error: jobErr } = await db
    .from("measurement_jobs")
    .select("id, question_id, provider, provider_model, status")
    .eq("org_id", args.orgId)
    .eq("run_id", args.run.id);
  if (jobErr) return { ok: false, error: "INTERNAL_ERROR" };
  const jobRows = jobs ?? [];
  if (jobRows.length !== EXPECTED_JOBS) return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  if (
    jobRows.some(
      (j) =>
        j.status !== "completed" ||
        j.provider !== "openai" ||
        (j.provider_model ?? "").trim() !== plannedModel,
    )
  ) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }
  const jobQuestionIds = [...jobRows.map((j) => j.question_id)].sort();
  if (
    [...new Set(jobQuestionIds)].sort().join("|") !== snapshotQuestionIds.join("|") ||
    jobQuestionIds.length !== EXPECTED_JOBS
  ) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }
  const jobById = new Map(jobRows.map((j) => [j.id, j]));

  const { data: measurements, error: mErr } = await db
    .from("measurements")
    .select(
      "id, job_id, question_id, provider, provider_model, valid, parser_version, manual_review_required, was_client_mentioned, client_position, client_domain_cited",
    )
    .eq("org_id", args.orgId)
    .eq("run_id", args.run.id);
  if (mErr) return { ok: false, error: "INTERNAL_ERROR" };
  const mRows = measurements ?? [];
  if (mRows.length !== EXPECTED_JOBS) return { ok: false, error: "EVALUATION_DATA_MISMATCH" };

  const seenJobs = new Set<string>();
  for (const m of mRows) {
    const job = jobById.get(m.job_id);
    if (!job || seenJobs.has(m.job_id)) return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
    seenJobs.add(m.job_id);
    if (
      job.question_id !== m.question_id ||
      m.provider !== "openai" ||
      (m.provider_model ?? "").trim() !== plannedModel ||
      m.valid !== true
    ) {
      return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
    }
  }
  // 질문별 정확히 repetitions 건
  const perQuestion = new Map<string, number>();
  for (const m of mRows) perQuestion.set(m.question_id, (perQuestion.get(m.question_id) ?? 0) + 1);
  if (
    perQuestion.size !== BASELINE_EXPECTED_QUESTION_COUNT ||
    [...perQuestion.values()].some((c) => c !== BASELINE_REPETITIONS)
  ) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }

  // 등록된(pinned) 경쟁업체 mention만 인정
  const competitorIds = new Set(
    (args.snapshot.parsing_context?.competitors ?? []).map((c) => c.id),
  );
  const measurementIds = mRows.map((m) => m.id);
  const competitorMeasurementIds = new Set<string>();
  if (competitorIds.size > 0) {
    const { data: mentions, error: menErr } = await db
      .from("measurement_mentions")
      .select("measurement_id, matched_business_id")
      .eq("org_id", args.orgId)
      .in("measurement_id", measurementIds);
    if (menErr) return { ok: false, error: "INTERNAL_ERROR" };
    for (const mention of mentions ?? []) {
      if (mention.matched_business_id && competitorIds.has(mention.matched_business_id)) {
        competitorMeasurementIds.add(mention.measurement_id);
      }
    }
  }

  const facts: MeasurementFact[] = mRows.map((m) => ({
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

  return { ok: true, facts };
}

type ComputedEvaluation = {
  experiment: ExperimentRow;
  baselineSnapshot: ExperimentConditionSnapshotV1;
  followupSnapshot: ExperimentConditionSnapshotV1;
  baselineRun: RunRow;
  followupRun: RunRow;
  baselineMetrics: PhaseMetrics;
  followupMetrics: PhaseMetrics;
  questionResults: QuestionResult[];
  outcome: EvaluationOutcome;
  parserVersion: string;
  providerModel: string;
  actualChangeSummary: string | null;
};

/** 모든 eligibility 검증 + metric 계산. write 없음. */
async function computeEvaluation(args: {
  orgId: string;
  experimentId: string;
}): Promise<{ ok: true; result: ComputedEvaluation } | { ok: false; error: EvaluationErrorCode }> {
  const db = await admin();
  const { data: expData, error: expErr } = await db
    .from("experiments")
    .select(EXPERIMENT_COLUMNS)
    .eq("id", args.experimentId)
    .eq("org_id", args.orgId)
    .maybeSingle();
  if (expErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!expData) return { ok: false, error: "EXPERIMENT_NOT_FOUND" };
  const experiment = expData as unknown as ExperimentRow;

  // --- 실험 상태: Follow-up finalize까지 끝난 canonical 상태만 허용 ---
  // (evaluation 기록 후에도 별도 status enum으로 전이하지 않으므로 'followup' 유지가 정상)
  if (experiment.status !== "followup") {
    return { ok: false, error: "EVALUATION_INVALID_STATE" };
  }

  // --- Baseline 확정 여부 ---
  const baselineSnapshot = asSnapshot(experiment.baseline_condition_snapshot);
  if (
    !baselineSnapshot ||
    !experiment.baseline_run_id ||
    !experiment.baseline_start_at ||
    !experiment.baseline_end_at ||
    !baselineSnapshot.observed?.finalized_at ||
    !baselineSnapshot.condition_hash
  ) {
    return { ok: false, error: "EVALUATION_BASELINE_NOT_FINALIZED" };
  }

  // --- Follow-up 확정 여부 ---
  const followupSnapshot = asSnapshot(experiment.followup_condition_snapshot);
  if (
    !followupSnapshot ||
    !experiment.followup_run_id ||
    !experiment.followup_start_at ||
    !experiment.followup_end_at ||
    !followupSnapshot.observed?.finalized_at ||
    !followupSnapshot.condition_hash
  ) {
    return { ok: false, error: "EVALUATION_FOLLOWUP_NOT_FINALIZED" };
  }

  // --- Action Applied 완전성 ---
  const actionSnap = experiment.action_application_snapshot;
  if (
    !experiment.intervention_at ||
    !experiment.intervention_confirmed_at ||
    !experiment.changed_by ||
    !actionSnap ||
    typeof actionSnap !== "object" ||
    Array.isArray(actionSnap)
  ) {
    return { ok: false, error: "EVALUATION_INVALID_STATE" };
  }
  const actionRecord = actionSnap as Record<string, unknown>;
  if (
    actionRecord["snapshot_version"] !== "1" ||
    actionRecord["experiment_id"] !== experiment.id ||
    actionRecord["org_id"] !== experiment.org_id ||
    actionRecord["business_id"] !== experiment.business_id ||
    actionRecord["baseline_run_id"] !== experiment.baseline_run_id
  ) {
    return { ok: false, error: "EVALUATION_INVALID_STATE" };
  }
  if (actionRecord["baseline_condition_hash"] !== baselineSnapshot.condition_hash) {
    return { ok: false, error: "EVALUATION_CONDITION_MISMATCH" };
  }
  // Action Applied 감사정보 strict 검증 (자동 보정/overwrite 없음)
  const expSourceType =
    experiment.source_type === "profile_coverage_item" ? "profile_coverage_item" : "insight_action";
  if (
    !sameInstant(actionRecord["applied_at"] as string | null, experiment.intervention_at) ||
    !sameInstant(actionRecord["recorded_at"] as string | null, experiment.intervention_confirmed_at) ||
    actionRecord["recorded_by"] !== experiment.changed_by ||
    (actionRecord["source_insight_action_id"] ?? null) !==
      (experiment.source_insight_action_id ?? null)
  ) {
    return { ok: false, error: "EVALUATION_INVALID_STATE" };
  }
  // source_type 분기 provenance 검증 (기존 snapshot에는 source_type이 없을 수 있다)
  const recordSourceType =
    actionRecord["source_type"] === undefined
      ? "insight_action"
      : (actionRecord["source_type"] as string);
  if (recordSourceType !== expSourceType) {
    return { ok: false, error: "EVALUATION_INVALID_STATE" };
  }
  if (expSourceType === "profile_coverage_item") {
    if (
      !experiment.source_profile_coverage_item_id ||
      actionRecord["source_profile_coverage_item_id"] !== experiment.source_profile_coverage_item_id
    ) {
      return { ok: false, error: "EVALUATION_INVALID_STATE" };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item, error: itemErr } = await supabaseAdmin
      .from("profile_coverage_items")
      .select("id, org_id, business_id")
      .eq("id", experiment.source_profile_coverage_item_id)
      .eq("org_id", experiment.org_id)
      .eq("business_id", experiment.business_id)
      .maybeSingle();
    if (itemErr) return { ok: false, error: "INTERNAL_ERROR" };
    if (!item) return { ok: false, error: "EVALUATION_INVALID_STATE" };
  }


  // --- 조건 동일성 ---
  if (baselineSnapshot.condition_hash !== followupSnapshot.condition_hash) {
    return { ok: false, error: "EVALUATION_CONDITION_MISMATCH" };
  }
  const [reBase, reFollow] = await Promise.all([
    recomputeHash(baselineSnapshot),
    recomputeHash(followupSnapshot),
  ]);
  if (
    reBase !== baselineSnapshot.condition_hash ||
    reFollow !== followupSnapshot.condition_hash ||
    !snapshotsIdentical(baselineSnapshot, followupSnapshot) ||
    baselineSnapshot.questions.length !== BASELINE_EXPECTED_QUESTION_COUNT
  ) {
    return { ok: false, error: "EVALUATION_CONDITION_MISMATCH" };
  }

  // --- canonical runs ---
  const [baselineRun, followupRun] = await Promise.all([
    loadRun(args.orgId, experiment.baseline_run_id),
    loadRun(args.orgId, experiment.followup_run_id),
  ]);
  if (!baselineRun || !followupRun) return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  for (const [run, phase] of [
    [baselineRun, "baseline"],
    [followupRun, "followup"],
  ] as const) {
    if (
      run.experiment_id !== experiment.id ||
      run.org_id !== experiment.org_id ||
      run.business_id !== experiment.business_id ||
      run.question_set_id !== baselineSnapshot.question_set_id ||
      run.run_type !== "experiment" ||
      run.phase !== phase ||
      run.status !== "completed" ||
      !run.started_at ||
      !run.completed_at ||
      Number(run.total_jobs) !== EXPECTED_JOBS ||
      Number(run.completed_jobs) !== EXPECTED_JOBS ||
      Number(run.failed_jobs) !== 0
    ) {
      return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
    }
  }

  // --- finalized 시각 provenance: experiment 컬럼 / snapshot.observed / run 실제 시각이 같은 instant ---
  if (
    !sameInstant(experiment.baseline_start_at, baselineRun.started_at) ||
    !sameInstant(experiment.baseline_end_at, baselineRun.completed_at) ||
    !sameInstant(baselineSnapshot.observed?.run_started_at ?? null, baselineRun.started_at) ||
    !sameInstant(baselineSnapshot.observed?.run_completed_at ?? null, baselineRun.completed_at)
  ) {
    return { ok: false, error: "EVALUATION_BASELINE_NOT_FINALIZED" };
  }
  if (
    !sameInstant(experiment.followup_start_at, followupRun.started_at) ||
    !sameInstant(experiment.followup_end_at, followupRun.completed_at) ||
    !sameInstant(followupSnapshot.observed?.run_started_at ?? null, followupRun.started_at) ||
    !sameInstant(followupSnapshot.observed?.run_completed_at ?? null, followupRun.completed_at)
  ) {
    return { ok: false, error: "EVALUATION_FOLLOWUP_NOT_FINALIZED" };
  }

  // --- 인과 순서: Follow-up 측정은 변경 적용 이후 ---
  const followupStartedMs = Date.parse(followupRun.started_at ?? "");
  const interventionMs = Date.parse(experiment.intervention_at);
  if (
    !Number.isFinite(followupStartedMs) ||
    !Number.isFinite(interventionMs) ||
    followupStartedMs < interventionMs
  ) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }

  // --- pinned pipeline provenance 재확인 ---
  // NOTE: 여기서는 run_enqueued system_event만 재검증한다.
  // provider_payloads 대조는 Follow-up finalize(verifyProviderPayloadsMatchSnapshot)에서
  // 이미 수행되며, evaluation은 Follow-up finalize 이후에만 가능하므로 중복 구현하지 않는다.
  const [baseProv, followProv] = await Promise.all([
    verifyRunProvenance({
      orgId: args.orgId,
      runId: baselineRun.id,
      experimentId: experiment.id,
      phase: "baseline",
      conditionHash: baselineSnapshot.condition_hash,
    }),
    verifyRunProvenance({
      orgId: args.orgId,
      runId: followupRun.id,
      experimentId: experiment.id,
      phase: "followup",
      conditionHash: followupSnapshot.condition_hash,
    }),
  ]);
  if (!baseProv || !followProv) {
    return { ok: false, error: "EVALUATION_PIPELINE_PROVENANCE_MISMATCH" };
  }

  // --- measurement facts ---
  const baseFacts = await collectPhaseFacts({
    orgId: args.orgId,
    run: baselineRun,
    snapshot: baselineSnapshot,
  });
  if (!baseFacts.ok) return { ok: false, error: baseFacts.error };
  const followFacts = await collectPhaseFacts({
    orgId: args.orgId,
    run: followupRun,
    snapshot: followupSnapshot,
  });
  if (!followFacts.ok) return { ok: false, error: followFacts.error };

  const baselineMetrics = computePhaseMetrics(baseFacts.facts);
  const followupMetrics = computePhaseMetrics(followFacts.facts);
  if (
    baselineMetrics.validCount !== EXPECTED_JOBS ||
    followupMetrics.validCount !== EXPECTED_JOBS
  ) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }

  // --- parser drift 차단 (양쪽 단일값 + 완전 동일) ---
  const parsers = [
    ...new Set([...baselineMetrics.parserVersions, ...followupMetrics.parserVersions]),
  ];
  if (parsers.length !== 1 || !parsers[0]) {
    return { ok: false, error: "EVALUATION_PARSER_DRIFT" };
  }
  const models = [
    ...new Set([...baselineMetrics.providerModels, ...followupMetrics.providerModels]),
  ];
  if (models.length !== 1 || !models[0]) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }

  const questionResults = buildQuestionResults(baselineMetrics, followupMetrics);
  const outcome = classifyOutcome({
    inclusionDeltaCount: followupMetrics.inclusionCount - baselineMetrics.inclusionCount,
    questionResults,
  });

  const summaryRaw = actionRecord["actual_change_summary"];
  const actualChangeSummary =
    typeof summaryRaw === "string" && summaryRaw.trim() ? summaryRaw.trim().slice(0, 2000) : null;

  return {
    ok: true,
    result: {
      experiment,
      baselineSnapshot,
      followupSnapshot,
      baselineRun,
      followupRun,
      baselineMetrics,
      followupMetrics,
      questionResults,
      outcome,
      parserVersion: parsers[0],
      providerModel: models[0],
      actualChangeSummary,
    },
  };
}

function toDTO(c: ComputedEvaluation, recorded: boolean, evaluatedAt: string | null): ExperimentEvaluationDTO {
  const b = c.baselineMetrics;
  const f = c.followupMetrics;
  const questionLabelById = new Map(
    [...c.baselineSnapshot.questions]
      .sort((x, y) => (x.id < y.id ? -1 : 1))
      .map((q, i) => [q.id, { label: `질문 ${i + 1}`, snippet: promptSnippet(q.prompt_text) }]),
  );

  return {
    experimentId: c.experiment.id,
    outcome: c.outcome,
    evidenceGrade: "directional",
    recorded,
    evaluatedAt,
    baseline: {
      validCount: b.validCount,
      inclusionCount: b.inclusionCount,
      inclusionRate: b.inclusionRate,
      top3Count: b.top3Count,
      top3Rate: b.top3Rate,
      substitutionCount: b.substitutionCount,
      substitutionRate: b.substitutionRate,
      domainCitedCount: b.clientDomainCitedCount,
      domainCitedRate: b.clientDomainCitedRate,
      averagePosition: b.averagePositionAmongPositioned,
      positionObservedCount: b.positionObservedCount,
    },
    followup: {
      validCount: f.validCount,
      inclusionCount: f.inclusionCount,
      inclusionRate: f.inclusionRate,
      top3Count: f.top3Count,
      top3Rate: f.top3Rate,
      substitutionCount: f.substitutionCount,
      substitutionRate: f.substitutionRate,
      domainCitedCount: f.clientDomainCitedCount,
      domainCitedRate: f.clientDomainCitedRate,
      averagePosition: f.averagePositionAmongPositioned,
      positionObservedCount: f.positionObservedCount,
    },
    delta: {
      inclusionCount: f.inclusionCount - b.inclusionCount,
      inclusionPp: deltaPp(b.inclusionRate, f.inclusionRate),
      top3Pp: deltaPp(b.top3Rate, f.top3Rate),
      substitutionPp: deltaPp(b.substitutionRate, f.substitutionRate),
      domainCitationPp: deltaPp(b.clientDomainCitedRate, f.clientDomainCitedRate),
      averagePosition:
        b.averagePositionAmongPositioned === null || f.averagePositionAmongPositioned === null
          ? null
          : f.averagePositionAmongPositioned - b.averagePositionAmongPositioned,
    },
    questionResults: c.questionResults.map((q) => {
      const meta = questionLabelById.get(q.questionId);
      return {
        label: meta?.label ?? "질문",
        promptSnippet: meta?.snippet ?? "",
        baselineInclusionCount: q.baselineInclusionCount,
        baselineValidCount: q.baselineValidCount,
        followupInclusionCount: q.followupInclusionCount,
        followupValidCount: q.followupValidCount,
        deltaPp: q.deltaPp,
        direction: q.direction,
      };
    }),
    quality: {
      baselineManualReviewCount: b.manualReviewRequiredCount,
      followupManualReviewCount: f.manualReviewRequiredCount,
      parserVersion: c.parserVersion,
      providerModel: c.providerModel,
    },
    actionAppliedAt: c.experiment.intervention_at,
    actualChangeSummary: c.actualChangeSummary,
    caution: EVALUATION_CAUTION,
  };
}

function buildSnapshot(c: ComputedEvaluation, evaluatedAt: string, evaluatedBy: string) {
  const strip = (m: PhaseMetrics) => ({
    valid_count: m.validCount,
    inclusion_count: m.inclusionCount,
    inclusion_rate: m.inclusionRate,
    top3_count: m.top3Count,
    top3_rate: m.top3Rate,
    position_observed_count: m.positionObservedCount,
    average_position_among_positioned: m.averagePositionAmongPositioned,
    median_position_among_positioned: m.medianPositionAmongPositioned,
    client_domain_cited_count: m.clientDomainCitedCount,
    client_domain_cited_rate: m.clientDomainCitedRate,
    competitor_present_count: m.competitorPresentCount,
    competitor_present_rate: m.competitorPresentRate,
    substitution_count: m.substitutionCount,
    substitution_rate: m.substitutionRate,
    manual_review_required_count: m.manualReviewRequiredCount,
  });
  const b = c.baselineMetrics;
  const f = c.followupMetrics;

  return {
    snapshot_version: "1",
    evaluation_version: EVALUATION_VERSION,
    experiment_id: c.experiment.id,
    org_id: c.experiment.org_id,
    business_id: c.experiment.business_id,
    baseline_run_id: c.baselineRun.id,
    followup_run_id: c.followupRun.id,
    condition_hash: c.baselineSnapshot.condition_hash,
    source_insight_action_id: c.experiment.source_insight_action_id,
    action_applied_at: c.experiment.intervention_at,
    evaluated_at: evaluatedAt,
    evaluated_by: evaluatedBy,
    sample: {
      baseline_valid: b.validCount,
      followup_valid: f.validCount,
      questions: BASELINE_EXPECTED_QUESTION_COUNT,
      repetitions: BASELINE_REPETITIONS,
    },
    quality: {
      parser_version: c.parserVersion,
      provider_model: c.providerModel,
      baseline_manual_review_count: b.manualReviewRequiredCount,
      followup_manual_review_count: f.manualReviewRequiredCount,
    },
    baseline_metrics: strip(b),
    followup_metrics: strip(f),
    deltas: {
      inclusion_count: f.inclusionCount - b.inclusionCount,
      inclusion_pp: deltaPp(b.inclusionRate, f.inclusionRate),
      top3_count: f.top3Count - b.top3Count,
      top3_pp: deltaPp(b.top3Rate, f.top3Rate),
      substitution_count: f.substitutionCount - b.substitutionCount,
      substitution_pp: deltaPp(b.substitutionRate, f.substitutionRate),
      client_domain_cited_count: f.clientDomainCitedCount - b.clientDomainCitedCount,
      client_domain_cited_pp: deltaPp(b.clientDomainCitedRate, f.clientDomainCitedRate),
      average_position:
        b.averagePositionAmongPositioned === null || f.averagePositionAmongPositioned === null
          ? null
          : f.averagePositionAmongPositioned - b.averagePositionAmongPositioned,
      average_position_note: "값이 낮아질수록 개선입니다.",
    },
    question_results: c.questionResults.map((q) => ({
      question_id: q.questionId,
      baseline_valid_count: q.baselineValidCount,
      followup_valid_count: q.followupValidCount,
      baseline_inclusion_count: q.baselineInclusionCount,
      followup_inclusion_count: q.followupInclusionCount,
      delta_count: q.deltaCount,
      delta_pp: q.deltaPp,
      direction: q.direction,
    })),
    primary_metric: EVALUATION_PRIMARY_METRIC,
    primary_outcome: c.outcome,
    evidence_grade: EVALUATION_EVIDENCE_GRADE,
    classification_rule: EVALUATION_CLASSIFICATION_RULE,
    caution: EVALUATION_CAUTION,
  };
}


/** 숫자 무결성: 유한값 / 확률 0..1 / 음수 아닌 정수 count */
function snapshotNumbersLegal(s: Record<string, unknown>): boolean {
  const phases = ["baseline_metrics", "followup_metrics"] as const;
  for (const key of phases) {
    const m = s[key];
    if (!m || typeof m !== "object" || Array.isArray(m)) return false;
    const rec = m as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
      if (k.endsWith("_rate") && (v < 0 || v > 1)) return false;
      if (k.endsWith("_count") && (v < 0 || !Number.isInteger(v))) return false;
    }
  }
  const deltas = s["deltas"];
  if (!deltas || typeof deltas !== "object" || Array.isArray(deltas)) return false;
  for (const [k, v] of Object.entries(deltas as Record<string, unknown>)) {
    if (v === null || k === "average_position_note") continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}

/**
 * 이미 확정된 evaluation_snapshot이 "현재 DB 데이터로 재계산한 결과"와
 * 완전히 동일한 canonical 결과인지 검증한다. 값이 다르면 idempotent success 금지.
 * 비교는 buildSnapshot() 출력 전체를 stableStringify로 대조하므로
 * IDs / sample / quality / metrics / deltas / question_results / outcome / rule / caution을 모두 포함한다.
 */
function validateStoredEvaluation(
  c: ComputedEvaluation,
  stored: unknown,
): { ok: true; evaluatedAt: string } | { ok: false; error: EvaluationErrorCode } {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { ok: false, error: "EVALUATION_ALREADY_RECORDED" };
  }
  const st = stored as Record<string, unknown>;
  const storedAt = typeof st["evaluated_at"] === "string" ? (st["evaluated_at"] as string) : null;
  const storedBy = typeof st["evaluated_by"] === "string" ? (st["evaluated_by"] as string) : null;

  if (
    st["snapshot_version"] !== "1" ||
    st["evaluation_version"] !== EVALUATION_VERSION ||
    !storedAt ||
    !storedBy ||
    !sameInstant(storedAt, c.experiment.evaluated_at) ||
    storedBy !== c.experiment.evaluated_by
  ) {
    return { ok: false, error: "EVALUATION_ALREADY_RECORDED" };
  }
  if (!snapshotNumbersLegal(st)) return { ok: false, error: "EVALUATION_DATA_MISMATCH" };

  // 저장된 evaluated_at/by를 그대로 사용해 기대 snapshot을 재구성하고 canonical 대조
  const expected = buildSnapshot(c, storedAt, storedBy);
  if (stableStringify(expected) !== stableStringify(st)) {
    return { ok: false, error: "EVALUATION_ALREADY_RECORDED" };
  }
  return { ok: true, evaluatedAt: storedAt };
}

/** 확정 후 summary 컬럼이 expected와 일치하는지 확인 (postcondition). */
function summaryColumnsMatch(c: ComputedEvaluation, row: ExperimentRow): boolean {
  const b = c.baselineMetrics.inclusionRate;
  const f = c.followupMetrics.inclusionRate;
  const expectedDelta = b === null || f === null ? null : f - b;
  const num = (v: number | null) => (v === null ? null : Number(v));
  const eq = (a: number | null, x: number | null) =>
    a === null || x === null ? a === x : Math.abs(a - x) < 1e-9;
  return (
    row.evaluation_version === EVALUATION_VERSION &&
    row.evidence_grade === EVALUATION_EVIDENCE_GRADE &&
    row.primary_metric === EVALUATION_PRIMARY_METRIC &&
    row.result_classification === outcomeToResultClassification(c.outcome) &&
    eq(num(row.baseline_value), b) &&
    eq(num(row.followup_value), f) &&
    eq(num(row.delta_value), expectedDelta)
  );
}

export async function previewExperimentEvaluationImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<PreviewExperimentEvaluationResult> {
  if (!(await hasStaffRole(args.supabase, args.orgId, args.userId))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const computed = await computeEvaluation({ orgId: args.orgId, experimentId: args.experimentId });
  if (!computed.ok) return { ok: false, error: computed.error };
  const recorded = !!computed.result.experiment.evaluation_snapshot;
  return {
    ok: true,
    evaluation: toDTO(computed.result, recorded, computed.result.experiment.evaluated_at),
  };
}

export async function finalizeExperimentEvaluationImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<FinalizeExperimentEvaluationResult> {
  if (!(await hasStaffRole(args.supabase, args.orgId, args.userId))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  // client 계산을 신뢰하지 않고 서버에서 전부 재계산한다.
  const computed = await computeEvaluation({ orgId: args.orgId, experimentId: args.experimentId });
  if (!computed.ok) return { ok: false, error: computed.error };
  const c = computed.result;

  // 이미 평가된 경우: 재계산 결과와 완전히 같을 때만 idempotent success (덮어쓰기 금지)
  if (c.experiment.evaluation_snapshot) {
    const check = validateStoredEvaluation(c, c.experiment.evaluation_snapshot);
    if (!check.ok) return { ok: false, error: check.error };
    if (!summaryColumnsMatch(c, c.experiment)) {
      return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
    }
    return { ok: true, evaluation: toDTO(c, true, check.evaluatedAt) };
  }

  const evaluatedAt = new Date().toISOString();
  const snapshot = buildSnapshot(c, evaluatedAt, args.userId);
  const db = await admin();
  const { data: updated, error: updErr } = await db
    .from("experiments")
    .update({
      evaluation_snapshot: snapshot as never,
      evaluated_at: evaluatedAt,
      evaluated_by: args.userId,
      evaluation_version: EVALUATION_VERSION,
      evidence_grade: EVALUATION_EVIDENCE_GRADE,
      primary_metric: EVALUATION_PRIMARY_METRIC,
      baseline_value: c.baselineMetrics.inclusionRate,
      followup_value: c.followupMetrics.inclusionRate,
      delta_value:
        c.followupMetrics.inclusionRate === null || c.baselineMetrics.inclusionRate === null
          ? null
          : c.followupMetrics.inclusionRate - c.baselineMetrics.inclusionRate,
      result_classification: outcomeToResultClassification(c.outcome),
    })
    .eq("id", c.experiment.id)
    .eq("org_id", c.experiment.org_id)
    .eq("status", "followup")
    .eq("baseline_run_id", c.baselineRun.id)
    .eq("followup_run_id", c.followupRun.id)
    .eq("baseline_start_at", c.experiment.baseline_start_at as string)
    .eq("baseline_end_at", c.experiment.baseline_end_at as string)
    .eq("followup_start_at", c.experiment.followup_start_at as string)
    .eq("followup_end_at", c.experiment.followup_end_at as string)
    .is("evaluation_snapshot", null)
    .is("evaluated_at", null)
    .is("evaluated_by", null)
    .select("id")
    .maybeSingle();

  if (updErr) {
    console.error("[evaluation] finalize update failed");
    return { ok: false, error: "INTERNAL_ERROR" };
  }

  // 성공/CAS 실패 모두 row를 다시 읽어 동일한 validator로 postcondition을 확인한다.
  const reload = await computeEvaluation({ orgId: args.orgId, experimentId: args.experimentId });
  if (!reload.ok) return { ok: false, error: reload.error };
  const r = reload.result;
  const check = validateStoredEvaluation(r, r.experiment.evaluation_snapshot);
  if (!check.ok) return { ok: false, error: updated ? "EVALUATION_DATA_MISMATCH" : check.error };
  if (!summaryColumnsMatch(r, r.experiment)) {
    return { ok: false, error: "EVALUATION_DATA_MISMATCH" };
  }
  return { ok: true, evaluation: toDTO(r, true, check.evaluatedAt) };
}
