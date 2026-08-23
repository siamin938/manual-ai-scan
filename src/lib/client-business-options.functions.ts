import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 대상 업체 선택용 최소 DTO. id/name 외 어떤 컬럼도 노출하지 않는다. */
export type ClientBusinessOptionDTO = {
  id: string;
  name: string;
};

export type ClientBusinessOptionsDTO = {
  businesses: ClientBusinessOptionDTO[];
};

/**
 * 조직의 활성 대상 업체(is_client_business=true, active=true) 목록.
 * RLS가 적용된 context.supabase만 사용하므로 service_role이 필요 없다.
 */
export const getClientBusinessOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_ORG");
    return { orgId: input.orgId };
  })
  .handler(async ({ data, context }): Promise<ClientBusinessOptionsDTO> => {
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error("MEMBERSHIP_CHECK_FAILED");
    if (!membership) throw new Error("FORBIDDEN");

    const { data: rows, error } = await context.supabase
      .from("businesses")
      .select("id, name")
      .eq("org_id", data.orgId)
      .eq("is_client_business", true)
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) throw new Error("BUSINESS_QUERY_FAILED");

    return { businesses: (rows ?? []).map((b) => ({ id: b.id, name: b.name })) };
  });
