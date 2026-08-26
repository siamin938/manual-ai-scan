import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchVisibilityDiagnostic } from "./visibility-diagnostic.server";
import type { VisibilityDiagnosticResponseDTO } from "./visibility-diagnostic.types";

/**
 * `visibility-diagnostic` Edge Function 호출용 얇은 authenticated wrapper.
 * 입력은 `{ orgId, businessId }`, 출력은 Edge Function이 준 최소 DTO뿐이다.
 */
export const getVisibilityDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<VisibilityDiagnosticResponseDTO> => {
    return fetchVisibilityDiagnostic({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });
