/**
 * Profile Coverage first-party citation backfill v0.1 (server-only).
 *
 * SECURITY / SAFETY CONTRACT
 * - No provider / OpenAI / Edge calls. Zero cost. Read-only apart from the
 *   additive first-party columns.
 * - Never reads response_text, provider payloads, parsing context, aliases or secrets.
 * - service_role only inside `.server.ts`.
 * - org_id + business_id scope enforced on every query.
 * - Existing domain fields (`domain_cited_count`, `domain_citation_rate`,
 *   `client_domain_citation_rate`) are never read for logic nor written.
 * - If ANY eligible measurement lacks a v0.1.0 summary, nothing is written.
 * - SAFE summary return only.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FIRST_PARTY_CLASSIFIER_VERSION,
  aggregateCoverageFirstParty,
  type EligibleMeasurementFact,
} from "./first-party-measurement-summary.helpers";

export interface CoverageFirstPartyBackfillSummary {
  classifierVersion: string;
  runsConsidered: number;
  runsUpdated: number;
  runsSkippedIncomplete: number;
  runsSkippedAlreadyVersioned: number;
  itemsUpdated: number;
}

const EMPTY: CoverageFirstPartyBackfillSummary = {
  classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
  runsConsidered: 0,
  runsUpdated: 0,
  runsSkippedIncomplete: 0,
  runsSkippedAlreadyVersioned: 0,
  itemsUpdated: 0,
};

/**
 * Backfill first-party citation metrics for completed profile coverage runs of
 * one org (optionally one business / one run).
 */
export async function backfillCoverageFirstPartyMetrics(args: {
  orgId: string;
  businessId?: string;
  coverageRunId?: string;
}): Promise<CoverageFirstPartyBackfillSummary> {
  const { orgId } = args;
  if (!orgId) throw new Error("ORG_REQUIRED");

  if (args.businessId) {
    const { data: business, error } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("id", args.businessId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new Error("BUSINESS_SCOPE_LOOKUP_FAILED");
    if (!business) throw new Error("BUSINESS_NOT_IN_ORG");
  }

  let runQuery = supabaseAdmin
    .from("profile_coverage_runs")
    .select(
      "id, org_id, business_id, source_run_id, required_parser_version, eligible_measurement_count, first_party_classifier_version",
    )
    .eq("org_id", orgId)
    .eq("status", "completed");
  if (args.businessId) runQuery = runQuery.eq("business_id", args.businessId);
  if (args.coverageRunId) runQuery = runQuery.eq("id", args.coverageRunId);

  const { data: runs, error: runsError } = await runQuery;
  if (runsError) throw new Error("COVERAGE_RUN_READ_FAILED");

  const summary: CoverageFirstPartyBackfillSummary = { ...EMPTY };

  for (const run of runs ?? []) {
    summary.runsConsidered += 1;

    if (run.first_party_classifier_version === FIRST_PARTY_CLASSIFIER_VERSION) {
      summary.runsSkippedAlreadyVersioned += 1;
      continue;
    }

    // Eligible measurements for this coverage run: valid measurements of the
    // source measurement run produced by the required parser version.
    const { data: measurementRows, error: measurementError } = await supabaseAdmin
      .from("measurements")
      .select("id, question_id")
      .eq("org_id", orgId)
      .eq("run_id", run.source_run_id)
      .eq("valid", true)
      .eq("parser_version", run.required_parser_version);
    if (measurementError) throw new Error("MEASUREMENT_READ_FAILED");

    const eligible: EligibleMeasurementFact[] = (measurementRows ?? []).map((m) => ({
      measurementId: m.id as string,
      questionId: m.question_id as string,
    }));

    // Defensive: if our eligibility reconstruction disagrees with the stored
    // engine count, do not write anything.
    if (eligible.length === 0 || eligible.length !== run.eligible_measurement_count) {
      summary.runsSkippedIncomplete += 1;
      continue;
    }

    const citedByMeasurementId = new Map<string, boolean>();
    const ids = eligible.map((e) => e.measurementId);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data, error } = await supabaseAdmin
        .from("measurement_first_party_summaries")
        .select("measurement_id, client_first_party_cited")
        .eq("org_id", orgId)
        .eq("business_id", run.business_id)
        .eq("classifier_version", FIRST_PARTY_CLASSIFIER_VERSION)
        .in("measurement_id", chunk);
      if (error) throw new Error("SUMMARY_READ_FAILED");
      for (const row of data ?? []) {
        citedByMeasurementId.set(
          row.measurement_id as string,
          Boolean(row.client_first_party_cited),
        );
      }
    }

    const aggregate = aggregateCoverageFirstParty({ eligible, citedByMeasurementId });
    if (!aggregate.complete) {
      summary.runsSkippedIncomplete += 1;
      continue;
    }

    // Items: only the additive first-party columns are written.
    const { data: itemRows, error: itemError } = await supabaseAdmin
      .from("profile_coverage_items")
      .select("id, question_id")
      .eq("org_id", orgId)
      .eq("coverage_run_id", run.id);
    if (itemError) throw new Error("COVERAGE_ITEM_READ_FAILED");

    const byQuestion = new Map(aggregate.perQuestion.map((q) => [q.questionId, q]));

    for (const item of itemRows ?? []) {
      const q = byQuestion.get(item.question_id as string);
      if (!q) continue;
      const { error: updateError } = await supabaseAdmin
        .from("profile_coverage_items")
        .update({
          first_party_cited_count: q.firstPartyCitedCount,
          first_party_citation_rate: q.firstPartyCitationRate,
          first_party_classifier_version: FIRST_PARTY_CLASSIFIER_VERSION,
        })
        .eq("id", item.id)
        .eq("org_id", orgId)
        .eq("coverage_run_id", run.id);
      if (updateError) throw new Error("COVERAGE_ITEM_UPDATE_FAILED");
      summary.itemsUpdated += 1;
    }

    const { error: runUpdateError } = await supabaseAdmin
      .from("profile_coverage_runs")
      .update({
        client_first_party_citation_rate: aggregate.clientFirstPartyCitationRate,
        first_party_classifier_version: FIRST_PARTY_CLASSIFIER_VERSION,
      })
      .eq("id", run.id)
      .eq("org_id", orgId);
    if (runUpdateError) throw new Error("COVERAGE_RUN_UPDATE_FAILED");

    summary.runsUpdated += 1;
  }

  return summary;
}
