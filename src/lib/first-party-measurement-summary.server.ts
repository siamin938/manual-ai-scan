/**
 * First-party measurement summary pipeline v0.1 (server-only).
 *
 * SECURITY / SAFETY CONTRACT
 * - No provider / OpenAI / Edge / measurement execution. Zero cost.
 * - Never reads response_text, provider payloads, parsing context, aliases or secrets.
 * - service_role is used only inside `.server.ts` modules (blocked from client bundles).
 * - org_id + business_id scope is verified and enforced on every query.
 * - Returns a SAFE aggregate summary only: no ids, urls or registry details.
 * - Version provenance: existing (measurement, business, version) rows are skipped,
 *   never updated or deleted.
 * - `client_domain_cited` / `domain_citation_rate` are neither read nor modified.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FIRST_PARTY_CLASSIFIER_VERSION,
  buildMeasurementSummaryRows,
  mergeMeasurementSummaries,
  summarizeMeasurementSummaryRows,
  type MeasurementSourceFact,
  type MeasurementSummaryRunSummary,
  type SourceClassificationFact,
} from "./first-party-measurement-summary.helpers";

export { FIRST_PARTY_CLASSIFIER_VERSION };
export type { MeasurementSummaryRunSummary };

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

function normalizeBatchSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
  return Math.max(25, Math.min(Math.floor(value), MAX_BATCH_SIZE));
}

function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

async function assertBusinessInOrg(orgId: string, businessId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error("BUSINESS_SCOPE_LOOKUP_FAILED");
  if (!data) throw new Error("BUSINESS_NOT_IN_ORG");
}

export async function summarizeAndPersistBusinessMeasurements(args: {
  orgId: string;
  businessId: string;
  batchSize?: number;
}): Promise<MeasurementSummaryRunSummary> {
  const { orgId, businessId } = args;
  if (!orgId || !businessId) throw new Error("ORG_AND_BUSINESS_REQUIRED");
  const batchSize = normalizeBatchSize(args.batchSize);

  await assertBusinessInOrg(orgId, businessId);

  const summaries: MeasurementSummaryRunSummary[] = [];
  let offset = 0;

  for (;;) {
    // Measurements scoped to org + business through the run join.
    // Only ids are selected — never response_text or provider payloads.
    const { data: measurementRows, error: measurementError } = await supabaseAdmin
      .from("measurements")
      .select("id, measurement_runs!inner(id, org_id, business_id)")
      .eq("org_id", orgId)
      .eq("measurement_runs.org_id", orgId)
      .eq("measurement_runs.business_id", businessId)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (measurementError) throw new Error("MEASUREMENT_READ_FAILED");

    const measurementIds = (measurementRows ?? []).map((m) => m.id as string);
    if (measurementIds.length === 0) break;

    const [sourcesRes, existingRes] = await Promise.all([
      supabaseAdmin
        .from("measurement_sources")
        .select("id, measurement_id")
        .eq("org_id", orgId)
        .in("measurement_id", measurementIds),
      supabaseAdmin
        .from("measurement_first_party_summaries")
        .select("measurement_id")
        .eq("org_id", orgId)
        .eq("business_id", businessId)
        .eq("classifier_version", FIRST_PARTY_CLASSIFIER_VERSION)
        .in("measurement_id", measurementIds),
    ]);

    if (sourcesRes.error) throw new Error("MEASUREMENT_SOURCE_READ_FAILED");
    if (existingRes.error) throw new Error("EXISTING_SUMMARY_READ_FAILED");

    const sourceIdsByMeasurement = new Map<string, string[]>();
    for (const id of measurementIds) sourceIdsByMeasurement.set(id, []);
    const allSourceIds: string[] = [];
    for (const s of sourcesRes.data ?? []) {
      const bucket = sourceIdsByMeasurement.get(s.measurement_id as string);
      if (!bucket) continue;
      bucket.push(s.id as string);
      allSourceIds.push(s.id as string);
    }

    // Classifications for this business + classifier version only.
    const classifications: SourceClassificationFact[] = [];
    for (let i = 0; i < allSourceIds.length; i += 500) {
      const chunk = allSourceIds.slice(i, i + 500);
      const { data, error } = await supabaseAdmin
        .from("measurement_source_classifications")
        .select("measurement_source_id, classification, confidence")
        .eq("org_id", orgId)
        .eq("business_id", businessId)
        .eq("classifier_version", FIRST_PARTY_CLASSIFIER_VERSION)
        .in("measurement_source_id", chunk);
      if (error) throw new Error("CLASSIFICATION_READ_FAILED");
      for (const row of data ?? []) {
        classifications.push({
          measurement_source_id: row.measurement_source_id as string,
          classification: row.classification as string,
          confidence: row.confidence as string,
        });
      }
    }

    const measurements: MeasurementSourceFact[] = measurementIds.map((id) => ({
      measurementId: id,
      sourceIds: sourceIdsByMeasurement.get(id) ?? [],
    }));

    const alreadySummarizedMeasurementIds = new Set<string>(
      (existingRes.data ?? []).map((r) => r.measurement_id as string),
    );

    const { rows, skippedCount, incompleteClassificationCount } = buildMeasurementSummaryRows({
      orgId,
      businessId,
      measurements,
      classifications,
      alreadySummarizedMeasurementIds,
    });

    let insertedRows = rows;
    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("measurement_first_party_summaries")
        .insert(rows);
      if (insertError) {
        if (isUniqueViolation(insertError)) insertedRows = [];
        else throw new Error("SUMMARY_INSERT_FAILED");
      }
    }

    summaries.push(
      summarizeMeasurementSummaryRows({
        measurementCount: measurementIds.length,
        skippedCount: skippedCount + (rows.length - insertedRows.length),
        incompleteClassificationCount,
        insertedRows,
      }),
    );

    if (measurementIds.length < batchSize) break;
    offset += batchSize;
  }

  return mergeMeasurementSummaries(summaries);
}

/**
 * One-off backfill entry point. Server-only, not reachable from the browser and
 * not wired to any route or server function. Must be invoked deliberately.
 */
export async function backfillFirstPartyMeasurementSummaries(args: {
  orgId: string;
  businessIds: readonly string[];
  batchSize?: number;
}): Promise<MeasurementSummaryRunSummary> {
  const summaries: MeasurementSummaryRunSummary[] = [];
  for (const businessId of args.businessIds ?? []) {
    summaries.push(
      await summarizeAndPersistBusinessMeasurements({
        orgId: args.orgId,
        businessId,
        ...(args.batchSize === undefined ? {} : { batchSize: args.batchSize }),
      }),
    );
  }
  return mergeMeasurementSummaries(summaries);
}
