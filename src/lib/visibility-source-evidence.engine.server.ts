/**
 * Visibility Source Evidence Scoring v0.7.0 — server-only pure engine.
 *
 * CORE ENGINE ISOLATION
 * - This file is server-only and must never be imported by client/UI bundles.
 * - Raw score/thresholds are internal. Customer DTOs expose only qualitative
 *   evidence grades/labels and observed counts.
 *
 * Product principle:
 * - repeated source-side gap > raw response volume > distinct competitors
 *   > direct citation bonus
 * - client presence on the same source lowers the urgency
 * - a one-off direct citation must not outrank a repeatedly reproduced
 *   competitor-only source gap
 */

export const SOURCE_EVIDENCE_VERSION = "0.7.0";

export type SourceEvidenceGrade = "priority" | "candidate" | "reference";

export type SourceEvidenceInput = {
  actionable: boolean;
  repeatedMeasurement: boolean;
  competitorResponseCount: number;
  clientResponseCount: number;
  competitorRunCount: number;
  clientRunCount: number;
  /** Number of compatible runs where competitor responses > client responses. */
  competitorGapRunCount: number;
  distinctCompetitorCount: number;
  directResponseCount: number;
  nearSectionResponseCount: number;
};

export type SourceEvidenceResult = {
  grade: SourceEvidenceGrade;
  score: number;
  responseGap: number;
  repeatedGapConfirmed: boolean;
  leadEligible: boolean;
};

function n(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function evaluateSourceEvidence(raw: SourceEvidenceInput): SourceEvidenceResult {
  const actionable = raw.actionable === true;
  const repeatedMeasurement = raw.repeatedMeasurement === true;
  const competitorResponseCount = n(raw.competitorResponseCount);
  const clientResponseCount = n(raw.clientResponseCount);
  const competitorRunCount = n(raw.competitorRunCount);
  const clientRunCount = n(raw.clientRunCount);
  const competitorGapRunCount = n(raw.competitorGapRunCount);
  const distinctCompetitorCount = n(raw.distinctCompetitorCount);
  const directResponseCount = n(raw.directResponseCount);
  const nearSectionResponseCount = n(raw.nearSectionResponseCount);
  const responseGap = Math.max(0, competitorResponseCount - clientResponseCount);
  const repeatedGapConfirmed = repeatedMeasurement && competitorGapRunCount >= 2;

  // Internal ranking score. Reproducibility intentionally dominates direct-link bonus.
  const score = Math.max(
    0,
    competitorGapRunCount * 180 +
      Math.min(competitorRunCount, 6) * 40 +
      Math.min(responseGap, 12) * 35 +
      Math.min(competitorResponseCount, 24) * 18 +
      Math.min(distinctCompetitorCount, 10) * 20 +
      Math.min(directResponseCount, 12) * 10 +
      Math.min(nearSectionResponseCount, 24) * 4 -
      Math.min(clientResponseCount, 24) * 18 -
      Math.min(clientRunCount, 6) * 20,
  );

  if (!actionable || competitorResponseCount === 0 || responseGap === 0) {
    return {
      grade: "reference",
      score,
      responseGap,
      repeatedGapConfirmed,
      leadEligible: false,
    };
  }

  if (repeatedMeasurement) {
    const priority =
      competitorGapRunCount >= 2 &&
      competitorRunCount >= 2 &&
      competitorResponseCount >= 3 &&
      responseGap >= 2 &&
      distinctCompetitorCount >= 2;

    if (priority) {
      return {
        grade: "priority",
        score,
        responseGap,
        repeatedGapConfirmed,
        leadEligible: true,
      };
    }

    const candidate =
      (competitorRunCount >= 2 &&
        competitorGapRunCount >= 1 &&
        competitorResponseCount >= 2 &&
        responseGap >= 1) ||
      (directResponseCount >= 1 && responseGap >= 1);

    return {
      grade: candidate ? "candidate" : "reference",
      score,
      responseGap,
      repeatedGapConfirmed,
      // Repeated candidate becomes a recommendation lead only when the source
      // itself was present across >=2 runs; one-off direct citations stay observational.
      leadEligible:
        candidate && competitorRunCount >= 2 && competitorGapRunCount >= 1,
    };
  }

  const candidate =
    (competitorResponseCount >= 2 &&
      responseGap >= 1 &&
      distinctCompetitorCount >= 2) ||
    (directResponseCount >= 1 && responseGap >= 1);

  return {
    grade: candidate ? "candidate" : "reference",
    score,
    responseGap,
    repeatedGapConfirmed: false,
    // First measurement is always an observation, but a sufficiently concrete
    // source can still be the lead clue shown to the customer.
    leadEligible: candidate,
  };
}
