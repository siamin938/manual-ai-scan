import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchEntityFactsV2ReadGateway } from "./entity-facts-v2-read-gateway.server";
import {
  buildCustomerEvidenceReadFromCurrentRun,
  isCustomerEvidenceInsightId,
  type CustomerEvidenceInsightId,
  type CustomerEvidenceReadResponse,
} from "./action-opportunity-v1.customer-read";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Customer evidence read API — RELEASE CANDIDATE ONLY, not mounted to any UI.
 *
 * Unlike the existing admin-only getActionOpportunityV1DashboardPrivatePreview,
 * this endpoint does not call an internal-operator RPC. It instead enforces
 * authenticated user membership and an RLS-scoped business lookup BEFORE
 * service-role-backed customer-safe Entity Facts v2 reads.
 *
 * Exact current representative Run must equal the Run already displayed by
 * the caller's dashboard. Client input never includes counts or evidence.
 * No DB writes, new AI measurements, credits, or production feature flag.
 */
export const getActionOpportunityV1CustomerEvidence = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    orgId: string;
    businessId: string;
    expectedRunId: string;
    insightId: CustomerEvidenceInsightId;
  }) => {
    if (!input ||
      typeof input.orgId !== "string" ||
      typeof input.businessId !== "string" ||
      typeof input.expectedRunId !== "string" ||
      !UUID_RE.test(input.orgId.trim()) ||
      !UUID_RE.test(input.businessId.trim()) ||
      !UUID_RE.test(input.expectedRunId.trim()) ||
      !isCustomerEvidenceInsightId(input.insightId)
    ) {
      throw new Error("INVALID_REQUEST");
    }

    return {
      orgId: input.orgId.trim().toLowerCase(),
      businessId: input.businessId.trim().toLowerCase(),
      expectedRunId: input.expectedRunId.trim().toLowerCase(),
      insightId: input.insightId,
    };
  })
  .handler(async ({ data, context }): Promise<CustomerEvidenceReadResponse> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };

    // The user's own session/RLS client is the sole source of authorization.
    // Internal admins have no automatic access to another customer organization.
    const { data: membership, error: memberError } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memberError) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    const { data: business, error: businessError } = await context.supabase
      .from("businesses")
      .select("id")
      .eq("org_id", data.orgId)
      .eq("id", data.businessId)
      .eq("is_client_business", true)
      .eq("active", true)
      .maybeSingle();
    if (businessError) return { ok: false, error: "INTERNAL_ERROR" };
    if (!business || business.id !== data.businessId) {
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    // This is the exact same current customer Read Gateway as /dashboard,
    // never an arbitrary historical Run or the internal admin preview.
    const gateway = await fetchEntityFactsV2ReadGateway({
      orgId: data.orgId,
      businessId: data.businessId,
    });
    if (!gateway.ok ||
      gateway.data.business.id !== data.businessId ||
      gateway.data.scope.runId !== data.expectedRunId
    ) {
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    const result = buildCustomerEvidenceReadFromCurrentRun({
      userId: context.userId,
      orgId: data.orgId,
      businessId: data.businessId,
      expectedRunId: data.expectedRunId,
      insightId: data.insightId,
      dto: gateway.data,
    });
    return result ?? { ok: false, error: "NOT_AVAILABLE" };
  });
