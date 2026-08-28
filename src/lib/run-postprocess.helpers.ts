/**
 * Pure state helpers for the completed-run auto post-processing orchestrator.
 *
 * SECURITY: no Supabase, no secrets, no raw provider/Edge payloads.
 * Only safe step states and safe error codes cross this boundary.
 */

export type PostprocessStepState = "pending" | "ok" | "failed" | "skipped";

export type PostprocessSteps = {
  reparse: PostprocessStepState;
  entityVerification: PostprocessStepState;
  entityCanonicalization: PostprocessStepState;
  citationAttribution: PostprocessStepState;
  sourceClassification: PostprocessStepState;
  measurementSummary: PostprocessStepState;
  profileCoverage: PostprocessStepState;
  firstPartyCoverage: PostprocessStepState;
  insights: PostprocessStepState;
};

export type PostprocessCounts = {
  entityVerified: number;
  entityNeedsReview: number;
  canonicalMerged: number;
  canonicalStandalone: number;
  citationDirect: number;
  citationSection: number;
  classifiedSources: number;
  firstPartySources: number;
  summarizedMeasurements: number;
  coverageItemsUpdated: number;
};

export type RunPostprocessResultDTO = {
  ok: boolean;
  status: "completed" | "failed";
  steps: PostprocessSteps;
  counts?: PostprocessCounts;
  error?: string;
};

export const POSTPROCESS_STEP_ORDER: (keyof PostprocessSteps)[] = [
  "reparse",
  "entityVerification",
  "entityCanonicalization",
  "citationAttribution",
  "sourceClassification",
  "measurementSummary",
  "profileCoverage",
  "firstPartyCoverage",
  "insights",
];

export function initialSteps(): PostprocessSteps {
  return {
    reparse: "pending",
    entityVerification: "pending",
    entityCanonicalization: "pending",
    citationAttribution: "pending",
    sourceClassification: "pending",
    measurementSummary: "pending",
    profileCoverage: "pending",
    firstPartyCoverage: "pending",
    insights: "pending",
  };
}

/** Every step after the failed one is reported as skipped, never force-progressed. */
export function markFailure(
  steps: PostprocessSteps,
  failedStep: keyof PostprocessSteps,
): PostprocessSteps {
  const next = { ...steps };
  let seen = false;
  for (const key of POSTPROCESS_STEP_ORDER) {
    if (key === failedStep) {
      next[key] = "failed";
      seen = true;
      continue;
    }
    if (seen) next[key] = "skipped";
  }
  return next;
}

const SAFE_ERROR_CODES = new Set([
  "INVALID_INPUT",
  "FORBIDDEN",
  "RUN_NOT_FOUND",
  "RUN_NOT_ELIGIBLE",
  "REPARSE_FAILED",
  "ENTITY_VERIFICATION_FAILED",
  "ENTITY_CANONICALIZATION_FAILED",
  "CITATION_ATTRIBUTION_FAILED",
  "SOURCE_CLASSIFICATION_FAILED",
  "MEASUREMENT_SUMMARY_FAILED",
  "PROFILE_COVERAGE_FAILED",
  "FIRST_PARTY_COVERAGE_FAILED",
  "INSIGHTS_FAILED",
  "POSTPROCESS_FAILED",
]);

/** Never let a raw Edge/provider error message escape to the browser. */
export function toSafeErrorCode(code: string | null | undefined): string {
  return code && SAFE_ERROR_CODES.has(code) ? code : "POSTPROCESS_FAILED";
}

export function isRunEligibleForPostprocess(run: {
  run_type?: string | null;
  phase?: string | null;
  status?: string | null;
  business_id?: string | null;
}): boolean {
  if (!run) return false;
  if (run.run_type !== "audit") return false;
  if (run.phase !== "standalone") return false;
  if (run.status !== "completed" && run.status !== "partial") return false;
  return typeof run.business_id === "string" && run.business_id.length > 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
