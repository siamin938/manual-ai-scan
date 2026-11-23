import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CUSTOMER_STANDARD_QUESTION_COUNT,
  calcEstimatedCostUsd,
  calcInternalMaxCostUsd,
  calcPlannedJobs,
} from "@/lib/customer-measurement.helpers";
import {
  hasUnifiedDiagnosticIntentShape,
  isUnifiedDiagnosticSetName,
} from "@/lib/custom-question-suggestions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: unknown[]) => LooseQuery;
  gte: (column: string, value: unknown) => LooseQuery;
  order: (column: string, options?: unknown) => LooseQuery;
  limit: (count: number) => LooseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

type LooseAdmin = {
  from: (table: string) => LooseQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const admin = supabaseAdmin as unknown as LooseAdmin;

export type InternalObservationSchedulerBlocker =
  | "CANDIDATE_DATA_INVALID"
  | "BUSINESS_NOT_AVAILABLE"
  | "QUESTION_SET_NOT_AVAILABLE"
  | "INVALID_QUESTION_CONTRACT"
  | "SAME_CONDITION_RUN_ACTIVE"
  | "PROVIDER_NOT_READY"
  | "NO_MEASUREMENT_CREDIT"
  | "DAILY_PIPELINE_RUN_LIMIT"
  | "DAILY_USAGE_LIMIT"
  | "MONTHLY_USAGE_LIMIT";

export type InternalObservationSchedulerCandidateDTO = {
  itemId: string;
  businessId: string | null;
  businessName: string;
  questionSetId: string | null;
  questionSetName: string | null;
  service: string;
  region: string;
  city: string | null;
  preparedAt: string | null;
  createdAt: string;
  plannedJobs: number;
  estimatedCostUsd: number;
  maxCostUsd: number;
  sequence: number | null;
  dispatchNow: boolean;
  planned: boolean;
  creditBalanceAfter: number | null;
  projectedDailyRequestsAfter: number | null;
  projectedMonthlyCostUsdAfter: number | null;
  blockers: InternalObservationSchedulerBlocker[];
};

export type InternalObservationSchedulerDryRunDTO = {
  version: "0.4-dry-run";
  generatedAt: string;
  dryRunOnly: true;
  policy: "oldest_ready_first";
  orgId: string;
  orgName: string;
  automaticExecutionEnabled: boolean;
  schedulerActorConfigured: boolean;
  lastSchedulerTickAt: string | null;
  lastSchedulerResult: string | null;
  providerReady: boolean;
  creditBalance: number;
  dailyRunLimit: number;
  pipelineRunsToday: number;
  dailySlotsRemaining: number;
  concurrentRunLimit: number;
  activeRunCount: number;
  dispatchSlotsNow: number;
  dailyRequestsUsed: number;
  dailyRequestLimit: number;
  monthlyActualCostUsd: number;
  monthlyReservedCostUsd: number;
  monthlyBudgetUsd: number;
  readyCandidateCount: number;
  plannedCandidateCount: number;
  excludedCandidateCount: number;
  dispatchNowCount: number;
  plannedJobsTotal: number;
  estimatedCostUsdTotal: number;
  maxCostUsdTotal: number;
  plannedCreditBalanceAfter: number;
  projectedDailyRequestsAfter: number;
  projectedMonthlyCostUsdAfter: number;
  candidates: InternalObservationSchedulerCandidateDTO[];
};

export type GetInternalObservationSchedulerDryRunResult =
  | { ok: true; plan: InternalObservationSchedulerDryRunDTO }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function seoulDateSlug(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function seoulDayStartIso(date = new Date()): string {
  return new Date(`${seoulDateSlug(date)}T00:00:00+09:00`).toISOString();
}

function rounded(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

export async function buildInternalObservationSchedulerDryRun(
  orgId: string,
): Promise<InternalObservationSchedulerDryRunDTO | null> {
  const [
    orgRes,
    providerRes,
    creditRes,
    settingsRes,
    usageRes,
    activeRunsRes,
    dailyPipelineRes,
    candidatesRes,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, measurement_data_origin, daily_request_limit, monthly_budget_usd")
      .eq("id", orgId)
      .eq("measurement_data_origin", "internal_observation")
      .maybeSingle(),
    admin
      .from("provider_settings")
      .select(
        "enabled, estimated_cost_per_request_usd, paid_account_confirmed, terms_reviewed, automated_benchmark_approved",
      )
      .eq("org_id", orgId)
      .eq("provider", "openai")
      .maybeSingle(),
    admin
      .from("measurement_credit_accounts")
      .select("balance")
      .eq("org_id", orgId)
      .maybeSingle(),
    admin
      .from("internal_observation_pipeline_settings")
      .select("execution_enabled, daily_run_limit, concurrent_run_limit, scheduler_actor_user_id, last_scheduler_tick_at, last_scheduler_result")
      .eq("org_id", orgId)
      .maybeSingle(),
    admin.rpc("get_org_usage", { p_org_id: orgId }),
    admin
      .from("measurement_runs")
      .select("id, business_id, question_set_id, status")
      .eq("org_id", orgId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .in("status", ["queued", "running"]),
    admin
      .from("internal_observation_pipeline_items")
      .select("id")
      .eq("org_id", orgId)
      .gte("measurement_approved_at", seoulDayStartIso()),
    admin
      .from("internal_observation_pipeline_items")
      .select(
        "id, business_id, business_name, question_set_id, service, region, city, prepared_at, created_at",
      )
      .eq("org_id", orgId)
      .eq("status", "ready_to_measure")
      .order("prepared_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (
    orgRes.error ||
    providerRes.error ||
    creditRes.error ||
    settingsRes.error ||
    usageRes.error ||
    activeRunsRes.error ||
    dailyPipelineRes.error ||
    candidatesRes.error ||
    !isRecord(orgRes.data)
  ) {
    return null;
  }

  const orgName = str(orgRes.data["name"]);
  if (!orgName) return null;

  const providerRow = isRecord(providerRes.data) ? providerRes.data : {};
  const providerReady =
    providerRow["enabled"] === true &&
    providerRow["paid_account_confirmed"] === true &&
    providerRow["terms_reviewed"] === true &&
    providerRow["automated_benchmark_approved"] === true;
  const estimatedPerRequestUsd = Math.max(
    0,
    num(providerRow["estimated_cost_per_request_usd"]) ?? 0,
  );

  const creditRow = isRecord(creditRes.data) ? creditRes.data : {};
  const creditBalance = Math.max(0, Math.trunc(num(creditRow["balance"]) ?? 0));

  const settingsRow = isRecord(settingsRes.data) ? settingsRes.data : {};
  const automaticExecutionEnabled = settingsRow["execution_enabled"] === true;
  const schedulerActorConfigured = !!str(settingsRow["scheduler_actor_user_id"]);
  const lastSchedulerTickAt = str(settingsRow["last_scheduler_tick_at"]);
  const lastSchedulerResult = str(settingsRow["last_scheduler_result"]);
  const dailyRunLimit = Math.max(1, Math.trunc(num(settingsRow["daily_run_limit"]) ?? 5));
  const concurrentRunLimit = Math.max(
    1,
    Math.trunc(num(settingsRow["concurrent_run_limit"]) ?? 1),
  );

  const usageRaw = Array.isArray(usageRes.data) ? usageRes.data[0] : usageRes.data;
  const usageRow = isRecord(usageRaw) ? usageRaw : {};
  const dailyRequestsUsed = Math.max(0, Math.trunc(num(usageRow["daily_requests"]) ?? 0));
  const monthlyActualCostUsd = Math.max(0, num(usageRow["monthly_actual_cost_usd"]) ?? 0);
  const monthlyReservedCostUsd = Math.max(
    0,
    num(usageRow["monthly_reserved_cost_usd"]) ?? 0,
  );
  const dailyRequestLimit = Math.max(
    0,
    Math.trunc(num(orgRes.data["daily_request_limit"]) ?? 0),
  );
  const monthlyBudgetUsd = Math.max(0, num(orgRes.data["monthly_budget_usd"]) ?? 0);

  const activeRunRows = Array.isArray(activeRunsRes.data)
    ? activeRunsRes.data.filter(isRecord)
    : [];
  const activeRunCount = activeRunRows.length;
  const activeSameCondition = new Set(
    activeRunRows
      .map((row) => {
        const businessId = str(row["business_id"]);
        const questionSetId = str(row["question_set_id"]);
        return businessId && questionSetId ? `${businessId}|${questionSetId}` : null;
      })
      .filter((value): value is string => !!value),
  );

  const dailyPipelineRows = Array.isArray(dailyPipelineRes.data)
    ? dailyPipelineRes.data
    : [];
  const pipelineRunsToday = dailyPipelineRows.length;
  const dailySlotsRemaining = Math.max(0, dailyRunLimit - pipelineRunsToday);
  const dispatchSlotsNow = Math.max(0, concurrentRunLimit - activeRunCount);

  const rawCandidates = Array.isArray(candidatesRes.data)
    ? candidatesRes.data.filter(isRecord)
    : [];

  const businessIds = [
    ...new Set(
      rawCandidates
        .map((row) => str(row["business_id"]))
        .filter((value): value is string => !!value),
    ),
  ];
  const questionSetIds = [
    ...new Set(
      rawCandidates
        .map((row) => str(row["question_set_id"]))
        .filter((value): value is string => !!value),
    ),
  ];

  const [businessesRes, setsRes, questionsRes] = await Promise.all([
    businessIds.length
      ? admin
          .from("businesses")
          .select("id, name, active, is_client_business")
          .eq("org_id", orgId)
          .in("id", businessIds)
      : Promise.resolve({ data: [], error: null }),
    questionSetIds.length
      ? admin
          .from("question_sets")
          .select("id, name, active, business_id")
          .eq("org_id", orgId)
          .in("id", questionSetIds)
      : Promise.resolve({ data: [], error: null }),
    questionSetIds.length
      ? admin
          .from("questions")
          .select("id, question_set_id, intent_type, data_class, active")
          .eq("org_id", orgId)
          .in("question_set_id", questionSetIds)
          .eq("active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (businessesRes.error || setsRes.error || questionsRes.error) return null;

  const businessById = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(businessesRes.data) ? businessesRes.data : []) {
    if (!isRecord(row)) continue;
    const id = str(row["id"]);
    if (id) businessById.set(id, row);
  }

  const setById = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(setsRes.data) ? setsRes.data : []) {
    if (!isRecord(row)) continue;
    const id = str(row["id"]);
    if (id) setById.set(id, row);
  }

  const questionsBySetId = new Map<string, Record<string, unknown>[]>();
  for (const row of Array.isArray(questionsRes.data) ? questionsRes.data : []) {
    if (!isRecord(row)) continue;
    const setId = str(row["question_set_id"]);
    if (!setId) continue;
    const current = questionsBySetId.get(setId) ?? [];
    current.push(row);
    questionsBySetId.set(setId, current);
  }

  let simulatedCredit = creditBalance;
  let simulatedDailyRequests = dailyRequestsUsed;
  let simulatedMonthlyCost =
    monthlyActualCostUsd + monthlyReservedCostUsd;
  let usedDailySlots = 0;
  let dispatchAllocated = 0;
  let sequence = 0;

  const candidates: InternalObservationSchedulerCandidateDTO[] = [];

  for (const row of rawCandidates) {
    const itemId = str(row["id"]);
    const businessId = str(row["business_id"]);
    const businessName = str(row["business_name"]);
    const questionSetId = str(row["question_set_id"]);
    const service = str(row["service"]) ?? "";
    const region = str(row["region"]) ?? "";
    const city = str(row["city"]);
    const preparedAt = str(row["prepared_at"]);
    const createdAt = str(row["created_at"]);

    if (!itemId || !businessName || !createdAt) continue;

    const blockers: InternalObservationSchedulerBlocker[] = [];
    const business = businessId ? businessById.get(businessId) : null;
    const set = questionSetId ? setById.get(questionSetId) : null;
    const questionRows = questionSetId
      ? questionsBySetId.get(questionSetId) ?? []
      : [];

    if (!businessId || !questionSetId) {
      blockers.push("CANDIDATE_DATA_INVALID");
    }
    if (
      !business ||
      business["active"] !== true ||
      business["is_client_business"] !== true
    ) {
      blockers.push("BUSINESS_NOT_AVAILABLE");
    }

    const questionSetName = set ? str(set["name"]) : null;
    if (
      !set ||
      set["active"] !== true ||
      !questionSetName ||
      !isUnifiedDiagnosticSetName(questionSetName) ||
      (businessId && str(set["business_id"]) !== businessId)
    ) {
      blockers.push("QUESTION_SET_NOT_AVAILABLE");
    }

    const intentTypes = questionRows
      .map((question) => str(question["intent_type"]))
      .filter((value): value is string => !!value);

    if (
      questionRows.length !== CUSTOMER_STANDARD_QUESTION_COUNT ||
      !hasUnifiedDiagnosticIntentShape(intentTypes) ||
      questionRows.some(
        (question) =>
          question["data_class"] !== "public" || question["active"] !== true,
      )
    ) {
      blockers.push("INVALID_QUESTION_CONTRACT");
    }

    if (
      businessId &&
      questionSetId &&
      activeSameCondition.has(`${businessId}|${questionSetId}`)
    ) {
      blockers.push("SAME_CONDITION_RUN_ACTIVE");
    }
    if (!providerReady) blockers.push("PROVIDER_NOT_READY");

    const plannedJobs = calcPlannedJobs(questionRows.length);
    const estimatedCostUsd = calcEstimatedCostUsd(
      estimatedPerRequestUsd,
      plannedJobs,
    );
    const maxCostUsd = calcInternalMaxCostUsd(estimatedCostUsd);

    if (blockers.length === 0) {
      if (usedDailySlots >= dailySlotsRemaining) {
        blockers.push("DAILY_PIPELINE_RUN_LIMIT");
      } else if (simulatedCredit < 1) {
        blockers.push("NO_MEASUREMENT_CREDIT");
      } else if (
        simulatedDailyRequests + plannedJobs >
        dailyRequestLimit
      ) {
        blockers.push("DAILY_USAGE_LIMIT");
      } else if (
        simulatedMonthlyCost + maxCostUsd >
        monthlyBudgetUsd
      ) {
        blockers.push("MONTHLY_USAGE_LIMIT");
      }
    }

    const planned = blockers.length === 0;
    let creditBalanceAfter: number | null = null;
    let projectedDailyRequestsAfter: number | null = null;
    let projectedMonthlyCostUsdAfter: number | null = null;
    let dispatchNow = false;
    let candidateSequence: number | null = null;

    if (planned) {
      usedDailySlots += 1;
      sequence += 1;
      simulatedCredit -= 1;
      simulatedDailyRequests += plannedJobs;
      simulatedMonthlyCost = rounded(simulatedMonthlyCost + maxCostUsd);

      candidateSequence = sequence;
      creditBalanceAfter = simulatedCredit;
      projectedDailyRequestsAfter = simulatedDailyRequests;
      projectedMonthlyCostUsdAfter = simulatedMonthlyCost;

      if (dispatchAllocated < dispatchSlotsNow) {
        dispatchAllocated += 1;
        dispatchNow = true;
      }
    }

    candidates.push({
      itemId,
      businessId,
      businessName,
      questionSetId,
      questionSetName,
      service,
      region,
      city,
      preparedAt,
      createdAt,
      plannedJobs,
      estimatedCostUsd,
      maxCostUsd,
      sequence: candidateSequence,
      dispatchNow,
      planned,
      creditBalanceAfter,
      projectedDailyRequestsAfter,
      projectedMonthlyCostUsdAfter,
      blockers,
    });
  }

  const plannedCandidates = candidates.filter((candidate) => candidate.planned);
  return {
    version: "0.4-dry-run",
    generatedAt: new Date().toISOString(),
    dryRunOnly: true,
    policy: "oldest_ready_first",
    orgId,
    orgName,
    automaticExecutionEnabled,
    schedulerActorConfigured,
    lastSchedulerTickAt,
    lastSchedulerResult,
    providerReady,
    creditBalance,
    dailyRunLimit,
    pipelineRunsToday,
    dailySlotsRemaining,
    concurrentRunLimit,
    activeRunCount,
    dispatchSlotsNow,
    dailyRequestsUsed,
    dailyRequestLimit,
    monthlyActualCostUsd,
    monthlyReservedCostUsd,
    monthlyBudgetUsd,
    readyCandidateCount: candidates.length,
    plannedCandidateCount: plannedCandidates.length,
    excludedCandidateCount: candidates.length - plannedCandidates.length,
    dispatchNowCount: plannedCandidates.filter((candidate) => candidate.dispatchNow)
      .length,
    plannedJobsTotal: plannedCandidates.reduce(
      (sum, candidate) => sum + candidate.plannedJobs,
      0,
    ),
    estimatedCostUsdTotal: rounded(
      plannedCandidates.reduce(
        (sum, candidate) => sum + candidate.estimatedCostUsd,
        0,
      ),
    ),
    maxCostUsdTotal: rounded(
      plannedCandidates.reduce((sum, candidate) => sum + candidate.maxCostUsd, 0),
    ),
    plannedCreditBalanceAfter: simulatedCredit,
    projectedDailyRequestsAfter: simulatedDailyRequests,
    projectedMonthlyCostUsdAfter: simulatedMonthlyCost,
    candidates,
  };
}

export const getInternalObservationSchedulerDryRun = createServerFn({
  method: "POST",
})
  .inputValidator((input: { orgId: string }) => {
    if (
      !input ||
      typeof input.orgId !== "string" ||
      !UUID_RE.test(input.orgId.trim())
    ) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId: input.orgId.trim().toLowerCase() };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<GetInternalObservationSchedulerDryRunResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    try {
      const plan = await buildInternalObservationSchedulerDryRun(data.orgId);
      if (!plan) return { ok: false, error: "NOT_AVAILABLE" };
      return { ok: true, plan };
    } catch {
      return { ok: false, error: "NOT_AVAILABLE" };
    }
  });
