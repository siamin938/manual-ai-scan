import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchActionRecommendations } from "./visibility-actions.server";
import type { ActionRecommendationsResponseDTO } from "./visibility-actions.types";

/** `visibility-action-recommendations` Edge Function 호출용 얇은 authenticated wrapper. */
export const getActionRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<ActionRecommendationsResponseDTO> => {
    return fetchActionRecommendations({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });
