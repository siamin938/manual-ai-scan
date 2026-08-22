import { describe, expect, it } from "vitest";
import {
  buildQuestionResults,
  classifyOutcome,
  computePhaseMetrics,
  type MeasurementFact,
} from "./experiments.evaluation.helpers";

function facts(spec: { q: string; mentioned: boolean; position?: number | null }[]): MeasurementFact[] {
  return spec.map((s, i) => ({
    measurementId: `m${i}`,
    questionId: s.q,
    valid: true,
    wasClientMentioned: s.mentioned,
    clientPosition: s.position ?? (s.mentioned ? 1 : null),
    clientDomainCited: false,
    manualReviewRequired: false,
    parserVersion: "1.2.3",
    providerModel: "gpt-5.6-luna",
    registeredCompetitorMention: false,
  }));
}

/** 질문별 5회 중 mention 수를 지정해 phase facts 생성 */
function phase(counts: [number, number, number]): MeasurementFact[] {
  const spec: { q: string; mentioned: boolean }[] = [];
  counts.forEach((c, qi) => {
    for (let i = 0; i < 5; i++) spec.push({ q: `q${qi + 1}`, mentioned: i < c });
  });
  return facts(spec);
}

function outcomeFor(base: [number, number, number], follow: [number, number, number]) {
  const b = computePhaseMetrics(phase(base));
  const f = computePhaseMetrics(phase(follow));
  const questionResults = buildQuestionResults(b, f);
  return classifyOutcome({
    inclusionDeltaCount: f.inclusionCount - b.inclusionCount,
    questionResults,
  });
}

describe("evaluation v0.1 classification", () => {
  it("+2 net, 2 questions up, 0 down => directional_improvement", () => {
    expect(outcomeFor([1, 1, 1], [2, 2, 1])).toBe("directional_improvement");
  });

  it("-2 net, 2 questions down, 0 up => directional_decline", () => {
    expect(outcomeFor([2, 2, 1], [1, 1, 1])).toBe("directional_decline");
  });

  it("+1 only => no_clear_change", () => {
    expect(outcomeFor([1, 1, 1], [2, 1, 1])).toBe("no_clear_change");
  });

  it("+2 net but one question down => no_clear_change", () => {
    expect(outcomeFor([1, 1, 2], [3, 2, 1])).toBe("no_clear_change");
  });
});

describe("evaluation v0.1 metrics", () => {
  it("valid measurements를 분모로 rate를 계산한다", () => {
    const m = computePhaseMetrics(phase([1, 0, 4]));
    expect(m.validCount).toBe(15);
    expect(m.inclusionCount).toBe(5);
    expect(m.inclusionRate).toBeCloseTo(5 / 15);
    expect(m.top3Count).toBe(5);
    expect(m.averagePositionAmongPositioned).toBe(1);
  });

  it("등록 경쟁사 mention이 없으면 substitution은 0", () => {
    const m = computePhaseMetrics(phase([0, 0, 0]));
    expect(m.substitutionCount).toBe(0);
    expect(m.competitorPresentCount).toBe(0);
  });

  it("parser drift는 parserVersions 다중값으로 관측된다", () => {
    const base = phase([1, 1, 1]);
    base[0] = { ...base[0]!, parserVersion: "1.3.0" };
    const m = computePhaseMetrics(base);
    expect(m.parserVersions.length).toBe(2);
  });
});
