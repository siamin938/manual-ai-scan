import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchCustomDiagnostic } from "./custom-diagnostic.server";
import type { CustomDiagnosticResponse } from "./custom-diagnostic.helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const getCustomDiagnostic = createServerFn({ method: "POST" })
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
  .handler(async ({ data, context }): Promise<CustomDiagnosticResponse> => {
    const { data: membership, error } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };
    return fetchCustomDiagnostic(data);
  });
