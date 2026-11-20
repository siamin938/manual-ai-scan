import { describe, expect, it } from "vitest";
import { interleaveQuestionsByIntent, hasVerifiedBroadAbsence } from "../../src/components/diagnostic-layout";
import { isCompetitorInitiallyVisible, benchmarkShareText } from "../../src/components/dashboard-evidence-panels";

describe("saved question presentation order", () => {
  it("places sixteen detailed questions into two rows of eight saved intents", () => {
    const intents = ["local", "recommendation", "service", "review_quality", "trust", "comparison", "price_value", "discovery"];
    const rows = intents.flatMap(intentType => [
      {questionId: `${intentType}-first`, intentType, confirmedMentionCount: 0},
      {questionId: `${intentType}-second`, intentType, confirmedMentionCount: 1},
    ]);
    const ordered = interleaveQuestionsByIntent(rows, intents);
    expect(ordered.map(q => q.questionId)).toEqual([
      ...intents.map(intent => `${intent}-first`), ...intents.map(intent => `${intent}-second`),
    ]);
    expect(ordered.reduce((sum, q) => sum + q.confirmedMentionCount, 0)).toBe(8);
  });
  it("interleaves stored questions using the same API intent order, without changing objects", () => {
    const rows = [
      { questionId: "s1", intentType: "service" }, { questionId: "s2", intentType: "service" },
      { questionId: "l1", intentType: "local" }, { questionId: "l2", intentType: "local" },
      { questionId: "s3", intentType: "service" }, { questionId: "extra", intentType: "legacy" },
    ];
    const ordered = interleaveQuestionsByIntent(rows, ["local", "recommendation", "service"]);
    expect(ordered.map(q => q.questionId)).toEqual(["l1", "s1", "extra", "l2", "s2", "s3"]);
    expect(ordered).toHaveLength(rows.length);
    for (const row of rows) expect(ordered).toContain(row);
    expect(rows.map(q => q.questionId)).toEqual(["s1", "s2", "l1", "l2", "s3", "extra"]);
  });
  it("does not describe 0/0 or absent scope as verified broad absence", () => {
    expect(hasVerifiedBroadAbsence([{kind:"core", validCount:0, confirmedCount:0, confirmedPct:null}])).toBe(false);
    expect(hasVerifiedBroadAbsence(null)).toBe(false);
    expect(hasVerifiedBroadAbsence([{kind:"core", validCount:8, confirmedCount:0, confirmedPct:0}])).toBe(true);
    expect(hasVerifiedBroadAbsence([{kind:"core", validCount:8, confirmedCount:1, confirmedPct:12.5}])).toBe(false);
  });
});

describe("initial competitor visibility", () => {
  it("shows the first eight single-observation businesses, then requires expansion", () => {
    expect(Array.from({length:9}, (_, index) => isCompetitorInitiallyVisible("single", index))).toEqual([true,true,true,true,true,true,true,true,false]);
  });
  it("shows all repeated businesses without a presentation limit", () => {
    expect(isCompetitorInitiallyVisible("repeated", 8)).toBe(true);
    expect(isCompetitorInitiallyVisible("repeated", 35)).toBe(true);
  });
});

it("keeps unaggregated shares distinct from zero and formats measured shares with one decimal", () => {
  expect(benchmarkShareText(null)).toBe("집계 전");
  expect(benchmarkShareText(0)).toBe("0.0%");
  expect(benchmarkShareText(75)).toBe("75.0%");
  expect(benchmarkShareText(28.57)).toBe("28.6%");
});