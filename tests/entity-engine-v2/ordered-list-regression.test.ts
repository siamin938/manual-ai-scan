import { describe, expect, it } from "vitest";
import {
  extractEntityCandidatesV2,
  type CandidateBusinessRef,
} from "../../supabase/functions/_shared/entity-engine-v2/candidate-extractor";
import { evaluateIdentityCandidatesV2 } from "../../supabase/functions/_shared/entity-engine-v2/identity-gate";
import { parseResponseStructure } from "../../supabase/functions/_shared/entity-engine-v2/response-structure";

function evaluate(text: string, businesses: CandidateBusinessRef[] = []) {
  const nodes = parseResponseStructure(text);
  const candidates = extractEntityCandidatesV2(nodes, businesses);
  const results = evaluateIdentityCandidatesV2(candidates, nodes, businesses);
  return { nodes, candidates, results };
}

describe("Entity Engine v2 ordered-list historical regressions", () => {
  it("parses a numbered business item and keeps its indented details under that item", () => {
    const text = [
      "### 일반 정비·소모품 교체",
      "1. **카포스 배진자동차공업사 — 분당 정자동**",
      "   - 주소: 경기 성남시 분당구 백현로156번길 22",
      "   - 전화: 031-712-6177",
      "2. **쌍둥이자동차공업사 — 분당 정자동**",
      "   - 주소: 경기 성남시 분당구 느티로77번길 3",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const first = nodes.find(
      (node) => node.kind === "list_item" && node.text.includes("카포스 배진자동차공업사"),
    );
    const phone = nodes.find(
      (node) => node.kind === "list_item" && node.criterionLabel === "전화",
    );
    const second = nodes.find(
      (node) => node.kind === "list_item" && node.text.includes("쌍둥이자동차공업사"),
    );

    expect(first).toBeDefined();
    expect(phone?.parentId).toBe(first?.id);
    expect(second?.parentId).not.toBe(first?.id);
    expect(second?.parentId).toBe(
      nodes.find((node) => node.kind === "heading")?.id,
    );
  });

  it("parses right-paren and circled ordered markers as recommendation list items", () => {
    const nodes = parseResponseStructure(
      [
        "1) **XPEL Pro 일산백석점**",
        "② **XPEL Pro 일산로점**",
      ].join("\n"),
    );

    expect(nodes.filter((node) => node.kind === "list_item").map((node) => node.text)).toEqual([
      "XPEL Pro 일산백석점",
      "XPEL Pro 일산로점",
    ]);
  });

  it("recovers the registered client alias from a real numbered-list response", () => {
    // Historical measurement: 6861fc14-6da2-4488-9f75-21999fbe82f1
    const businesses: CandidateBusinessRef[] = [
      {
        id: "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스 구로점"],
      },
    ];
    const text = [
      "1. **카스페이스 구로점**",
      "   - 썬팅뿐 아니라 신차검수·PPF·유리막·블랙박스까지 진행합니다.",
      "2. **더플레이스카 — 구로동**",
    ].join("\n");

    const { results } = evaluate(text, businesses);
    const client = results.find(
      (result) => result.canonicalBusinessId === "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
    );

    expect(client?.decision).toBe("confirmed_business");
    expect(client?.identitySurface).toBe("카스페이스 구로점");
    expect(client?.canonicalDisplayName).toBe("카스페이스 구로 본점");
  });

  it("removes geography annotations from a real unregistered numbered business", () => {
    // Historical measurement: 4b1f40b4-72dc-4596-b67b-65e9902c17ce
    const text = [
      "1. **3M 썬팅 구로점 — 구로동**",
      "   - 주소: 서울 구로구 구로동로 222, 1층",
      "   - 전화: 02-6226-5000",
    ].join("\n");

    const { candidates, results } = evaluate(text);
    expect(candidates.map((candidate) => candidate.identitySurface)).toContain("3M 썬팅 구로점");
    expect(candidates.map((candidate) => candidate.identitySurface)).not.toContain(
      "3M 썬팅 구로점 — 구로동",
    );
    expect(
      results.find((result) => result.identitySurface === "3M 썬팅 구로점")?.decision,
    ).toBe("confirmed_business");
  });

  it("confirms a descriptor business from only its own numbered-item address and phone", () => {
    // Historical measurement: e1744fe1-6a7b-4609-b820-ca628565bf1d
    const text = [
      "1. **카포스 배진자동차공업사 — 분당 정자동**",
      "   - 주소: 경기 성남시 분당구 백현로156번길 22",
      "   - 전화: 031-712-6177",
      "2. **무관한 선택지**",
      "   - 주소: 경기 성남시 분당구 다른로 99",
    ].join("\n");

    const { results } = evaluate(text);
    const business = results.find(
      (result) => result.identitySurface === "카포스 배진자동차공업사",
    );

    expect(business?.decision).toBe("confirmed_business");
    expect(business?.reasons).toContain("LIST_WITH_SCOPED_IDENTITY_EVIDENCE");
    expect(
      business?.evidence.some(
        (evidence) =>
          evidence.type === "address" &&
          evidence.provenance === "list_detail_child" &&
          evidence.value?.includes("백현로156번길 22"),
      ),
    ).toBe(true);
    expect(
      business?.evidence.some((evidence) => evidence.value?.includes("다른로 99")),
    ).toBe(false);
  });

  it("keeps sibling numbered-item evidence isolated", () => {
    // Historical shape: 7e830d35-b5c1-496f-bbe6-899f67fd7874
    const text = [
      "1. **XPEL Pro 일산백석점**",
      "   - 전화: 010-3125-0509",
      "2. **XPEL Pro 일산로점**",
      "   - 전화: 010-3780-4549",
    ].join("\n");

    const { results } = evaluate(text);
    const baekseok = results.find(
      (result) => result.identitySurface === "XPEL Pro 일산백석점",
    );
    const ilsanro = results.find(
      (result) => result.identitySurface === "XPEL Pro 일산로점",
    );

    expect(baekseok?.decision).toBe("confirmed_business");
    expect(ilsanro?.decision).toBe("confirmed_business");
    expect(baekseok?.evidence.some((evidence) => evidence.value === "010-3125-0509")).toBe(true);
    expect(baekseok?.evidence.some((evidence) => evidence.value === "010-3780-4549")).toBe(false);
    expect(ilsanro?.evidence.some((evidence) => evidence.value === "010-3780-4549")).toBe(true);
    expect(ilsanro?.evidence.some((evidence) => evidence.value === "010-3125-0509")).toBe(false);
  });

  it("does not promote an ordered checklist item merely because it ends in 점", () => {
    // Historical negative control: 3c66b77d-e5a3-446a-8b65-048cda68af03
    const { results } = evaluate(
      [
        "## 상담할 때 꼭 물어볼 것",
        "1. **필름 브랜드와 제품명** — TPU인지 확인",
        "2. **시공 후 세차 가능 시점** — 최소 7일간 세차를 피하도록 안내",
      ].join("\n"),
    );

    const timing = results.find(
      (result) => result.identitySurface === "시공 후 세차 가능 시점",
    );
    expect(timing?.decision).not.toBe("confirmed_business");
  });
});
