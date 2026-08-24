import { describe, expect, it } from "vitest";
import {
  selectBaselineQuestionIds,
  type BaselineFindingCandidate,
} from "./experiments.baseline-question-selection";

const f = (
  finding_key: string,
  question_id: string | null,
  priority_score: number | null,
  metric_value: number | null,
): BaselineFindingCandidate => ({ finding_key, question_id, priority_score, metric_value });

describe("selectBaselineQuestionIds", () => {
  it("우선순위 상위 unique 3개를 선택한다", () => {
    const res = selectBaselineQuestionIds(
      [
        f("k_a", "q1", 69, 0),
        f("k_b", "q2", 69, 0),
        f("k_c", "q3", 69, 0),
        f("k_d", "q4", 67.5, 0.2),
        f("k_e", "q5", 67.5, 0.4),
      ],
      3,
    );
    expect(res).toEqual({ kind: "selected", questionIds: ["q1", "q2", "q3"] });
  });

  it("중복 question_id를 dedupe한다", () => {
    const res = selectBaselineQuestionIds(
      [
        f("k_a", "q1", 90, 0),
        f("k_b", "q1", 80, 0),
        f("k_c", "q2", 70, 0),
        f("k_d", "q3", 60, 0),
      ],
      3,
    );
    expect(res).toEqual({ kind: "selected", questionIds: ["q1", "q2", "q3"] });
  });

  it("관련 질문이 1~2개면 insufficient", () => {
    const res = selectBaselineQuestionIds([f("k_a", "q1", 90, 0), f("k_b", "q2", 80, 0)], 3);
    expect(res).toEqual({ kind: "insufficient", relatedCount: 2 });
  });

  it("관련 질문이 0개면 legacy fallback", () => {
    const res = selectBaselineQuestionIds([f("k_a", null, 90, 0), f("k_b", null, 80, null)], 3);
    expect(res).toEqual({ kind: "legacy_fallback" });
  });

  it("결정적 tie-break: metric_value ASC NULLS LAST, finding_key ASC", () => {
    const res = selectBaselineQuestionIds(
      [
        f("k_z", "qz", 50, null),
        f("k_b", "qb", 50, 0.5),
        f("k_a", "qa", 50, 0.5),
        f("k_c", "qc", 50, 0.1),
      ],
      3,
    );
    expect(res).toEqual({ kind: "selected", questionIds: ["qc", "qa", "qb"] });
  });
});
