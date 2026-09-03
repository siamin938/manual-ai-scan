import { describe, expect, it } from "vitest";
import { evaluateSourceEvidence } from "./visibility-source-evidence.engine.server";

describe("evaluateSourceEvidence", () => {
  it("repeated competitor-only gap becomes priority", () => {
    const result = evaluateSourceEvidence({
      actionable: true,
      repeatedMeasurement: true,
      competitorResponseCount: 6,
      clientResponseCount: 0,
      competitorRunCount: 2,
      clientRunCount: 0,
      competitorGapRunCount: 2,
      distinctCompetitorCount: 4,
      directResponseCount: 0,
      nearSectionResponseCount: 6,
    });
    expect(result.grade).toBe("priority");
    expect(result.leadEligible).toBe(true);
    expect(result.repeatedGapConfirmed).toBe(true);
  });

  it("source already repeatedly linked to client is reference, not remediation lead", () => {
    const result = evaluateSourceEvidence({
      actionable: true,
      repeatedMeasurement: true,
      competitorResponseCount: 0,
      clientResponseCount: 5,
      competitorRunCount: 0,
      clientRunCount: 2,
      competitorGapRunCount: 0,
      distinctCompetitorCount: 0,
      directResponseCount: 0,
      nearSectionResponseCount: 0,
    });
    expect(result.grade).toBe("reference");
    expect(result.leadEligible).toBe(false);
  });

  it("one-run mixed gap remains observational candidate", () => {
    const result = evaluateSourceEvidence({
      actionable: true,
      repeatedMeasurement: true,
      competitorResponseCount: 2,
      clientResponseCount: 1,
      competitorRunCount: 1,
      clientRunCount: 1,
      competitorGapRunCount: 1,
      distinctCompetitorCount: 1,
      directResponseCount: 0,
      nearSectionResponseCount: 2,
    });
    expect(result.grade).toBe("reference");
    expect(result.leadEligible).toBe(false);
  });

  it("one-off direct citation gets candidate bonus but cannot beat repeat eligibility", () => {
    const oneOff = evaluateSourceEvidence({
      actionable: true,
      repeatedMeasurement: true,
      competitorResponseCount: 1,
      clientResponseCount: 0,
      competitorRunCount: 1,
      clientRunCount: 0,
      competitorGapRunCount: 1,
      distinctCompetitorCount: 1,
      directResponseCount: 1,
      nearSectionResponseCount: 0,
    });
    const repeated = evaluateSourceEvidence({
      actionable: true,
      repeatedMeasurement: true,
      competitorResponseCount: 4,
      clientResponseCount: 0,
      competitorRunCount: 2,
      clientRunCount: 0,
      competitorGapRunCount: 2,
      distinctCompetitorCount: 2,
      directResponseCount: 0,
      nearSectionResponseCount: 4,
    });
    expect(oneOff.grade).toBe("candidate");
    expect(oneOff.leadEligible).toBe(false);
    expect(repeated.grade).toBe("priority");
    expect(repeated.score).toBeGreaterThan(oneOff.score);
  });

  it("non-actionable domains always remain reference", () => {
    const result = evaluateSourceEvidence({
      actionable: false,
      repeatedMeasurement: true,
      competitorResponseCount: 8,
      clientResponseCount: 0,
      competitorRunCount: 2,
      clientRunCount: 0,
      competitorGapRunCount: 2,
      distinctCompetitorCount: 5,
      directResponseCount: 3,
      nearSectionResponseCount: 5,
    });
    expect(result.grade).toBe("reference");
    expect(result.leadEligible).toBe(false);
  });
});
