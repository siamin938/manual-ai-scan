import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildInternalObservationSchedulerDryRun,
  type InternalObservationSchedulerDryRunDTO,
} from "@/lib/internal-observation-scheduler.functions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACTIVATION_CONFIRM_TEXT = "자동 실행 시작" as const;
const ACTIVATION_TTL_MS = 10 * 60 * 1000;
const WRITE_ROLES = new Set(["owner", "admin", "analyst"]);

type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  insert: (values: unknown) => LooseQuery;
  update: (values: unknown) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: unknown[]) => LooseQuery;
  order: (column: string, options?: unknown) => LooseQuery;
  limit: (count: number) => LooseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

type LooseAdmin = {
  from: (table: string) => LooseQuery;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

const admin = supabaseAdmin as unknown as LooseAdmin;

export type InternalObservationSchedulerState = "off" | "paused" | "running";

export type SchedulerActivationBlocker =
  | "STATE_ALREADY_RUNNING"
  | "EXECUTOR_NOT_READY"
  | "ACTOR_NOT_CONFIGURED"
  | "CRON_NOT_AVAILABLE"
  | "NO_PLANNED_CANDIDATE"
  | "NO_DISPATCH_SLOT"
  | "OPERATOR_WRITE_ROLE_REQUIRED";

export type InternalObservationSchedulerActivationPlanDTO = {
  version: "0.6";
  generatedAt: string;
  planHash: string;
  orgId: string;
  orgName: string;
  schedulerState: InternalObservationSchedulerState;
  executionEnabled: boolean;
  executorDeployed: boolean;
  executorReady: boolean;
  schedulerActorConfigured: boolean;
  cronJobExists: boolean;
  cronActive: boolean;
  cronSchedule: string | null;
  operatorRole: string | null;
  blockers: SchedulerActivationBlocker[];
  canRequestActivation: boolean;
  confirmText: typeof ACTIVATION_CONFIRM_TEXT;
  dryRun: InternalObservationSchedulerDryRunDTO;
};

export type InternalObservationSchedulerPendingRequestDTO = {
  requestId: string;
  requestedAt: string;
  expiresAt: string;
  requestedByCurrentUser: boolean;
};

export type InternalObservationSchedulerOperationsDTO = {
  plan: InternalObservationSchedulerActivationPlanDTO;
  pendingRequest: InternalObservationSchedulerPendingRequestDTO | null;
};

export type GetSchedulerOperationsResult =
  | { ok: true; data: InternalObservationSchedulerOperationsDTO }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

export type RequestSchedulerActivationResult =
  | {
      ok: true;
      requestId: string;
      planHash: string;
      expiresAt: string;
      confirmText: typeof ACTIVATION_CONFIRM_TEXT;
    }
  | {
      ok: false;
      error: "FORBIDDEN" | "PLAN_BLOCKED" | "NOT_AVAILABLE";
      plan?: InternalObservationSchedulerActivationPlanDTO;
    };

export type ConfirmSchedulerActivationResult =
  | { ok: true; schedulerState: "running"; cronActive: true }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_CONFIRMATION"
        | "REQUEST_NOT_AVAILABLE"
        | "REQUEST_EXPIRED"
        | "PLAN_CHANGED"
        | "PLAN_BLOCKED"
        | "CRON_ACTIVATION_FAILED"
        | "NOT_AVAILABLE";
      plan?: InternalObservationSchedulerActivationPlanDTO;
    };

export type SchedulerControlResult =
  | {
      ok: true;
      schedulerState: "paused" | "off";
      cronActive: false;
      activeRunsContinue: true;
    }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

async function operatorWriteRole(orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !isRecord(data)) return null;
  const role = str(data["role"]);
  return role && WRITE_ROLES.has(role) ? role : null;
}

async function schedulerCronStatus(): Promise<{
  exists: boolean;
  active: boolean;
  schedule: string | null;
} | null> {
  const { data, error } = await admin.rpc(
    "get_internal_observation_scheduler_cron_status_v06",
  );
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) return null;
  const exists = bool(row["job_exists"]);
  const active = bool(row["active"]);
  const schedule = row["schedule"] === null ? null : str(row["schedule"]);
  if (exists === null || active === null || schedule === undefined) return null;
  return { exists, active, schedule };
}

async function buildActivationPlan(args: {
  orgId: string;
  userId: string;
}): Promise<InternalObservationSchedulerActivationPlanDTO | null> {
  const [dryRun, cron, role, settingsRes] = await Promise.all([
    buildInternalObservationSchedulerDryRun(args.orgId),
    schedulerCronStatus(),
    operatorWriteRole(args.orgId, args.userId),
    admin
      .from("internal_observation_pipeline_settings")
      .select(
        "execution_enabled, scheduler_state, scheduler_executor_deployed, scheduler_executor_ready, scheduler_actor_user_id",
      )
      .eq("org_id", args.orgId)
      .maybeSingle(),
  ]);

  if (
    !dryRun ||
    !cron ||
    settingsRes.error ||
    !isRecord(settingsRes.data)
  ) {
    return null;
  }

  const schedulerStateRaw = str(settingsRes.data["scheduler_state"]);
  const schedulerState: InternalObservationSchedulerState =
    schedulerStateRaw === "running" || schedulerStateRaw === "paused"
      ? schedulerStateRaw
      : "off";
  const executionEnabled = settingsRes.data["execution_enabled"] === true;
  const executorDeployed = settingsRes.data["scheduler_executor_deployed"] === true;
  const executorReady = settingsRes.data["scheduler_executor_ready"] === true;
  const schedulerActorConfigured = !!str(
    settingsRes.data["scheduler_actor_user_id"],
  );

  const blockers: SchedulerActivationBlocker[] = [];
  if (schedulerState === "running" || executionEnabled) {
    blockers.push("STATE_ALREADY_RUNNING");
  }
  if (!executorReady) blockers.push("EXECUTOR_NOT_READY");
  if (!schedulerActorConfigured) blockers.push("ACTOR_NOT_CONFIGURED");
  if (!cron.exists) blockers.push("CRON_NOT_AVAILABLE");
  if (dryRun.plannedCandidateCount < 1) blockers.push("NO_PLANNED_CANDIDATE");
  if (dryRun.dispatchNowCount < 1) blockers.push("NO_DISPATCH_SLOT");
  if (!role) blockers.push("OPERATOR_WRITE_ROLE_REQUIRED");

  const fingerprint = {
    version: "0.6",
    orgId: args.orgId,
    schedulerState,
    executionEnabled,
    executorDeployed,
    executorReady,
    schedulerActorConfigured,
    cronJobExists: cron.exists,
    cronSchedule: cron.schedule,
    operatorRole: role,
    dryRun: {
      providerReady: dryRun.providerReady,
      creditBalance: dryRun.creditBalance,
      dailyRunLimit: dryRun.dailyRunLimit,
      pipelineRunsToday: dryRun.pipelineRunsToday,
      concurrentRunLimit: dryRun.concurrentRunLimit,
      activeRunCount: dryRun.activeRunCount,
      dailyRequestsUsed: dryRun.dailyRequestsUsed,
      dailyRequestLimit: dryRun.dailyRequestLimit,
      monthlyActualCostUsd: dryRun.monthlyActualCostUsd,
      monthlyReservedCostUsd: dryRun.monthlyReservedCostUsd,
      monthlyBudgetUsd: dryRun.monthlyBudgetUsd,
      candidates: dryRun.candidates.map((candidate) => ({
        itemId: candidate.itemId,
        sequence: candidate.sequence,
        dispatchNow: candidate.dispatchNow,
        planned: candidate.planned,
        blockers: candidate.blockers,
        plannedJobs: candidate.plannedJobs,
        maxCostUsd: candidate.maxCostUsd,
      })),
    },
    blockers,
  };

  return {
    version: "0.6",
    generatedAt: new Date().toISOString(),
    planHash: stableHash(fingerprint),
    orgId: args.orgId,
    orgName: dryRun.orgName,
    schedulerState,
    executionEnabled,
    executorDeployed,
    executorReady,
    schedulerActorConfigured,
    cronJobExists: cron.exists,
    cronActive: cron.active,
    cronSchedule: cron.schedule,
    operatorRole: role,
    blockers,
    canRequestActivation: blockers.length === 0,
    confirmText: ACTIVATION_CONFIRM_TEXT,
    dryRun,
  };
}

async function pendingRequest(
  orgId: string,
  userId: string,
): Promise<InternalObservationSchedulerPendingRequestDTO | null> {
  const { data, error } = await admin
    .from("internal_observation_scheduler_activation_requests")
    .select("id, requested_by, requested_at, expires_at")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !isRecord(data)) return null;
  const requestId = str(data["id"]);
  const requestedBy = str(data["requested_by"]);
  const requestedAt = str(data["requested_at"]);
  const expiresAt = str(data["expires_at"]);
  if (!requestId || !requestedBy || !requestedAt || !expiresAt) return null;

  if (Date.parse(expiresAt) <= Date.now()) {
    await admin
      .from("internal_observation_scheduler_activation_requests")
      .update({ status: "expired" })
      .eq("id", requestId)
      .eq("status", "pending");
    return null;
  }

  return {
    requestId,
    requestedAt,
    expiresAt,
    requestedByCurrentUser: requestedBy === userId,
  };
}

async function logControlEvent(args: {
  orgId: string;
  eventType: string;
  message: string;
  actorUserId: string;
  metadata?: Record<string, unknown>;
}) {
  await admin.from("system_events").insert({
    org_id: args.orgId,
    run_id: null,
    event_type: args.eventType,
    severity: "info",
    message: args.message,
    metadata: {
      ...(args.metadata ?? {}),
      actor_user_id: args.actorUserId,
      scheduler_version: "0.6",
    },
  });
}

export const getInternalObservationSchedulerOperations = createServerFn({
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
  .handler(async ({ data, context }): Promise<GetSchedulerOperationsResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const [plan, pending] = await Promise.all([
      buildActivationPlan({ orgId: data.orgId, userId: context.userId }),
      pendingRequest(data.orgId, context.userId),
    ]);
    if (!plan) return { ok: false, error: "NOT_AVAILABLE" };
    return { ok: true, data: { plan, pendingRequest: pending } };
  });

export const requestInternalObservationSchedulerActivation = createServerFn({
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
  .handler(async ({ data, context }): Promise<RequestSchedulerActivationResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const plan = await buildActivationPlan({
      orgId: data.orgId,
      userId: context.userId,
    });
    if (!plan) return { ok: false, error: "NOT_AVAILABLE" };
    if (!plan.canRequestActivation) {
      return { ok: false, error: "PLAN_BLOCKED", plan };
    }

    await admin
      .from("internal_observation_scheduler_activation_requests")
      .update({
        status: "cancelled",
        cancelled_by: context.userId,
        cancelled_at: new Date().toISOString(),
      })
      .eq("org_id", data.orgId)
      .eq("status", "pending");

    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS).toISOString();
    const { data: inserted, error } = await admin
      .from("internal_observation_scheduler_activation_requests")
      .insert({
        org_id: data.orgId,
        status: "pending",
        plan_hash: plan.planHash,
        plan_snapshot: plan,
        requested_by: context.userId,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error || !isRecord(inserted) || !str(inserted["id"])) {
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    await logControlEvent({
      orgId: data.orgId,
      eventType: "internal_scheduler_activation_requested",
      message: "Internal observation scheduler activation was requested.",
      actorUserId: context.userId,
      metadata: {
        request_id: str(inserted["id"]),
        plan_hash: plan.planHash,
        expires_at: expiresAt,
      },
    });

    return {
      ok: true,
      requestId: str(inserted["id"])!,
      planHash: plan.planHash,
      expiresAt,
      confirmText: ACTIVATION_CONFIRM_TEXT,
    };
  });

export const confirmInternalObservationSchedulerActivation = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: { orgId: string; requestId: string; confirmation: string }) => {
      if (
        !input ||
        typeof input.orgId !== "string" ||
        !UUID_RE.test(input.orgId.trim()) ||
        typeof input.requestId !== "string" ||
        !UUID_RE.test(input.requestId.trim()) ||
        typeof input.confirmation !== "string"
      ) {
        throw new Error("INVALID_INPUT");
      }
      return {
        orgId: input.orgId.trim().toLowerCase(),
        requestId: input.requestId.trim().toLowerCase(),
        confirmation: input.confirmation.trim(),
      };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ConfirmSchedulerActivationResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };
    if (data.confirmation !== ACTIVATION_CONFIRM_TEXT) {
      return { ok: false, error: "INVALID_CONFIRMATION" };
    }

    const { data: requestRaw, error: requestError } = await admin
      .from("internal_observation_scheduler_activation_requests")
      .select("id, org_id, status, plan_hash, requested_by, expires_at")
      .eq("id", data.requestId)
      .eq("org_id", data.orgId)
      .maybeSingle();

    if (requestError || !isRecord(requestRaw)) {
      return { ok: false, error: "REQUEST_NOT_AVAILABLE" };
    }
    if (
      requestRaw["status"] !== "pending" ||
      str(requestRaw["requested_by"]) !== context.userId
    ) {
      return { ok: false, error: "REQUEST_NOT_AVAILABLE" };
    }

    const expiresAt = str(requestRaw["expires_at"]);
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
      await admin
        .from("internal_observation_scheduler_activation_requests")
        .update({ status: "expired" })
        .eq("id", data.requestId)
        .eq("status", "pending");
      return { ok: false, error: "REQUEST_EXPIRED" };
    }

    const plan = await buildActivationPlan({
      orgId: data.orgId,
      userId: context.userId,
    });
    if (!plan) return { ok: false, error: "NOT_AVAILABLE" };
    if (!plan.canRequestActivation) {
      return { ok: false, error: "PLAN_BLOCKED", plan };
    }
    if (plan.planHash !== str(requestRaw["plan_hash"])) {
      return { ok: false, error: "PLAN_CHANGED", plan };
    }

    const cronToggle = await admin.rpc(
      "set_internal_observation_scheduler_cron_active_v06",
      { p_active: true },
    );
    if (cronToggle.error || cronToggle.data !== true) {
      return { ok: false, error: "CRON_ACTIVATION_FAILED" };
    }

    const now = new Date().toISOString();
    const { error: settingsError } = await admin
      .from("internal_observation_pipeline_settings")
      .update({
        execution_enabled: true,
        scheduler_state: "running",
        scheduler_activated_at: now,
        scheduler_activated_by: context.userId,
        scheduler_paused_at: null,
        scheduler_stopped_at: null,
        updated_by: context.userId,
        updated_at: now,
      })
      .eq("org_id", data.orgId)
      .eq("execution_enabled", false);

    if (settingsError) {
      await admin.rpc("set_internal_observation_scheduler_cron_active_v06", {
        p_active: false,
      });
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    await admin
      .from("internal_observation_scheduler_activation_requests")
      .update({
        status: "confirmed",
        confirmed_by: context.userId,
        confirmed_at: now,
      })
      .eq("id", data.requestId)
      .eq("status", "pending");

    await logControlEvent({
      orgId: data.orgId,
      eventType: "internal_scheduler_activated",
      message: "Internal observation scheduler was activated.",
      actorUserId: context.userId,
      metadata: {
        request_id: data.requestId,
        plan_hash: plan.planHash,
        cron_schedule: plan.cronSchedule,
      },
    });

    return { ok: true, schedulerState: "running", cronActive: true };
  });

async function disableScheduler(args: {
  orgId: string;
  userId: string;
  state: "paused" | "off";
}): Promise<SchedulerControlResult> {
  const role = await operatorWriteRole(args.orgId, args.userId);
  if (!role) return { ok: false, error: "FORBIDDEN" };

  await admin.rpc("set_internal_observation_scheduler_cron_active_v06", {
    p_active: false,
  });

  const now = new Date().toISOString();
  const patch =
    args.state === "paused"
      ? {
          execution_enabled: false,
          scheduler_state: "paused",
          scheduler_paused_at: now,
          updated_by: args.userId,
          updated_at: now,
        }
      : {
          execution_enabled: false,
          scheduler_state: "off",
          scheduler_stopped_at: now,
          updated_by: args.userId,
          updated_at: now,
        };

  const { error } = await admin
    .from("internal_observation_pipeline_settings")
    .update(patch)
    .eq("org_id", args.orgId);

  if (error) return { ok: false, error: "NOT_AVAILABLE" };

  if (args.state === "off") {
    await admin
      .from("internal_observation_scheduler_activation_requests")
      .update({
        status: "cancelled",
        cancelled_by: args.userId,
        cancelled_at: now,
      })
      .eq("org_id", args.orgId)
      .eq("status", "pending");
  }

  await logControlEvent({
    orgId: args.orgId,
    eventType:
      args.state === "paused"
        ? "internal_scheduler_paused"
        : "internal_scheduler_stopped",
    message:
      args.state === "paused"
        ? "Internal observation scheduler was paused. Active runs are not cancelled."
        : "Internal observation scheduler was stopped. Active runs are not cancelled.",
    actorUserId: args.userId,
    metadata: { active_runs_continue: true },
  });

  return {
    ok: true,
    schedulerState: args.state,
    cronActive: false,
    activeRunsContinue: true,
  };
}

export const pauseInternalObservationScheduler = createServerFn({ method: "POST" })
  .inputValidator((input: { orgId: string }) => {
    if (!input || typeof input.orgId !== "string" || !UUID_RE.test(input.orgId.trim())) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId: input.orgId.trim().toLowerCase() };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<SchedulerControlResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };
    return disableScheduler({
      orgId: data.orgId,
      userId: context.userId,
      state: "paused",
    });
  });

export const stopInternalObservationScheduler = createServerFn({ method: "POST" })
  .inputValidator((input: { orgId: string }) => {
    if (!input || typeof input.orgId !== "string" || !UUID_RE.test(input.orgId.trim())) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId: input.orgId.trim().toLowerCase() };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<SchedulerControlResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };
    return disableScheduler({
      orgId: data.orgId,
      userId: context.userId,
      state: "off",
    });
  });
