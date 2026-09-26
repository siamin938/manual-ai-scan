import { describe, expect, it } from "vitest";
import {
  buildCustomQuestionCandidates,
  buildCustomQuestionSetSignature,
  buildUnifiedDiagnosticQuestionCandidates,
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

  it("builds a stable signature for identical custom sets regardless of row order", () => {
    const a = buildCustomQuestionSetSignature([
      {
        promptText: "서울에서 테슬라 신차패키지 맡길 수 있는 곳 어디야?",
        intentType: "local",
        region: "서울특별시",
        city: null,
      },
      {
        promptText: "서울에서 테슬라 모델Y 신차패키지 맡길 만한 업체 추천해줘",
        intentType: "recommendation",
        region: "서울특별시",
        city: null,
      },
    ]);
    const b = buildCustomQuestionSetSignature([
      {
        promptText: "서울에서 테슬라 모델Y 신차패키지 맡길 만한 업체 추천해줘",
        intentType: "recommendation",
        region: "서울특별시",
        city: null,
      },
      {
        promptText: "  서울에서  테슬라 신차패키지 맡길 수 있는 곳 어디야? ",
        intentType: "local",
        region: "서울특별시",
        city: null,
      },
    ]);

    expect(a).toBe(b);
  });

  it("keeps location metadata in the custom set signature", () => {
    const regionOnly = buildCustomQuestionSetSignature([
      {
        promptText: "서울에서 신차패키지 추천해줘",
        intentType: "recommendation",
        region: "서울특별시",
        city: null,
      },
    ]);
    const cityScoped = buildCustomQuestionSetSignature([
      {
        promptText: "서울에서 신차패키지 추천해줘",
        intentType: "recommendation",
        region: "서울특별시",
        city: "구로구",
      },
    ]);

    expect(regionOnly).not.toBe(cityScoped);
  });

  it("locks region-mode custom saves to city=null in the questions screen", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/routes/_authenticated/questions.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'const city = customLocationMode === "region" ? null : (selectedBusiness?.city ?? null);',
    );
    expect(source).toContain('buildCustomQuestionSetSignature(');
    expect(source).toContain('같은 맞춤 질문 세트가 이미 있어 기존 세트를 선택했습니다.');
  });

  it("keeps baseline question metadata independent from custom location mode", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/routes/_authenticated/questions.tsx", import.meta.url),
      "utf8",
    );
    const standardStart = source.indexOf("const saveSuggestions = useMutation");
    const customStart = source.indexOf("const saveCustomSuggestions = useMutation");
    const standardBlock = source.slice(standardStart, customStart);

    expect(standardBlock).toContain("city: selectedBusiness?.city ?? null,");
    expect(standardBlock).not.toContain("customLocationMode");
  });


  it("builds one unified 24-question set as 8 intents x 3 questions", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "서울특별시",
        service: "신차패키지",
        brandModel: "테슬라, 테슬라 모델Y, 테슬라 모델3",
      },
      "카스페이스 구로점",
    );

    expect(result).toHaveLength(24);
    expect(new Set(result.map((item) => item.promptText)).size).toBe(24);
    expect(result.every((item) => item.selected)).toBe(true);
    expect(result.every((item) => !item.promptText.includes("카스페이스 구로점"))).toBe(true);

    const counts = new Map<string, number>();
    for (const item of result) {
      counts.set(item.intentType, (counts.get(item.intentType) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      local: 3,
      recommendation: 3,
      service: 3,
      review_quality: 3,
      trust: 3,
      comparison: 3,
      price_value: 3,
      discovery: 3,
    });
  });

  it("uses the locked Core + Focus + Specific wording for the Seoul Tesla example", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "서울특별시",
        service: "신차패키지",
        brandModel: "테슬라, 테슬라 모델Y, 테슬라 모델3",
      },
      "카스페이스 구로점",
    );

    expect(result.slice(0, 3).map((item) => item.promptText)).toEqual([
      "서울에서 신차패키지 맡길 수 있는 곳 어디야?",
      "서울에서 테슬라 신차패키지 맡기기 편한 업체 몇 곳 알려줘",
      "서울에서 테슬라 모델Y 신차패키지 맡길 곳을 위치와 접근성 기준으로 몇 곳 알려줘",
    ]);
    expect(result.slice(3, 6).map((item) => item.promptText)).toEqual([
      "서울에서 신차패키지 잘하는 업체 추천해줘",
      "서울에서 테슬라 모델Y 신차패키지 맡길 만한 업체 추천해줘",
      "서울에서 테슬라 모델3 신차패키지 업체 중 작업 경험과 후기를 함께 보고 추천해줘",
    ]);
    expect(result.slice(15, 18).map((item) => item.promptText)).toEqual([
      "서울 신차패키지 업체 여러 곳을 작업 범위와 후기 기준으로 비교해줘",
      "서울 테슬라 모델3 신차패키지 업체 여러 곳을 작업 범위와 후기 기준으로 비교해줘",
      "서울 테슬라 신차패키지 업체를 작업 범위, 후기, 전문성 기준으로 비교해줘",
    ]);
  });

  it("still produces 24 distinct questions without brand/model or customer need", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "파주시",
        service: "타이어 교체",
      },
      "타이어프로 봉일천점",
    );

    expect(result).toHaveLength(24);
    expect(new Set(result.map((item) => item.promptText)).size).toBe(24);
    expect(result.every((item) => item.promptText.includes("파주"))).toBe(true);
    expect(result.every((item) => item.promptText.includes("타이어 교체"))).toBe(true);
  });

  it("uses owner-confirmed customer need only in the specific layer", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "서울특별시",
        service: "신차패키지",
        brandModel: "테슬라, 테슬라 모델Y",
        customerNeed: "출고 후 한 번에 시공",
      },
      "카스페이스 구로점",
    );

    const needQuestions = result.filter((item) => item.promptText.includes("출고 후 한 번에 시공"));
    expect(needQuestions).toHaveLength(8);
    expect(needQuestions.map((item) => item.id).every((id) => id.endsWith("-specific"))).toBe(true);
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
