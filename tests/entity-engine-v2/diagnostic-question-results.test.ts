import { describe, expect, it } from "vitest";
import { questionPresentationState, questionPresentationGroups, confirmedUniqueQuestionCount, type PresentedQuestion } from "../../src/components/diagnostic-question-results";
const q = (questionId: string, validCount: number, confirmedMentionCount: number, unresolvedTargetCount = 0): PresentedQuestion => ({ questionId, questionText: `긴 한글 질문 ${questionId}`, intentType: "local", validCount, confirmedMentionCount, unresolvedTargetCount });
describe("saved question result presentation", () => {
  it("orders confirmed, additional checks, unconfirmed, and no valid answers without mutating the original", () => {
    const rows = [q("absent1", 1, 0), q("none", 0, 0), q("check", 2, 0, 1), q("yes1", 3, 2), q("absent2", 1, 0), q("yes2", 1, 1)];
    expect(questionPresentationGroups(rows).flatMap(g => g.rows.map(row => row.questionId))).toEqual(["yes1", "yes2", "check", "absent1", "absent2", "none"]);
    expect(rows.map(row => row.questionId)).toEqual(["absent1", "none", "check", "yes1", "absent2", "yes2"]);
  });
  it("keeps mixed confirmed answers first and retains unresolved answer counts", () => {
    const mixed = q("mixed", 4, 2, 1);
    expect(questionPresentationState(mixed)).toBe("confirmed");
    expect(questionPresentationGroups([mixed])[0]?.rows[0]?.unresolvedTargetCount).toBe(1);
  });
  it("counts unique confirmed questions, never repeated answer occurrences", () => {
    expect(confirmedUniqueQuestionCount([q("a", 5, 3), q("a", 5, 3), q("b", 2, 1), q("c", 2, 0)])).toBe(2);
  });
  it("keeps zero valid answers distinct from zero confirmed answers", () => {
    expect(questionPresentationState(q("zero", 0, 0))).toBe("unmeasured");
    expect(questionPresentationState(q("absent", 3, 0))).toBe("absent");
  });
  it("does not present mismatched or missing historical counts as confirmed", () => {
    expect(questionPresentationState(q("invalid", 1, 2))).toBe("unavailable");
    expect(questionPresentationState(q("missing", Number.NaN, 0))).toBe("unavailable");
    expect(confirmedUniqueQuestionCount([q("invalid", 1, 2)])).toBe(0);
  });
  it("omits empty categories and preserves every original row", () => {
    const rows = [q("one", 1, 0), q("two", 1, 0)];
    const groups = questionPresentationGroups(rows);
    expect(groups.map(group => group.state)).toEqual(["absent"]);
    expect(groups.flatMap(group => group.rows)).toEqual(rows);
  });
});
