import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createInternalObservationScheduledMeasurementRun } from "@/lib/customer-measurement.server";
import { reconcileInternalObservationPipelineItems } from "@/lib/internal-observation-reconciliation.functions";
import { buildInternalObservationSchedulerDryRun } from "@/lib/internal-observation-scheduler.functions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  update: (values: unknown) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: unknown[]) => LooseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
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

export type InternalObservationGuardedSchedulerTickDTO =
  | {
      status: "disabled";
      orgId: string;
      reason: "MASTER_SWITCH_OFF" | "ACTOR_NOT_CONFIGURED";
    }
  | {
      status: "idle";
      orgId: string;
      reason:
        | "NO_DISPATCH_SLOT"
        | "NO_PLANNED_CANDIDATE"
        | "CLAIM_RACE"
        | "PLAN_CHANGED";
    }
  | {
      status: "started";
      orgId: string;
      itemId: string;
      businessName: string;
      runId: string;
      plannedJobs: number;
    }
  | {
      status: "failed";
      orgId: string;
      itemId: string | null;
      reason: "PLAN_NOT_AVAILABLE" | "RUN_START_FAILED" | "PIPELINE_LINK_FAILED";
      code?: string;
    };

export type RunInternalObservationGuardedSchedulerTickResult =
  | { ok: true; tick: InternalObservationGuardedSchedulerTickDTO }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

function seoulDateSlug(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function writeSchedulerResult(
  orgId: string,
  result: string,
): Promise<void> {
  await admin
    .from("internal_observation_pipeline_settings")
    .update({
      last_scheduler_tick_at: new Date().toISOString(),
      last_scheduler_result: result.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);
}

async function releaseClaim(args: {
  itemId: string;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  await admin
    .from("internal_observation_pipeline_items")
    .update({
      status: "ready_to_measure",
      measurement_approved_at: null,
      measurement_approved_by: null,
      error_code: args.errorCode,
      error_message: args.errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.itemId)
    .eq("status", "measuring");
}

export async function runInternalObservationGuardedSchedulerTickCore(
  orgId: string,
): Promise<InternalObservationGuardedSchedulerTickDTO> {
  // First reconcile the previous run. No replacement run is created here.
  await reconcileInternalObservationPipelineItems({ limit: 20 });

  const { data: settingsRaw, error: settingsError } = await admin
    .from("internal_observation_pipeline_settings")
    .select(
      "execution_enabled, scheduler_actor_user_id, daily_run_limit, concurrent_run_limit",
    )
    .eq("org_id", orgId)
    .maybeSingle();

  if (settingsError || !isRecord(settingsRaw)) {
    return {
      status: "failed",
      orgId,
      itemId: null,
      reason: "PLAN_NOT_AVAILABLE",
    };
  }

  const executionEnabled = settingsRaw["execution_enabled"] === true;
  const schedulerActorUserId = str(settingsRaw["scheduler_actor_user_id"]);

  // Critical fuse: OFF path is side-effect free, including no scheduler tick metadata write.
  if (!executionEnabled) {
    return {
      status: "disabled",
      orgId,
      reason: "MASTER_SWITCH_OFF",
    };
  }
  if (!schedulerActorUserId) {
    await writeSchedulerResult(orgId, "disabled:ACTOR_NOT_CONFIGURED");
    return {
      status: "disabled",
      orgId,
      reason: "ACTOR_NOT_CONFIGURED",
    };
  }

  const plan = await buildInternalObservationSchedulerDryRun(orgId);
  if (!plan) {
    await writeSchedulerResult(orgId, "failed:PLAN_NOT_AVAILABLE");
    return {
      status: "failed",
      orgId,
      itemId: null,
      reason: "PLAN_NOT_AVAILABLE",
    };
  }

  if (plan.dispatchSlotsNow < 1) {
    await writeSchedulerResult(orgId, "idle:NO_DISPATCH_SLOT");
    return {
      status: "idle",
      orgId,
      reason: "NO_DISPATCH_SLOT",
    };
  }

  const expected = plan.candidates.find(
    (candidate) => candidate.planned && candidate.dispatchNow,
  );
  if (!expected) {
    await writeSchedulerResult(orgId, "idle:NO_PLANNED_CANDIDATE");
    return {
      status: "idle",
      orgId,
      reason: "NO_PLANNED_CANDIDATE",
    };
  }

  const { data: claimedRaw, error: claimError } = await admin.rpc(
    "claim_internal_observation_scheduler_candidate_v05",
    {
      p_org_id: orgId,
      p_actor_user_id: schedulerActorUserId,
    },
  );

  if (claimError) {
    await writeSchedulerResult(orgId, "idle:CLAIM_RACE");
    return {
      status: "idle",
      orgId,
      reason: "CLAIM_RACE",
    };
  }

  const claimedRow = Array.isArray(claimedRaw) ? claimedRaw[0] : claimedRaw;
  if (!isRecord(claimedRow)) {
    await writeSchedulerResult(orgId, "idle:CLAIM_RACE");
    return {
      status: "idle",
      orgId,
      reason: "CLAIM_RACE",
    };
  }

  const itemId = str(claimedRow["item_id"]);
  const businessId = str(claimedRow["business_id"]);
  const questionSetId = str(claimedRow["question_set_id"]);
  const businessName = str(claimedRow["business_name"]);

  if (
    !itemId ||
    !businessId ||
    !questionSetId ||
    !businessName ||
    itemId !== expected.itemId
  ) {
    if (itemId) {
      await releaseClaim({
        itemId,
        errorCode: "SCHEDULER_PLAN_CHANGED",
        errorMessage:
          "Dry-run 계획과 원자 claim 대상이 달라 실행하지 않았습니다. 다음 tick에서 다시 계산합니다.",
      });
    }
    await writeSchedulerResult(orgId, "idle:PLAN_CHANGED");
    return {
      status: "idle",
      orgId,
      reason: "PLAN_CHANGED",
    };
  }

  const runResult = await createInternalObservationScheduledMeasurementRun({
    supabase: supabaseAdmin,
    schedulerActorUserId,
    orgId,
    businessId,
    questionSetId,
    name: `내부 자동 관찰 · ${businessName} · ${seoulDateSlug()}`,
  });

  if (!runResult.ok) {
    await releaseClaim({
      itemId,
      errorCode: `SCHEDULER_${runResult.error}`,
      errorMessage:
        "Guarded Scheduler가 실행 직전 조건을 재검증했으며 Run을 시작하지 못했습니다. 자동 재시도 Run은 만들지 않습니다.",
    });
    await writeSchedulerResult(
      orgId,
      `failed:RUN_START_FAILED:${runResult.error}`,
    );
    return {
      status: "failed",
      orgId,
      itemId,
      reason: "RUN_START_FAILED",
      code: runResult.error,
    };
  }

  const { data: creditRaw } = await admin
    .from("measurement_credit_accounts")
    .select("balance")
    .eq("org_id", orgId)
    .maybeSingle();
  const creditBalance =
    isRecord(creditRaw) && Number.isFinite(Number(creditRaw["balance"]))
      ? Math.max(0, Math.trunc(Number(creditRaw["balance"])))
      : null;

  const { error: linkError } = await admin
    .from("internal_observation_pipeline_items")
    .update({
      run_id: runResult.runId,
      status: "measuring",
      readiness: {
        reason: null,
        creditBalance,
        providerReady: true,
        executionEnabled: true,
        dailyRunLimit: Number(settingsRaw["daily_run_limit"] ?? 5),
        concurrentRunLimit: Number(settingsRaw["concurrent_run_limit"] ?? 1),
        activeRunCount: 1,
      },
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("status", "measuring");

  if (linkError) {
    await writeSchedulerResult(
      orgId,
      `failed:PIPELINE_LINK_FAILED:${runResult.runId}`,
    );
    return {
      status: "failed",
      orgId,
      itemId,
      reason: "PIPELINE_LINK_FAILED",
      code: runResult.runId,
    };
  }

  await writeSchedulerResult(orgId, `started:${itemId}:${runResult.runId}`);

  return {
    status: "started",
    orgId,
    itemId,
    businessName,
    runId: runResult.runId,
    plannedJobs: runResult.plannedJobs,
  };
}

export const runInternalObservationGuardedSchedulerTick = createServerFn({
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
  .handler(
    async ({
      data,
      context,
    }): Promise<RunInternalObservationGuardedSchedulerTickResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (!(await isInternalAdmin(client))) {
        return { ok: false, error: "FORBIDDEN" };
      }

      try {
        const tick = await runInternalObservationGuardedSchedulerTickCore(
          data.orgId,
        );
        return { ok: true, tick };
      } catch {
        return { ok: false, error: "NOT_AVAILABLE" };
      }
    },
  );
