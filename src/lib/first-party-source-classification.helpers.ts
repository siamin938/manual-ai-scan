/**
 * Pure helpers for the First-party Source Classification pipeline v0.1.
 *
 * SECURITY: this module holds only deterministic mapping/aggregation logic.
 * It never touches Supabase, secrets, response_text, provider payloads or
 * parsing context. Registry internals and URLs stay inside the server module
 * and are never part of the returned summary.
 */

import {
  classifyFirstPartySource,
  type ClassificationResult,
  type FirstPartySourceRegistryEntry,
  type MatchMode,
  type FirstPartySourceType,
} from "./first-party-source-classifier";

export const FIRST_PARTY_CLASSIFIER_VERSION = "0.1.0";

/** Minimal registry row shape read from public.business_first_party_sources. */
export interface FirstPartySourceRow {
  id: string;
  source_type: string;
  canonical_url: string | null;
  normalized_host: string | null;
  resource_key: string | null;
  match_mode: string;
  verification_status: string;
  active: boolean;
}

/** Minimal source row shape read from public.measurement_sources. */
export interface MeasurementSourceRow {
  id: string;
  url: string;
  domain?: string | null;
}

export interface ClassificationInsertRow {
  org_id: string;
  business_id: string;
  measurement_source_id: string;
  classification: string;
  matched_first_party_source_id: string | null;
  source_type: string | null;
  match_method: string | null;
  confidence: string;
  classifier_version: string;
}

export interface ClassificationRunSummary {
  classifierVersion: string;
  sourceCount: number;
  insertedCount: number;
  skippedCount: number;
  firstPartyCount: number;
  thirdPartyCount: number;
  lowConfidenceCount: number;
}

const SOURCE_TYPES: readonly string[] = ["owned_domain", "naver_place", "naver_blog"];
const MATCH_MODES: readonly string[] = ["host_or_subdomain", "exact_url", "resource_prefix"];

/** Map raw registry rows to classifier entries, dropping unusable/unverified ones. */
export function toRegistryEntries(
  rows: readonly FirstPartySourceRow[],
): FirstPartySourceRegistryEntry[] {
  const entries: FirstPartySourceRegistryEntry[] = [];
  for (const row of rows ?? []) {
    if (!row || !row.id) continue;
    if (!row.active) continue;
    if (row.verification_status !== "verified") continue;
    if (!SOURCE_TYPES.includes(row.source_type)) continue;
    if (!MATCH_MODES.includes(row.match_mode)) continue;
    entries.push({
      id: row.id,
      sourceType: row.source_type as FirstPartySourceType,
      canonicalUrl: row.canonical_url ?? null,
      normalizedHost: row.normalized_host ?? null,
      resourceKey: row.resource_key ?? null,
      matchMode: row.match_mode as MatchMode,
      verificationStatus: "verified",
      active: true,
    });
  }
  return entries;
}

/** Build the persistable row for a single classification result. */
export function buildClassificationRow(args: {
  orgId: string;
  businessId: string;
  measurementSourceId: string;
  result: ClassificationResult;
}): ClassificationInsertRow {
  const { result } = args;
  return {
    org_id: args.orgId,
    business_id: args.businessId,
    measurement_source_id: args.measurementSourceId,
    classification: result.classification,
    matched_first_party_source_id: result.matchedFirstPartySourceId,
    source_type: result.sourceType,
    match_method: result.matchMethod === "none" ? null : result.matchMethod,
    confidence: result.confidence,
    classifier_version: FIRST_PARTY_CLASSIFIER_VERSION,
  };
}

/**
 * Classify a batch of measurement sources, skipping ids that already have a
 * stored classification for this classifier version. Existing rows are never
 * updated or deleted — provenance per version is preserved.
 */
export function buildClassificationRows(args: {
  orgId: string;
  businessId: string;
  sources: readonly MeasurementSourceRow[];
  registry: readonly FirstPartySourceRegistryEntry[];
  alreadyClassifiedSourceIds: ReadonlySet<string>;
}): { rows: ClassificationInsertRow[]; skippedCount: number } {
  const rows: ClassificationInsertRow[] = [];
  const seen = new Set<string>();
  let skippedCount = 0;

  for (const source of args.sources ?? []) {
    if (!source?.id) continue;
    if (args.alreadyClassifiedSourceIds.has(source.id) || seen.has(source.id)) {
      skippedCount += 1;
      continue;
    }
    seen.add(source.id);
    const result = classifyFirstPartySource(
      { url: source.url, domain: source.domain ?? null },
      args.registry,
    );
    rows.push(
      buildClassificationRow({
        orgId: args.orgId,
        businessId: args.businessId,
        measurementSourceId: source.id,
        result,
      }),
    );
  }

  return { rows, skippedCount };
}

/** Aggregate a SAFE summary. No ids, urls or registry details are included. */
export function summarizeClassificationRows(args: {
  sourceCount: number;
  skippedCount: number;
  insertedRows: readonly ClassificationInsertRow[];
}): ClassificationRunSummary {
  let firstPartyCount = 0;
  let thirdPartyCount = 0;
  let lowConfidenceCount = 0;

  for (const row of args.insertedRows ?? []) {
    if (row.classification === "first_party") firstPartyCount += 1;
    else thirdPartyCount += 1;
    if (row.confidence === "low") lowConfidenceCount += 1;
  }

  return {
    classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
    sourceCount: args.sourceCount,
    insertedCount: args.insertedRows?.length ?? 0,
    skippedCount: args.skippedCount,
    firstPartyCount,
    thirdPartyCount,
    lowConfidenceCount,
  };
}

/** Merge per-batch summaries into one cumulative SAFE summary. */
export function mergeSummaries(
  summaries: readonly ClassificationRunSummary[],
): ClassificationRunSummary {
  return (summaries ?? []).reduce<ClassificationRunSummary>(
    (acc, s) => ({
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      sourceCount: acc.sourceCount + s.sourceCount,
      insertedCount: acc.insertedCount + s.insertedCount,
      skippedCount: acc.skippedCount + s.skippedCount,
      firstPartyCount: acc.firstPartyCount + s.firstPartyCount,
      thirdPartyCount: acc.thirdPartyCount + s.thirdPartyCount,
      lowConfidenceCount: acc.lowConfidenceCount + s.lowConfidenceCount,
    }),
    {
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      sourceCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      firstPartyCount: 0,
      thirdPartyCount: 0,
      lowConfidenceCount: 0,
    },
  );
}
