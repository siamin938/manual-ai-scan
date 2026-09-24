import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ActionOpportunityEvidenceExample = {
  sourceGroupKey: string;
  entityName: string;
  domain: string;
  url: string;
};

export type ActionOpportunityEvidenceResponse =
  | { ok: true; examples: ActionOpportunityEvidenceExample[] }
  | { ok: false; error: "FORBIDDEN" | "BUSINESS_NOT_AVAILABLE" | "INTERNAL_ERROR" };

function sourceGroupForDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/^www\./, "");
  if (d === "blog.naver.com" || d.endsWith(".tistory.com")) return "blog";
  if (d === "cafe.naver.com") return "community";
  if (
    [
      "m.place.naver.com",
      "place.naver.com",
      "map.naver.com",
      "placeview.co.kr",
      "localview.co.kr",
      "daangn.com",
      "soonwidot.co.kr",
      "play.mycle.co.kr",
      "service.mycle.co.kr",
      "pf.kakao.com",
      "fcmt.purpleo.co.kr",
      "miso.kr",
      "soomgo.com",
    ].includes(d) ||
    d.endsWith(".daangn.com") ||
    d.endsWith(".miso.kr") ||
    d.endsWith(".soomgo.com")
  ) {
    return "profile_directory";
  }
  if (d === "oh-car.kr" || d.endsWith(".oh-car.kr")) return "auto_platform";
  if (
    ["news.nate.com", "yna.co.kr", "wowtv.co.kr", "v.daum.net", "n.news.naver.com", "newsis.com"].includes(d)
  ) {
    return "news";
  }
  if (d === "youtube.com" || d === "youtu.be" || d.endsWith(".youtube.com")) {
    return "video";
  }
  if (["kumhotire.com", "tstation.com", "hankooktire.com"].includes(d)) {
    return "business_brand_site";
  }
  return "other";
}

function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Customer-safe evidence examples from the selected business's latest run only.
 * Never exposes benchmark entities from other organizations.
 */
export const getActionOpportunityEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || !input?.businessId) throw new Error("INVALID_REQUEST");
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(async ({ data, context }): Promise<ActionOpportunityEvidenceResponse> => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (membershipError) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("id", data.businessId)
      .eq("org_id", data.orgId)
      .eq("is_client_business", true)
      .eq("active", true)
      .maybeSingle();

    if (businessError) return { ok: false, error: "INTERNAL_ERROR" };
    if (!business) return { ok: false, error: "BUSINESS_NOT_AVAILABLE" };

    const { data: run, error: runError } = await supabaseAdmin
      .from("measurement_runs")
      .select("id")
      .eq("org_id", data.orgId)
      .eq("business_id", data.businessId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .eq("diagnostic_scope", "customer")
      .eq("status", "completed")
      .is("experiment_id", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runError) return { ok: false, error: "INTERNAL_ERROR" };
    if (!run) return { ok: true, examples: [] };

    const { data: rows, error } = await supabaseAdmin
      .from("measurement_citation_attributions_actionable_v2")
      .select("canonical_key, canonical_display_name, citation_url, domain")
      .eq("org_id", data.orgId)
      .eq("business_id", data.businessId)
      .eq("source_run_id", run.id)
      .neq("canonical_key", `business:${data.businessId}`)
      .limit(250);

    if (error) return { ok: false, error: "INTERNAL_ERROR" };

    const counts = new Map<string, number>();
    const examples: ActionOpportunityEvidenceExample[] = [];
    const seen = new Set<string>();

    for (const row of rows ?? []) {
      const entityName =
        typeof row.canonical_display_name === "string"
          ? row.canonical_display_name.trim()
          : "";
      const domain = typeof row.domain === "string" ? row.domain.trim().toLowerCase() : "";
      const url = safeHttpUrl(row.citation_url);
      if (!entityName || !domain || !url) continue;

      const sourceGroupKey = sourceGroupForDomain(domain);
      if (sourceGroupKey === "other") continue;

      const groupCount = counts.get(sourceGroupKey) ?? 0;
      if (groupCount >= 2) continue;

      const dedupeKey = `${sourceGroupKey}\u0000${entityName}\u0000${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      counts.set(sourceGroupKey, groupCount + 1);
      examples.push({ sourceGroupKey, entityName, domain, url });
    }

    return { ok: true, examples };
  });
