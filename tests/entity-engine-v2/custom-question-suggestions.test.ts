import { describe, expect, it } from "vitest";
import {
  buildCustomQuestionCandidates,
  validateCustomQuestionInput,
} from "../../src/lib/custom-question-suggestions";

describe("custom question suggestions v0.1", () => {
  it("builds one deterministic question for each allowed intent", () => {
    const result = buildCustomQuestionCandidates(
      {
        location: "구로구",
        service: "신차패키지",
        brandModel: "테슬라 모델Y",
        customerNeed: "출고 후 한 번에 시공",
      },
      "카스페이스 구로점",
    );

    expect(result).toHaveLength(8);
    expect(result.map((item) => item.intentType)).toEqual([
      "local",
      "recommendation",
      "service",
      "review_quality",
      "trust",
      "comparison",
      "price_value",
      "discovery",
    ]);
    expect(result.every((item) => item.selected)).toBe(true);
    expect(result.every((item) => !item.promptText.includes("카스페이스 구로점"))).toBe(true);
    expect(result.some((item) => item.promptText.includes("테슬라 모델Y"))).toBe(true);
    expect(result.some((item) => item.promptText.includes("출고 후 한 번에 시공"))).toBe(true);
  });

  it("works without brand/model or customer need", () => {
    const result = buildCustomQuestionCandidates(
      {
        location: "파주시",
        service: "타이어 교체",
      },
      "타이어프로 봉일천점",
    );

    expect(result).toHaveLength(8);
    expect(result.every((item) => item.promptText.includes("파주시"))).toBe(true);
    expect(result.every((item) => item.promptText.includes("타이어 교체"))).toBe(true);
  });

  it("rejects missing service", () => {
    expect(
      validateCustomQuestionInput(
        { location: "구로구", service: " " },
        "카스페이스 구로점",
      ),
    ).toEqual({ ok: false, error: "SERVICE_REQUIRED" });
  });

  it("rejects target business name in owner input", () => {
    expect(
      validateCustomQuestionInput(
        {
          location: "구로구",
          service: "신차패키지",
          customerNeed: "카스페이스 구로점처럼 시공",
        },
        "카스페이스 구로점",
      ),
    ).toEqual({ ok: false, error: "BUSINESS_NAME_INCLUDED" });
  });
});
