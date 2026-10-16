import { supabase } from "@/integrations/supabase/client";
import {
  MEASUREMENT_HISTORY_PAGE_SIZE,
  type MeasurementHistoryCatalogResponse,
} from "./measurement-history.model";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * The dates/name of completed customer measurements are ALREADY permitted by
 * public.measurement_runs RLS (organization membership). Read only those safe
 * fields using the current user's session. This avoids blocking the history
 * index on the separate Lovable server-function runtime.
 *
 * Never fetch v2 materialization/facts through the browser: that remains
 * server-only and must pass independent organization/business/Run validation.
 */
export async function fetchMemberHistoryCatalog(args: {
  orgId: string;
  businessId: string;
  page: number;
}): Promise<MeasurementHistoryCatalogResponse> {
  const { orgId, businessId, page } = args;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(businessId) ||
      !Number.isInteger(page) || page < 0 || page > 1000) {
    return { ok: false, error: "NOT_AVAILABLE" };
  }

  const start = page * MEASUREMENT_HISTORY_PAGE_SIZE;
  const { data, error } = await supabase
    .from("measurement_runs")
    .select("id,name,completed_at,created_at")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("run_type", "audit")
    .eq("phase", "standalone")
    .eq("diagnostic_scope", "customer")
    .eq("status", "completed")
    .eq("total_jobs", 24)
    .is("experiment_id", null)
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + MEASUREMENT_HISTORY_PAGE_SIZE);

  if (error) {
    // Do not log tokens, request headers or arbitrary Supabase error bodies.
    console.warn("[measurement-history] member RLS date index failed", error.code);
    return { ok: false, error: "INTERNAL_ERROR" };
  }

  const runs = (data ?? []).slice(0, MEASUREMENT_HISTORY_PAGE_SIZE);
  return {
    ok: true,
    data: {
      orgId,
      businessId,
      page,
      snapshotStatus: "temporarily_unavailable",
      hasNextPage: (data ?? []).length > MEASUREMENT_HISTORY_PAGE_SIZE,
      runs: runs.map((row) => ({
        runId: row.id,
        runName: row.name,
        measuredAt: row.completed_at ?? row.created_at,
        status: "not_available",
        validCount: null,
        confirmedCount: null,
        top3Count: null,
      })),
    },
  };
}
