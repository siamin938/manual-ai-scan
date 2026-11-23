import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.server";
import type { EntityFactsV2ReadGatewayResponse } from "@/lib/entity-facts-v2-read-gateway.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type PilotOpsAdminRunDetailDTO = {
  orgId: string;
  businessId: string;
  businessName: string;
  runId: string;
  runName: string;
  status: string;
  questionSetId: string;
  questionSetName: string | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  repetitions: number;
  selectedProviders: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  jobStatusCounts: Record<string, number>;
  failedJobSamples: Array<{
    errorCode: string | null;
    errorMessage: string | null;
  }>;
};

export type PilotOpsAdminRunDetailResponse =
  | { ok: true; detail: PilotOpsAdminRunDetailDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" | "INVALID_INPUT" };

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

export const getPilotOpsAdminResult = createServerFn({ method: "POST" })
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input || !validUuid(input.orgId) || !validUuid(input.businessId)) {
      throw new Error("INVALID_INPUT");
    }
    return {
      orgId: input.orgId.trim().toLowerCase(),
      businessId: input.businessId.trim().toLowerCase(),
    };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<EntityFactsV2ReadGatewayResponse> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    return fetchEntityFactsV2ReadGateway({
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });

export const getPilotOpsAdminRunDetail = createServerFn({ method: "POST" })
  .inputValidator((input: { orgId: string; businessId: string; runId: string }) => {
    if (
      !input ||
      !validUuid(input.orgId) ||
      !validUuid(input.businessId) ||
      !validUuid(input.runId)
    ) {
      throw new Error("INVALID_INPUT");
    }
    return {
      orgId: input.orgId.trim().toLowerCase(),
      businessId: input.businessId.trim().toLowerCase(),
      runId: input.runId.trim().toLowerCase(),
    };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<PilotOpsAdminRunDetailResponse> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const [runRes, businessRes, jobsRes] = await Promise.all([
      supabaseAdmin
        .from("measurement_runs")
        .select(
          "id, org_id, business_id, question_set_id, name, status, total_jobs, completed_jobs, failed_jobs, repetitions, selected_providers, created_at, started_at, completed_at",
        )
        .eq("id", data.runId)
        .eq("org_id", data.orgId)
        .eq("business_id", data.businessId)
        .eq("run_type", "audit")
        .eq("phase", "standalone")
        .eq("diagnostic_scope", "customer")
        .is("experiment_id", null)
        .maybeSingle(),
      supabaseAdmin
        .from("businesses")
        .select("id, name")
        .eq("id", data.businessId)
        .eq("org_id", data.orgId)
        .eq("is_client_business", true)
        .maybeSingle(),
      supabaseAdmin
        .from("measurement_jobs")
        .select("status, error_code, error_message")
        .eq("org_id", data.orgId)
        .eq("run_id", data.runId),
    ]);

    if (runRes.error || businessRes.error || jobsRes.error || !runRes.data || !businessRes.data) {
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    const { data: questionSet, error: questionSetError } = await supabaseAdmin
      .from("question_sets")
      .select("id, name")
      .eq("id", runRes.data.question_set_id)
      .eq("org_id", data.orgId)
      .eq("business_id", data.businessId)
      .maybeSingle();

    if (questionSetError) return { ok: false, error: "NOT_AVAILABLE" };

    const jobStatusCounts: Record<string, number> = {};
    const failedJobSamples: PilotOpsAdminRunDetailDTO["failedJobSamples"] = [];
    for (const job of jobsRes.data ?? []) {
      const status = String(job.status);
      jobStatusCounts[status] = (jobStatusCounts[status] ?? 0) + 1;
      if ((job.error_code || job.error_message) && failedJobSamples.length < 3) {
        failedJobSamples.push({
          errorCode: job.error_code ?? null,
          errorMessage: job.error_message ?? null,
        });
      }
    }

    return {
      ok: true,
      detail: {
        orgId: data.orgId,
        businessId: data.businessId,
        businessName: businessRes.data.name,
        runId: runRes.data.id,
        runName: runRes.data.name,
        status: String(runRes.data.status),
        questionSetId: runRes.data.question_set_id,
        questionSetName: questionSet?.name ?? null,
        totalJobs: Number(runRes.data.total_jobs ?? 0),
        completedJobs: Number(runRes.data.completed_jobs ?? 0),
        failedJobs: Number(runRes.data.failed_jobs ?? 0),
        repetitions: Number(runRes.data.repetitions ?? 0),
        selectedProviders: Array.isArray(runRes.data.selected_providers)
          ? runRes.data.selected_providers.map(String)
          : [],
        createdAt: runRes.data.created_at,
        startedAt: runRes.data.started_at ?? null,
        completedAt: runRes.data.completed_at ?? null,
        jobStatusCounts,
        failedJobSamples,
      },
    };
  });
