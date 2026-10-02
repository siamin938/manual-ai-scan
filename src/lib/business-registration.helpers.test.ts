import { describe, expect, it } from "vitest";
import {
  businessNameIdentityKey,
  generateSafeAliasCandidates,
  getBusinessSaveErrorMessage,
  mergeBusinessAliases,
  normalizeOptionalPublicUrl,
  parseAliasInput,
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

describe("parseAliasInput", () => {
  it("쉼표와 줄바꿈으로 분리하고 정규화·중복 제거한다", () => {
    expect(parseAliasInput("카스페이스 구로 본점,  카스페이스구로본점\n카스페이스  구로 본점\n\n")).toEqual([
      "카스페이스 구로 본점",
      "카스페이스구로본점",
    ]);
  });
});

describe("mergeBusinessAliases", () => {
  it("기존 별칭을 보존하고 새 별칭을 추가하며 공식명은 제외한다", () => {
    expect(mergeBusinessAliases(["기존별칭"], "카스페이스 구로점, 새 별칭, 기존별칭", "카스페이스 구로점")).toEqual([
      "기존별칭",
      "새 별칭",
      "카스페이스구로점",
    ]);
  });

  it("지점 별칭을 자동 추론하지 않는다", () => {
    const out = mergeBusinessAliases([], "", "카스페이스 구로점");
    expect(out).toEqual(["카스페이스구로점"]);
    expect(out).not.toContain("카스페이스 구로 본점");
  });
});

describe("normalizeOptionalPublicUrl", () => {
  it("빈 입력은 null", () => {
    expect(normalizeOptionalPublicUrl("  ")).toEqual({ ok: true, value: null });
  });
  it("scheme 없는 주소에 https를 붙인다", () => {
    expect(normalizeOptionalPublicUrl("www.carspace.co.kr")).toEqual({ ok: true, value: "https://www.carspace.co.kr" });
    expect(normalizeOptionalPublicUrl("carspace.co.kr/about")).toEqual({ ok: true, value: "https://carspace.co.kr/about" });
  });
  it("이미 http(s)인 URL은 유지한다", () => {
    expect(normalizeOptionalPublicUrl("https://naver.me/abc")).toEqual({ ok: true, value: "https://naver.me/abc" });
    expect(normalizeOptionalPublicUrl("http://example.com/x?y=1")).toEqual({ ok: true, value: "http://example.com/x?y=1" });
  });
  it("protocol-relative URL은 https로 바꾼다", () => {
    expect(normalizeOptionalPublicUrl("//example.com")).toEqual({ ok: true, value: "https://example.com" });
  });
  it("지원하지 않는 scheme와 잘못된 값은 거부한다", () => {
    for (const bad of ["ftp://example.com", "javascript:alert(1)", "mailto:a@b.com", "not a url", "https://", "abc", "http://exa mple.com"]) {
      expect(normalizeOptionalPublicUrl(bad).ok).toBe(false);
    }
  });
});
