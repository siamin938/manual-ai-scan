import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchEntityFactsV2Comparison } from "./entity-facts-v2-comparison.server";
import type { EntityFactsV2ComparisonResponse } from "./entity-facts-v2-comparison.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Authenticated wrapper for the customer-safe Entity Facts v2 comparison
 * contract. This is intentionally not wired to the dashboard yet.
 */
export const getEntityFactsV2Comparison = createServerFn({ method: "POST" })
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
  .handler(
    async ({ data, context }): Promise<EntityFactsV2ComparisonResponse> => {
      const { data: membership, error: membershipError } =
        await context.supabase
          .from("organization_members")
          .select("org_id")
          .eq("org_id", data.orgId)
          .eq("user_id", context.userId)
          .maybeSingle();

      if (membershipError) return { ok: false, error: "INTERNAL_ERROR" };
      if (!membership) return { ok: false, error: "FORBIDDEN" };

      return fetchEntityFactsV2Comparison({
        orgId: data.orgId,
        businessId: data.businessId,
      });
    },
  );
