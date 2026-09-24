import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.server";

export type ActionOpportunityEvidenceExample = {
  sourceGroupKey: string;
  entityName: string;
  domain: string;
  url: string;
  attributionLevel: "direct" | "section";
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
  ) return "profile_directory";
  if (d === "oh-car.kr" || d.endsWith(".oh-car.kr")) return "auto_platform";
  if (["news.nate.com","yna.co.kr","wowtv.co.kr","v.daum.net","n.news.naver.com","newsis.com"].includes(d)) return "news";
  if (d === "youtube.com" || d === "youtu.be" || d.endsWith(".youtube.com")) return "video";
  if (["kumhotire.com","tstation.com","hankooktire.com"].includes(d)) return "business_brand_site";
  return "other";
}

function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeEntitySurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

export async function fetchActionOpportunityEvidence(args: {
  orgId: string;
  businessId: string;
  highVisibilityThresholdPct: number;
}): Promise<ActionOpportunityEvidenceExample[]> {
  const gateway = await fetchEntityFactsV2ReadGateway({
    orgId: args.orgId,
    businessId: args.businessId,
  });
  if (!gateway.ok) return [];

  const validCount = gateway.data.overview.validCount;
  if (validCount <= 0) return [];

  const thresholdPct = Math.max(
    0,
    Math.min(100, args.highVisibilityThresholdPct),
  );
  const confirmedCompetitorSurfaces = new Set(
    gateway.data.competitors
      .filter(
        (competitor) =>
          (100 * competitor.responseCount) / validCount >= thresholdPct,
      )
      .map((competitor) => normalizeEntitySurface(competitor.name)),
  );
  if (confirmedCompetitorSurfaces.size === 0) return [];

  const { data: run } = await supabaseAdmin
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

  if (!run) return [];

  const { data: rows, error } = await supabaseAdmin
    .from("measurement_citation_attributions_actionable_v2")
    .select("canonical_key, canonical_display_name, citation_url, domain, attribution_level")
    .eq("org_id", args.orgId)
    .eq("business_id", args.businessId)
    .eq("source_run_id", run.id)
    .neq("canonical_key", `business:${args.businessId}`)
    .in("attribution_level", ["direct", "section"])
    .limit(300);

  if (error) return [];

  const normalized = (rows ?? [])
    .map((row) => {
      const entityName =
        typeof row.canonical_display_name === "string"
          ? row.canonical_display_name.trim()
          : "";
      const domain =
        typeof row.domain === "string" ? row.domain.trim().toLowerCase() : "";
      const url = safeHttpUrl(row.citation_url);
      const sourceGroupKey = sourceGroupForDomain(domain);
      const attributionLevel =
        row.attribution_level === "direct" ? "direct" : "section";
      if (!entityName || !domain || !url || sourceGroupKey === "other") return null;
      if (!confirmedCompetitorSurfaces.has(normalizeEntitySurface(entityName))) {
        return null;
      }
      return { sourceGroupKey, entityName, domain, url, attributionLevel };
    })
    .filter((row): row is ActionOpportunityEvidenceExample => row !== null)
    .sort((a, b) =>
      (a.attributionLevel === "direct" ? 0 : 1) -
        (b.attributionLevel === "direct" ? 0 : 1) ||
      a.entityName.localeCompare(b.entityName, "ko") ||
      a.domain.localeCompare(b.domain, "en")
    );

  const out: ActionOpportunityEvidenceExample[] = [];
  const perGroup = new Map<string, number>();
  const seen = new Set<string>();

  for (const row of normalized) {
    if ((perGroup.get(row.sourceGroupKey) ?? 0) >= 2) continue;
    const key = `${row.sourceGroupKey}\u0000${normalizeEntitySurface(row.entityName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perGroup.set(row.sourceGroupKey, (perGroup.get(row.sourceGroupKey) ?? 0) + 1);
    out.push(row);
  }

  return out;
}
