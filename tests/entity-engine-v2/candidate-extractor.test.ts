import { describe, expect, it } from "vitest";
import { extractEntityCandidatesV2 } from "../../supabase/functions/_shared/entity-engine-v2/candidate-extractor";
import { parseResponseStructure } from "../../supabase/functions/_shared/entity-engine-v2/response-structure";

const businesses = [
  {
    id: "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
    name: "카스페이스 구로 본점",
    aliases: ["카스페이스 구로본점"],
  },
  {
    id: "a0d95431-fe9f-4bea-a02b-02fd3ea9f2a2",
    name: "현대엑스티어 판교",
    aliases: [],
  },
  {
    id: "483022a4-30c9-4f6d-9cf4-19a30c2f58d2",
    name: "타이어프로 봉일천점",
    aliases: [],
  },
];

describe("Entity Engine v2 candidate extractor", () => {
  it("extracts a registered business subspan instead of the whole descriptive heading", () => {
    const nodes = parseResponseStructure(
      "## 2. 카스페이스 구로본점 패키지 구성\n\n| 패키지 | 가격 |\n|---|---:|\n| 스페셜 | 45만 원~ |",
    );
    const candidates = extractEntityCandidatesV2(nodes, businesses);
    const registered = candidates.find(
      (candidate) =>
        candidate.matchedBusinessIds.includes(
          "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
        ),
    );

    expect(registered?.role).toBe("registered_subspan");
    expect(registered?.identitySurface).toBe("카스페이스 구로본점");
    expect(registered?.observedSurface).toBe("카스페이스 구로본점 패키지 구성");
    expect(
      candidates.some(
        (candidate) => candidate.identitySurface === "카스페이스 구로본점 패키지 구성",
      ),
    ).toBe(false);
  });

  it("extracts the registered business from a purpose criterion body", () => {
    const nodes = parseResponseStructure(
      [
        "## 목적별 추천",
        "- **가성비와 투명한 공임:** 공임나라 분당금곡점",
        "- **빠른 국산차 오일 교환:** 현대엑스티어 판교",
      ].join("\n"),
    );
    const candidates = extractEntityCandidatesV2(nodes, businesses);
    const target = candidates.find(
      (candidate) =>
        candidate.matchedBusinessIds.includes(
          "a0d95431-fe9f-4bea-a02b-02fd3ea9f2a2",
        ),
    );

    expect(target?.identitySurface).toBe("현대엑스티어 판교");
    expect(target?.observedSurface).toContain("빠른 국산차 오일 교환");
    expect(target?.role).toBe("registered_subspan");
  });

  it("extracts the registered business from a regional criterion body", () => {
    const nodes = parseResponseStructure(
      [
        "### 목적별로 고르면",
        "- **금촌·조리 쪽:** 타이어프로 봉일천점",
      ].join("\n"),
    );
    const candidates = extractEntityCandidatesV2(nodes, businesses);
    const tire = candidates.find(
      (candidate) =>
        candidate.matchedBusinessIds.includes(
          "483022a4-30c9-4f6d-9cf4-19a30c2f58d2",
        ),
    );

    expect(tire?.identitySurface).toBe("타이어프로 봉일천점");
    expect(tire?.observedSurface).toContain("금촌·조리 쪽");
  });

  it("emits an unregistered table primary cell as a candidate without confirming it", () => {
    const nodes = parseResponseStructure(
      [
        "## 후보",
        "| 업체 | 위치 |",
        "|---|---|",
        "| **XPEL Pro 일산백석점** | 일산동구 장항로 70 |",
      ].join("\n"),
    );
    const candidates = extractEntityCandidatesV2(nodes, []);
    const xpel = candidates.find(
      (candidate) => candidate.identitySurface === "XPEL Pro 일산백석점",
    );

    expect(xpel?.role).toBe("table_primary_cell");
    expect(xpel?.matchedBusinessIds).toEqual([]);
  });

  it("keeps generic headings as candidates for the later identity gate, not as confirmed businesses", () => {
    const nodes = parseResponseStructure(
      "## 1순위로 문의해볼 곳\n\n| 업체 | 위치 |\n|---|---|\n| XPEL Pro 일산백석점 | 일산동구 |",
    );
    const candidates = extractEntityCandidatesV2(nodes, []);
    const heading = candidates.find(
      (candidate) => candidate.identitySurface === "로 문의해볼 곳",
    );

    expect(heading?.role).toBe("heading_surface");
    expect(heading?.matchedBusinessIds).toEqual([]);
  });
});
