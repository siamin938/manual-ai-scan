import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.server";
import { fetchActionOpportunityEvidence } from "@/lib/action-opportunity-evidence.server";
import { buildActionOpportunityV1Preview } from "@/lib/action-opportunity-v1.rules";
import {
  buildCustomerPreviewV1Model,
  type CustomerPreviewV1Model,
} from "@/lib/action-opportunity-v1.customer-preview.viewmodel";
import type { CustomerPreviewV1SourceLink } from "@/components/action-opportunity-v1-customer-preview";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type ActionOpportunityV1DashboardPrivatePreviewResponse =
  | {
      ok: true;
      orgId: string;
      businessId: string;
      runId: string;
      model: CustomerPreviewV1Model;
      citedPages: CustomerPreviewV1SourceLink[];
    }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

/**
 * ADMIN-ONLY dashboard preview. Double permission boundary:
 * (1) global internal operator RPC, (2) selected org's RLS-scoped membership.
 *
 * The customer-facing Read Gateway is reused as the ONLY facts source.
 * Read-only, no credit debits, no external AI calls, no new measurement, no writes.
 */
export const getActionOpportunityV1DashboardPrivatePreview = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (
      !input ||
      typeof input.orgId !== "string" ||
      typeof input.businessId !== "string" ||
      !UUID_RE.test(input.orgId.trim()) ||
      !UUID_RE.test(input.businessId.trim())
    ) {
      throw new Error("INVALID_REQUEST");
    }
    return {
      orgId: input.orgId.trim().toLowerCase(),
      businessId: input.businessId.trim().toLowerCase(),
    };
  })
  .handler(async ({ data, context }): Promise<ActionOpportunityV1DashboardPrivatePreviewResponse> => {
    const rpcClient = context.supabase as unknown as RpcCaller;

    // Fail closed BEFORE reading privileged v2 materialization or citations.
    const permission = await rpcClient.rpc("can_view_data_asset_admin_v01");
    if (permission.error || permission.data !== true) {
      return { ok: false, error: "FORBIDDEN" };
    }

    // Internal admins do not automatically gain cross-organization customer
    // dashboard access: keep the existing RLS-scoped membership boundary.
    const { data: membership, error: memberError } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memberError) return { ok: false, error: "NOT_AVAILABLE" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    const gateway = await fetchEntityFactsV2ReadGateway({
      orgId: data.orgId,
      businessId: data.businessId,
    });
    if (!gateway.ok || gateway.data.business.id !== data.businessId) {
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    const opportunities = buildActionOpportunityV1Preview(gateway.data);
    const model = buildCustomerPreviewV1Model(gateway.data, opportunities);
    if (!model || model.runId !== gateway.data.scope.runId) {
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    // Optional evidence is scoped to the exact representative Run; failure
    // must not alter the diagnostic or promote an unverified citation.
    let citedPages: CustomerPreviewV1SourceLink[] = [];
    const sourceDomain = opportunities.items
      .find((item) => item.id === "competitor_source_difference")
      ?.evidence.find((row) => row.label === "출처")?.value;

    if (sourceDomain) {
      try {
        const evidence = await fetchActionOpportunityEvidence({
          orgId: data.orgId,
          businessId: data.businessId,
          highVisibilityThresholdPct: 0,
          expectedRunId: gateway.data.scope.runId,
          focusDomain: sourceDomain,
        });
        citedPages = evidence.currentRunReferences
          .filter((row) => row.domain === sourceDomain)
          .flatMap((source) =>
            source.entities.map((item) => ({
              entityName: item.entityName,
              url: item.url,
            })),
          );
      } catch {
        citedPages = [];
      }
    }

    return {
      ok: true,
      orgId: data.orgId,
      businessId: data.businessId,
      runId: gateway.data.scope.runId,
      model,
      citedPages,
    };
  });
