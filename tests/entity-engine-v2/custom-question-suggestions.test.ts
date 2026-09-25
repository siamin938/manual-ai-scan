import { describe, expect, it } from "vitest";
import {
  buildCustomQuestionCandidates,
  naturalizeQuestionLocation,
  parseBrandModelTargets,
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
    expect(new Set(result.map((item) => item.promptText)).size).toBe(8);
    expect(result.every((item) => item.promptText.includes("구로"))).toBe(true);
    expect(result.every((item) => !item.promptText.includes("구로구"))).toBe(true);
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
    expect(result.every((item) => item.promptText.includes("파주"))).toBe(true);
    expect(result.every((item) => !item.promptText.includes("파주시"))).toBe(true);
    expect(result.every((item) => item.promptText.includes("타이어 교체"))).toBe(true);
  });

  it("uses natural search surfaces for registered administrative areas", () => {
    expect(naturalizeQuestionLocation("서울특별시")).toBe("서울");
    expect(naturalizeQuestionLocation("파주시")).toBe("파주");
    expect(naturalizeQuestionLocation("구로구")).toBe("구로");
    expect(naturalizeQuestionLocation("고양시 일산동구")).toBe("고양 일산동구");
  });

  it("keeps intent angles materially different for the Seoul Tesla example", () => {
    const result = buildCustomQuestionCandidates(
      {
        location: "서울특별시",
        service: "신차패키지",
        brandModel: "테슬라",
      },
      "카스페이스 구로점",
    );

    expect(result.map((item) => item.promptText)).toEqual([
      "서울에서 테슬라 신차패키지 맡길 수 있는 곳 어디야?",
      "서울에서 테슬라 신차패키지 맡길 만한 업체 추천해줘",
      "서울에서 테슬라 신차패키지 전문으로 하는 곳 알려줘",
      "서울 테슬라 신차패키지 실제 이용 후기 좋은 곳 알려줘",
      "테슬라 신차패키지 작업 경험 많은 서울 업체 어디야?",
      "서울 테슬라 신차패키지 업체 여러 곳을 작업 범위와 후기 기준으로 비교해줘",
      "서울에서 테슬라 신차패키지 비용 대비 괜찮은 곳 알려줘",
      "서울에서 테슬라 신차패키지 업체를 처음 알아볼 때 후보로 볼 만한 곳 몇 곳 알려줘",
    ]);
  });

  it("splits multiple brand/model targets and distributes them across questions", () => {
    expect(
      parseBrandModelTargets("테슬라, 테슬라 모델Y, 테슬라 모델3, 테슬라 모델Y"),
    ).toEqual(["테슬라", "테슬라 모델Y", "테슬라 모델3"]);

    const result = buildCustomQuestionCandidates(
      {
        location: "서울특별시",
        service: "신차패키지",
        brandModel: "테슬라, 테슬라 모델Y, 테슬라 모델3",
      },
      "카스페이스 구로점",
    );

    expect(result).toHaveLength(8);
    expect(result[0]?.promptText).toContain("테슬라 신차패키지");
    expect(result[1]?.promptText).toContain("테슬라 모델Y 신차패키지");
    expect(result[2]?.promptText).toContain("테슬라 모델3 신차패키지");
    expect(result.every((item) => !item.promptText.includes("테슬라, 테슬라"))).toBe(true);
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
