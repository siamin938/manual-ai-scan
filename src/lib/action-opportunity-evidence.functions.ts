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

export const getActionOpportunityEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    orgId: string;
    businessId: string;
    highVisibilityThresholdPct: number;
  }) => {
    if (
      !input?.orgId ||
      !input?.businessId ||
      typeof input.highVisibilityThresholdPct !== "number" ||
      !Number.isFinite(input.highVisibilityThresholdPct)
    ) {
      throw new Error("INVALID_REQUEST");
    }
    return {
      orgId: input.orgId,
      businessId: input.businessId,
      highVisibilityThresholdPct: Math.max(
        0,
        Math.min(100, input.highVisibilityThresholdPct),
      ),
    };
  })
  .handler(async ({ data, context }): Promise<ActionOpportunityEvidenceResponse> => {
    const { data: membership, error } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    try {
      return {
        ok: true,
        examples: await fetchActionOpportunityEvidence(data),
      };
    } catch {
      // Optional evidence must never break the main dashboard.
      return { ok: true, examples: [] };
    }
  });
