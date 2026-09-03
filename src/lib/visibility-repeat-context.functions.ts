import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchVisibilityRepeatContext } from "./visibility-repeat-context.server";
import type { VisibilityRepeatContextResponseDTO } from "./visibility-repeat-context.types";

/** 반복 측정 보조 컨텍스트(출처 side 배지 / 반복 기준 미노출 질문)용 authenticated wrapper. */
export const getVisibilityRepeatContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    if (!input?.businessId || typeof input.businessId !== "string")
      throw new Error("INVALID_BUSINESS");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<VisibilityRepeatContextResponseDTO> => {
    return fetchVisibilityRepeatContext({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });
