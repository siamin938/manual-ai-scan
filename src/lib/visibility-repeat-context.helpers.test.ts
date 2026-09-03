import { describe, expect, it } from "vitest";
import {
  normalizeDomain,
  repeatQuestionLabel,
  repeatQuestionState,
  resolveSourceSide,
  sortRepeatQuestions,
} from "./visibility-repeat-context.helpers";
import type { RepeatContextQuestionDTO } from "./visibility-repeat-context.types";

describe("normalizeDomain", () => {
  it("lower-cases and strips a leading www", () => {
    expect(normalizeDomain("WWW.Example.COM")).toBe("example.com");
    expect(normalizeDomain(" blog.example.com ")).toBe("blog.example.com");
  });

  it("returns null for empty or non-string input", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });
});

describe("resolveSourceSide", () => {
  it("classifies by which side has responses", () => {
    expect(resolveSourceSide(2, 0)).toBe("client");
    expect(resolveSourceSide(0, 3)).toBe("competitor");
    expect(resolveSourceSide(1, 1)).toBe("both");
    expect(resolveSourceSide(0, 0)).toBeNull();
  });
});

describe("repeatQuestionState", () => {
  it("splits never/sometimes/always", () => {
    expect(repeatQuestionState(2, 0)).toBe("never_visible");
    expect(repeatQuestionState(2, 1)).toBe("sometimes_visible");
    expect(repeatQuestionState(2, 2)).toBe("always_visible");
    expect(repeatQuestionState(3, 3)).toBe("always_visible");
  });
});

describe("repeatQuestionLabel", () => {
  it("renders counts dynamically", () => {
    expect(repeatQuestionLabel(2, 0)).toBe("2회 모두 미추천");
    expect(repeatQuestionLabel(2, 1)).toBe("1회 미추천 · 1회 추천");
    expect(repeatQuestionLabel(3, 1)).toBe("2회 미추천 · 1회 추천");
    expect(repeatQuestionLabel(3, 3)).toBe("3회 모두 추천");
  });
});

describe("sortRepeatQuestions", () => {
  it("keeps never_visible first, then more missing runs first", () => {
    const items: RepeatContextQuestionDTO[] = [
      {
        questionId: "b",
        questionText: "B",
        intentType: "local",
        validCount: 3,
        mentionCount: 1,
        state: "sometimes_visible",
      },
      {
        questionId: "a",
        questionText: "A",
        intentType: "local",
        validCount: 2,
        mentionCount: 0,
        state: "never_visible",
      },
      {
        questionId: "c",
        questionText: "C",
        intentType: "price_value",
        validCount: 3,
        mentionCount: 2,
        state: "sometimes_visible",
      },
    ];
    expect(sortRepeatQuestions(items).map((q) => q.questionId)).toEqual(["a", "b", "c"]);
  });
});
