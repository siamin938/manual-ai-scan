/**
 * Entity Verification persistence pipeline v0.1 (server-only).
 *
 * SECURITY / SAFETY CONTRACT
 * - No provider / OpenAI / Edge / measurement execution. Zero cost.
 * - NEVER selects response_text, resolution_evidence, provider payloads,
 *   aliases, registry data or secrets.
 * - service_role is used only inside `.server.ts` modules (blocked from client bundles).
 * - org_id + business_id scope verified and enforced on every query; run scope
 *   is additionally verified against the same org + business.
 * - Existing (mention, business, verifier_version) rows are skipped — never
 *   updated or deleted. Parser v1.2.3 columns are never written.
 * - Returns a SAFE aggregate summary only: no ids, names or reason codes.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ENTITY_VERIFIER_VERSION,
  buildEntityVerificationRows,
  summarizeEntityVerificationRows,
  type EntityVerificationInput,
  type EntityVerificationRow,
  type EntityVerificationSummary,
} from "./entity-verification";

export { ENTITY_VERIFIER_VERSION };
export type { EntityVerificationSummary };

const BATCH_SIZE = 200;

// `measurement_entity_verifications` is applied by a separate Supabase migration,
// so it is not present in the generated Database types yet. Access it through a
// narrowly typed loose view of the admin client instead of weakening the client.
type LooseQuery = {
  select: (columns: string) => LooseQuery;
  insert: (rows: unknown[]) => Promise<{ error: { code?: string | null } | null }>;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: readonly unknown[]) => LooseQuery;
  then: <T>(
    onfulfilled: (value: { data: Record<string, unknown>[] | null; error: unknown }) => T,
  ) => Promise<T>;
};

function verificationsTable(): LooseQuery {
  return (supabaseAdmin as unknown as { from: (table: string) => LooseQuery }).from(
    "measurement_entity_verifications",
  );
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

async function assertRunInScope(orgId: string, businessId: string, runId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("measurement_runs")
    .select("id")
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error("RUN_SCOPE_LOOKUP_FAILED");
  if (!data) throw new Error("RUN_NOT_IN_SCOPE");
}

export async function verifyAndPersistBusinessEntities(args: {
  orgId: string;
  businessId: string;
  runId?: string;
}): Promise<EntityVerificationSummary> {
  const { orgId, businessId, runId } = args;
  if (!orgId || !businessId) throw new Error("ORG_AND_BUSINESS_REQUIRED");

  await assertBusinessInOrg(orgId, businessId);
  if (runId) await assertRunInScope(orgId, businessId, runId);

  let mentionCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  let confirmedBusinessCount = 0;
  let rejectedCount = 0;
  let needsReviewCount = 0;

  let offset = 0;
  for (;;) {
    // Measurement ids only — response_text is never selected.
    let measurementQuery = supabaseAdmin
      .from("measurements")
      .select("id, measurement_runs!inner(id, org_id, business_id)")
      .eq("org_id", orgId)
      .eq("measurement_runs.org_id", orgId)
      .eq("measurement_runs.business_id", businessId);
    if (runId) measurementQuery = measurementQuery.eq("run_id", runId);

    const { data: measurementRows, error: measurementError } = await measurementQuery
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (measurementError) throw new Error("MEASUREMENT_READ_FAILED");

    const measurementIds = (measurementRows ?? []).map((m) => m.id as string);
    if (measurementIds.length === 0) break;

    // Mention metadata only: no resolution_evidence, no aliases source data.
    const { data: mentionRows, error: mentionError } = await supabaseAdmin
      .from("measurement_mentions")
      .select(
        "id, measurement_id, matched_business_id, display_name, entity_kind, specificity, count_as_confirmed_business, resolution_confidence",
      )
      .eq("org_id", orgId)
      .in("measurement_id", measurementIds);
    if (mentionError) throw new Error("MENTION_READ_FAILED");

    const mentions: EntityVerificationInput[] = (mentionRows ?? []).map((m) => ({
      mentionId: m.id as string,
      measurementId: m.measurement_id as string,
      matchedBusinessId: (m.matched_business_id as string | null) ?? null,
      displayName: (m.display_name as string) ?? "",
      entityKind: (m.entity_kind as string | null) ?? null,
      specificity: (m.specificity as string | null) ?? null,
      countAsConfirmedBusiness: (m.count_as_confirmed_business as boolean | null) ?? null,
      resolutionConfidence: (m.resolution_confidence as string | null) ?? null,
    }));

    if (mentions.length > 0) {
      const mentionIds = mentions.map((m) => m.mentionId);
      const existingMentionIds = new Set<string>();
      for (let i = 0; i < mentionIds.length; i += 500) {
        const chunk = mentionIds.slice(i, i + 500);
        const { data: existing, error: existingError } = await verificationsTable()
          .select("measurement_mention_id")
          .eq("org_id", orgId)
          .eq("business_id", businessId)
          .eq("verifier_version", ENTITY_VERIFIER_VERSION)
          .in("measurement_mention_id", chunk);
        if (existingError) throw new Error("EXISTING_VERIFICATION_READ_FAILED");
        for (const row of existing ?? [])
          existingMentionIds.add(row["measurement_mention_id"] as string);
      }

      const { rows, skippedCount: skipped } = buildEntityVerificationRows({
        orgId,
        businessId,
        mentions,
        existingMentionIds,
      });

      let insertedRows: EntityVerificationRow[] = rows;
      if (rows.length > 0) {
        const { error: insertError } = await verificationsTable().insert(rows);
        if (insertError) {
          if (isUniqueViolation(insertError)) insertedRows = [];
          else throw new Error("VERIFICATION_INSERT_FAILED");
        }
      }

      const summary = summarizeEntityVerificationRows({
        mentionCount: mentions.length,
        insertedRows,
        skippedCount: skipped + (rows.length - insertedRows.length),
      });
      mentionCount += summary.mentionCount;
      insertedCount += summary.insertedCount;
      skippedCount += summary.skippedCount;
      confirmedBusinessCount += summary.confirmedBusinessCount;
      rejectedCount += summary.rejectedCount;
      needsReviewCount += summary.needsReviewCount;
    }

    if (measurementIds.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return {
    verifierVersion: ENTITY_VERIFIER_VERSION,
    mentionCount,
    insertedCount,
    skippedCount,
    confirmedBusinessCount,
    rejectedCount,
    needsReviewCount,
  };
}
