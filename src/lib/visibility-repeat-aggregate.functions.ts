import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchVisibilityRepeatAggregate } from "./visibility-repeat-aggregate.server";
import type { VisibilityRepeatAggregateResponseDTO } from "./visibility-diagnostic.types";

/** `visibility-repeat-aggregate` Edge Function 호출용 얇은 authenticated wrapper. */
export const getVisibilityRepeatAggregate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<VisibilityRepeatAggregateResponseDTO> => {
    return fetchVisibilityRepeatAggregate({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });
