import { describe, expect, it } from "vitest";
import {
  CITATION_PAGE_ENTITY_VERIFIER_VERSION,
  buildCitationPageIdentitySurfaces,
  verifyCitationPageEntity,
} from "../../supabase/functions/_shared/citation-page-entity-verification";

const branchBusiness = {
  name: "현대 엑스티어 판교점",
  aliases: [] as string[],
  region: "경기도",
  city: "성남시 분당구",
  address: "경기도 성남시 분당구 대왕판교로 660",
};

describe("Citation Page Entity Verification v0.1", () => {
  it("pins the verifier version", () => {
    expect(CITATION_PAGE_ENTITY_VERIFIER_VERSION).toBe("0.1.1");
  });

  it("derives only the safe terminal 점 branch variant when aliases are empty", () => {
    expect(buildCitationPageIdentitySurfaces(branchBusiness)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "현대 엑스티어 판교점",
          kind: "explicit",
        }),
        expect.objectContaining({
          value: "현대 엑스티어 판교",
          kind: "inferred_branch",
        }),
      ]),
    );
  });

  it("confirms a verified official source without page-text inference", () => {
    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/store",
        citationTitle: null,
        pageTitle: null,
        pageText: null,
        fetchSucceeded: false,
        officialSource: true,
      },
    });
    expect(result.status).toBe("confirmed");
    expect(result.confidence).toBe("high");
    expect(result.reasons).toContain("official_source");
  });

  it("confirms an exact branch identity in the page title", () => {
    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/article",
        citationTitle: "현대 엑스티어 판교점 오픈",
        pageTitle: null,
        pageText: "",
        fetchSucceeded: true,
        officialSource: false,
      },
    });
    expect(result.status).toBe("confirmed");
    expect(result.confidence).toBe("high");
  });

  it("confirms the safe branch variant in page body without hardcoding the business", () => {
    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/article",
        citationTitle: "윤활유 전문 플래그십 스토어 오픈",
        pageTitle: "판교에 첫 윤활유 전문점",
        pageText:
          "HD현대오일뱅크는 성남시 분당구 대왕판교로에 현대엑스티어 판교를 열었다.",
        fetchSucceeded: true,
        officialSource: false,
      },
    });
    expect(result.status).toBe("confirmed");
    expect(result.reasons).toContain("safe_branch_identity_body");
  });

  it("confirms brand plus branch on the page even when the exact phrase is separated", () => {
    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/article",
        citationTitle: "판교에 첫 전문점",
        pageTitle: "판교에 첫 전문점",
        pageText:
          "현대엑스티어의 첫 전문 매장이 판교에 문을 열었다. 성남시 분당구에 위치한다.",
        fetchSucceeded: true,
        officialSource: false,
      },
    });
    expect(result.status).toBe("confirmed");
    expect(result.reasons).toContain("brand_and_branch_on_page");
  });

  it("keeps a brand-only page unresolved for a branch-specific business", () => {
    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/article",
        citationTitle: "현대엑스티어 윤활유 신제품",
        pageTitle: "현대엑스티어 윤활유 신제품",
        pageText: "현대엑스티어 브랜드의 새 윤활유 제품을 소개한다.",
        fetchSucceeded: true,
        officialSource: false,
      },
    });
    expect(result.status).toBe("unresolved");
    expect(result.reasons).toContain("partial_branch_identity_evidence");
  });

  it("marks a successfully fetched unrelated page as unrelated", () => {
    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/gongim",
        citationTitle: "성남 공임나라 정비소 찾기",
        pageTitle: "성남 공임나라 정비소 찾기",
        pageText: "공임나라 지점과 예약 정보를 안내합니다.",
        fetchSucceeded: true,
        officialSource: false,
      },
    });
    expect(result.status).toBe("unrelated");
    expect(result.confidence).toBe("high");
  });

  it("fails closed when an inferred identity surface collides", () => {
    const inferred = buildCitationPageIdentitySurfaces(branchBusiness).find(
      (item) => item.kind === "inferred_branch",
    );
    expect(inferred).toBeDefined();

    const result = verifyCitationPageEntity({
      business: branchBusiness,
      page: {
        url: "https://example.com/article",
        citationTitle: "현대 엑스티어 판교",
        pageTitle: null,
        pageText: "",
        fetchSucceeded: true,
        officialSource: false,
      },
      ambiguousIdentityCompacts: new Set([inferred!.compact]),
    });
    expect(result.status).not.toBe("confirmed");
  });

  it("supports non-branch businesses such as blogs, profiles and local services", () => {
    const result = verifyCitationPageEntity({
      business: {
        name: "모터큐브",
        aliases: [],
        region: "서울특별시",
        city: "구로구",
        address: null,
      },
      page: {
        url: "https://blog.naver.com/example",
        citationTitle: "모터큐브 신차패키지 시공 후기",
        pageTitle: null,
        pageText: "",
        fetchSucceeded: true,
        officialSource: false,
      },
    });
    expect(result.status).toBe("confirmed");
    expect(result.confidence).toBe("high");
  });
});
