import { describe, expect, it } from "vitest";
import {
  businessNameIdentityKey,
  generateSafeAliasCandidates,
  getBusinessSaveErrorMessage,
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

describe("businessNameIdentityKey", () => {
  it("공백 차이를 무시한다", () => {
    expect(businessNameIdentityKey("  커스텀개러지 ")).toBe(businessNameIdentityKey("커스텀개러지"));
    expect(businessNameIdentityKey("커스텀  개러지")).toBe(businessNameIdentityKey("커스텀 개러지"));
  });

  it("영문 대소문자 차이를 무시한다", () => {
    expect(businessNameIdentityKey("ABC Motors")).toBe(businessNameIdentityKey("abc motors"));
  });
});

describe("getBusinessSaveErrorMessage", () => {
  it("unique 위반은 친절한 한글 메시지로 바꾸고 constraint 이름을 노출하지 않는다", () => {
    const msg = getBusinessSaveErrorMessage({
      code: "23505",
      message: 'duplicate key value violates unique constraint "businesses_org_id_name_key"',
      details: "Key (org_id, name) already exists.",
    });
    expect(msg).toBe("이미 등록된 업체명입니다. 지점이 다른 업체라면 공식 업체명에 지점명을 포함해 주세요.");
    expect(msg).not.toContain("businesses_org_id_name_key");
  });

  it("일반 오류는 일반 메시지로 변환한다", () => {
    expect(getBusinessSaveErrorMessage(new Error("network down"))).toBe(
      "업체 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });
});
