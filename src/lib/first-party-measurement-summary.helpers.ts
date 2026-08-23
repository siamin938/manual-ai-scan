/**
 * Pure aggregation helpers for the First-party measurement summary pipeline v0.1.
 *
 * SECURITY: deterministic in-memory aggregation only. No Supabase, no secrets,
 * no response_text / provider payload / parsing context / aliases. Registry
 * internals and URLs never enter this module.
 *
 * This layer is additive: it never reads or changes `client_domain_cited`
 * or `domain_citation_rate`.
 */

import { FIRST_PARTY_CLASSIFIER_VERSION } from "./first-party-source-classification.helpers";

export { FIRST_PARTY_CLASSIFIER_VERSION };

/** Classification row shape needed for aggregation (no urls, no registry data). */
export interface SourceClassificationFact {
  measurement_source_id: string;
  classification: string;
  confidence: string;
}

export interface MeasurementSourceFact {
  measurementId: string;
  sourceIds: readonly string[];
}

export interface MeasurementSummaryInsertRow {
  org_id: string;
  business_id: string;
  measurement_id: string;
  classifier_version: string;
  source_count: number;
  first_party_source_count: number;
  client_first_party_cited: boolean;
  low_confidence_source_count: number;
}

export interface MeasurementSummaryRunSummary {
  classifierVersion: string;
  measurementCount: number;
  insertedCount: number;
  skippedCount: number;
  incompleteClassificationCount: number;
  citedMeasurementCount: number;
  uncitedMeasurementCount: number;
}

export interface BuildMeasurementSummaryResult {
  rows: MeasurementSummaryInsertRow[];
  skippedCount: number;
  incompleteClassificationCount: number;
}

/**
 * Build summary rows for a batch of measurements.
 *
 * - measurements with zero sources produce a row with source_count = 0.
 * - measurements whose classification count does not match their source count
 *   are NOT persisted; they are counted as incomplete so partial data is never
 *   frozen into a `false` citation verdict.
 * - measurements that already have a row for this classifier version are skipped.
 */
export function buildMeasurementSummaryRows(args: {
  orgId: string;
  businessId: string;
  measurements: readonly MeasurementSourceFact[];
  classifications: readonly SourceClassificationFact[];
  alreadySummarizedMeasurementIds: ReadonlySet<string>;
}): BuildMeasurementSummaryResult {
  const bySourceId = new Map<string, SourceClassificationFact>();
  for (const c of args.classifications ?? []) {
    if (c?.measurement_source_id) bySourceId.set(c.measurement_source_id, c);
  }

  const rows: MeasurementSummaryInsertRow[] = [];
  const seen = new Set<string>();
  let skippedCount = 0;
  let incompleteClassificationCount = 0;

  for (const m of args.measurements ?? []) {
    if (!m?.measurementId) continue;
    if (args.alreadySummarizedMeasurementIds.has(m.measurementId) || seen.has(m.measurementId)) {
      skippedCount += 1;
      continue;
    }
    seen.add(m.measurementId);

    const sourceIds = [...new Set(m.sourceIds ?? [])];
    const facts = sourceIds
      .map((id) => bySourceId.get(id))
      .filter((f): f is SourceClassificationFact => !!f);

    if (facts.length !== sourceIds.length) {
      incompleteClassificationCount += 1;
      continue;
    }

    const firstPartyCount = facts.filter((f) => f.classification === "first_party").length;
    const lowConfidenceCount = facts.filter((f) => f.confidence === "low").length;

    rows.push({
      org_id: args.orgId,
      business_id: args.businessId,
      measurement_id: m.measurementId,
      classifier_version: FIRST_PARTY_CLASSIFIER_VERSION,
      source_count: sourceIds.length,
      first_party_source_count: firstPartyCount,
      client_first_party_cited: firstPartyCount > 0,
      low_confidence_source_count: lowConfidenceCount,
    });
  }

  return { rows, skippedCount, incompleteClassificationCount };
}

/** SAFE aggregate summary. No ids, urls or registry details. */
export function summarizeMeasurementSummaryRows(args: {
  measurementCount: number;
  skippedCount: number;
  incompleteClassificationCount: number;
  insertedRows: readonly MeasurementSummaryInsertRow[];
}): MeasurementSummaryRunSummary {
  let citedMeasurementCount = 0;
  let uncitedMeasurementCount = 0;
  for (const row of args.insertedRows ?? []) {
    if (row.client_first_party_cited) citedMeasurementCount += 1;
    else uncitedMeasurementCount += 1;
  }
  return {
    classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
    measurementCount: args.measurementCount,
    insertedCount: args.insertedRows?.length ?? 0,
    skippedCount: args.skippedCount,
    incompleteClassificationCount: args.incompleteClassificationCount,
    citedMeasurementCount,
    uncitedMeasurementCount,
  };
}

export function mergeMeasurementSummaries(
  summaries: readonly MeasurementSummaryRunSummary[],
): MeasurementSummaryRunSummary {
  return (summaries ?? []).reduce<MeasurementSummaryRunSummary>(
    (acc, s) => ({
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      measurementCount: acc.measurementCount + s.measurementCount,
      insertedCount: acc.insertedCount + s.insertedCount,
      skippedCount: acc.skippedCount + s.skippedCount,
      incompleteClassificationCount:
        acc.incompleteClassificationCount + s.incompleteClassificationCount,
      citedMeasurementCount: acc.citedMeasurementCount + s.citedMeasurementCount,
      uncitedMeasurementCount: acc.uncitedMeasurementCount + s.uncitedMeasurementCount,
    }),
    {
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      measurementCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      incompleteClassificationCount: 0,
      citedMeasurementCount: 0,
      uncitedMeasurementCount: 0,
    },
  );
}

/* ------------------------------------------------------------------ */
/* Profile Coverage aggregation (pure)                                 */
/* ------------------------------------------------------------------ */

export interface EligibleMeasurementFact {
  measurementId: string;
  questionId: string;
}

export interface CoverageFirstPartyQuestionResult {
  questionId: string;
  measurementCount: number;
  firstPartyCitedCount: number;
  firstPartyCitationRate: number;
}

export interface CoverageFirstPartyAggregate {
  complete: boolean;
  missingSummaryCount: number;
  eligibleCount: number;
  citedCount: number;
  clientFirstPartyCitationRate: number | null;
  perQuestion: CoverageFirstPartyQuestionResult[];
}

/**
 * Aggregate first-party citation rates for a completed coverage run.
 * If ANY eligible measurement lacks a v0.1.0 summary, the result is marked
 * incomplete and callers MUST NOT write — missing data is never treated as false.
 */
export function aggregateCoverageFirstParty(args: {
  eligible: readonly EligibleMeasurementFact[];
  citedByMeasurementId: ReadonlyMap<string, boolean>;
}): CoverageFirstPartyAggregate {
  const eligible = args.eligible ?? [];
  let missingSummaryCount = 0;
  let citedCount = 0;

  const perQuestionMap = new Map<string, { total: number; cited: number }>();

  for (const e of eligible) {
    const bucket = perQuestionMap.get(e.questionId) ?? { total: 0, cited: 0 };
    bucket.total += 1;
    const cited = args.citedByMeasurementId.get(e.measurementId);
    if (cited === undefined) {
      missingSummaryCount += 1;
    } else if (cited) {
      bucket.cited += 1;
      citedCount += 1;
    }
    perQuestionMap.set(e.questionId, bucket);
  }

  const complete = missingSummaryCount === 0 && eligible.length > 0;

  return {
    complete,
    missingSummaryCount,
    eligibleCount: eligible.length,
    citedCount,
    clientFirstPartyCitationRate:
      complete && eligible.length > 0 ? citedCount / eligible.length : null,
    perQuestion: [...perQuestionMap.entries()].map(([questionId, v]) => ({
      questionId,
      measurementCount: v.total,
      firstPartyCitedCount: v.cited,
      firstPartyCitationRate: v.total > 0 ? v.cited / v.total : 0,
    })),
  };
}
