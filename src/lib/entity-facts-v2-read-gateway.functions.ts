import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchEntityFactsV2ReadGateway } from "./entity-facts-v2-read-gateway.server";
import type { EntityFactsV2ReadGatewayResponse } from "./entity-facts-v2-read-gateway.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Authenticated server wrapper for the Entity Facts v2 customer-safe Read Gateway.
 *
 * Important:
 * - This function is NOT wired to any route yet.
 * - Membership is verified with the current user's RLS-scoped client.
 * - The server-only gateway performs all reads from v2 materialization storage.
 */
export const getEntityFactsV2ReadGateway = createServerFn({ method: "POST" })
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
  .handler(async ({ data, context }): Promise<EntityFactsV2ReadGatewayResponse> => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (membershipError) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    return fetchEntityFactsV2ReadGateway({
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });
