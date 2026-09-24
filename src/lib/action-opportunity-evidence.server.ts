import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ActionOpportunityEvidenceExample = {
  sourceGroupKey: string;
  entityName: string;
  domain: string;
  url: string;
};

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

export async function fetchActionOpportunityEvidence(args: {
  orgId: string;
  businessId: string;
}): Promise<ActionOpportunityEvidenceExample[]> {
  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", args.businessId)
    .eq("org_id", args.orgId)
    .eq("is_client_business", true)
    .eq("active", true)
    .maybeSingle();

  if (businessError || !business) return [];

  const { data: run, error: runError } = await supabaseAdmin
    .from("measurement_runs")
    .select("id")
    .eq("org_id", args.orgId)
    .eq("business_id", args.businessId)
    .eq("run_type", "audit")
    .eq("phase", "standalone")
    .eq("diagnostic_scope", "customer")
    .eq("status", "completed")
    .is("experiment_id", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError || !run) return [];

  const { data: rows, error } = await supabaseAdmin
    .from("measurement_citation_attributions_actionable_v2")
    .select("canonical_key, canonical_display_name, citation_url, domain")
    .eq("org_id", args.orgId)
    .eq("business_id", args.businessId)
    .eq("source_run_id", run.id)
    .neq("canonical_key", `business:${args.businessId}`)
    .limit(250);

  if (error) return [];

  const counts = new Map<string, number>();
  const examples: ActionOpportunityEvidenceExample[] = [];
  const seen = new Set<string>();

  for (const row of rows ?? []) {
    const entityName =
      typeof row.canonical_display_name === "string"
        ? row.canonical_display_name.trim()
        : "";
    const domain =
      typeof row.domain === "string" ? row.domain.trim().toLowerCase() : "";
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

  return examples;
}
