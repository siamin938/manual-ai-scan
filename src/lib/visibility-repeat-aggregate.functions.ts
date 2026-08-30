import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseVisibilityRepeatAggregateResponse } from "./visibility-repeat-aggregate.server";
import type { VisibilityRepeatAggregateResponseDTO } from "./visibility-diagnostic.types";

/** `get_visibility_repeat_aggregate_v01` RPC 호출용 얇은 authenticated wrapper. */
export const getVisibilityRepeatAggregate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<VisibilityRepeatAggregateResponseDTO> => {
    const { data: rpcData, error } = await context.supabase.rpc(
      "get_visibility_repeat_aggregate_v01",
      {
        p_org_id: data.orgId,
        p_business_id: data.businessId,
      },
    );

    if (error) {
      console.error("[getVisibilityRepeatAggregate] RPC error:", error);
      return { ok: false, error: "INTERNAL_ERROR" };
    }

    return parseVisibilityRepeatAggregateResponse(rpcData);
  });
