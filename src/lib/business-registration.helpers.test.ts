import { describe, expect, it } from "vitest";
import {
  generateSafeAliasCandidates,
  normalizeAliasList,
  normalizeBusinessName,
} from "./business-registration.helpers";

describe("normalizeBusinessName", () => {
  it("트림하고 연속 공백을 1칸으로 만든다", () => {
    expect(normalizeBusinessName("  강남   모터스  남양주점 ")).toBe("강남 모터스 남양주점");
  });

  it("빈 문자열을 안전하게 처리한다", () => {
    expect(normalizeBusinessName("   ")).toBe("");
  });
});

describe("generateSafeAliasCandidates", () => {
  it("공백만 제거한 전체 이름 1개를 후보로 만든다", () => {
    expect(generateSafeAliasCandidates("강남 모터스 남양주점")).toEqual(["강남모터스남양주점"]);
  });

  it("공백이 없는 이름은 후보가 없다", () => {
    expect(generateSafeAliasCandidates("강남모터스")).toEqual([]);
  });

  it("지점명·지역명을 삭제한 축약형은 만들지 않는다", () => {
    const candidates = generateSafeAliasCandidates("강남 모터스 남양주점");
    expect(candidates).not.toContain("강남 모터스");
    expect(candidates).not.toContain("강남모터스");
    expect(candidates).not.toContain("모터스");
    expect(candidates.length).toBe(1);
  });

  it("정규화된 공식명 자체는 후보에 포함하지 않는다", () => {
    expect(generateSafeAliasCandidates("강남 모터스")).not.toContain("강남 모터스");
  });

  it("빈 이름은 후보가 없다", () => {
    expect(generateSafeAliasCandidates("  ")).toEqual([]);
  });
});

describe("normalizeAliasList", () => {
  it("공백 정규화 후 중복을 제거한다", () => {
    expect(normalizeAliasList(["강남  모터스", "강남 모터스", " ", "강남모터스"])).toEqual([
      "강남 모터스",
      "강남모터스",
    ]);
  });
});
