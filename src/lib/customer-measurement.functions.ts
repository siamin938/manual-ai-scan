import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isUuid, type CreateCustomerMeasurementResult } from "./customer-measurement.helpers";

export type { CreateCustomerMeasurementResult };

export const startCustomerMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { orgId: string; businessId: string; questionSetId: string; name?: string }) => {
      if (!isUuid(input?.orgId) || !isUuid(input?.businessId) || !isUuid(input?.questionSetId)) {
        throw new Error("INVALID_INPUT");
      }
      return {
        orgId: input.orgId,
        businessId: input.businessId,
        questionSetId: input.questionSetId,
        name: typeof input.name === "string" ? input.name.slice(0, 120) : "",
      };
    },
  )
  .handler(async ({ data, context }): Promise<CreateCustomerMeasurementResult> => {
    const { createCustomerMeasurementRun } = await import("./customer-measurement.server");
    try {
      return await createCustomerMeasurementRun({
        supabase: context.supabase,
        userId: context.userId,
        orgId: data.orgId,
        businessId: data.businessId,
        questionSetId: data.questionSetId,
        name: data.name,
      });
    } catch {
      return { ok: false, error: "MEASUREMENT_NOT_READY" };
    }
  });
