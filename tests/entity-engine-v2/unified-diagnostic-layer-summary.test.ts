import { describe, expect, it } from "vitest";
import {
  buildUnifiedDiagnosticLayerSummary,
  confirmedRatePct,
} from "../../src/lib/unified-diagnostic-layer-summary";
import type { EntityFactsV2ReadQuestionAreaDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";

function area(
  id: string,
  confirmedMentionCount: number,
  unresolvedTargetCount = 0,
): EntityFactsV2ReadQuestionAreaDTO {
  return {
    questionId: id,
    questionText: `질문 ${id}`,
    intentType: "local",
    status: confirmedMentionCount > 0 ? "covered" : "missing",
    validCount: 1,
    confirmedMentionCount,
    unresolvedTargetCount,
    visibilityLowerBoundPct: confirmedMentionCount > 0 ? 100 : 0,
    visibilityUpperBoundPct: confirmedMentionCount > 0 ? 100 : 0,
    confirmedTop3Count: confirmedMentionCount,
    top3UncertainCount: 0,
    top3LowerBoundPct: confirmedMentionCount > 0 ? 100 : 0,
    top3UpperBoundPct: confirmedMentionCount > 0 ? 100 : 0,
  };
}

describe("unified diagnostic layer summary", () => {
  it("reproduces the Kaspase unified result as 16/24, 16/16, and 0/8", () => {
    const core = Array.from({ length: 8 }, (_, index) =>
      area(`core-${index + 1}`, 0),
    );
    const custom = Array.from({ length: 16 }, (_, index) =>
      area(`custom-${index + 1}`, 1),
    );
    const questionAreas = [...core, ...custom];
    const questionLocations = [
      ...core.map((item) => ({ questionId: item.questionId, city: null })),
      ...custom.map((item) => ({ questionId: item.questionId, city: "구로구" })),
    ];

    const summary = buildUnifiedDiagnosticLayerSummary({
      questionAreas,
      questionLocations,
      overview: {
        validCount: 24,
        confirmedMentionCount: 16,
        unresolvedTargetCount: 0,
      },
    });

    expect(summary).not.toBeNull();
    expect(summary?.overall).toMatchObject({
      questionCount: 24,
      validCount: 24,
      confirmedCount: 16,
      unresolvedCount: 0,
    });
    expect(summary?.custom).toMatchObject({
      questionCount: 16,
      validCount: 16,
      confirmedCount: 16,
      unresolvedCount: 0,
    });
    expect(summary?.core).toMatchObject({
      questionCount: 8,
      validCount: 8,
      confirmedCount: 0,
      unresolvedCount: 0,
    });
    expect(confirmedRatePct(summary!.overall)).toBe(66.67);
    expect(confirmedRatePct(summary!.custom)).toBe(100);
    expect(confirmedRatePct(summary!.core)).toBe(0);
  });

  it("fails closed when the persisted layer shape is not exactly Core 8 + Custom 16", () => {
    const questionAreas = Array.from({ length: 24 }, (_, index) =>
      area(`q-${index + 1}`, index < 16 ? 1 : 0),
    );
    const questionLocations = questionAreas.map((item, index) => ({
      questionId: item.questionId,
      city: index < 17 ? "구로구" : null,
    }));

    expect(
      buildUnifiedDiagnosticLayerSummary({
        questionAreas,
        questionLocations,
        overview: {
          validCount: 24,
          confirmedMentionCount: 16,
          unresolvedTargetCount: 0,
        },
      }),
    ).toBeNull();
  });

  it("fails closed on missing question metadata or overview mismatch", () => {
    const questionAreas = Array.from({ length: 24 }, (_, index) =>
      area(`q-${index + 1}`, index >= 8 ? 1 : 0),
    );
    const validLocations = questionAreas.map((item, index) => ({
      questionId: item.questionId,
      city: index < 8 ? null : "구로구",
    }));

    expect(
      buildUnifiedDiagnosticLayerSummary({
        questionAreas,
        questionLocations: validLocations.slice(0, 23),
        overview: {
          validCount: 24,
          confirmedMentionCount: 16,
          unresolvedTargetCount: 0,
        },
      }),
    ).toBeNull();

    expect(
      buildUnifiedDiagnosticLayerSummary({
        questionAreas,
        questionLocations: validLocations,
        overview: {
          validCount: 24,
          confirmedMentionCount: 15,
          unresolvedTargetCount: 0,
        },
      }),
    ).toBeNull();
  });
});
