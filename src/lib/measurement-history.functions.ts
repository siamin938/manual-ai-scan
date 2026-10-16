import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isUuid } from "./customer-measurement.helpers";
import {
  fetchMeasurementHistoryCatalog,
  fetchMeasurementHistoryDetail,
} from "./measurement-history.server";
import type {
  MeasurementHistoryCatalogResponse,
  MeasurementHistoryDetailResponse,
} from "./measurement-history.model";



function validateScope(orgId: unknown, businessId: unknown) {
  if (typeof orgId !== "string" || typeof businessId !== "string" ||
      !isUuid(orgId) || !isUuid(businessId)) {
    throw new Error("INVALID_REQUEST");
  }
  return { orgId: orgId.toLowerCase(), businessId: businessId.toLowerCase() };
}

/**
 * A historical result belongs to the paying organization, not the internal
 * admin. All users must pass their session's RLS-scoped membership before
 * privileged snapshot reads. No writes, AI jobs or credit changes.
 */
export const listMeasurementHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string; page: number }) => {
    const scope = validateScope(input?.orgId, input?.businessId);
    if (!Number.isInteger(input?.page) || input.page < 0 || input.page > 1000) {
      throw new Error("INVALID_REQUEST");
    }
    return { ...scope, page: input.page };
  })
  .handler(async ({ data, context }): Promise<MeasurementHistoryCatalogResponse> => {
    const { data: membership, error } = await context.supabase
      .from("organization_members").select("org_id")
      .eq("org_id", data.orgId).eq("user_id", context.userId).maybeSingle();
    if (error) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };
    return fetchMeasurementHistoryCatalog(data, context.supabase);
  });

export const getMeasurementHistoryDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string; runId: string }) => {
    const scope = validateScope(input?.orgId, input?.businessId);
    if (typeof input?.runId !== "string" || !isUuid(input.runId)) {
      throw new Error("INVALID_REQUEST");
    }
    return { ...scope, runId: input.runId.toLowerCase() };
  })
  .handler(async ({ data, context }): Promise<MeasurementHistoryDetailResponse> => {
    const { data: membership, error } = await context.supabase
      .from("organization_members").select("org_id")
      .eq("org_id", data.orgId).eq("user_id", context.userId).maybeSingle();
    if (error) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };
    return fetchMeasurementHistoryDetail(data);
  });
