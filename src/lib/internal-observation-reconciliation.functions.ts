import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.server";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "@/lib/customer-measurement.helpers";

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  update: (values: unknown) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: unknown[]) => LooseQuery;
  order: (column: string, options?: unknown) => LooseQuery;
  limit: (count: number) => LooseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

type LooseAdmin = {
  from: (table: string) => LooseQuery;
};

const admin = supabaseAdmin as unknown as LooseAdmin;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type InternalObservationReconciliationState =
  | "measuring"
  | "postprocessing"
  | "completed"
  | "failed";

export type InternalObservationReconciliationItemDTO = {
  itemId: string;
  runId: string | null;
  state: InternalObservationReconciliationState;
  changed: boolean;
  code: string | null;
  runStatus: string | null;
  completedJobs: number | null;
  totalJobs: number | null;
  failedJobs: number | null;
  entityFactsReady: boolean;
};

export type ReconcileInternalObservationPipelineResult =
  | {
      ok: true;
      checked: number;
      measuring: number;
      postprocessing: number;
      completed: number;
      failed: number;
      items: InternalObservationReconciliationItemDTO[];
    }
  | {
      ok: false;
      error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE";
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

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

async function updateItem(
  itemId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin
    .from("internal_observation_pipeline_items")
    .update({
      ...patch,
      reconciled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .select("id")
    .maybeSingle();

  return !error && isRecord(data) && str(data["id"]) === itemId;
}

async function reconcileOne(
  raw: Record<string, unknown>,
): Promise<InternalObservationReconciliationItemDTO> {
  const itemId = str(raw["id"]);
  const orgId = str(raw["org_id"]);
  const businessId = str(raw["business_id"]);
  const questionSetId = str(raw["question_set_id"]);
  const runId = str(raw["run_id"]);
  const currentStatus = str(raw["status"]);

  if (!itemId || !orgId || !businessId || !questionSetId || !runId) {
    if (itemId) {
      await updateItem(itemId, {
        status: "failed",
        terminal_at: new Date().toISOString(),
        error_code: "PIPELINE_LINK_INVALID",
        error_message: "측정 완료 상태를 확인할 연결 정보가 부족합니다.",
      });
    }
    return {
      itemId: itemId ?? "unknown",
      runId,
      state: "failed",
      changed: true,
      code: "PIPELINE_LINK_INVALID",
      runStatus: null,
      completedJobs: null,
      totalJobs: null,
      failedJobs: null,
      entityFactsReady: false,
    };
  }

  const { data: runRaw, error: runError } = await admin
    .from("measurement_runs")
    .select(
      "id, org_id, business_id, question_set_id, status, total_jobs, completed_jobs, failed_jobs, completed_at",
    )
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("question_set_id", questionSetId)
    .maybeSingle();

  if (runError || !isRecord(runRaw)) {
    await updateItem(itemId, {
      status: "failed",
      terminal_at: new Date().toISOString(),
      error_code: "RUN_NOT_FOUND",
      error_message: "연결된 측정 Run을 확인할 수 없습니다. 자동 재측정은 하지 않습니다.",
    });
    return {
      itemId,
      runId,
      state: "failed",
      changed: currentStatus !== "failed",
      code: "RUN_NOT_FOUND",
      runStatus: null,
      completedJobs: null,
      totalJobs: null,
      failedJobs: null,
      entityFactsReady: false,
    };
  }

  const runStatus = str(runRaw["status"]);
  const totalJobs = num(runRaw["total_jobs"]);
  const completedJobs = num(runRaw["completed_jobs"]);
  const failedJobs = num(runRaw["failed_jobs"]);

  if (runStatus === "draft" || runStatus === "queued" || runStatus === "running") {
    if (currentStatus !== "measuring" || raw["error_code"] !== null) {
      await updateItem(itemId, {
        status: "measuring",
        error_code: null,
        error_message: null,
      });
    } else {
      await updateItem(itemId, {});
    }

    return {
      itemId,
      runId,
      state: "measuring",
      changed: currentStatus !== "measuring",
      code: null,
      runStatus,
      completedJobs,
      totalJobs,
      failedJobs,
      entityFactsReady: false,
    };
  }

  if (runStatus === "failed" || runStatus === "cancelled") {
    const code = runStatus === "failed" ? "RUN_FAILED" : "RUN_CANCELLED";
    await updateItem(itemId, {
      status: "failed",
      terminal_at: new Date().toISOString(),
      error_code: code,
      error_message:
        runStatus === "failed"
          ? "측정 Run이 실패했습니다. 자동으로 새 Run을 만들지 않습니다."
          : "측정 Run이 취소되었습니다. 자동으로 새 Run을 만들지 않습니다.",
    });

    return {
      itemId,
      runId,
      state: "failed",
      changed: currentStatus !== "failed",
      code,
      runStatus,
      completedJobs,
      totalJobs,
      failedJobs,
      entityFactsReady: false,
    };
  }

  if (runStatus !== "completed") {
    await updateItem(itemId, {
      status: "failed",
      terminal_at: new Date().toISOString(),
      error_code: "RUN_STATUS_INVALID",
      error_message: "알 수 없는 Run 상태입니다. 자동 재측정은 하지 않습니다.",
    });

    return {
      itemId,
      runId,
      state: "failed",
      changed: currentStatus !== "failed",
      code: "RUN_STATUS_INVALID",
      runStatus,
      completedJobs,
      totalJobs,
      failedJobs,
      entityFactsReady: false,
    };
  }

  if (
    totalJobs !== CUSTOMER_STANDARD_QUESTION_COUNT ||
    completedJobs !== CUSTOMER_STANDARD_QUESTION_COUNT ||
    failedJobs !== 0
  ) {
    await updateItem(itemId, {
      status: "failed",
      terminal_at: new Date().toISOString(),
      error_code: "RUN_INCOMPLETE",
      error_message: "측정 Run이 24/24 · 실패 0 계약을 충족하지 못했습니다. 자동 재측정은 하지 않습니다.",
    });

    return {
      itemId,
      runId,
      state: "failed",
      changed: currentStatus !== "failed",
      code: "RUN_INCOMPLETE",
      runStatus,
      completedJobs,
      totalJobs,
      failedJobs,
      entityFactsReady: false,
    };
  }

  const gateway = await fetchEntityFactsV2ReadGateway({ orgId, businessId });

  if (gateway.ok) {
    if (gateway.data.scope.runId !== runId) {
      await updateItem(itemId, {
        status: "failed",
        terminal_at: new Date().toISOString(),
        error_code: "ENTITY_FACTS_RUN_MISMATCH",
        error_message: "Entity Facts v2 대표 Run이 파이프라인 Run과 일치하지 않습니다. 자동으로 결과를 확정하지 않습니다.",
      });

      return {
        itemId,
        runId,
        state: "failed",
        changed: currentStatus !== "failed",
        code: "ENTITY_FACTS_RUN_MISMATCH",
        runStatus,
        completedJobs,
        totalJobs,
        failedJobs,
        entityFactsReady: false,
      };
    }

    const now = new Date().toISOString();
    await updateItem(itemId, {
      status: "completed",
      terminal_at: now,
      entity_facts_ready_at: now,
      error_code: null,
      error_message: null,
    });

    return {
      itemId,
      runId,
      state: "completed",
      changed: currentStatus !== "completed",
      code: null,
      runStatus,
      completedJobs,
      totalJobs,
      failedJobs,
      entityFactsReady: true,
    };
  }

  if (
    gateway.error === "NO_V2_DATA" ||
    gateway.error === "INTERNAL_ERROR"
  ) {
    const code =
      gateway.error === "NO_V2_DATA"
        ? "ENTITY_FACTS_PENDING"
        : "ENTITY_FACTS_CHECK_RETRY";

    await updateItem(itemId, {
      status: "postprocessing",
      error_code: code,
      error_message:
        gateway.error === "NO_V2_DATA"
          ? "Run 24/24 완료 · Entity Facts v2 후처리를 기다리고 있습니다."
          : "Run은 완료됐지만 Entity Facts v2 확인을 다시 시도해야 합니다.",
    });

    return {
      itemId,
      runId,
      state: "postprocessing",
      changed: currentStatus !== "postprocessing" || raw["error_code"] !== code,
      code,
      runStatus,
      completedJobs,
      totalJobs,
      failedJobs,
      entityFactsReady: false,
    };
  }

  const code =
    gateway.error === "INVALID_V2_DATA"
      ? "ENTITY_FACTS_INVALID"
      : "ENTITY_FACTS_BUSINESS_UNAVAILABLE";

  await updateItem(itemId, {
    status: "failed",
    terminal_at: new Date().toISOString(),
    error_code: code,
    error_message:
      gateway.error === "INVALID_V2_DATA"
        ? "Entity Facts v2 데이터 계약을 확인해야 합니다. 자동 재측정은 하지 않습니다."
        : "Entity Facts v2 대상 업체를 확인할 수 없습니다. 자동 재측정은 하지 않습니다.",
  });

  return {
    itemId,
    runId,
    state: "failed",
    changed: currentStatus !== "failed",
    code,
    runStatus,
    completedJobs,
    totalJobs,
    failedJobs,
    entityFactsReady: false,
  };
}

export async function reconcileInternalObservationPipelineItems(args?: {
  itemId?: string | null;
  limit?: number;
}): Promise<InternalObservationReconciliationItemDTO[]> {
  const limit = Math.min(50, Math.max(1, args?.limit ?? 20));

  let query = admin
    .from("internal_observation_pipeline_items")
    .select("*")
    .in("status", ["measuring", "postprocessing"])
    .order("measurement_approved_at", { ascending: true })
    .limit(limit);

  if (args?.itemId) {
    query = query.eq("id", args.itemId);
  }

  const { data, error } = await query;
  if (error) throw new Error("PIPELINE_RECONCILIATION_LOAD_FAILED");

  const rows = Array.isArray(data) ? data.filter(isRecord) : [];
  const results: InternalObservationReconciliationItemDTO[] = [];
  for (const row of rows) {
    results.push(await reconcileOne(row));
  }
  return results;
}

export const reconcileInternalObservationPipeline = createServerFn({
  method: "POST",
})
  .inputValidator((input: { itemId?: string | null } | undefined) => {
    const raw = input?.itemId?.trim() ?? "";
    if (raw && !UUID_RE.test(raw)) throw new Error("INVALID_INPUT");
    return { itemId: raw || null };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<ReconcileInternalObservationPipelineResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    try {
      const items = await reconcileInternalObservationPipelineItems({
        itemId: data.itemId,
      });

      return {
        ok: true,
        checked: items.length,
        measuring: items.filter((item) => item.state === "measuring").length,
        postprocessing: items.filter((item) => item.state === "postprocessing").length,
        completed: items.filter((item) => item.state === "completed").length,
        failed: items.filter((item) => item.state === "failed").length,
        items,
      };
    } catch {
      return { ok: false, error: "NOT_AVAILABLE" };
    }
  });
