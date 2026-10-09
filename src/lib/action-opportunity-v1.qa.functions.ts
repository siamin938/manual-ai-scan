import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type ActionOpportunityV1QaBusiness = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  city: string | null;
};

export type ActionOpportunityV1QaBusinessesResult =
  | { ok: true; businesses: ActionOpportunityV1QaBusiness[] }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

/**
 * Read-only lookup for the internal Action Opportunity v1.0 QA preview.
 * Does not create/register businesses, create question sets, run measurements,
 * alter scheduler gates, or debit credits.
 *
 * The separate admin-only Entity Facts v2 gateway decides the exact
 * representative Run. This search returns names/IDs, never Run facts.
 */
export const searchActionOpportunityV1QaBusinesses = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; query: string }) => {
    if (
      !input ||
      typeof input.orgId !== "string" ||
      !UUID_RE.test(input.orgId.trim()) ||
      typeof input.query !== "string"
    ) {
      throw new Error("INVALID_REQUEST");
    }
    // Prevent wildcard-only enumeration; the user must search a real name.
    const query = input.query.trim().replace(/[%_\\]/gu, "").trim();
    if (query.length < 2 || query.length > 60) {
      throw new Error("INVALID_REQUEST");
    }
    return {
      orgId: input.orgId.trim().toLowerCase(),
      query,
    };
  })
  .handler(async ({ data, context }): Promise<ActionOpportunityV1QaBusinessesResult> => {
    const client = context.supabase as unknown as RpcCaller;
    const permission = await client.rpc("can_view_data_asset_admin_v01");
    if (permission.error || permission.data !== true) {
      return { ok: false, error: "FORBIDDEN" };
    }

    // The internal-observation route never becomes a cross-org customer
    // search. The user must already have selected an internal observation org.
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("id", data.orgId)
      .eq("measurement_data_origin", "internal_observation")
      .maybeSingle();
    if (orgError) return { ok: false, error: "NOT_AVAILABLE" };
    if (!org) return { ok: false, error: "FORBIDDEN" };

    const { data: rows, error } = await supabaseAdmin
      .from("businesses")
      .select("id, name, category, region, city")
      .eq("org_id", data.orgId)
      .eq("is_client_business", true)
      .eq("active", true)
      .ilike("name", "%" + data.query + "%")
      .order("name", { ascending: true })
      .limit(15);

    if (error) return { ok: false, error: "NOT_AVAILABLE" };
    return {
      ok: true,
      businesses: (rows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        region: row.region,
        city: row.city,
      })),
    };
  });
