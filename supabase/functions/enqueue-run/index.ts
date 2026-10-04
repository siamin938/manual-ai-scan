import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleOptions, jsonResponse, readJsonBody } from "./_shared/http.ts";
import { constantTimeEquals, getProviderAutomationBlock, safeErrorMessage } from "./_shared/safety.ts";
import { getSupabaseRuntimeEnv } from "./_shared/supabase-env.ts";
import type { ProviderName, ProviderSettingRow } from "./_shared/types.ts";

interface EnqueueBody {
  runId?: string;
  internalSchedulerItemId?: string;
  internalSchedulerActorUserId?: string;
}

class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_ROLES = new Set(["owner", "admin", "analyst"]);

interface SnapshotQuestion {
  id: string;
  prompt_text: string;
  prompt_hash: string | null;
  intent_type: string;
  language: string;
  country_code: string;
  region: string | null;
  city: string | null;
  weight: number;
  data_class: string;
  active: boolean;
}

interface SnapshotBusinessRef {
  id: string;
  name: string;
  aliases: string[];
  official_domains: string[];
  website_url: string | null;
}

interface ExperimentConditionSnapshotV1 {
  snapshot_version: "1";
  captured_at: string;
  experiment_id: string;
  org_id: string;
  business_id: string;
  source_insight_action_id: string;
  reference_source_run_id: string;
  question_set_id: string;
  questions: SnapshotQuestion[];
  planned: {
    selected_providers: ProviderName[];
    provider_models: Record<string, string>;
    repetitions: number;
    search_context_size: string;
    store: boolean;
    planned_jobs: number;
    estimated_cost_usd: number;
    max_cost_usd: number;
  };
  parsing_context: {
    target: SnapshotBusinessRef;
    competitors: SnapshotBusinessRef[];
  };
  condition_hash: string;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const out = JSON.stringify(value);
    return out === undefined ? "null" : out;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function canonicalBusiness(value: SnapshotBusinessRef) {
  return {
    id: value.id,
    name: value.name,
    aliases: [...(value.aliases ?? [])].sort(),
    official_domains: [...(value.official_domains ?? [])].sort(),
    website_url: value.website_url ?? null,
  };
}

function buildConditionCanonical(snapshot: ExperimentConditionSnapshotV1) {
  return {
    question_set_id: snapshot.question_set_id,
    questions: [...snapshot.questions]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((question) => ({
        id: question.id,
        prompt_text: question.prompt_text,
        prompt_hash: question.prompt_hash ?? null,
        intent_type: question.intent_type,
        language: question.language,
        country_code: question.country_code,
        region: question.region ?? null,
        city: question.city ?? null,
        weight: question.weight,
        data_class: question.data_class,
        active: question.active,
      })),
    selected_providers: [...snapshot.planned.selected_providers].sort(),
    provider_models: Object.keys(snapshot.planned.provider_models)
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = snapshot.planned.provider_models[key]!;
        return acc;
      }, {}),
    repetitions: snapshot.planned.repetitions,
    search_context_size: snapshot.planned.search_context_size,
    store: snapshot.planned.store,
    parsing_context: {
      target: canonicalBusiness(snapshot.parsing_context.target),
      competitors: [...snapshot.parsing_context.competitors]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(canonicalBusiness),
    },
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function computeConditionHash(snapshot: ExperimentConditionSnapshotV1): Promise<string> {
  return sha256Hex(stableStringify(buildConditionCanonical(snapshot)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function parseSnapshotQuestion(value: unknown): SnapshotQuestion | null {
  if (!isRecord(value)) return null;
  const weight = Number(value.weight);
  if (
    typeof value.id !== "string" ||
    typeof value.prompt_text !== "string" ||
    !(typeof value.prompt_hash === "string" || value.prompt_hash === null) ||
    typeof value.intent_type !== "string" ||
    typeof value.language !== "string" ||
    typeof value.country_code !== "string" ||
    !(typeof value.region === "string" || value.region === null) ||
    !(typeof value.city === "string" || value.city === null) ||
    !Number.isFinite(weight) ||
    typeof value.data_class !== "string" ||
    typeof value.active !== "boolean"
  ) return null;

  return {
    id: value.id,
    prompt_text: value.prompt_text,
    prompt_hash: value.prompt_hash as string | null,
    intent_type: value.intent_type,
    language: value.language,
    country_code: value.country_code,
    region: value.region as string | null,
    city: value.city as string | null,
    weight,
    data_class: value.data_class,
    active: value.active,
  };
}

function parseSnapshotBusiness(value: unknown): SnapshotBusinessRef | null {
  if (!isRecord(value)) return null;
  const aliases = asStringArray(value.aliases);
  const officialDomains = asStringArray(value.official_domains);
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.aliases) || aliases.length !== value.aliases.length ||
    !Array.isArray(value.official_domains) || officialDomains.length !== value.official_domains.length ||
    !(typeof value.website_url === "string" || value.website_url === null)
  ) return null;
  return {
    id: value.id,
    name: value.name,
    aliases,
    official_domains: officialDomains,
    website_url: value.website_url as string | null,
  };
}

function parseExperimentSnapshot(value: unknown): ExperimentConditionSnapshotV1 | null {
  if (!isRecord(value) || value.snapshot_version !== "1") return null;
  if (!isRecord(value.planned) || !isRecord(value.parsing_context)) return null;
  const questionValues = Array.isArray(value.questions) ? value.questions : [];
  const questions = questionValues.map(parseSnapshotQuestion);
  if (questions.some((question) => !question)) return null;
  const target = parseSnapshotBusiness(value.parsing_context.target);
  const competitorValues = Array.isArray(value.parsing_context.competitors)
    ? value.parsing_context.competitors
    : [];
  const competitors = competitorValues.map(parseSnapshotBusiness);
  if (!target || competitors.some((business) => !business)) return null;

  const selectedProviders = asStringArray(value.planned.selected_providers) as ProviderName[];
  const providerModelsRaw = value.planned.provider_models;
  if (!isRecord(providerModelsRaw)) return null;
  const providerModels: Record<string, string> = {};
  for (const [key, model] of Object.entries(providerModelsRaw)) {
    if (typeof model !== "string") return null;
    providerModels[key] = model;
  }

  const repetitions = Number(value.planned.repetitions);
  const plannedJobs = Number(value.planned.planned_jobs);
  const estimatedCostUsd = Number(value.planned.estimated_cost_usd);
  const maxCostUsd = Number(value.planned.max_cost_usd);
  if (
    typeof value.captured_at !== "string" ||
    typeof value.experiment_id !== "string" ||
    typeof value.org_id !== "string" ||
    typeof value.business_id !== "string" ||
    typeof value.source_insight_action_id !== "string" ||
    typeof value.reference_source_run_id !== "string" ||
    typeof value.question_set_id !== "string" ||
    typeof value.condition_hash !== "string" ||
    !Number.isInteger(repetitions) ||
    !Number.isInteger(plannedJobs) ||
    !Number.isFinite(estimatedCostUsd) ||
    !Number.isFinite(maxCostUsd) ||
    typeof value.planned.search_context_size !== "string" ||
    typeof value.planned.store !== "boolean"
  ) return null;

  return {
    snapshot_version: "1",
    captured_at: value.captured_at,
    experiment_id: value.experiment_id,
    org_id: value.org_id,
    business_id: value.business_id,
    source_insight_action_id: value.source_insight_action_id,
    reference_source_run_id: value.reference_source_run_id,
    question_set_id: value.question_set_id,
    questions: questions as SnapshotQuestion[],
    planned: {
      selected_providers: selectedProviders,
      provider_models: providerModels,
      repetitions,
      search_context_size: value.planned.search_context_size,
      store: value.planned.store,
      planned_jobs: plannedJobs,
      estimated_cost_usd: estimatedCostUsd,
      max_cost_usd: maxCostUsd,
    },
    parsing_context: {
      target,
      competitors: competitors as SnapshotBusinessRef[],
    },
    condition_hash: value.condition_hash,
  };
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameSnapshotQuestion(current: Record<string, unknown>, expected: SnapshotQuestion): boolean {
  return current.id === expected.id &&
    current.prompt_text === expected.prompt_text &&
    (current.prompt_hash ?? null) === expected.prompt_hash &&
    current.intent_type === expected.intent_type &&
    current.language === expected.language &&
    current.country_code === expected.country_code &&
    (current.region ?? null) === expected.region &&
    (current.city ?? null) === expected.city &&
    Number(current.weight) === expected.weight &&
    current.data_class === expected.data_class &&
    current.active === expected.active;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function providerKeyConfigured(provider: ProviderName): boolean {
  if (provider === "openai") return Boolean(Deno.env.get("OPENAI_API_KEY"));
  if (provider === "gemini") return Boolean(Deno.env.get("GEMINI_API_KEY"));
  return Boolean(Deno.env.get("PERPLEXITY_API_KEY"));
}

async function insertInChunks(
  serviceClient: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
): Promise<void> {
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const { error } = await serviceClient
      .from("measurement_jobs")
      .upsert(chunk, { onConflict: "run_id,question_id,provider,repetition_no", ignoreDuplicates: true });
    if (error) throw new AppError("JOB_INSERT_FAILED", error.message, 500);
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const { url: supabaseUrl, publishableKey: anonKey, secretKey: serviceRoleKey } = getSupabaseRuntimeEnv();
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new AppError("SERVER_NOT_CONFIGURED", "Supabase Edge Function secrets are incomplete.", 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await readJsonBody<EnqueueBody>(request);
    const runId = body.runId?.trim();
    if (!runId || !UUID_PATTERN.test(runId)) {
      throw new AppError("INVALID_RUN_ID", "올바른 runId가 필요합니다.");
    }

    const configuredInternalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
    const suppliedInternalSecret = request.headers.get("x-internal-secret") ?? "";
    const internalSchedulerMode =
      configuredInternalSecret.length > 0 &&
      constantTimeEquals(configuredInternalSecret, suppliedInternalSecret);

    let actorUserId: string;
    let run: any;

    if (internalSchedulerMode) {
      const schedulerItemId = body.internalSchedulerItemId?.trim() ?? "";
      const schedulerActorUserId = body.internalSchedulerActorUserId?.trim() ?? "";
      if (!UUID_PATTERN.test(schedulerItemId) || !UUID_PATTERN.test(schedulerActorUserId)) {
        throw new AppError("INTERNAL_SCHEDULER_SCOPE_INVALID", "내부 스케줄러 실행 범위가 올바르지 않습니다.", 403);
      }

      const { data: internalRun, error: internalRunError } = await serviceClient
        .from("measurement_runs")
        .select("id,org_id,business_id,question_set_id,status,selected_providers,repetitions,max_cost_usd,scheduled_at,total_jobs,estimated_cost_usd,run_type,phase,experiment_id,created_by,data_origin,diagnostic_scope")
        .eq("id", runId)
        .single();
      if (internalRunError || !internalRun) {
        throw new AppError("RUN_NOT_FOUND", "실행을 찾을 수 없습니다.", 404);
      }

      const { data: pipelineItem, error: pipelineError } = await serviceClient
        .from("internal_observation_pipeline_items")
        .select("id,org_id,business_id,question_set_id,run_id,status,measurement_approved_by")
        .eq("id", schedulerItemId)
        .maybeSingle();
      if (
        pipelineError ||
        !pipelineItem ||
        pipelineItem.org_id !== internalRun.org_id ||
        pipelineItem.business_id !== internalRun.business_id ||
        pipelineItem.question_set_id !== internalRun.question_set_id ||
        pipelineItem.run_id !== internalRun.id ||
        pipelineItem.status !== "measuring" ||
        pipelineItem.measurement_approved_by !== schedulerActorUserId
      ) {
        throw new AppError("INTERNAL_SCHEDULER_SCOPE_INVALID", "내부 스케줄러 파이프라인 연결이 일치하지 않습니다.", 403);
      }

      const { data: schedulerSettings, error: schedulerSettingsError } = await serviceClient
        .from("internal_observation_pipeline_settings")
        .select("execution_enabled,scheduler_state,scheduler_executor_ready,scheduler_actor_user_id")
        .eq("org_id", internalRun.org_id)
        .maybeSingle();
      if (
        schedulerSettingsError ||
        !schedulerSettings ||
        schedulerSettings.execution_enabled !== true ||
        schedulerSettings.scheduler_state !== "running" ||
        schedulerSettings.scheduler_executor_ready !== true ||
        schedulerSettings.scheduler_actor_user_id !== schedulerActorUserId
      ) {
        throw new AppError("INTERNAL_SCHEDULER_NOT_READY", "내부 스케줄러 실행 Gate가 닫혀 있습니다.", 403);
      }

      const { data: orgRow, error: orgError } = await serviceClient
        .from("organizations")
        .select("measurement_data_origin")
        .eq("id", internalRun.org_id)
        .maybeSingle();
      if (
        orgError ||
        !orgRow ||
        orgRow.measurement_data_origin !== "internal_observation" ||
        internalRun.data_origin !== "internal_observation" ||
        internalRun.diagnostic_scope !== "customer" ||
        internalRun.run_type !== "audit" ||
        internalRun.phase !== "standalone" ||
        internalRun.created_by !== schedulerActorUserId
      ) {
        throw new AppError("INTERNAL_SCHEDULER_SCOPE_INVALID", "내부 스케줄러 Run 범위가 올바르지 않습니다.", 403);
      }

      const { data: membership, error: membershipError } = await serviceClient
        .from("organization_members")
        .select("role")
        .eq("org_id", internalRun.org_id)
        .eq("user_id", schedulerActorUserId)
        .maybeSingle();
      if (membershipError || !membership || !STAFF_ROLES.has(membership.role)) {
        throw new AppError("FORBIDDEN", "측정 실행 권한이 없습니다.", 403);
      }

      run = internalRun;
      actorUserId = schedulerActorUserId;
    } else {
      const authorization = request.headers.get("Authorization");
      if (!authorization?.startsWith("Bearer ")) {
        throw new AppError("AUTH_REQUIRED", "로그인이 필요합니다.", 401);
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) {
        throw new AppError("AUTH_INVALID", "유효한 로그인 세션이 아닙니다.", 401);
      }

      const { data: userRun, error: runError } = await userClient
        .from("measurement_runs")
        .select("id,org_id,business_id,question_set_id,status,selected_providers,repetitions,max_cost_usd,scheduled_at,total_jobs,estimated_cost_usd,run_type,phase,experiment_id")
        .eq("id", runId)
        .single();
      if (runError || !userRun) throw new AppError("RUN_NOT_FOUND", "실행을 찾을 수 없습니다.", 404);

      const { data: membership, error: membershipError } = await userClient
        .from("organization_members")
        .select("role")
        .eq("org_id", userRun.org_id)
        .eq("user_id", authData.user.id)
        .single();
      if (membershipError || !membership || !STAFF_ROLES.has(membership.role)) {
        throw new AppError("FORBIDDEN", "측정 실행 권한이 없습니다.", 403);
      }

      run = userRun;
      actorUserId = authData.user.id;
    }

    if (run.status !== "draft") {
      const { count } = await serviceClient
        .from("measurement_jobs")
        .select("id", { count: "exact", head: true })
        .eq("run_id", runId);
      return jsonResponse({
        ok: true,
        idempotent: true,
        runId,
        status: run.status,
        totalJobs: count ?? run.total_jobs ?? 0,
        estimatedCostUsd: numberValue(run.estimated_cost_usd),
      });
    }

    let experimentSnapshot: ExperimentConditionSnapshotV1 | null = null;
    const isExperimentMode = run.run_type === "experiment";

    if (isExperimentMode) {
      if (!run.experiment_id || (run.phase !== "baseline" && run.phase !== "followup")) {
        throw new AppError("EXPERIMENT_RUN_INVALID", "실험 측정 실행 정보가 올바르지 않습니다.");
      }

      const { data: experiment, error: experimentError } = await serviceClient
        .from("experiments")
        .select("id,org_id,business_id,status,baseline_run_id,followup_run_id,baseline_condition_snapshot,followup_condition_snapshot")
        .eq("id", run.experiment_id)
        .eq("org_id", run.org_id)
        .eq("business_id", run.business_id)
        .maybeSingle();
      if (experimentError) throw new AppError("EXPERIMENT_LOAD_FAILED", experimentError.message, 500);
      if (!experiment) throw new AppError("EXPERIMENT_NOT_FOUND", "연결된 실험을 찾을 수 없습니다.", 404);
      const expectedExperimentStatus = run.phase === "baseline" ? "baseline" : "followup";
      if (experiment.status !== expectedExperimentStatus) {
        throw new AppError("EXPERIMENT_STATE_MISMATCH", "실험 상태와 측정 단계가 일치하지 않습니다.", 409);
      }

      const canonicalRunId = run.phase === "baseline" ? experiment.baseline_run_id : experiment.followup_run_id;
      if (canonicalRunId !== run.id) {
        throw new AppError("EXPERIMENT_RUN_NOT_CANONICAL", "공식 실험 측정 실행이 아닙니다.", 409);
      }

      const rawSnapshot = run.phase === "baseline"
        ? experiment.baseline_condition_snapshot
        : experiment.followup_condition_snapshot;
      experimentSnapshot = parseExperimentSnapshot(rawSnapshot);
      if (!experimentSnapshot) {
        throw new AppError("EXPERIMENT_SNAPSHOT_INVALID", "실험 측정 조건 snapshot이 올바르지 않습니다.", 409);
      }

      if (
        experimentSnapshot.experiment_id !== experiment.id ||
        experimentSnapshot.org_id !== run.org_id ||
        experimentSnapshot.business_id !== run.business_id ||
        experimentSnapshot.question_set_id !== run.question_set_id
      ) {
        throw new AppError("EXPERIMENT_SNAPSHOT_SCOPE_MISMATCH", "실험 snapshot 범위가 측정 실행과 일치하지 않습니다.", 409);
      }

      const snapshotProviders = [...experimentSnapshot.planned.selected_providers];
      const runProviders = [...new Set((run.selected_providers ?? []) as ProviderName[])];
      if (
        !sameStringArray(snapshotProviders, ["openai"]) ||
        !sameStringArray(runProviders, snapshotProviders) ||
        experimentSnapshot.planned.repetitions !== 5 ||
        Number(run.repetitions) !== experimentSnapshot.planned.repetitions ||
        experimentSnapshot.questions.length !== 3 ||
        experimentSnapshot.planned.planned_jobs !== 15 ||
        experimentSnapshot.planned.store !== false ||
        experimentSnapshot.planned.max_cost_usd !== 1 ||
        !["low", "medium", "high"].includes(experimentSnapshot.planned.search_context_size) ||
        !experimentSnapshot.planned.provider_models.openai ||
        experimentSnapshot.planned.provider_models.openai.trim() !== experimentSnapshot.planned.provider_models.openai ||
        Math.abs(numberValue(run.max_cost_usd) - experimentSnapshot.planned.max_cost_usd) > 1e-9 ||
        experimentSnapshot.parsing_context.target.id !== run.business_id
      ) {
        throw new AppError("EXPERIMENT_SNAPSHOT_MISMATCH", "실험 snapshot과 측정 실행 조건이 일치하지 않습니다.", 409);
      }

      const competitorIds = experimentSnapshot.parsing_context.competitors.map((business) => business.id);
      if (
        competitorIds.some((id) => id === run.business_id) ||
        new Set(competitorIds).size !== competitorIds.length
      ) {
        throw new AppError("EXPERIMENT_SNAPSHOT_MISMATCH", "실험 parser context가 올바르지 않습니다.", 409);
      }

      const { data: currentQuestionSet, error: questionSetError } = await serviceClient
        .from("question_sets")
        .select("id,business_id,active")
        .eq("id", run.question_set_id)
        .eq("org_id", run.org_id)
        .maybeSingle();
      if (questionSetError) throw new AppError("QUESTION_SET_LOAD_FAILED", questionSetError.message, 500);
      if (!currentQuestionSet || !currentQuestionSet.active || currentQuestionSet.business_id !== run.business_id) {
        throw new AppError("EXPERIMENT_SNAPSHOT_MISMATCH", "실험 질문 세트 상태가 변경되었습니다.", 409);
      }

      const questionIds = experimentSnapshot.questions.map((question) => question.id);
      if (new Set(questionIds).size !== questionIds.length) {
        throw new AppError("EXPERIMENT_SNAPSHOT_MISMATCH", "실험 snapshot에 중복 질문이 있습니다.", 409);
      }

      const { data: currentQuestions, error: currentQuestionError } = await serviceClient
        .from("questions")
        .select("id,prompt_text,prompt_hash,intent_type,language,country_code,region,city,weight,data_class,active")
        .eq("org_id", run.org_id)
        .eq("question_set_id", run.question_set_id);
      if (currentQuestionError) {
        throw new AppError("QUESTION_LOAD_FAILED", currentQuestionError.message, 500);
      }
      const currentActiveQuestions = ((currentQuestions ?? []) as Record<string, unknown>[])
        .filter((question) => question.active === true);

      // Experiment snapshot may intentionally pin a strict subset of an active question set.
      // Extra active questions outside the snapshot are allowed, but every pinned question
      // must still exist, remain active/public, and match the exact snapshotted content below.
      const currentById = new Map<string, Record<string, unknown>>(
        currentActiveQuestions.map((question) => [String(question.id), question]),
      );
      for (const expected of experimentSnapshot.questions) {
        const current = currentById.get(expected.id);
        if (!current || !sameSnapshotQuestion(current, expected) || expected.active !== true || expected.data_class !== "public") {
          throw new AppError("EXPERIMENT_SNAPSHOT_MISMATCH", "실험 질문 조건이 snapshot 이후 변경되었습니다.", 409);
        }
      }

      const recomputedHash = await computeConditionHash(experimentSnapshot);
      if (recomputedHash !== experimentSnapshot.condition_hash) {
        throw new AppError("EXPERIMENT_CONDITION_HASH_MISMATCH", "실험 조건 hash 검증에 실패했습니다.", 409);
      }
    }

    const providers = experimentSnapshot
      ? [...experimentSnapshot.planned.selected_providers]
      : [...new Set((run.selected_providers ?? []) as ProviderName[])];
    if (providers.length === 0) throw new AppError("NO_PROVIDER", "측정 엔진을 하나 이상 선택해야 합니다.");
    if (providers.some((provider) => !["openai", "gemini", "perplexity"].includes(provider))) {
      throw new AppError("INVALID_PROVIDER", "지원하지 않는 엔진이 포함되어 있습니다.");
    }

    const repetitions = experimentSnapshot
      ? experimentSnapshot.planned.repetitions
      : Number(run.repetitions);
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
      throw new AppError("INVALID_REPETITIONS", "반복 횟수는 1~5회여야 합니다.");
    }

    const { data: organization, error: orgError } = await serviceClient
      .from("organizations")
      .select("daily_request_limit,monthly_budget_usd")
      .eq("id", run.org_id)
      .single();
    if (orgError || !organization) throw new AppError("ORG_NOT_FOUND", "조직 설정을 찾을 수 없습니다.", 404);

    let allQuestions: { id: string; data_class: string; active: boolean }[];
    if (experimentSnapshot) {
      allQuestions = experimentSnapshot.questions.map((question) => ({
        id: question.id,
        data_class: question.data_class,
        active: question.active,
      }));
    } else {
      const { data: liveQuestions, error: questionError } = await serviceClient
        .from("questions")
        .select("id,data_class,active")
        .eq("org_id", run.org_id)
        .eq("question_set_id", run.question_set_id)
        .eq("active", true);
      if (questionError) throw new AppError("QUESTION_LOAD_FAILED", questionError.message, 500);
      allQuestions = (liveQuestions ?? []) as { id: string; data_class: string; active: boolean }[];
    }
    if (!allQuestions.length) throw new AppError("NO_ACTIVE_QUESTIONS", "활성 질문이 없습니다.");
    if (allQuestions.some((question) => question.data_class !== "public" || question.active !== true)) {
      throw new AppError("NON_PUBLIC_QUESTION", "질문 세트에 public이 아닌 활성 질문이 포함되어 있습니다.");
    }

    const { data: settingsData, error: settingsError } = await serviceClient
      .from("provider_settings")
      .select("org_id,provider,enabled,model_name,search_context_size,estimated_cost_per_request_usd,paid_account_confirmed,terms_reviewed,terms_version,terms_reviewed_at,terms_reviewed_by,automated_benchmark_approved,approval_reference,config")
      .eq("org_id", run.org_id)
      .in("provider", providers);
    if (settingsError) throw new AppError("PROVIDER_SETTINGS_FAILED", settingsError.message, 500);

    const settings = new Map<ProviderName, ProviderSettingRow>();
    for (const row of (settingsData ?? []) as ProviderSettingRow[]) settings.set(row.provider, row);

    for (const provider of providers) {
      const setting = settings.get(provider);
      if (!setting?.enabled) throw new AppError("PROVIDER_DISABLED", `${provider} 엔진이 비활성 상태입니다.`);
      if (!setting.model_name?.trim()) throw new AppError("PROVIDER_MODEL_MISSING", `${provider} 모델 설정이 없습니다.`);
      if (experimentSnapshot && !setting.paid_account_confirmed) {
        throw new AppError("PROVIDER_PAID_NOT_CONFIRMED", `${provider} 유료 API 사용 확인이 필요합니다.`);
      }
      const currentEstimatedCost = Number(setting.estimated_cost_per_request_usd);
      if (experimentSnapshot && (!Number.isFinite(currentEstimatedCost) || currentEstimatedCost < 0)) {
        throw new AppError("PROVIDER_COST_INVALID", `${provider} 비용 설정이 올바르지 않습니다.`);
      }
      const policyBlock = getProviderAutomationBlock(setting);
      if (policyBlock) throw new AppError(policyBlock.code, policyBlock.message);
      if (!providerKeyConfigured(provider)) throw new AppError("PROVIDER_KEY_MISSING", `${provider} API 키가 Edge Function Secrets에 없습니다.`);
    }

    const perQuestionCost = providers.reduce(
      (sum, provider) => sum + numberValue(settings.get(provider)?.estimated_cost_per_request_usd),
      0,
    );
    const totalJobs = allQuestions.length * providers.length * repetitions;
    if (experimentSnapshot && totalJobs !== experimentSnapshot.planned.planned_jobs) {
      throw new AppError("EXPERIMENT_SNAPSHOT_MISMATCH", "실험 작업 수가 snapshot과 일치하지 않습니다.", 409);
    }
    const estimatedCostUsd = Number((allQuestions.length * repetitions * perQuestionCost).toFixed(6));
    const maxCostUsd = numberValue(run.max_cost_usd);
    if (estimatedCostUsd > maxCostUsd + 1e-9) {
      throw new AppError(
        "RUN_COST_CAP_EXCEEDED",
        `예상 비용 $${estimatedCostUsd.toFixed(4)}가 실행 한도 $${maxCostUsd.toFixed(4)}를 초과합니다.`,
      );
    }

    const { count: existingCount, error: existingCountError } = await serviceClient
      .from("measurement_jobs")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId);
    if (existingCountError) throw new AppError("JOB_COUNT_FAILED", existingCountError.message, 500);
    const newJobCount = Math.max(0, totalJobs - (existingCount ?? 0));

    const { data: usageRows, error: usageError } = await serviceClient.rpc("get_org_usage", { p_org_id: run.org_id });
    if (usageError) throw new AppError("USAGE_CHECK_FAILED", usageError.message, 500);
    const usage = usageRows?.[0] ?? {};
    const dailyRequests = numberValue(usage.daily_requests);
    const monthlyActual = numberValue(usage.monthly_actual_cost_usd);
    const monthlyReserved = numberValue(usage.monthly_reserved_cost_usd);
    const dailyLimit = numberValue(organization.daily_request_limit);
    const monthlyBudget = numberValue(organization.monthly_budget_usd);

    if (dailyRequests + newJobCount > dailyLimit) {
      throw new AppError(
        "DAILY_REQUEST_LIMIT_EXCEEDED",
        `오늘 요청 한도 ${dailyLimit}건을 초과합니다. 현재 ${dailyRequests}건, 추가 ${newJobCount}건입니다.`,
      );
    }
    if (monthlyActual + monthlyReserved + estimatedCostUsd > monthlyBudget + 1e-9) {
      throw new AppError(
        "MONTHLY_BUDGET_EXCEEDED",
        `월 예산 $${monthlyBudget.toFixed(2)}를 초과할 수 있어 실행이 차단되었습니다.`,
      );
    }

    const scheduledAt = run.scheduled_at ?? new Date().toISOString();
    const jobs: Record<string, unknown>[] = [];
    for (const question of allQuestions) {
      for (const provider of providers) {
        const setting = settings.get(provider)!;
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          jobs.push({
            org_id: run.org_id,
            run_id: runId,
            question_id: question.id,
            provider,
            provider_model: experimentSnapshot
              ? experimentSnapshot.planned.provider_models[provider]!
              : setting.model_name,
            repetition_no: repetition,
            status: "queued",
            scheduled_at: scheduledAt,
            next_attempt_at: scheduledAt,
            idempotency_key: `${runId}:${question.id}:${provider}:${repetition}`,
            estimated_cost_usd: numberValue(setting.estimated_cost_per_request_usd),
          });
        }
      }
    }

    await insertInChunks(serviceClient, jobs);

    const { error: updateError } = await serviceClient
      .from("measurement_runs")
      .update({
        status: "queued",
        total_jobs: totalJobs,
        completed_jobs: 0,
        failed_jobs: 0,
        estimated_cost_usd: estimatedCostUsd,
      })
      .eq("id", runId)
      .eq("org_id", run.org_id)
      .eq("status", "draft");
    if (updateError) throw new AppError("RUN_UPDATE_FAILED", updateError.message, 500);

    await serviceClient.from("system_events").insert({
      org_id: run.org_id,
      run_id: runId,
      event_type: "run_enqueued",
      severity: "info",
      message: `${totalJobs}개 측정 작업이 큐에 등록되었습니다.`,
      metadata: {
        providers,
        questions: allQuestions.length,
        repetitions,
        estimated_cost_usd: estimatedCostUsd,
        ...(experimentSnapshot
          ? {
              experiment_id: run.experiment_id,
              experiment_phase: run.phase,
              condition_hash: experimentSnapshot.condition_hash,
              execution_mode: "experiment_snapshot_v1",
            }
          : {}),
      },
      created_by: actorUserId,
    });

    return jsonResponse({
      ok: true,
      idempotent: false,
      runId,
      status: "queued",
      questions: allQuestions.length,
      providers,
      repetitions,
      totalJobs,
      estimatedCostUsd,
    });
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError("UNEXPECTED_ERROR", safeErrorMessage(error), 500);
    console.error(JSON.stringify({ function: "enqueue-run", code: appError.code, message: safeErrorMessage(appError) }));
    return jsonResponse({ error: appError.code, message: safeErrorMessage(appError) }, appError.status);
  }
});
