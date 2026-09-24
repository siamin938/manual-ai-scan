import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchActionOpportunityEvidence,
  type ActionOpportunityEvidenceExample,
} from "@/lib/action-opportunity-evidence.server";

export type { ActionOpportunityEvidenceExample };

export type ActionOpportunityEvidenceResponse =
  | { ok: true; examples: ActionOpportunityEvidenceExample[] }
  | { ok: false; error: "FORBIDDEN" | "INTERNAL_ERROR" };

/**
 * Authenticated wrapper for customer-safe evidence from the selected
 * business's latest measurement only.
 */
export const getActionOpportunityEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || !input?.businessId) throw new Error("INVALID_REQUEST");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(
    async ({ data, context }): Promise<ActionOpportunityEvidenceResponse> => {
      const { data: membership, error: membershipError } = await context.supabase
        .from("organization_members")
        .select("org_id")
        .eq("org_id", data.orgId)
        .eq("user_id", context.userId)
        .maybeSingle();

      if (membershipError) return { ok: false, error: "INTERNAL_ERROR" };
      if (!membership) return { ok: false, error: "FORBIDDEN" };

      try {
        const examples = await fetchActionOpportunityEvidence({
          orgId: data.orgId,
          businessId: data.businessId,
        });
        return { ok: true, examples };
      } catch {
        return { ok: false, error: "INTERNAL_ERROR" };
      }
    },
  );
