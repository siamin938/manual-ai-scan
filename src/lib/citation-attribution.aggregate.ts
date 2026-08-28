/**
 * Pure counting of stored attribution rows for the customer comparison view.
 * No rules, no thresholds: it only groups already-decided rows by domain.
 */

import type { CompetitorAttributedSourceDTO } from "./visibility-competitor.types";

export type AttributionAggregateRow = {
  domain: string | null;
  title: string | null;
  measurement_id: string;
  canonical_key: string;
  canonical_display_name: string;
  attribution_level: string;
};

export function aggregateAttributedSources(args: {
  rows: AttributionAggregateRow[];
  clientKey: string;
  competitorKey: string;
  competitorName: string;
}): CompetitorAttributedSourceDTO[] {
  const { rows, clientKey, competitorKey, competitorName } = args;
  type Bucket = {
    domain: string;
    sampleTitle: string | null;
    clientDirect: Set<string>;
    clientSection: Set<string>;
    competitorDirect: Set<string>;
    competitorSection: Set<string>;
    clientDirectCitations: number;
    clientSectionCitations: number;
    competitorDirectCitations: number;
    competitorSectionCitations: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const domain = row.domain;
    if (!domain) continue;
    const isClient = row.canonical_key === clientKey;
    const isCompetitor =
      row.canonical_key === competitorKey || row.canonical_display_name === competitorName;
    if (!isClient && !isCompetitor) continue;
    const level = row.attribution_level;
    if (level !== "direct" && level !== "section") continue;

    let bucket = buckets.get(domain);
    if (!bucket) {
      bucket = {
        domain,
        sampleTitle: row.title ?? null,
        clientDirect: new Set(),
        clientSection: new Set(),
        competitorDirect: new Set(),
        competitorSection: new Set(),
        clientDirectCitations: 0,
        clientSectionCitations: 0,
        competitorDirectCitations: 0,
        competitorSectionCitations: 0,
      };
      buckets.set(domain, bucket);
    }
    if (!bucket.sampleTitle && row.title) bucket.sampleTitle = row.title;

    if (isClient) {
      if (level === "direct") {
        bucket.clientDirect.add(row.measurement_id);
        bucket.clientDirectCitations += 1;
      } else {
        bucket.clientSection.add(row.measurement_id);
        bucket.clientSectionCitations += 1;
      }
    }
    if (isCompetitor) {
      if (level === "direct") {
        bucket.competitorDirect.add(row.measurement_id);
        bucket.competitorDirectCitations += 1;
      } else {
        bucket.competitorSection.add(row.measurement_id);
        bucket.competitorSectionCitations += 1;
      }
    }
  }

  return Array.from(buckets.values())
    .map((b) => ({
      domain: b.domain,
      sampleTitle: b.sampleTitle,
      clientDirectResponseCount: b.clientDirect.size,
      clientSectionResponseCount: b.clientSection.size,
      clientDirectCitationCount: b.clientDirectCitations,
      clientSectionCitationCount: b.clientSectionCitations,
      competitorDirectResponseCount: b.competitorDirect.size,
      competitorSectionResponseCount: b.competitorSection.size,
      competitorDirectCitationCount: b.competitorDirectCitations,
      competitorSectionCitationCount: b.competitorSectionCitations,
    }))
    .sort(
      (a, b) =>
        b.clientDirectResponseCount +
        b.competitorDirectResponseCount -
        (a.clientDirectResponseCount + a.competitorDirectResponseCount) ||
        b.clientSectionResponseCount +
          b.competitorSectionResponseCount -
          (a.clientSectionResponseCount + a.competitorSectionResponseCount) ||
        a.domain.localeCompare(b.domain),
    );
}
