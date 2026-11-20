import { savedSourceUrl } from "./diagnostic-source-links";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.server";
import { selectSafeCitationPageForEntity, type CitationPageCandidate } from "@/lib/action-opportunity-citation-selection";

export type ActionOpportunityEvidenceExample = {
  sourceGroupKey: string;
  entityName: string;
  domain: string;
  url: string;
  attributionLevel: "direct" | "section";
};

export type CurrentRunSourceReference = {
  sourceGroupKey: string;
  domain: string;
  responseCount: number;
  entityCount: number;
  entities: Array<{
    entityName: string;
    url: string;
    attributionLevel: "direct" | "section";
  }>;
};

export type ActionOpportunityEvidenceResult = {
  highVisibilityExamples: ActionOpportunityEvidenceExample[];
  currentRunReferences: CurrentRunSourceReference[];
  peerPageReferences: CurrentRunSourceReference[];
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
  /** Admin QA may pin evidence to its exact displayed representative Run. */
  expectedRunId?: string;
  /** Admin QA may narrow the source comparison to one observed domain. */
  focusDomain?: string;
}): Promise<ActionOpportunityEvidenceResult> {
  const empty: ActionOpportunityEvidenceResult = {
    highVisibilityExamples: [],
    currentRunReferences: [],
    peerPageReferences: [],
  };

  const gateway = await fetchEntityFactsV2ReadGateway({
    orgId: args.orgId,
    businessId: args.businessId,
  });
  if (!gateway.ok) return empty;

  const validCount = gateway.data.overview.validCount;
  if (validCount <= 0) return empty;

  const allCompetitorSurfaces = new Set(
    gateway.data.competitors.map((competitor) =>
      normalizeEntitySurface(competitor.name),
    ),
  );

  const thresholdPct = Math.max(
    0,
    Math.min(100, args.highVisibilityThresholdPct),
  );
  const highVisibilityCompetitorSurfaces = new Set(
    gateway.data.competitors
      .filter(
        (competitor) =>
          (100 * competitor.responseCount) / validCount >= thresholdPct,
      )
      .map((competitor) => normalizeEntitySurface(competitor.name)),
  );

  const referenceSourceByDomain = new Map(
    gateway.data.observedSources
      .filter(
        (source) =>
          source.evidence !== "clue" &&
          source.competitorResponseCount > 0 &&
          (!args.focusDomain ||
            source.domain.toLowerCase().replace(/^www\./u, "") ===
              args.focusDomain.trim().toLowerCase().replace(/^www\./u, "")),
      )
      .map((source) => [
        source.domain.toLowerCase().replace(/^www\./, ""),
        {
          responseCount: source.competitorResponseCount,
          exclusive: source.targetResponseCount === 0,
          competitorNames: new Set(
            source.linkedEntities
              .filter(
                (entity) =>
                  !entity.isTarget && entity.evidence === "confirmed",
              )
              .map((entity) => normalizeEntitySurface(entity.name)),
          ),
        },
      ]),
  );

  // Evidence must use the exact representative run already validated by the
  // dashboard read gateway. Do not independently pick another "latest" run.
  const sourceRunId = gateway.data.scope.runId;
  if (args.expectedRunId && args.expectedRunId !== sourceRunId) {
    return empty;
  }
  const { data: rows, error, count } = await supabaseAdmin
    .from("measurement_citation_attributions_actionable_v2")
    .select("canonical_key, canonical_display_name, citation_url, domain, attribution_level", { count: "exact" })
    .eq("org_id", args.orgId)
    .eq("business_id", args.businessId)
    .eq("source_run_id", sourceRunId)
    .neq("canonical_key", `business:${args.businessId}`)
    .in("attribution_level", ["direct", "section"])
    .limit(1000);

  if (error || !rows || count !== rows.length) return empty;

  const normalized = (rows ?? [])
    .map((row) => {
      const entityName =
        typeof row.canonical_display_name === "string"
          ? row.canonical_display_name.trim()
          : "";
      const domain =
        typeof row.domain === "string"
          ? row.domain.trim().toLowerCase().replace(/^www\./, "")
          : "";
      const url = savedSourceUrl(row.citation_url, domain);
      const sourceGroupKey = sourceGroupForDomain(domain);
      const attributionLevel: "direct" | "section" =
        row.attribution_level === "direct" ? "direct" : "section";
      if (!entityName || !domain || !url) return null;
      const entitySurface = normalizeEntitySurface(entityName);
      if (!allCompetitorSurfaces.has(entitySurface)) return null;
      return {
        sourceGroupKey,
        entityName,
        entitySurface,
        domain,
        url,
        attributionLevel,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) =>
      (a.attributionLevel === "direct" ? 0 : 1) -
        (b.attributionLevel === "direct" ? 0 : 1) ||
      a.entityName.localeCompare(b.entityName, "ko") ||
      a.domain.localeCompare(b.domain, "en")
    );

  // Source examples use the same guarded link selection as the current-run
  // references. An attribution with two incompatible URLs must not turn into
  // an arbitrary "business page" link in the existing dashboard.
  const highVisibilityByEntityDomain = new Map<
    string,
    {
      sourceGroupKey: string;
      entityName: string;
      entitySurface: string;
      domain: string;
      candidates: CitationPageCandidate[];
    }
  >();
  for (const row of normalized) {
    if (row.sourceGroupKey === "other") continue;
    if (!highVisibilityCompetitorSurfaces.has(row.entitySurface)) continue;
    const key = `${row.sourceGroupKey}\u0000${row.entitySurface}\u0000${row.domain}`;
    const bucket = highVisibilityByEntityDomain.get(key);
    if (bucket) {
      bucket.candidates.push({
        url: row.url,
        attributionLevel: row.attributionLevel,
      });
    } else {
      highVisibilityByEntityDomain.set(key, {
        sourceGroupKey: row.sourceGroupKey,
        entityName: row.entityName,
        entitySurface: row.entitySurface,
        domain: row.domain,
        candidates: [{
          url: row.url,
          attributionLevel: row.attributionLevel,
        }],
      });
    }
  }

  const highVisibilityExamples: ActionOpportunityEvidenceExample[] = [];
  const perGroup = new Map<string, number>();
  const highSeen = new Set<string>();

  for (const bucket of highVisibilityByEntityDomain.values()) {
    if ((perGroup.get(bucket.sourceGroupKey) ?? 0) >= 2) continue;
    const entityKey = `${bucket.sourceGroupKey}\u0000${bucket.entitySurface}`;
    if (highSeen.has(entityKey)) continue;
    const page = selectSafeCitationPageForEntity(
      bucket.entityName,
      bucket.candidates,
    );
    if (!page) continue;
    highSeen.add(entityKey);
    perGroup.set(
      bucket.sourceGroupKey,
      (perGroup.get(bucket.sourceGroupKey) ?? 0) + 1,
    );
    highVisibilityExamples.push({
      sourceGroupKey: bucket.sourceGroupKey,
      entityName: bucket.entityName,
      domain: bucket.domain,
      ...page,
    });
  }

  const groupedReferences = new Map<
    string,
    {
      sourceGroupKey: string;
      domain: string;
      responseCount: number;
      entities: Map<
        string,
        {
          entityName: string;
          candidates: CitationPageCandidate[];
        }
      >;
    }
  >();

  for (const row of normalized) {
    const referenceSource = referenceSourceByDomain.get(row.domain);
    if (!referenceSource) continue;
    if (!referenceSource.competitorNames.has(row.entitySurface)) continue;

    let group = groupedReferences.get(row.domain);
    if (!group) {
      group = {
        sourceGroupKey: row.sourceGroupKey,
        domain: row.domain,
        responseCount: referenceSource.responseCount,
        entities: new Map(),
      };
      groupedReferences.set(row.domain, group);
    }

    const existing = group.entities.get(row.entitySurface);
    if (existing) {
      existing.candidates.push({
        url: row.url,
        attributionLevel: row.attributionLevel,
      });
    } else {
      group.entities.set(row.entitySurface, {
        entityName: row.entityName,
        candidates: [{
          url: row.url,
          attributionLevel: row.attributionLevel,
        }],
      });
    }
  }

  const peerPageReferences = [...groupedReferences.values()]
    .map((group) => {
      const safeEntities = [...group.entities.values()]
        .map((entity) => {
          const page = selectSafeCitationPageForEntity(
            entity.entityName,
            entity.candidates,
          );
          return page
            ? { entityName: entity.entityName, ...page }
            : null;
        })
        .filter((entity): entity is NonNullable<typeof entity> => entity !== null)
        .sort(
          (a, b) =>
            (a.attributionLevel === "direct" ? 0 : 1) -
              (b.attributionLevel === "direct" ? 0 : 1) ||
            a.entityName.localeCompare(b.entityName, "ko"),
        );
      return {
        sourceGroupKey: group.sourceGroupKey,
        domain: group.domain,
        responseCount: group.responseCount,
        entityCount: safeEntities.length,
        entities: safeEntities,
      };
    })
    .filter((group) => group.entityCount > 0)
    .sort(
      (a, b) =>
        b.entityCount - a.entityCount ||
        b.responseCount - a.responseCount ||
        a.domain.localeCompare(b.domain, "en"),
    );

  const currentRunReferences = peerPageReferences
    .filter(group => referenceSourceByDomain.get(group.domain)?.exclusive)
    .slice(0, 3)
    .map(group => ({ ...group, entities: group.entities.slice(0, 3) }));

  return {
    highVisibilityExamples,
    currentRunReferences,
    peerPageReferences,
  };
}
