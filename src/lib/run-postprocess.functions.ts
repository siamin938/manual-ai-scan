/**
 * Completed audit run auto post-processing orchestrator v0.1.
 *
 * SECURITY CONTRACT
 * - Authenticated (requireSupabaseAuth) + org membership role owner/admin/analyst.
 * - Provider / OpenAI measurement calls are NEVER made here. Only the
 *   provider-free reparse / coverage / insight Edge paths are invoked.
 * - Raw Edge responses, previews, response_text, urls, registry, aliases and
 *   secrets are never returned nor logged.
 * - service_role is only touched inside `.server.ts` modules imported in-handler.
 * - Every step is idempotent; re-calling for the same run is safe.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  initialSteps,
  isRunEligibleForPostprocess,
  isUuid,
  markFailure,
  toSafeErrorCode,
  type PostprocessCounts,
  type RunPostprocessResultDTO,
} from "./run-postprocess.helpers";

export type { RunPostprocessResultDTO };

const ALLOWED_ROLES = new Set(["owner", "admin", "analyst"]);

function fail(
  steps: ReturnType<typeof initialSteps>,
  step: Parameters<typeof markFailure>[1],
  code: string,
): RunPostprocessResultDTO {
  return {
    ok: false,
    status: "failed",
    steps: markFailure(steps, step),
    error: toSafeErrorCode(code),
  };
}

export const runPostprocess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; runId: string }) => {
    if (!isUuid(input?.orgId) || !isUuid(input?.runId)) throw new Error("INVALID_INPUT");
    return { orgId: input.orgId, runId: input.runId };
  })
  .handler(async ({ data, context }): Promise<RunPostprocessResultDTO> => {
    const steps = initialSteps();

    // 1) membership + role
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) return fail(steps, "reparse", "FORBIDDEN");
    if (!membership || !ALLOWED_ROLES.has(String(membership.role)))
      return fail(steps, "reparse", "FORBIDDEN");

    // 2) run scope + eligibility (org-scoped, no cross-org bypass)
    const { data: run, error: runErr } = await context.supabase
      .from("measurement_runs")
      .select("id, org_id, business_id, run_type, phase, status")
      .eq("id", data.runId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (runErr) return fail(steps, "reparse", "RUN_NOT_FOUND");
    if (!run) return fail(steps, "reparse", "RUN_NOT_FOUND");
    if (!isRunEligibleForPostprocess(run)) return fail(steps, "reparse", "RUN_NOT_ELIGIBLE");

    const businessId = run.business_id as string;
    const counts: PostprocessCounts = {
      entityVerified: 0,
      entityNeedsReview: 0,
      classifiedSources: 0,
      firstPartySources: 0,
      summarizedMeasurements: 0,
      coverageItemsUpdated: 0,
    };

    // 3a) reparse-measurements (no provider call; re-parses stored text server-side)
    try {
      const { error } = await context.supabase.functions.invoke("reparse-measurements", {
        body: { run_id: data.runId, dry_run: false },
      });
      if (error) return fail(steps, "reparse", "REPARSE_FAILED");
    } catch {
      return fail(steps, "reparse", "REPARSE_FAILED");
    }
    steps.reparse = "ok";

    // 3a-2) entity verification (pure verifier over stored mention metadata)
    try {
      const { verifyAndPersistBusinessEntities } = await import("./entity-verification.server");
      const summary = await verifyAndPersistBusinessEntities({
        orgId: data.orgId,
        businessId,
        runId: data.runId,
      });
      counts.entityVerified = summary.confirmedBusinessCount;
      counts.entityNeedsReview = summary.needsReviewCount;
    } catch {
      return fail(steps, "entityVerification", "ENTITY_VERIFICATION_FAILED");
    }
    steps.entityVerification = "ok";

    // 3b) first-party source classification
    try {
      const { classifyAndPersistBusinessSources } = await import(
        "./first-party-source-classification.server"
      );
      const summary = await classifyAndPersistBusinessSources({ orgId: data.orgId, businessId });
      counts.classifiedSources = summary.insertedCount;
      counts.firstPartySources = summary.firstPartyCount;
    } catch {
      return fail(steps, "sourceClassification", "SOURCE_CLASSIFICATION_FAILED");
    }
    steps.sourceClassification = "ok";

    // 3c) measurement-level first-party summary
    try {
      const { summarizeAndPersistBusinessMeasurements } = await import(
        "./first-party-measurement-summary.server"
      );
      const summary = await summarizeAndPersistBusinessMeasurements({
        orgId: data.orgId,
        businessId,
      });
      counts.summarizedMeasurements = summary.insertedCount;
    } catch {
      return fail(steps, "measurementSummary", "MEASUREMENT_SUMMARY_FAILED");
    }
    steps.measurementSummary = "ok";

    // 3d) profile coverage
    try {
      const { error } = await context.supabase.functions.invoke("compute-profile-coverage", {
        body: { run_id: data.runId, dry_run: false },
      });
      if (error) return fail(steps, "profileCoverage", "PROFILE_COVERAGE_FAILED");
    } catch {
      return fail(steps, "profileCoverage", "PROFILE_COVERAGE_FAILED");
    }
    steps.profileCoverage = "ok";

    // 3e) first-party coverage metrics for the coverage run just produced
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: coverageRun, error: coverageErr } = await supabaseAdmin
        .from("profile_coverage_runs")
        .select("id")
        .eq("org_id", data.orgId)
        .eq("business_id", businessId)
        .eq("source_run_id", data.runId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (coverageErr) return fail(steps, "firstPartyCoverage", "FIRST_PARTY_COVERAGE_FAILED");
      if (!coverageRun) {
        steps.firstPartyCoverage = "skipped";
      } else {
        const { backfillCoverageFirstPartyMetrics } = await import(
          "./profile-coverage.first-party.server"
        );
        const summary = await backfillCoverageFirstPartyMetrics({
          orgId: data.orgId,
          businessId,
          coverageRunId: coverageRun.id as string,
        });
        counts.coverageItemsUpdated = summary.itemsUpdated;
        steps.firstPartyCoverage = "ok";
      }
    } catch {
      return fail(steps, "firstPartyCoverage", "FIRST_PARTY_COVERAGE_FAILED");
    }

    // 3f) insights
    try {
      const { error } = await context.supabase.functions.invoke("compute-insights-v021", {
        body: { run_id: data.runId, dry_run: false },
      });
      if (error) return fail(steps, "insights", "INSIGHTS_FAILED");
    } catch {
      return fail(steps, "insights", "INSIGHTS_FAILED");
    }
    steps.insights = "ok";

    return { ok: true, status: "completed", steps, counts };
  });
