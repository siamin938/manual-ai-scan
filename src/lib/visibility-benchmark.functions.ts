import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchVisibilityBenchmark } from "./visibility-benchmark.server";
import type { VisibilityBenchmarkResponseDTO } from "./visibility-benchmark.types";

/** `visibility-benchmark` Edge Function 호출용 얇은 authenticated wrapper. */
export const getVisibilityBenchmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<VisibilityBenchmarkResponseDTO> => {
    return fetchVisibilityBenchmark({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
    });
  });
