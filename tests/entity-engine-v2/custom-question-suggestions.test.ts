import { describe, expect, it } from "vitest";
import { buildInsertPayloads } from "../../src/lib/question-suggestions";
import {
  buildCustomQuestionCandidates,
  buildCustomQuestionSetSignature,
  buildUnifiedDiagnosticQuestionCandidates,
  hasUnifiedDiagnosticIntentShape,
  UNIFIED_DIAGNOSTIC_CONTRACT_VERSION,
  naturalizeQuestionLocation,
  parseBrandModelTargets,
  validateCustomQuestionInput,
} from "../../src/lib/custom-question-suggestions";

describe("custom question suggestions v0.1", () => {
  it("pins the unified diagnostic contract at v0.2", () => {
    expect(UNIFIED_DIAGNOSTIC_CONTRACT_VERSION).toBe("0.2");
  });

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

  it("automates broad Core and local Focus/Specific regions in the questions screen", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/routes/_authenticated/questions.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const diagnosticCoreLocation =");
    expect(source).toContain("const diagnosticDetailLocation =");
    expect(source).toContain("기준 검색 8문항");
    expect(source).toContain("맞춤 검색 16문항");
    expect(source).toContain("resolveQuestionLocation(candidate.promptText, region, city)");
    expect(source).not.toContain("customLocationMode");
    expect(source).toContain("buildCustomQuestionSetSignature(");
    expect(source).toContain("같은 AI 진단 질문 세트가 이미 있어 기존 세트를 선택했습니다.");
    expect(source).toContain("내 업체 AI 진단 24문항 만들기");
    expect(source).toContain("AI 진단 질문 검토");
    expect(source).toContain("24개 질문 저장");
    expect(source).not.toContain("기본 진단 24문항 만들기");
  });

  it("keeps baseline question metadata independent from unified diagnostic location routing", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/routes/_authenticated/questions.tsx", import.meta.url),
      "utf8",
    );
    const standardStart = source.indexOf("const saveSuggestions = useMutation");
    const customStart = source.indexOf("const saveCustomSuggestions = useMutation");
    const standardBlock = source.slice(standardStart, customStart);

    expect(standardBlock).toContain("city: selectedBusiness?.city ?? null,");
    expect(standardBlock).not.toContain("diagnosticCoreLocation");
    expect(standardBlock).not.toContain("diagnosticDetailLocation");
  });


  it("accepts only the exact unified 8 intents x 3 server shape", () => {
    const valid = [
      "local", "local", "local",
      "recommendation", "recommendation", "recommendation",
      "service", "service", "service",
      "review_quality", "review_quality", "review_quality",
      "trust", "trust", "trust",
      "comparison", "comparison", "comparison",
      "price_value", "price_value", "price_value",
      "discovery", "discovery", "discovery",
    ];
    expect(hasUnifiedDiagnosticIntentShape(valid)).toBe(true);
    expect(hasUnifiedDiagnosticIntentShape(valid.slice(0, 23))).toBe(false);
    expect(hasUnifiedDiagnosticIntentShape([...valid.slice(0, 23), "unknown"])).toBe(false);
    expect(
      hasUnifiedDiagnosticIntentShape([
        ...valid.filter((intent) => intent !== "local"),
        "recommendation", "recommendation", "recommendation",
      ]),
    ).toBe(false);
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

  it("uses customer-like Core + Focus + Specific wording for the Seoul Tesla example", () => {
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
      "서울 신차패키지 업체 여러 곳 후기랑 작업 내용 비교해줘",
      "서울 테슬라 모델3 신차패키지 업체 몇 곳 후기랑 작업 내용 비교해줘",
      "서울 테슬라 신차패키지 업체 몇 곳 후기랑 가격 비교해줘",
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

  it("keeps most Core questions broad while mixing optional models into some Core intents", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "서울특별시",
        service: "튜닝",
        brandModel: "필랑트, 그랑콜레오스",
      },
      "아우토모토스",
      "자동차 튜닝",
      "중랑구",
    );

    expect(result).toHaveLength(24);

    for (let i = 0; i < result.length; i += 3) {
      const core = result[i]!;
      const focus = result[i + 1]!;
      const specific = result[i + 2]!;
      expect(core.promptText).toContain("서울");
      expect(core.promptText).toContain("튜닝");
      expect(core.promptText).not.toContain("르노");
      expect(core.promptText).not.toContain("중랑");
      expect(focus.promptText).toContain("중랑");
      expect(specific.promptText).toContain("중랑");
      expect(focus.promptText.includes("필랑트")).not.toBe(
        specific.promptText.includes("필랑트"),
      );
      expect(focus.promptText.includes("그랑콜레오스")).not.toBe(
        specific.promptText.includes("그랑콜레오스"),
      );
    }

    const coreQuestions = result.filter((_, index) => index % 3 === 0);
    expect(coreQuestions.filter((item) => item.promptText.includes("필랑트"))).toHaveLength(1);
    expect(coreQuestions.filter((item) => item.promptText.includes("그랑콜레오스"))).toHaveLength(1);
    expect(coreQuestions.filter((item) =>
      !item.promptText.includes("필랑트") && !item.promptText.includes("그랑콜레오스"),
    )).toHaveLength(6);

    expect(result.filter((item) => item.promptText.includes("서울")).length).toBe(8);
    expect(result.filter((item) => item.promptText.includes("중랑")).length).toBe(16);
    expect(result.filter((item) => item.promptText.includes("필랑트")).length).toBe(9);
    expect(result.filter((item) => item.promptText.includes("그랑콜레오스")).length).toBe(9);
    expect(result.some((item) => item.promptText.includes("오래 작업한"))).toBe(false);
  });

  it("stores Core questions at region scope and local questions at city scope", () => {
    const candidates = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "서울특별시",
        service: "튜닝",
        brandModel: "필랑트, 그랑콜레오스",
      },
      "아우토모토스",
      "자동차 튜닝",
      "중랑구",
    );
    const payloads = buildInsertPayloads(candidates, {
      orgId: "org",
      questionSetId: "set",
      region: "서울특별시",
      city: "중랑구",
    });

    expect(payloads).toHaveLength(24);
    payloads.forEach((row, index) => {
      expect(row.region).toBe("서울특별시");
      if (index % 3 === 0) {
        expect(row.city).toBeNull();
      } else {
        expect(row.city).toBe("중랑구");
      }
    });
  });

  it("uses natural customer wording for service, trust, and comparison questions", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "경기도",
        service: "엔진오일",
      },
      "현대엑스티어 판교",
      "자동차 엔진오일 교환·프리미엄 윤활유 전문점",
      "성남시 분당구",
    );

    expect(result[7]?.promptText).toBe("성남 분당에서 엔진오일 잘하는 곳 알려줘");
    expect(result[8]?.promptText).toBe("성남 분당에서 엔진오일 맡길 수 있는 업체 몇 곳 알려줘");
    expect(result[14]?.promptText).toBe("성남 분당에서 엔진오일 믿고 맡길 만한 곳 알려줘");
    expect(result.slice(15, 18).map((item) => item.promptText)).toEqual([
      "경기 엔진오일 업체 여러 곳 후기랑 작업 내용 비교해줘",
      "성남 분당 엔진오일 업체 몇 곳 후기랑 작업 내용 비교해줘",
      "성남 분당 엔진오일 업체 몇 곳 후기랑 가격 비교해줘",
    ]);
    expect(result.some((item) => item.promptText.includes("작업 범위를 다양하게"))).toBe(false);
    expect(result.some((item) => item.promptText.includes("전문성과 작업 경험을 확인"))).toBe(false);
  });

  it("clarifies generic tuning as automobile tuning when no model is present", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "경기도",
        service: "튜닝",
      },
      "커스텀개러지",
      "르노 자동차 튜닝",
      "남양주시",
    );

    expect(result).toHaveLength(24);
    expect(result.every((item) => item.promptText.includes("자동차 튜닝"))).toBe(true);
    expect(result.every((item) => !item.promptText.includes("르노"))).toBe(true);
  });

  it("does not narrow a broad tuning service from registered category metadata", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "경기도",
        service: "튜닝",
        brandModel: "필랑트, 그랑콜레오스, 아르카나",
      },
      "커스텀개러지",
      "르노 자동차 튜닝",
      "남양주시",
    );

    expect(result).toHaveLength(24);
    const coreQuestions = result.filter((_, index) => index % 3 === 0);
    expect(coreQuestions).toHaveLength(8);
    expect(coreQuestions.every((item) => item.promptText.includes("튜닝"))).toBe(true);
    expect(coreQuestions.every((item) => !item.promptText.includes("르노"))).toBe(true);
    expect(coreQuestions.filter((item) => !/필랑트|그랑콜레오스|아르카나/u.test(item.promptText))
      .every((item) => item.promptText.includes("자동차 튜닝"))).toBe(true);

    expect(coreQuestions.map((item) => item.promptText)).toEqual([
      "경기에서 자동차 튜닝 맡길 수 있는 곳 어디야?",
      "경기에서 자동차 튜닝 잘하는 업체 추천해줘",
      "경기에서 필랑트 튜닝 전문으로 하는 곳 알려줘",
      "경기 그랑콜레오스 튜닝 실제 이용 후기 좋은 곳 알려줘",
      "자동차 튜닝 작업 경험 많은 경기 업체 어디야?",
      "경기 자동차 튜닝 업체 여러 곳 후기랑 작업 내용 비교해줘",
      "경기에서 아르카나 튜닝 비용 대비 괜찮은 곳 알려줘",
      "경기에서 자동차 튜닝 업체를 처음 알아볼 때 후보로 볼 만한 곳 몇 곳 알려줘",
    ]);
  });

  it("does not narrow a broad engine-oil service to premium from category metadata", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "경기도",
        service: "엔진오일",
      },
      "현대엑스티어 판교",
      "자동차 엔진오일 교환·프리미엄 윤활유 전문점",
      "성남시 분당구",
    );

    expect(result).toHaveLength(24);
    expect(result.every((item) => item.promptText.includes("엔진오일"))).toBe(true);
    expect(result.every((item) => !item.promptText.includes("프리미엄"))).toBe(true);
  });

  it("keeps premium wording when the owner-confirmed service itself is premium", () => {
    const result = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "경기도",
        service: "프리미엄 엔진오일",
      },
      "프리미엄오일 전문점",
      "자동차 프리미엄 엔진오일 전문점",
      "성남시 분당구",
    );

    expect(result).toHaveLength(24);
    expect(result.every((item) => item.promptText.includes("프리미엄"))).toBe(true);
  });

  it("keeps Gyeonggi Core broad while Seongnam Bundang stays detailed", () => {
    const candidates = buildUnifiedDiagnosticQuestionCandidates(
      {
        location: "경기도",
        service: "프리미엄 엔진오일",
      },
      "현대엑스티어 판교",
      "자동차 엔진오일 교환·프리미엄 윤활유 전문점",
      "성남시 분당구",
    );

    expect(candidates).toHaveLength(24);
    expect(new Set(candidates.map((item) => item.promptText)).size).toBe(24);

    candidates.forEach((item, index) => {
      if (index % 3 === 0) {
        expect(item.promptText).toContain("경기");
        expect(item.promptText).not.toContain("성남");
        expect(item.promptText).not.toContain("분당");
      } else {
        expect(item.promptText).toContain("성남 분당");
      }
    });

    const payloads = buildInsertPayloads(candidates, {
      orgId: "org",
      questionSetId: "set",
      region: "경기도",
      city: "성남시 분당구",
    });

    payloads.forEach((row, index) => {
      expect(row.region).toBe("경기도");
      if (index % 3 === 0) {
        expect(row.city).toBeNull();
      } else {
        expect(row.city).toBe("성남시 분당구");
      }
    });
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
