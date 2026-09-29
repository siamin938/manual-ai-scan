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

  it("extracts a registered business exact subspan from prose without creating unregistered paragraph guesses", () => {
    const nodes = parseResponseStructure(
      "자동차 썬팅 범위 상담이라면 **카스페이스 구로 본점**부터 문의해보시는 게 괜찮습니다. ([hunnytip.kr](https://www.hunnytip.kr/example))",
    );
    const candidates = extractEntityCandidatesV2(nodes, businesses);

    expect(candidates).toEqual([
      expect.objectContaining({
        nodeKind: "paragraph",
        role: "registered_subspan",
        identitySurface: "카스페이스 구로 본점",
        matchedBusinessIds: ["8fa9168b-4dc2-4417-b2ef-bbdafd842c38"],
      }),
    ]);
  });

  it("extracts a safe terminal branch-suffix variant as the registered business", () => {
    const target = {
      id: "aefb2bb9-d0a2-4a6e-9be1-511c5cf82fb4",
      name: "현대 엑스티어 판교점",
      aliases: [],
    };
    const nodes = parseResponseStructure(
      "- **빠른 오일 교환:** 현대엑스티어 판교",
    );
    const candidates = extractEntityCandidatesV2(nodes, [target]);
    const matched = candidates.find((candidate) =>
      candidate.matchedBusinessIds.includes(target.id),
    );

    expect(matched?.role).toBe("registered_subspan");
    expect(matched?.identitySurface).toBe("현대엑스티어 판교");
    expect(matched?.matchedAlias).toBe("현대 엑스티어 판교");
  });

  it("keeps a derived branch alias ambiguous when two registered branches collide", () => {
    const collisionBusinesses = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "브랜드 판교점",
        aliases: [],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "브랜드 판교본점",
        aliases: [],
      },
    ];
    const nodes = parseResponseStructure("1. **브랜드 판교**");
    const candidates = extractEntityCandidatesV2(nodes, collisionBusinesses);
    const matched = candidates.find(
      (candidate) => candidate.identitySurface === "브랜드 판교",
    );

    expect(matched?.role).toBe("registered_subspan");
    expect(matched?.matchedBusinessIds.sort()).toEqual(
      collisionBusinesses.map((business) => business.id).sort(),
    );
  });

  it("does not emit arbitrary unregistered paragraph text as an entity candidate", () => {
    const nodes = parseResponseStructure(
      "구로구에서 상담받기 좋은 업체를 찾아보세요.",
    );
    const candidates = extractEntityCandidatesV2(nodes, businesses);

    expect(candidates).toEqual([]);
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

  it("does not turn metadata/detail values into sibling entity candidates", () => {
    const nodes = parseResponseStructure(
      [
        "### 3. 그린카서비스",
        "- **주소:** 경기도 성남시 분당구 정자동 242-1",
        "- **전화:** 031-712-6522",
        "- **특징:** 수입차 정비 전문점",
        "- **서비스:** 엔진오일, 냉각수, 브레이크오일",
      ].join("\n"),
    );
    const candidates = extractEntityCandidatesV2(nodes, []);
    const identities = candidates.map((candidate) => candidate.identitySurface);

    expect(identities).toContain("그린카서비스");
    expect(identities).not.toContain("경기도 성남시 분당구 정자동 242-1");
    expect(identities).not.toContain("031-712-6522");
    expect(identities).not.toContain("수입차 정비 전문점");
    expect(identities).not.toContain("엔진오일");
    expect(identities).not.toContain("냉각수");
    expect(identities).not.toContain("브레이크오일");
  });

  it("splits multiple unregistered businesses in one criterion body", () => {
    const nodes = parseResponseStructure(
      "- **운정·교하에서 최대한 가까운 곳:** 티스테이션 파주교하점, 금호타이어 운정신도시점",
    );
    const candidates = extractEntityCandidatesV2(nodes, []);
    const identities = candidates.map((candidate) => candidate.identitySurface);

    expect(identities).toContain("티스테이션 파주교하점");
    expect(identities).toContain("금호타이어 운정신도시점");
    expect(identities).not.toContain(
      "티스테이션 파주교하점, 금호타이어 운정신도시점",
    );
  });

  it("splits spaced slash-separated unregistered business siblings", () => {
    const nodes = parseResponseStructure(
      "- **후보:** 천현카센타 / 타이어타운 법원점",
    );
    const candidates = extractEntityCandidatesV2(nodes, []);
    const identities = candidates.map((candidate) => candidate.identitySurface);

    expect(identities).toContain("천현카센타");
    expect(identities).toContain("타이어타운 법원점");
    expect(identities).not.toContain("천현카센타 / 타이어타운 법원점");
  });

  it("does not split an unspaced slash inside one surface", () => {
    const nodes = parseResponseStructure(
      "- **후보:** AB모터스/미스터카",
    );
    const candidates = extractEntityCandidatesV2(nodes, []);

    expect(candidates.map((candidate) => candidate.identitySurface)).toContain(
      "AB모터스/미스터카",
    );
  });

  it("keeps unregistered siblings when one business in the same criterion is registered", () => {
    const nodes = parseResponseStructure(
      "- **조리·봉일천 쪽:** 타이어프로 봉일천점, 더타이어샵 봉일천점",
    );
    const candidates = extractEntityCandidatesV2(nodes, businesses);

    const registered = candidates.find((candidate) =>
      candidate.matchedBusinessIds.includes(
        "483022a4-30c9-4f6d-9cf4-19a30c2f58d2",
      ),
    );
    const sibling = candidates.find(
      (candidate) => candidate.identitySurface === "더타이어샵 봉일천점",
    );

    expect(registered?.identitySurface).toBe("타이어프로 봉일천점");
    expect(sibling).toBeDefined();
    expect(sibling?.matchedBusinessIds).toEqual([]);
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

  it("separates an unregistered business identity from a spaced heading annotation", () => {
    const nodes = parseResponseStructure(
      [
        "### 3. 5디테일 영등포점 — 영등포구",
        "- **주소:** 서울 영등포구 문래북로 54, 1층",
        "- **전화:** 010-8563-2787",
      ].join("\n"),
    );
    const candidates = extractEntityCandidatesV2(nodes, []);
    const business = candidates.find(
      (candidate) => candidate.identitySurface === "5디테일 영등포점",
    );

    expect(business?.role).toBe("heading_surface");
    expect(business?.observedSurface).toBe("5디테일 영등포점 — 영등포구");
    expect(
      candidates.some(
        (candidate) => candidate.identitySurface === "5디테일 영등포점 — 영등포구",
      ),
    ).toBe(false);
  });

  it("uses a named branch as the heading identity even when the suffix is a work-purpose note", () => {
    const nodes = parseResponseStructure(
      "### 1. BMS타이어 파주점 — 타이어·휠 작업 중심",
    );
    const candidates = extractEntityCandidatesV2(nodes, []);

    expect(candidates.map((candidate) => candidate.identitySurface)).toContain(
      "BMS타이어 파주점",
    );
    expect(candidates.map((candidate) => candidate.identitySurface)).not.toContain(
      "BMS타이어 파주점 — 타이어·휠 작업 중심",
    );
  });
});
