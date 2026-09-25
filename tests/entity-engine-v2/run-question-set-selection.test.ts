import { describe, expect, it } from "vitest";
import {
  choosePreferredRunQuestionSetId,
  getRunQuestionSetKind,
  isCustomRunQuestionSet,
} from "../../src/routes/_authenticated/runs.index";

describe("run question set selection", () => {
  it("recognizes only the v0.1 custom prefix", () => {
    expect(isCustomRunQuestionSet("맞춤 질문 · 카스페이스 구로점 · 2026-09-25")).toBe(true);
    expect(isCustomRunQuestionSet("Market 맞춤 질문")).toBe(false);
  });

  it("prefers the newest custom set in the existing newest-first order", () => {
    expect(
      choosePreferredRunQuestionSetId([
        { id: "new-baseline", name: "기본 질문" },
        { id: "new-custom", name: "맞춤 질문 · 새 세트" },
        { id: "old-custom", name: "맞춤 질문 · 이전 세트" },
      ]),
    ).toBe("new-custom");
  });

  it("falls back to the newest general set when no custom set exists", () => {
    expect(
      choosePreferredRunQuestionSetId([
        { id: "newest", name: "Market 질문" },
        { id: "older", name: "기본 질문" },
      ]),
    ).toBe("newest");
  });

  it("uses question count only to distinguish a selected baseline from other sets", () => {
    expect(getRunQuestionSetKind("맞춤 질문 · 업체", 8)).toBe("custom");
    expect(getRunQuestionSetKind("기본 질문", 24)).toBe("baseline");
    expect(getRunQuestionSetKind("Market 질문", 8)).toBe("other");
  });
});