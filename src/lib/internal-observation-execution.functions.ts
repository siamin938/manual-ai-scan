import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CUSTOMER_RUN_REPETITIONS,
  CUSTOMER_STANDARD_QUESTION_COUNT,
  calcEstimatedCostUsd,
  calcInternalMaxCostUsd,
  calcPlannedJobs,
  checkUsageAllowance,
} from "@/lib/customer-measurement.helpers";
import { createCustomerMeasurementRun } from "@/lib/customer-measurement.server";
import {
  hasUnifiedDiagnosticIntentShape,
  isUnifiedDiagnosticSetName,
} from "@/lib/custom-question-suggestions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const WRITE_ROLES = new Set(["owner", "admin", "analyst"]);

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  update: (values: unknown) => LooseQuery;
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

export type InternalObservationExecutionBlocker =
  | "ITEM_NOT_READY"
  | "INTERNAL_OBSERVATION_ORG_REQUIRED"
  | "BUSINESS_NOT_AVAILABLE"
  | "QUESTION_SET_NOT_AVAILABLE"
  | "INVALID_QUESTION_CONTRACT"
  | "PROVIDER_NOT_READY"
  | "NO_MEASUREMENT_CREDIT"
  | "OPERATOR_MEMBERSHIP_REQUIRED"
  | "SAME_CONDITION_RUN_ACTIVE"
  | "CONCURRENT_RUN_LIMIT"
  | "DAILY_PIPELINE_RUN_LIMIT"
  | "DAILY_USAGE_LIMIT"
  | "MONTHLY_USAGE_LIMIT"
  | "PLAN_NOT_AVAILABLE";

export type InternalObservationExecutionPlanDTO = {
  version: "0.2";
  generatedAt: string;
  planHash: string;
  itemId: string;
  orgId: string;
  orgName: string;
  businessId: string;
  businessName: string;
  questionSetId: string;
  questionSetName: string;
  provider: "OpenAI";
  repetitions: 1;
  plannedJobs: number;
  estimatedCostUsd: number;
  maxCostUsd: number;
  creditBefore: number;
  creditAfter: number;
  dailyRequestsUsed: number;
  dailyRequestLimit: number;
  projectedDailyRequests: number;
  monthlyActualCostUsd: number;
  monthlyReservedCostUsd: number;
  monthlyBudgetUsd: number;
  projectedMonthlyCostUsd: number;
  pipelineRunsToday: number;
  dailyPipelineRunLimit: number;
  activeRunCount: number;
  concurrentRunLimit: number;
  automaticExecutionEnabled: boolean;
  operatorRole: string | null;
  sameConditionRun: { runId: string; status: string } | null;
  blockers: InternalObservationExecutionBlocker[];
  canApprove: boolean;
};

export type PreviewInternalObservationExecutionPlanResult =
  | { ok: true; plan: InternalObservationExecutionPlanDTO }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

export type ApproveInternalObservationExecutionResult =
  | {
      ok: true;
      runId: string;
      plannedJobs: number;
      reusedExistingRun: boolean;
    }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "PLAN_CHANGED"
        | "PLAN_BLOCKED"
        | "RUN_START_FAILED"
        | "NOT_AVAILABLE";
      code?: string;
      plan?: InternalObservationExecutionPlanDTO;
    };

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

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

async function buildExecutionPlan(args: {
  itemId: string;
  userId: string;
}): Promise<InternalObservationExecutionPlanDTO | null> {
  const { data: itemRaw, error: itemError } = await admin
    .from("internal_observation_pipeline_items")
    .select("*")
    .eq("id", args.itemId)
    .maybeSingle();

  if (itemError || !isRecord(itemRaw)) return null;

  const itemStatus = str(itemRaw["status"]);
  const orgId = str(itemRaw["org_id"]);
  const businessId = str(itemRaw["business_id"]);
  const questionSetId = str(itemRaw["question_set_id"]);
  const itemUpdatedAt = str(itemRaw["updated_at"]);
  if (!orgId || !businessId || !questionSetId || !itemUpdatedAt) return null;

  const [
    orgRes,
    businessRes,
    setRes,
    questionsRes,
    providerRes,
    creditRes,
    settingsRes,
    membershipRes,
    usageRes,
    activeRunsRes,
    sameConditionRes,
    dailyPipelineRes,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, measurement_data_origin, daily_request_limit, monthly_budget_usd")
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("businesses")
      .select("id, name, active, is_client_business")
      .eq("id", businessId)
      .eq("org_id", orgId)
      .maybeSingle(),
    admin
      .from("question_sets")
      .select("id, name, active")
      .eq("id", questionSetId)
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("questions")
      .select("id, intent_type, data_class, active")
      .eq("org_id", orgId)
      .eq("question_set_id", questionSetId)
      .eq("active", true),
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
      .select("execution_enabled, daily_run_limit, concurrent_run_limit")
      .eq("org_id", orgId)
      .maybeSingle(),
    admin
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", args.userId)
      .maybeSingle(),
    admin.rpc("get_org_usage", { p_org_id: orgId }),
    admin
      .from("measurement_runs")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .in("status", ["queued", "running"]),
    admin
      .from("measurement_runs")
      .select("id, status, created_at")
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("question_set_id", questionSetId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .eq("diagnostic_scope", "customer")
      .in("status", ["draft", "queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("internal_observation_pipeline_items")
      .select("id")
      .eq("org_id", orgId)
      .gte("measurement_approved_at", seoulDayStartIso()),
  ]);

  if (
    orgRes.error ||
    businessRes.error ||
    setRes.error ||
    questionsRes.error ||
    providerRes.error ||
    creditRes.error ||
    settingsRes.error ||
    membershipRes.error ||
    usageRes.error ||
    activeRunsRes.error ||
    sameConditionRes.error ||
    dailyPipelineRes.error ||
    !isRecord(orgRes.data) ||
    !isRecord(businessRes.data) ||
    !isRecord(setRes.data)
  ) {
    return null;
  }

  const orgName = str(orgRes.data["name"]) ?? "";
  const businessName = str(businessRes.data["name"]) ?? "";
  const questionSetName = str(setRes.data["name"]) ?? "";
  if (!orgName || !businessName || !questionSetName) return null;

  const questionRows = Array.isArray(questionsRes.data) ? questionsRes.data : [];
  const intentTypes = questionRows
    .map((row) => (isRecord(row) ? str(row["intent_type"]) : null))
    .filter((value): value is string => !!value);

  const providerRow = isRecord(providerRes.data) ? providerRes.data : {};
  const providerReady =
    providerRow["enabled"] === true &&
    providerRow["paid_account_confirmed"] === true &&
    providerRow["terms_reviewed"] === true &&
    providerRow["automated_benchmark_approved"] === true;

  const estimatedPerRequestUsd = num(providerRow["estimated_cost_per_request_usd"]) ?? 0;
  const plannedJobs = calcPlannedJobs(questionRows.length);
  const estimatedCostUsd = calcEstimatedCostUsd(estimatedPerRequestUsd, plannedJobs);
  const maxCostUsd = calcInternalMaxCostUsd(estimatedCostUsd);

  const creditRow = isRecord(creditRes.data) ? creditRes.data : {};
  const creditBefore = Math.max(0, Math.trunc(num(creditRow["balance"]) ?? 0));

  const settingsRow = isRecord(settingsRes.data) ? settingsRes.data : {};
  const automaticExecutionEnabled = settingsRow["execution_enabled"] === true;
  const dailyPipelineRunLimit = Math.max(
    1,
    Math.trunc(num(settingsRow["daily_run_limit"]) ?? 5),
  );
  const concurrentRunLimit = Math.max(
    1,
    Math.trunc(num(settingsRow["concurrent_run_limit"]) ?? 1),
  );

  const membershipRow = isRecord(membershipRes.data) ? membershipRes.data : {};
  const operatorRole = str(membershipRow["role"]);

  const usageRaw = Array.isArray(usageRes.data) ? usageRes.data[0] : usageRes.data;
  const usageRow = isRecord(usageRaw) ? usageRaw : {};
  const dailyRequestsUsed = Math.max(0, Math.trunc(num(usageRow["daily_requests"]) ?? 0));
  const monthlyActualCostUsd = Math.max(0, num(usageRow["monthly_actual_cost_usd"]) ?? 0);
  const monthlyReservedCostUsd = Math.max(0, num(usageRow["monthly_reserved_cost_usd"]) ?? 0);

  const dailyRequestLimit = Math.max(
    0,
    Math.trunc(num(orgRes.data["daily_request_limit"]) ?? 0),
  );
  const monthlyBudgetUsd = Math.max(0, num(orgRes.data["monthly_budget_usd"]) ?? 0);

  const activeRunRows = Array.isArray(activeRunsRes.data) ? activeRunsRes.data : [];
  const activeRunCount = activeRunRows.length;
  const dailyPipelineRows = Array.isArray(dailyPipelineRes.data)
    ? dailyPipelineRes.data
    : [];
  const pipelineRunsToday = dailyPipelineRows.length;

  const sameConditionRaw = sameConditionRes.data;
  const sameConditionRun =
    isRecord(sameConditionRaw) && str(sameConditionRaw["id"]) && str(sameConditionRaw["status"])
      ? {
          runId: str(sameConditionRaw["id"])!,
          status: str(sameConditionRaw["status"])!,
        }
      : null;

  const blockers: InternalObservationExecutionBlocker[] = [];

  if (
    itemStatus !== "ready_to_measure" ||
    itemRaw["run_id"] !== null ||
    itemRaw["measurement_approved_at"] !== null
  ) {
    blockers.push("ITEM_NOT_READY");
  }
  if (orgRes.data["measurement_data_origin"] !== "internal_observation") {
    blockers.push("INTERNAL_OBSERVATION_ORG_REQUIRED");
  }
  if (businessRes.data["active"] !== true || businessRes.data["is_client_business"] !== true) {
    blockers.push("BUSINESS_NOT_AVAILABLE");
  }
  if (setRes.data["active"] !== true || !isUnifiedDiagnosticSetName(questionSetName)) {
    blockers.push("QUESTION_SET_NOT_AVAILABLE");
  }
  if (
    questionRows.length !== CUSTOMER_STANDARD_QUESTION_COUNT ||
    !hasUnifiedDiagnosticIntentShape(intentTypes) ||
    questionRows.some(
      (row) => !isRecord(row) || row["data_class"] !== "public" || row["active"] !== true,
    )
  ) {
    blockers.push("INVALID_QUESTION_CONTRACT");
  }
  if (!providerReady) blockers.push("PROVIDER_NOT_READY");
  if (creditBefore < 1) blockers.push("NO_MEASUREMENT_CREDIT");
  if (!operatorRole || !WRITE_ROLES.has(operatorRole)) {
    blockers.push("OPERATOR_MEMBERSHIP_REQUIRED");
  }
  if (sameConditionRun) blockers.push("SAME_CONDITION_RUN_ACTIVE");
  if (activeRunCount >= concurrentRunLimit) blockers.push("CONCURRENT_RUN_LIMIT");
  if (pipelineRunsToday >= dailyPipelineRunLimit) blockers.push("DAILY_PIPELINE_RUN_LIMIT");

  const usageLimitError = checkUsageAllowance({
    usage: {
      dailyRequests: dailyRequestsUsed,
      monthlyActualCostUsd,
      monthlyReservedCostUsd,
    },
    limits: {
      dailyRequestLimit,
      monthlyBudgetUsd,
    },
    plannedJobs,
    maxCostUsd,
  });
  if (usageLimitError === "DAILY_USAGE_LIMIT") blockers.push("DAILY_USAGE_LIMIT");
  if (usageLimitError === "MONTHLY_USAGE_LIMIT") blockers.push("MONTHLY_USAGE_LIMIT");

  const projectedDailyRequests = dailyRequestsUsed + plannedJobs;
  const projectedMonthlyCostUsd =
    Math.round(
      (monthlyActualCostUsd + monthlyReservedCostUsd + maxCostUsd) * 1e6,
    ) / 1e6;

  const fingerprint = {
    version: "0.2",
    itemId: args.itemId,
    itemUpdatedAt,
    orgId,
    businessId,
    questionSetId,
    questionCount: questionRows.length,
    intents: [...intentTypes].sort(),
    providerReady,
    estimatedPerRequestUsd,
    creditBefore,
    automaticExecutionEnabled,
    dailyPipelineRunLimit,
    concurrentRunLimit,
    operatorRole,
    dailyRequestsUsed,
    dailyRequestLimit,
    monthlyActualCostUsd,
    monthlyReservedCostUsd,
    monthlyBudgetUsd,
    activeRunCount,
    pipelineRunsToday,
    sameConditionRun,
    blockers,
  };

  return {
    version: "0.2",
    generatedAt: new Date().toISOString(),
    planHash: stableHash(fingerprint),
    itemId: args.itemId,
    orgId,
    orgName,
    businessId,
    businessName,
    questionSetId,
    questionSetName,
    provider: "OpenAI",
    repetitions: CUSTOMER_RUN_REPETITIONS,
    plannedJobs,
    estimatedCostUsd,
    maxCostUsd,
    creditBefore,
    creditAfter: Math.max(0, creditBefore - 1),
    dailyRequestsUsed,
    dailyRequestLimit,
    projectedDailyRequests,
    monthlyActualCostUsd,
    monthlyReservedCostUsd,
    monthlyBudgetUsd,
    projectedMonthlyCostUsd,
    pipelineRunsToday,
    dailyPipelineRunLimit,
    activeRunCount,
    concurrentRunLimit,
    automaticExecutionEnabled,
    operatorRole,
    sameConditionRun,
    blockers,
    canApprove: blockers.length === 0,
  };
}

export const previewInternalObservationExecutionPlan = createServerFn({
  method: "POST",
})
  .inputValidator((input: { itemId: string }) => {
    if (!input || typeof input.itemId !== "string" || !UUID_RE.test(input.itemId.trim())) {
      throw new Error("INVALID_INPUT");
    }
    return { itemId: input.itemId.trim().toLowerCase() };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<PreviewInternalObservationExecutionPlanResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const plan = await buildExecutionPlan({
      itemId: data.itemId,
      userId: context.userId,
    });
    if (!plan) return { ok: false, error: "NOT_AVAILABLE" };
    return { ok: true, plan };
  });

export const approveInternalObservationExecution = createServerFn({
  method: "POST",
})
  .inputValidator((input: { itemId: string; planHash: string }) => {
    if (
      !input ||
      typeof input.itemId !== "string" ||
      !UUID_RE.test(input.itemId.trim()) ||
      typeof input.planHash !== "string" ||
      !/^[0-9a-f]{64}$/iu.test(input.planHash.trim())
    ) {
      throw new Error("INVALID_INPUT");
    }
    return {
      itemId: input.itemId.trim().toLowerCase(),
      planHash: input.planHash.trim().toLowerCase(),
    };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ApproveInternalObservationExecutionResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const plan = await buildExecutionPlan({
      itemId: data.itemId,
      userId: context.userId,
    });
    if (!plan) return { ok: false, error: "NOT_AVAILABLE" };

    if (plan.planHash !== data.planHash) {
      return { ok: false, error: "PLAN_CHANGED", plan };
    }
    if (!plan.canApprove) {
      return { ok: false, error: "PLAN_BLOCKED", plan };
    }

    const approvedAt = new Date().toISOString();
    const { data: claimedRaw, error: claimError } = await admin
      .from("internal_observation_pipeline_items")
      .update({
        status: "measuring",
        measurement_approved_at: approvedAt,
        measurement_approved_by: context.userId,
        error_code: null,
        error_message: null,
        updated_at: approvedAt,
      })
      .eq("id", plan.itemId)
      .eq("status", "ready_to_measure")
      .select("id")
      .maybeSingle();

    if (claimError || !isRecord(claimedRaw) || !str(claimedRaw["id"])) {
      const refreshedPlan = await buildExecutionPlan({
        itemId: data.itemId,
        userId: context.userId,
      });
      return {
        ok: false,
        error: "PLAN_CHANGED",
        ...(refreshedPlan ? { plan: refreshedPlan } : {}),
      };
    }

    const beforeRunsRes = await admin
      .from("measurement_runs")
      .select("id")
      .eq("org_id", plan.orgId)
      .eq("business_id", plan.businessId)
      .eq("question_set_id", plan.questionSetId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .eq("diagnostic_scope", "customer")
      .in("status", ["draft", "queued", "running"]);

    const beforeRunIds = new Set(
      (Array.isArray(beforeRunsRes.data) ? beforeRunsRes.data : [])
        .map((row) => (isRecord(row) ? str(row["id"]) : null))
        .filter((id): id is string => !!id),
    );

    const runResult = await createCustomerMeasurementRun({
      supabase: context.supabase,
      userId: context.userId,
      orgId: plan.orgId,
      businessId: plan.businessId,
      questionSetId: plan.questionSetId,
      name: `내부 관찰 · ${plan.businessName} · ${seoulDateSlug()}`,
    });

    if (!runResult.ok) {
      await admin
        .from("internal_observation_pipeline_items")
        .update({
          status: "ready_to_measure",
          measurement_approved_at: null,
          measurement_approved_by: null,
          error_code: runResult.error,
          error_message: "실행 승인 직후 조건이 바뀌어 측정을 시작하지 못했습니다.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", plan.itemId)
        .eq("status", "measuring");

      return {
        ok: false,
        error: "RUN_START_FAILED",
        code: runResult.error,
      };
    }

    const reusedExistingRun = beforeRunIds.has(runResult.runId);
    const linkedAt = new Date().toISOString();
    const { error: linkError } = await admin
      .from("internal_observation_pipeline_items")
      .update({
        run_id: runResult.runId,
        status: "measuring",
        readiness: {
          reason: null,
          creditBalance: plan.creditAfter,
          providerReady: true,
          executionEnabled: plan.automaticExecutionEnabled,
          dailyRunLimit: plan.dailyPipelineRunLimit,
          concurrentRunLimit: plan.concurrentRunLimit,
          activeRunCount: plan.activeRunCount + (reusedExistingRun ? 0 : 1),
        },
        error_code: null,
        error_message: null,
        updated_at: linkedAt,
      })
      .eq("id", plan.itemId)
      .eq("status", "measuring");

    if (linkError) {
      return {
        ok: false,
        error: "NOT_AVAILABLE",
        code: "PIPELINE_LINK_FAILED",
      };
    }

    return {
      ok: true,
      runId: runResult.runId,
      plannedJobs: runResult.plannedJobs,
      reusedExistingRun,
    };
  });
