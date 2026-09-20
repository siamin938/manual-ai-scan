import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleOptions, jsonResponse } from "./_shared/http.ts";
import { PARSER_VERSION, parseMeasurement } from "./_shared/parser.ts";
import { ProviderHttpError, normalizeDomain, sha256Hex } from "./_shared/provider-utils.ts";
import { callProvider } from "./_shared/providers/index.ts";
import { getSupabaseRuntimeEnv } from "./_shared/supabase-env.ts";
import {
  SafetyError,
  buildApprovedProviderRequest,
  constantTimeEquals,
  getProviderAutomationBlock,
  safeErrorMessage,
} from "./_shared/safety.ts";
import type {
  BusinessForParsing,
  ClaimedJob,
  ProviderSettingRow,
} from "./_shared/types.ts";

const MAX_ATTEMPTS = 3;
const MAX_RESPONSE_CHARS = 120_000;
const MAX_RAW_PAYLOAD_BYTES = 1_500_000;

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
    selected_providers: string[];
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

  const selectedProviders = asStringArray(value.planned.selected_providers);
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

function exactSingleProvider(value: unknown, provider: string): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === provider;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function configError(error: unknown): boolean {
  const message = safeErrorMessage(error);
  return /_API_KEY_NOT_CONFIGURED|PROVIDER_DISABLED|PAID_NOT_CONFIRMED|MODEL_MISSING|TERMS_NOT_REVIEWED|AUTOMATION_NOT_APPROVED|AUTOMATION_BLOCKED|APPROVAL_REFERENCE_REQUIRED/.test(message);
}

function retryableError(error: unknown): boolean {
  if (error instanceof SafetyError) return false;
  if (error instanceof ProviderHttpError) return error.retryable;
  if (configError(error)) return false;
  return error instanceof TypeError;
}

function errorCode(error: unknown): string {
  if (error instanceof SafetyError) return error.code;
  if (error instanceof ProviderHttpError) return error.code;
  const message = safeErrorMessage(error);
  if (/^[A-Z0-9_:-]{3,100}$/.test(message)) return message.replace(/:.*/, "");
  return "JOB_PROCESSING_ERROR";
}

function officialDomains(row: Record<string, unknown>): string[] {
  const domains = new Set<string>();
  for (const value of (Array.isArray(row.official_domains) ? row.official_domains : [])) {
    if (typeof value === "string") {
      const domain = normalizeDomain(value);
      if (domain) domains.add(domain);
    }
  }
  if (typeof row.website_url === "string") {
    const domain = normalizeDomain(row.website_url);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

function toBusiness(row: Record<string, unknown>, isClient: boolean): BusinessForParsing {
  return {
    id: String(row.id),
    name: String(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((value): value is string => typeof value === "string") : [],
    officialDomains: officialDomains(row),
    isClient,
  };
}

function boundedRawPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).byteLength <= MAX_RAW_PAYLOAD_BYTES) return payload;
  return {
    truncated: true,
    reason: "RAW_PAYLOAD_SIZE_LIMIT",
    original_bytes: new TextEncoder().encode(json).byteLength,
  };
}

async function logEvent(
  client: ReturnType<typeof createClient>,
  job: ClaimedJob,
  eventType: string,
  severity: "info" | "warning" | "error" | "critical",
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.from("system_events").insert({
    org_id: job.org_id,
    run_id: job.run_id,
    event_type: eventType,
    severity,
    message: message.slice(0, 1000),
    metadata,
  });
}

async function markFailedOrRetry(
  client: ReturnType<typeof createClient>,
  job: ClaimedJob,
  error: unknown,
): Promise<"retried" | "failed"> {
  const canRetry = retryableError(error) && job.attempt_count < MAX_ATTEMPTS;
  const code = errorCode(error);
  const message = safeErrorMessage(error);

  if (canRetry) {
    const delaySeconds = Math.min(900, 60 * 2 ** Math.max(0, job.attempt_count - 1));
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    await client.from("measurement_jobs").update({
      status: "queued",
      next_attempt_at: nextAttemptAt,
      locked_at: null,
      error_code: code,
      error_message: message,
    }).eq("id", job.id);
    await logEvent(client, job, "job_retry_scheduled", "warning", message, {
      job_id: job.id,
      provider: job.provider,
      attempt_count: job.attempt_count,
      next_attempt_at: nextAttemptAt,
      error_code: code,
    });
    await client.rpc("refresh_run_progress", { p_run_id: job.run_id });
    return "retried";
  }

  await client.from("measurement_jobs").update({
    status: "failed",
    completed_at: new Date().toISOString(),
    locked_at: null,
    error_code: code,
    error_message: message,
  }).eq("id", job.id);
  await logEvent(client, job, "job_failed", "error", message, {
    job_id: job.id,
    provider: job.provider,
    attempt_count: job.attempt_count,
    error_code: code,
  });
  await client.rpc("refresh_run_progress", { p_run_id: job.run_id });
  return "failed";
}

async function processJob(
  client: ReturnType<typeof createClient>,
  job: ClaimedJob,
  retentionDays: number,
): Promise<void> {
  const { data: run, error: runError } = await client
    .from("measurement_runs")
    .select("id,org_id,business_id,question_set_id,status,max_cost_usd,estimated_cost_usd,actual_cost_usd,run_type,phase,experiment_id,repetitions,selected_providers")
    .eq("id", job.run_id)
    .eq("org_id", job.org_id)
    .single();
  if (runError || !run) throw new Error("RUN_NOT_FOUND");
  if (run.status === "cancelled") {
    await client.from("measurement_jobs").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", job.id);
    await client.rpc("refresh_run_progress", { p_run_id: job.run_id });
    return;
  }

  let experimentSnapshot: ExperimentConditionSnapshotV1 | null = null;
  let snapshotQuestion: SnapshotQuestion | null = null;

  const isExperimentRun = run.run_type === "experiment";
  if (isExperimentRun) {
    if (
      (run.phase !== "baseline" && run.phase !== "followup") ||
      typeof run.experiment_id !== "string" ||
      !run.experiment_id
    ) {
      throw new SafetyError("EXPERIMENT_RUN_SCOPE_INVALID", "실험 측정 Run의 phase/experiment_id가 올바르지 않습니다.");
    }

    const { data: experiment, error: experimentError } = await client
      .from("experiments")
      .select("id,org_id,business_id,status,baseline_run_id,followup_run_id,baseline_condition_snapshot,followup_condition_snapshot")
      .eq("id", run.experiment_id)
      .eq("org_id", job.org_id)
      .eq("business_id", run.business_id)
      .single();
    if (experimentError || !experiment) {
      throw new SafetyError("EXPERIMENT_NOT_FOUND", "실험 실행 정보를 확인할 수 없습니다.");
    }

    const expectedRunId = run.phase === "baseline"
      ? experiment.baseline_run_id
      : experiment.followup_run_id;
    const expectedExperimentStatus = run.phase === "baseline" ? "baseline" : "followup";
    if (expectedRunId !== run.id || experiment.status !== expectedExperimentStatus) {
      throw new SafetyError("EXPERIMENT_CANONICAL_RUN_MISMATCH", "현재 Run이 실험의 canonical 측정 Run과 일치하지 않습니다.");
    }

    const rawSnapshot = run.phase === "baseline"
      ? experiment.baseline_condition_snapshot
      : experiment.followup_condition_snapshot;
    const snapshot = parseExperimentSnapshot(rawSnapshot);
    if (!snapshot) {
      throw new SafetyError("EXPERIMENT_SNAPSHOT_INVALID", "실험 조건 snapshot 형식이 올바르지 않습니다.");
    }

    if (
      snapshot.experiment_id !== experiment.id ||
      snapshot.org_id !== job.org_id ||
      snapshot.business_id !== run.business_id ||
      snapshot.question_set_id !== run.question_set_id ||
      snapshot.parsing_context.target.id !== run.business_id ||
      snapshot.planned.store !== false ||
      snapshot.planned.repetitions !== Number(run.repetitions) ||
      Number(snapshot.planned.max_cost_usd) !== Number(run.max_cost_usd) ||
      Number(snapshot.planned.estimated_cost_usd) !== Number(run.estimated_cost_usd) ||
      snapshot.planned.estimated_cost_usd < 0 ||
      snapshot.planned.estimated_cost_usd > snapshot.planned.max_cost_usd ||
      !exactSingleProvider(snapshot.planned.selected_providers, "openai") ||
      !exactSingleProvider(run.selected_providers, "openai") ||
      snapshot.questions.length !== 3 ||
      snapshot.planned.planned_jobs !== snapshot.questions.length * snapshot.planned.repetitions
    ) {
      throw new SafetyError("EXPERIMENT_SNAPSHOT_SCOPE_MISMATCH", "실험 조건 snapshot과 Run 조건이 일치하지 않습니다.");
    }

    const recomputedHash = await computeConditionHash(snapshot);
    if (!snapshot.condition_hash || recomputedHash !== snapshot.condition_hash) {
      throw new SafetyError("BASELINE_CONDITION_DRIFT", "실험 조건 snapshot 해시가 일치하지 않습니다.");
    }

    const questionIds = snapshot.questions.map((question) => question.id);
    if (new Set(questionIds).size !== questionIds.length) {
      throw new SafetyError("EXPERIMENT_SNAPSHOT_DUPLICATE_QUESTION", "snapshot 질문 ID가 중복되었습니다.");
    }

    snapshotQuestion = snapshot.questions.find((question) => question.id === job.question_id) ?? null;
    if (!snapshotQuestion || !snapshotQuestion.active || snapshotQuestion.data_class !== "public") {
      throw new SafetyError("EXPERIMENT_QUESTION_MISMATCH", "현재 Job 질문이 snapshot의 실행 가능한 질문과 일치하지 않습니다.");
    }

    if (
      !Number.isInteger(Number(job.repetition_no)) ||
      Number(job.repetition_no) < 1 ||
      Number(job.repetition_no) > snapshot.planned.repetitions
    ) {
      throw new SafetyError("EXPERIMENT_REPETITION_MISMATCH", "Job 반복 번호가 snapshot 범위를 벗어났습니다.");
    }

    const competitorIds = snapshot.parsing_context.competitors.map((business) => business.id);
    if (
      competitorIds.includes(run.business_id) ||
      new Set(competitorIds).size !== competitorIds.length
    ) {
      throw new SafetyError("EXPERIMENT_PARSING_CONTEXT_INVALID", "snapshot parser 경쟁사 구성이 올바르지 않습니다.");
    }

    const plannedModel = snapshot.planned.provider_models[job.provider]?.trim() ?? "";
    if (!plannedModel || plannedModel !== job.provider_model.trim()) {
      throw new SafetyError("EXPERIMENT_MODEL_MISMATCH", "Job 모델과 snapshot 모델이 일치하지 않습니다.");
    }

    if (
      snapshot.planned.search_context_size !== "low" &&
      snapshot.planned.search_context_size !== "medium" &&
      snapshot.planned.search_context_size !== "high"
    ) {
      throw new SafetyError("EXPERIMENT_SEARCH_CONTEXT_INVALID", "snapshot search_context_size가 허용 범위가 아닙니다.");
    }

    experimentSnapshot = snapshot;
  }

  const { data: existingMeasurement, error: existingMeasurementError } = await client
    .from("measurements")
    .select("id,provider_model,actual_cost_usd,input_tokens,output_tokens")
    .eq("job_id", job.id)
    .maybeSingle();
  if (existingMeasurementError) throw new Error("EXISTING_MEASUREMENT_CHECK_FAILED");
  if (existingMeasurement) {
    const recoveredCost = numberValue(existingMeasurement.actual_cost_usd);
    await client.from("cost_events").upsert({
      org_id: job.org_id,
      run_id: job.run_id,
      job_id: job.id,
      provider: job.provider,
      model: existingMeasurement.provider_model,
      amount_usd: recoveredCost,
      input_tokens: existingMeasurement.input_tokens,
      output_tokens: existingMeasurement.output_tokens,
      metadata: { cost_source: "recovered_measurement", repetition_no: job.repetition_no },
    }, { onConflict: "job_id" });
    await client.from("measurement_jobs").update({
      status: "completed",
      actual_cost_usd: recoveredCost,
      completed_at: new Date().toISOString(),
      locked_at: null,
      error_code: null,
      error_message: null,
    }).eq("id", job.id);
    await client.rpc("refresh_run_progress", { p_run_id: job.run_id });
    return;
  }

  const estimatedJobCost = numberValue(job.estimated_cost_usd);
  if (numberValue(run.actual_cost_usd) + estimatedJobCost > numberValue(run.max_cost_usd) + 1e-9) {
    throw new SafetyError("RUN_COST_CAP_REACHED", "실행 최대 비용에 도달해 추가 API 호출을 차단했습니다.");
  }

  const { data: organization, error: orgError } = await client
    .from("organizations")
    .select("monthly_budget_usd")
    .eq("id", job.org_id)
    .single();
  if (orgError || !organization) throw new Error("ORG_NOT_FOUND");

  const { data: usageRows, error: usageError } = await client.rpc("get_org_usage", { p_org_id: job.org_id });
  if (usageError) throw new Error("USAGE_CHECK_FAILED");
  const monthlyActual = numberValue(usageRows?.[0]?.monthly_actual_cost_usd);
  if (monthlyActual + estimatedJobCost > numberValue(organization.monthly_budget_usd) + 1e-9) {
    throw new SafetyError("MONTHLY_BUDGET_REACHED", "조직 월 예산에 도달해 추가 API 호출을 차단했습니다.");
  }

  let question: {
    id?: string;
    org_id?: string;
    prompt_text: string;
    language: string;
    country_code?: string | null;
    region?: string | null;
    city?: string | null;
    data_class: "public" | "restricted" | "confidential";
    active: boolean;
  };

  if (experimentSnapshot && snapshotQuestion) {
    question = {
      id: snapshotQuestion.id,
      org_id: job.org_id,
      prompt_text: snapshotQuestion.prompt_text,
      language: snapshotQuestion.language,
      country_code: snapshotQuestion.country_code,
      region: snapshotQuestion.region,
      city: snapshotQuestion.city,
      data_class: snapshotQuestion.data_class as "public",
      active: snapshotQuestion.active,
    };
  } else {
    const { data: liveQuestion, error: questionError } = await client
      .from("questions")
      .select("id,org_id,prompt_text,language,country_code,region,city,data_class,active")
      .eq("id", job.question_id)
      .eq("org_id", job.org_id)
      .single();
    if (questionError || !liveQuestion) throw new Error("QUESTION_NOT_FOUND");
    question = liveQuestion;
  }

  const { data: settingData, error: settingError } = await client
    .from("provider_settings")
    .select("org_id,provider,enabled,model_name,search_context_size,estimated_cost_per_request_usd,paid_account_confirmed,terms_reviewed,terms_version,terms_reviewed_at,terms_reviewed_by,automated_benchmark_approved,approval_reference,config")
    .eq("org_id", job.org_id)
    .eq("provider", job.provider)
    .single();
  if (settingError || !settingData) throw new Error("PROVIDER_SETTINGS_NOT_FOUND");
  const setting = settingData as ProviderSettingRow;
  if (!setting.enabled) throw new Error("PROVIDER_DISABLED");
  const policyBlock = getProviderAutomationBlock(setting);
  if (policyBlock) throw new SafetyError(policyBlock.code, policyBlock.message);

  if (experimentSnapshot && !setting.paid_account_confirmed) {
    throw new SafetyError("PAID_NOT_CONFIRMED", "실험 측정은 유료 API 계정 확인이 필요합니다.");
  }

  const requestSetting: ProviderSettingRow = {
    ...setting,
    model_name: job.provider_model,
    ...(experimentSnapshot
      ? {
        search_context_size: experimentSnapshot.planned.search_context_size,
        estimated_cost_per_request_usd: numberValue(job.estimated_cost_usd),
      }
      : {}),
  };
  const approvedRequest = buildApprovedProviderRequest(question, requestSetting);

  let businesses: BusinessForParsing[];

  if (experimentSnapshot) {
    businesses = [
      toBusiness(experimentSnapshot.parsing_context.target as unknown as Record<string, unknown>, true),
      ...experimentSnapshot.parsing_context.competitors.map((business) =>
        toBusiness(business as unknown as Record<string, unknown>, false)
      ),
    ];
  } else {
    const { data: target, error: targetError } = await client
      .from("businesses")
      .select("id,name,aliases,official_domains,website_url")
      .eq("id", run.business_id)
      .eq("org_id", job.org_id)
      .eq("active", true)
      .single();
    if (targetError || !target) throw new Error("TARGET_BUSINESS_NOT_FOUND");

    const { data: links, error: linksError } = await client
      .from("business_competitors")
      .select("competitor_business_id")
      .eq("org_id", job.org_id)
      .eq("target_business_id", run.business_id)
      .eq("active", true);
    if (linksError) throw new Error("COMPETITOR_LINKS_FAILED");

    const competitorIds = (links ?? []).map((link) => link.competitor_business_id);
    let competitors: Record<string, unknown>[] = [];
    if (competitorIds.length > 0) {
      const { data, error } = await client
        .from("businesses")
        .select("id,name,aliases,official_domains,website_url")
        .eq("org_id", job.org_id)
        .eq("active", true)
        .in("id", competitorIds);
      if (error) throw new Error("COMPETITOR_LOAD_FAILED");
      competitors = (data ?? []) as Record<string, unknown>[];
    }

    businesses = [
      toBusiness(target as Record<string, unknown>, true),
      ...competitors.map((business) => toBusiness(business, false)),
    ];
  }

  const providerResult = await callProvider(job.provider, approvedRequest);
  const responseText = providerResult.text.slice(0, MAX_RESPONSE_CHARS);
  const parsed = parseMeasurement(responseText, providerResult.sources, businesses, {
    region: question.region ?? null,
    city: question.city ?? null,
  });
  const answerFingerprint = await sha256Hex(responseText);
  const actualCostUsd = Math.max(0, numberValue(providerResult.actualCostUsd));
  const now = new Date().toISOString();

  const { data: measurement, error: measurementError } = await client
    .from("measurements")
    .upsert({
      job_id: job.id,
      org_id: job.org_id,
      run_id: job.run_id,
      question_id: job.question_id,
      provider: job.provider,
      provider_model: providerResult.model,
      response_text: responseText,
      was_client_mentioned: parsed.wasClientMentioned,
      client_position: parsed.clientPosition ?? null,
      client_domain_cited: parsed.clientDomainCited,
      valid: parsed.valid,
      invalid_reason: parsed.invalidReason ?? null,
      parser_version: PARSER_VERSION,
      parse_confidence: parsed.parseConfidence,
      manual_review_required: parsed.manualReviewRequired,
      provider_request_id: providerResult.requestId ?? null,
      input_tokens: providerResult.usage.inputTokens ?? null,
      output_tokens: providerResult.usage.outputTokens ?? null,
      actual_cost_usd: actualCostUsd,
      answer_fingerprint: answerFingerprint,
      observed_at: now,
    }, { onConflict: "job_id" })
    .select("id")
    .single();
  if (measurementError || !measurement) throw new Error(`MEASUREMENT_SAVE_FAILED:${measurementError?.message ?? "unknown"}`);

  await client.from("measurement_mentions").delete().eq("measurement_id", measurement.id);

  const resolutionRowsByKey = new Map<string, Record<string, unknown>>();
  for (const resolution of parsed.entityResolutions) {
    const matchedBusinessId = resolution.matchedBusinessId ?? null;
    const displayName = String(resolution.displayName).trim();
    if (!displayName) continue;

    const normalizedName = displayName
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");

    const key = matchedBusinessId
      ? `business:${matchedBusinessId}`
      : `name:${normalizedName}`;

    const nextRow: Record<string, unknown> = {
      org_id: job.org_id,
      measurement_id: measurement.id,
      matched_business_id: matchedBusinessId,
      display_name: displayName,
      matched_alias: resolution.matchedAlias ?? null,
      position: resolution.position,
      explicit_rank: Boolean(resolution.explicitRank),
      confidence: resolution.specificityConfidence ?? "low",
      entity_kind: resolution.entityKind,
      specificity: resolution.specificity,
      resolution_confidence: resolution.specificityConfidence,
      count_as_confirmed_business: Boolean(resolution.countAsConfirmedBusiness),
      resolution_evidence: resolution.evidence ?? {},
    };

    const existing = resolutionRowsByKey.get(key);
    if (!existing || Number(nextRow.position) < Number(existing.position)) {
      resolutionRowsByKey.set(key, nextRow);
    }
  }

  const resolutionRows = [...resolutionRowsByKey.values()];
  if (resolutionRows.length > 0) {
    const { error } = await client.from("measurement_mentions").insert(resolutionRows);
    if (error) throw new Error(`MENTIONS_SAVE_FAILED:${error.message}`);
  }

  await client.from("measurement_sources").delete().eq("measurement_id", measurement.id);
  if (providerResult.sources.length > 0) {
    const { error } = await client.from("measurement_sources").insert(providerResult.sources.slice(0, 100).map((source) => ({
      org_id: job.org_id,
      measurement_id: measurement.id,
      url: source.url,
      domain: source.domain ?? normalizeDomain(source.url) ?? null,
      title: source.title ?? null,
    })));
    if (error) throw new Error(`SOURCES_SAVE_FAILED:${error.message}`);
  }

  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  const { error: payloadError } = await client.from("provider_payloads").upsert({
    job_id: job.id,
    org_id: job.org_id,
    request_payload_redacted: providerResult.requestPayloadRedacted,
    response_payload: boundedRawPayload(providerResult.rawPayload),
    expires_at: expiresAt,
  }, { onConflict: "job_id" });
  if (payloadError) throw new Error(`PAYLOAD_SAVE_FAILED:${payloadError.message}`);

  const { error: costError } = await client.from("cost_events").upsert({
    org_id: job.org_id,
    run_id: job.run_id,
    job_id: job.id,
    provider: job.provider,
    model: providerResult.model,
    amount_usd: actualCostUsd,
    input_tokens: providerResult.usage.inputTokens ?? null,
    output_tokens: providerResult.usage.outputTokens ?? null,
    metadata: {
      cost_source: providerResult.usage.actualCostUsd != null ? "provider" : "configured_estimate",
      repetition_no: job.repetition_no,
    },
  }, { onConflict: "job_id" });
  if (costError) throw new Error(`COST_SAVE_FAILED:${costError.message}`);

  const { error: completeError } = await client.from("measurement_jobs").update({
    status: "completed",
    actual_cost_usd: actualCostUsd,
    completed_at: now,
    locked_at: null,
    error_code: null,
    error_message: null,
  }).eq("id", job.id);
  if (completeError) throw new Error(`JOB_COMPLETE_FAILED:${completeError.message}`);

  await client.rpc("refresh_run_progress", { p_run_id: job.run_id });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

  const configuredSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-internal-secret") ?? "";
  if (!constantTimeEquals(configuredSecret, suppliedSecret)) {
    return jsonResponse({ error: "FORBIDDEN" }, 403);
  }

  const { url: supabaseUrl, secretKey: serviceRoleKey } = getSupabaseRuntimeEnv();
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "SERVER_NOT_CONFIGURED" }, 500);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const batchSize = Math.max(1, Math.min(10, Number(Deno.env.get("PROCESS_BATCH_SIZE")) || 3));
  const retentionDays = Math.max(1, Math.min(30, Number(Deno.env.get("RAW_PAYLOAD_RETENTION_DAYS")) || 7));

  const { data: claimedData, error: claimError } = await serviceClient.rpc("claim_measurement_jobs", { p_limit: batchSize });
  if (claimError) {
    console.error(JSON.stringify({ function: "process-measurement-job", code: "CLAIM_FAILED", message: safeErrorMessage(claimError) }));
    return jsonResponse({ error: "CLAIM_FAILED", message: safeErrorMessage(claimError) }, 500);
  }

  const jobs = (claimedData ?? []) as ClaimedJob[];
  const summary = { claimed: jobs.length, completed: 0, retried: 0, failed: 0 };

  for (const job of jobs) {
    try {
      await processJob(serviceClient, job, retentionDays);
      summary.completed += 1;
    } catch (error) {
      const result = await markFailedOrRetry(serviceClient, job, error);
      summary[result] += 1;
      console.error(JSON.stringify({
        function: "process-measurement-job",
        job_id: job.id,
        provider: job.provider,
        code: errorCode(error),
        message: safeErrorMessage(error),
      }));
    }
  }

  return jsonResponse({ ok: true, ...summary });
});
