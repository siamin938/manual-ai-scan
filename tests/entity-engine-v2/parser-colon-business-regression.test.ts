import { describe, expect, it } from "vitest";
import { parseMeasurement, PARSER_VERSION } from "../../supabase/functions/reparse-measurements/_shared/parser";

describe("parser 1.2.4 colon suffix business regression", () => {
  const target = {
    id: "c9cb39d5-9f04-46ec-8018-14156670446d",
    name: "카스페이스 구로점",
    aliases: ["카스페이스구로점", "카스페이스 구로 본점", "카스페이스구로본점"],
    officialDomains: [],
    isClient: true,
  };

  it("recognizes a registered business when a ranked heading is criterion: business", () => {
    const response = [
      "### 1. 테슬라 전문성 우선: 퀀텀팩토리 서초점",
      "설명",
      "### 2. PPF 마감과 대표 직접 시공을 중시: 모먼트",
      "설명",
      "### 3. 실제 모델 3 하이랜드 후기 확인: 카스페이스 구로 본점",
      "서울 구로에서 모델3 하이랜드 신차패키지 실제 작업 사례가 공개되어 있습니다.",
    ].join("\n");

    const parsed = parseMeasurement(response, [], [target], { region: "서울특별시" });

    expect(PARSER_VERSION).toBe("1.2.4");
    expect(parsed.wasClientMentioned).toBe(true);
    expect(parsed.clientPosition).toBe(3);
    expect(
      parsed.mentions.some(
        (mention) =>
          mention.businessId === target.id &&
          mention.displayName === "카스페이스 구로점" &&
          mention.position === 3,
      ),
    ).toBe(true);
    expect(
      parsed.entityResolutions.some(
        (resolution) =>
          resolution.matchedBusinessId === target.id &&
          resolution.matchedAlias === "카스페이스 구로 본점" &&
          resolution.position === 3 &&
          resolution.countAsConfirmedBusiness === true,
      ),
    ).toBe(true);
  });

  it("does not treat arbitrary colon suffix text as a business", () => {
    const response = [
      "### 1. 추천 이유: 실제 후기와 작업 범위가 좋음",
      "설명",
    ].join("\n");

    const parsed = parseMeasurement(response, [], [target], { region: "서울특별시" });

    expect(parsed.wasClientMentioned).toBe(false);
    expect(parsed.clientPosition).toBeUndefined();
    expect(parsed.mentions).toHaveLength(0);
  });
});
