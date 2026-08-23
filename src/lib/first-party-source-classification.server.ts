/**
 * First-party Source Classification pipeline v0.1 (server-only).
 *
 * SECURITY / SAFETY CONTRACT
 * - Never calls any provider / OpenAI / external AI service. Zero cost.
 * - Never reads response_text, provider payloads, secrets, parsing context or aliases.
 * - service_role client is imported here only; this file is `.server.ts` and is
 *   blocked from client bundles.
 * - org_id + business_id scope is verified server-side before anything is read.
 * - Returns only a SAFE aggregate summary: no urls, ids or registry details.
 * - Idempotent: sources that already have a row for classifier_version 0.1.0 are
 *   skipped. Existing rows are never updated or deleted.
 * - Does not touch the entity parser, measurements, experiments or insights logic,
 *   and does not read or change `client_domain_cited`.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FIRST_PARTY_CLASSIFIER_VERSION,
  buildClassificationRows,
  mergeSummaries,
  summarizeClassificationRows,
  toRegistryEntries,
  type ClassificationRunSummary,
  type FirstPartySourceRow,
  type MeasurementSourceRow,
} from "./first-party-source-classification.helpers";

export { FIRST_PARTY_CLASSIFIER_VERSION };
export type { ClassificationRunSummary };

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;

function normalizeBatchSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
  return Math.max(50, Math.min(Math.floor(value), MAX_BATCH_SIZE));
}

function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

export async function classifyAndPersistBusinessSources(args: {
  orgId: string;
  businessId: string;
  batchSize?: number;
}): Promise<ClassificationRunSummary> {
  const orgId = args.orgId;
  const businessId = args.businessId;
  const batchSize = normalizeBatchSize(args.batchSize);

  if (!orgId || !businessId) {
    throw new Error("ORG_AND_BUSINESS_REQUIRED");
  }

  // 1) Scope guard: the business must belong to this organization.
  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (businessError) throw new Error("BUSINESS_SCOPE_LOOKUP_FAILED");
  if (!business) throw new Error("BUSINESS_NOT_IN_ORG");

  // 2) Verified + active first-party registry for this org/business only.
  const { data: registryRows, error: registryError } = await supabaseAdmin
    .from("business_first_party_sources")
    .select("id, source_type, canonical_url, normalized_host, resource_key, match_mode, verification_status, active")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("active", true)
    .eq("verification_status", "verified");

  if (registryError) throw new Error("FIRST_PARTY_REGISTRY_READ_FAILED");
  const registry = toRegistryEntries((registryRows ?? []) as FirstPartySourceRow[]);

  // 3) Paginate measurement sources scoped to org + business through the run join.
  //    Only id/url/domain are selected — never response_text or provider payloads.
  const summaries: ClassificationRunSummary[] = [];
  let offset = 0;

  for (;;) {
    const { data: sourceRows, error: sourceError } = await supabaseAdmin
      .from("measurement_sources")
      .select("id, url, domain, measurements!inner(id, measurement_runs!inner(id, org_id, business_id))")
      .eq("org_id", orgId)
      .eq("measurements.measurement_runs.org_id", orgId)
      .eq("measurements.measurement_runs.business_id", businessId)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (sourceError) throw new Error("MEASUREMENT_SOURCE_READ_FAILED");

    const sources: MeasurementSourceRow[] = (sourceRows ?? []).map((row) => ({
      id: row.id as string,
      url: row.url as string,
      domain: (row.domain as string | null) ?? null,
    }));

    if (sources.length === 0) break;

    // 4) Pre-check existing rows for this classifier version → idempotent skip.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("measurement_source_classifications")
      .select("measurement_source_id")
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("classifier_version", FIRST_PARTY_CLASSIFIER_VERSION)
      .in(
        "measurement_source_id",
        sources.map((s) => s.id),
      );

    if (existingError) throw new Error("EXISTING_CLASSIFICATION_READ_FAILED");

    const alreadyClassifiedSourceIds = new Set<string>(
      (existing ?? []).map((r) => r.measurement_source_id as string),
    );

    const { rows, skippedCount } = buildClassificationRows({
      orgId,
      businessId,
      sources,
      registry,
      alreadyClassifiedSourceIds,
    });

    let insertedRows = rows;
    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("measurement_source_classifications")
        .insert(rows);

      if (insertError) {
        if (isUniqueViolation(insertError)) {
          // Concurrent writer already persisted this version: treat as skip.
          insertedRows = [];
        } else {
          throw new Error("CLASSIFICATION_INSERT_FAILED");
        }
      }
    }

    summaries.push(
      summarizeClassificationRows({
        sourceCount: sources.length,
        skippedCount: skippedCount + (rows.length - insertedRows.length),
        insertedRows,
      }),
    );

    if (sources.length < batchSize) break;
    offset += batchSize;
  }

  return mergeSummaries(summaries);
}

/**
 * One-off backfill entry point. Server-only, not reachable from the browser and
 * not wired to any route or server function. Must be invoked deliberately.
 */
export async function backfillFirstPartySourceClassifications(args: {
  orgId: string;
  businessIds: readonly string[];
  batchSize?: number;
}): Promise<ClassificationRunSummary> {
  const summaries: ClassificationRunSummary[] = [];
  for (const businessId of args.businessIds ?? []) {
    summaries.push(
      await classifyAndPersistBusinessSources({
        orgId: args.orgId,
        businessId,
        ...(args.batchSize === undefined ? {} : { batchSize: args.batchSize }),
      }),
    );
  }
  return mergeSummaries(summaries);
}
