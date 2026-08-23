/**
 * Canonical Entity Resolver persistence pipeline v0.1 (server-only).
 *
 * SECURITY / SAFETY CONTRACT
 * - No provider / OpenAI / Edge / measurement execution. Zero cost.
 * - NEVER selects response_text, resolution_evidence, provider payloads,
 *   aliases or secrets. Only mention metadata, verifier verdicts and already
 *   stored source urls are read.
 * - service_role is used only inside `.server.ts` modules (blocked from client bundles).
 * - org_id + business_id + run scope are verified before anything is read.
 * - Idempotent: existing (mention, business, resolver_version) rows are skipped;
 *   nothing is updated or deleted. Parser / verifier rows are never written.
 * - Returns a SAFE aggregate summary only: no ids, names, urls or reason codes.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  RESOLVER_VERSION,
  resolveCanonicalEntities,
  type ResolverMentionInput,
} from "./entity-canonical-resolver";
import {
  ENTITY_VERIFIER_VERSION,
  isVerifiedBusinessMention,
} from "./entity-verification";

export { RESOLVER_VERSION };

export type CanonicalResolutionSummary = {
  resolverVersion: string;
  candidateCount: number;
  insertedCount: number;
  skippedCount: number;
  matchedBusinessCount: number;
  mergedCount: number;
  standaloneCount: number;
};

const BATCH_SIZE = 500;

type LooseQuery = {
  select: (columns: string) => LooseQuery;
  insert: (rows: unknown[]) => Promise<{ error: { code?: string | null } | null }>;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: readonly unknown[]) => LooseQuery;
  then: <T>(
    onfulfilled: (value: { data: Record<string, unknown>[] | null; error: unknown }) => T,
  ) => Promise<T>;
};

function looseTable(table: string): LooseQuery {
  return (supabaseAdmin as unknown as { from: (t: string) => LooseQuery }).from(table);
}

function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

export async function resolveAndPersistRunCanonicalEntities(args: {
  orgId: string;
  businessId: string;
  runId: string;
}): Promise<CanonicalResolutionSummary> {
  const { orgId, businessId, runId } = args;
  if (!orgId || !businessId || !runId) throw new Error("ORG_BUSINESS_AND_RUN_REQUIRED");

  // 1) scope guards
  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (businessError) throw new Error("BUSINESS_SCOPE_LOOKUP_FAILED");
  if (!business) throw new Error("BUSINESS_NOT_IN_ORG");

  const { data: run, error: runError } = await supabaseAdmin
    .from("measurement_runs")
    .select("id")
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (runError) throw new Error("RUN_SCOPE_LOOKUP_FAILED");
  if (!run) throw new Error("RUN_NOT_IN_SCOPE");

  // 2) measurements of this run (ids only)
  const { data: measurementRows, error: measurementError } = await supabaseAdmin
    .from("measurements")
    .select("id")
    .eq("org_id", orgId)
    .eq("run_id", runId);
  if (measurementError) throw new Error("MEASUREMENT_READ_FAILED");
  const measurementIds = (measurementRows ?? []).map((m) => m.id as string);

  const empty: CanonicalResolutionSummary = {
    resolverVersion: RESOLVER_VERSION,
    candidateCount: 0,
    insertedCount: 0,
    skippedCount: 0,
    matchedBusinessCount: 0,
    mergedCount: 0,
    standaloneCount: 0,
  };
  if (measurementIds.length === 0) return empty;

  // 3) mention metadata (no evidence payloads)
  const mentionRows: Record<string, unknown>[] = [];
  for (let i = 0; i < measurementIds.length; i += BATCH_SIZE) {
    const chunk = measurementIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabaseAdmin
      .from("measurement_mentions")
      .select("id, measurement_id, matched_business_id, display_name")
      .eq("org_id", orgId)
      .in("measurement_id", chunk);
    if (error) throw new Error("MENTION_READ_FAILED");
    for (const row of data ?? []) mentionRows.push(row as Record<string, unknown>);
  }
  if (mentionRows.length === 0) return empty;

  // 4) verifier verdicts for the current verifier version
  const mentionIds = mentionRows.map((m) => m["id"] as string);
  const verified = new Set<string>();
  for (let i = 0; i < mentionIds.length; i += BATCH_SIZE) {
    const chunk = mentionIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await looseTable("measurement_entity_verifications")
      .select(
        "measurement_mention_id, verifier_version, verification_status, verified_count_as_business",
      )
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("verifier_version", ENTITY_VERIFIER_VERSION)
      .in("measurement_mention_id", chunk);
    if (error) throw new Error("VERIFICATION_READ_FAILED");
    for (const row of data ?? []) {
      if (
        isVerifiedBusinessMention({
          verifier_version: row["verifier_version"] as string,
          verification_status: row["verification_status"] as string,
          verified_count_as_business: row["verified_count_as_business"] as boolean,
        })
      ) {
        verified.add(row["measurement_mention_id"] as string);
      }
    }
  }

  // 5) stored source urls per measurement
  const sourceUrlsByMeasurement: Record<string, string[]> = {};
  for (let i = 0; i < measurementIds.length; i += BATCH_SIZE) {
    const chunk = measurementIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabaseAdmin
      .from("measurement_sources")
      .select("measurement_id, url")
      .eq("org_id", orgId)
      .in("measurement_id", chunk);
    if (error) throw new Error("SOURCE_READ_FAILED");
    for (const row of data ?? []) {
      const mid = row.measurement_id as string;
      (sourceUrlsByMeasurement[mid] ??= []).push(row.url as string);
    }
  }

  // 6) registered business names (target + any matched registered business)
  const registeredIds = Array.from(
    new Set(
      mentionRows
        .map((m) => m["matched_business_id"] as string | null)
        .filter((id): id is string => !!id)
        .concat(businessId),
    ),
  );
  const registeredNames: Record<string, string> = {};
  if (registeredIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", registeredIds);
    if (error) throw new Error("BUSINESS_NAME_READ_FAILED");
    for (const row of data ?? []) registeredNames[row.id as string] = row.name as string;
  }

  const mentions: ResolverMentionInput[] = mentionRows.map((m) => ({
    mentionId: m["id"] as string,
    measurementId: m["measurement_id"] as string,
    matchedBusinessId: (m["matched_business_id"] as string | null) ?? null,
    displayName: (m["display_name"] as string) ?? "",
    verified: verified.has(m["id"] as string),
  }));

  const resolutions = resolveCanonicalEntities({
    businessId,
    registeredNames,
    mentions,
    sourceUrlsByMeasurement,
  });

  // 7) idempotent insert
  const existing = new Set<string>();
  for (let i = 0; i < mentionIds.length; i += BATCH_SIZE) {
    const chunk = mentionIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await looseTable("measurement_entity_canonicalizations")
      .select("measurement_mention_id")
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("resolver_version", RESOLVER_VERSION)
      .in("measurement_mention_id", chunk);
    if (error) throw new Error("EXISTING_CANONICALIZATION_READ_FAILED");
    for (const row of data ?? []) existing.add(row["measurement_mention_id"] as string);
  }

  const rows = resolutions
    .filter((r) => !existing.has(r.mentionId))
    .map((r) => ({
      org_id: orgId,
      business_id: businessId,
      source_run_id: runId,
      measurement_id: r.measurementId,
      measurement_mention_id: r.mentionId,
      resolver_version: RESOLVER_VERSION,
      canonical_key: r.canonicalKey,
      canonical_display_name: r.canonicalDisplayName,
      resolution_status: r.resolutionStatus,
      confidence: r.confidence,
      reason_codes: r.reasonCodes,
    }));

  let insertedCount = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await looseTable("measurement_entity_canonicalizations").insert(chunk);
    if (error) {
      if (!isUniqueViolation(error)) throw new Error("CANONICALIZATION_INSERT_FAILED");
    } else {
      insertedCount += chunk.length;
    }
  }

  let matchedBusinessCount = 0;
  let mergedCount = 0;
  let standaloneCount = 0;
  for (const r of resolutions) {
    if (r.resolutionStatus === "matched_business") matchedBusinessCount += 1;
    else if (r.resolutionStatus === "merged") mergedCount += 1;
    else if (r.resolutionStatus === "standalone") standaloneCount += 1;
  }

  return {
    resolverVersion: RESOLVER_VERSION,
    candidateCount: resolutions.length,
    insertedCount,
    skippedCount: resolutions.length - insertedCount,
    matchedBusinessCount,
    mergedCount,
    standaloneCount,
  };
}
