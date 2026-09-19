import { describe, expect, it } from "vitest";
import {
  extractEntityCandidatesV2,
  type CandidateBusinessRef,
} from "../../supabase/functions/_shared/entity-engine-v2/candidate-extractor";
import {
  evaluateIdentityCandidatesV2,
  type IdentityDecisionV2,
} from "../../supabase/functions/_shared/entity-engine-v2/identity-gate";
import { parseResponseStructure } from "../../supabase/functions/_shared/entity-engine-v2/response-structure";

function evaluate(text: string, businesses: CandidateBusinessRef[] = []) {
  const nodes = parseResponseStructure(text);
  const candidates = extractEntityCandidatesV2(nodes, businesses);
  const results = evaluateIdentityCandidatesV2(candidates, nodes, businesses);
  return { nodes, candidates, results };
}

function decisionFor(
  text: string,
  surface: string,
  businesses: CandidateBusinessRef[] = [],
): IdentityDecisionV2 | undefined {
  return evaluate(text, businesses).results.find(
    (result) => result.identitySurface === surface,
  )?.decision;
}

describe("Entity Engine v2 single-authority identity gate", () => {
  it("rejects the ranked section heading while confirming businesses in its table rows", () => {
    const text = [
      "## 1순위로 문의해볼 곳",
      "",
      "| 업체 | 위치 | 특징 / 연락처 |",
      "|---|---|---|",
      "| **XPEL Pro 일산백석점** | 일산동구 장항로 70 나동 | XPEL 공식 PRO 인증점. **010-3125-0509** |",
      "| **XPEL Pro 일산로점** | 일산동구 일산로 418 | XPEL 공식 PRO 인증점. **010-3780-4549** |",
    ].join("\n");

    const { results } = evaluate(text);

    expect(
      results.find((result) => result.identitySurface === "로 문의해볼 곳")
        ?.decision,
    ).toBe("non_business");

    const baekseok = results.find(
      (result) => result.identitySurface === "XPEL Pro 일산백석점",
    );
    expect(baekseok?.decision).toBe("confirmed_business");
    expect(
      baekseok?.evidence.some(
        (evidence) => evidence.provenance === "same_table_row",
      ),
    ).toBe(true);

    expect(
      results.find((result) => result.identitySurface === "XPEL Pro 일산로점")
        ?.decision,
    ).toBe("confirmed_business");
  });

  it("keeps a generic chain heading non-business while classifying its network heading and concrete branches", () => {
    const text = [
      "## 1. 가장 무난한 체인점",
      "",
      "### 오토오아시스",
      "- **오토오아시스 세이브존성남점**",
      "  - 주소: 수정구 산성대로 337",
      "- **오토오아시스 하대원점**",
      "  - 주소: 중원구 둔촌대로 202",
    ].join("\n");

    const { results } = evaluate(text);

    expect(
      results.find((result) => result.identitySurface === "가장 무난한 체인점")
        ?.decision,
    ).toBe("non_business");

    const network = results.find(
      (result) => result.identitySurface === "오토오아시스",
    );
    expect(network?.decision).toBe("brand_network");
    expect(network?.reasons).toContain("DESCENDANT_BRANCH_NETWORK_PATTERN");

    expect(
      results.find(
        (result) => result.identitySurface === "오토오아시스 세이브존성남점",
      )?.decision,
    ).toBe("confirmed_business");
    expect(
      results.find(
        (result) => result.identitySurface === "오토오아시스 하대원점",
      )?.decision,
    ).toBe("confirmed_business");
  });

  it("rejects a comparison heading without suppressing actual table businesses", () => {
    const text = [
      "## 성남 엔진오일 정비소 비교",
      "",
      "| 정비소 | 위치 | 장점 |",
      "|---|---|---|",
      "| **판교메젠모터스** | 분당구 금곡동 | 종합정비업 |",
      "| **트윈모터스** | 분당구 백현동 | 독일차 전문 |",
    ].join("\n");

    expect(decisionFor(text, "성남 엔진오일 정비소 비교")).toBe(
      "non_business",
    );
    expect(decisionFor(text, "판교메젠모터스")).toBe("confirmed_business");
    expect(decisionFor(text, "트윈모터스")).toBe("confirmed_business");
  });

  it("keeps non-unique official installer wording out of local-business results", () => {
    const text = [
      "### 2. 3M 공식 썬팅 시공점 — 일산동구 풍동",
      "- 3M 크리스탈라인, 블랙박스, PPF를 함께 시공한다고 안내합니다.",
    ].join("\n");

    const { results } = evaluate(text);
    const result = results.find((item) =>
      item.identitySurface.startsWith("3M 공식 썬팅 시공점"),
    );

    expect(result?.decision).toBe("brand_network");
    expect(result?.decision).not.toBe("confirmed_business");
  });

  it("confirms a real business only from tightly scoped heading detail children", () => {
    const text = [
      "### 3. 그린카서비스",
      "- **주소:** 경기도 성남시 분당구 정자동 242-1",
      "- **전화:** 031-712-6522",
      "- **특징:** 수입차 정비 전문점",
    ].join("\n");

    const { results } = evaluate(text);
    const result = results.find(
      (item) => item.identitySurface === "그린카서비스",
    );

    expect(result?.decision).toBe("confirmed_business");
    expect(
      result?.evidence.some(
        (evidence) =>
          evidence.type === "address" &&
          evidence.provenance === "heading_detail_child",
      ),
    ).toBe(true);
    expect(
      result?.evidence.some(
        (evidence) =>
          evidence.type === "phone" &&
          evidence.provenance === "heading_detail_child",
      ),
    ).toBe(true);
  });

  it("confirms a named list business from a directly indented address/phone continuation", () => {
    const text = [
      "### 분당구",
      "- **판교메젠모터스**",
      "  분당구 대왕판교로 178, ☎ 031-717-1579",
      "- **트윈모터스**",
      "  분당구 백현동 123, ☎ 031-111-2222",
    ].join("\n");

    const { results } = evaluate(text);
    const pangyo = results.find(
      (item) => item.identitySurface === "판교메젠모터스",
    );
    const twin = results.find(
      (item) => item.identitySurface === "트윈모터스",
    );

    expect(pangyo?.decision).toBe("confirmed_business");
    expect(
      pangyo?.evidence.some(
        (item) =>
          item.provenance === "list_detail_child" &&
          (item.type === "address" || item.type === "phone"),
      ),
    ).toBe(true);
    expect(twin?.decision).toBe("confirmed_business");
  });

  it("does not leak an unindented paragraph into the previous list-item identity", () => {
    const text = [
      "- **판교메젠모터스**",
      "분당구 대왕판교로 178, ☎ 031-717-1579",
    ].join("\n");

    expect(decisionFor(text, "판교메젠모터스")).toBe("unresolved");
  });

  it("normalizes a registered business embedded in a descriptive section title", () => {
    const businesses: CandidateBusinessRef[] = [
      {
        id: "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스 구로본점"],
      },
    ];
    const text = "## 2. 카스페이스 구로본점 패키지 구성";
    const { results } = evaluate(text, businesses);
    const result = results.find((item) =>
      item.canonicalBusinessId === "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
    );

    expect(result?.decision).toBe("confirmed_business");
    expect(result?.identitySurface).toBe("카스페이스 구로본점");
    expect(result?.canonicalDisplayName).toBe("카스페이스 구로 본점");
    expect(
      results.some(
        (item) => item.identitySurface === "카스페이스 구로본점 패키지 구성",
      ),
    ).toBe(false);
  });

  it("extracts registered identity from regional and purpose labels instead of confirming the whole criterion", () => {
    const businesses: CandidateBusinessRef[] = [
      {
        id: "483022a4-30c9-4f6d-9cf4-19a30c2f58d2",
        name: "타이어프로 봉일천점",
        aliases: [],
      },
      {
        id: "a0d95431-fe9f-4bea-a02b-02fd3ea9f2a2",
        name: "현대엑스티어 판교",
        aliases: [],
      },
    ];
    const text = [
      "## 목적별 추천",
      "- **금촌·조리 쪽:** 타이어프로 봉일천점",
      "- **빠른 국산차 오일 교환:** 현대엑스티어 판교",
    ].join("\n");
    const { results } = evaluate(text, businesses);

    const tire = results.find(
      (item) =>
        item.canonicalBusinessId === "483022a4-30c9-4f6d-9cf4-19a30c2f58d2",
    );
    const xtier = results.find(
      (item) =>
        item.canonicalBusinessId === "a0d95431-fe9f-4bea-a02b-02fd3ea9f2a2",
    );

    expect(tire?.identitySurface).toBe("타이어프로 봉일천점");
    expect(tire?.decision).toBe("confirmed_business");
    expect(xtier?.identitySurface).toBe("현대엑스티어 판교");
    expect(xtier?.decision).toBe("confirmed_business");
    expect(
      results.some((item) => item.identitySurface.includes("빠른 국산차 오일 교환")),
    ).toBe(false);
  });

  it("keeps an actual named network branch as a specific business", () => {
    const text = [
      "### 1순위: 공임나라 분당수내점",
      "- **추천 이유:** 기본 점검을 꼼꼼히 해준다는 소개가 확인됩니다.",
    ].join("\n");

    expect(decisionFor(text, "공임나라 분당수내점")).toBe(
      "confirmed_business",
    );
  });

  it("classifies platform-affiliated shop descriptions as platform, never local competitors", () => {
    const text = [
      "### 3순위: 마이클 앱 제휴 정비소",
      "- 앱에서 차량번호를 입력하면 차종별 엔진오일 교환 총액과 후기를 비교할 수 있습니다.",
    ].join("\n");

    const result = evaluate(text).results.find(
      (item) => item.identitySurface === "마이클 앱 제휴 정비소",
    );

    expect(result?.decision).toBe("platform");
    expect(result?.decision).not.toBe("confirmed_business");
  });

  it("treats a generic official point in a table row as a network, not a shop", () => {
    const text = [
      "| 업체 | 위치 |",
      "|---|---|",
      "| **3M 썬팅 공식점** | 일산동구 풍동 |",
    ].join("\n");

    expect(decisionFor(text, "3M 썬팅 공식점")).toBe("brand_network");
  });

  it("does not confirm a bare location-only branch label", () => {
    const text = [
      "### 3. 사당점 — 서초구",
      "- 여러 썬팅 브랜드를 취급하는 것으로 소개됩니다.",
    ].join("\n");

    expect(decisionFor(text, "사당점")).toBe("unresolved");
  });

  it("does not mistake a normal Korean word ending in 점 for a branch", () => {
    expect(decisionFor("### 시공 후 세차 가능 시점", "시공 후 세차 가능 시점")).toBe(
      "unresolved",
    );
  });

  it("confirms a named branch after removing a human-facing heading suffix", () => {
    const text = "### 1. BMS타이어 파주점 — 타이어·휠 작업 중심";
    expect(decisionFor(text, "BMS타이어 파주점")).toBe("confirmed_business");
  });
});
