import { describe, expect, it } from "vitest";
import type { CandidateBusinessRef } from "../../supabase/functions/_shared/entity-engine-v2/candidate-extractor";
import {
  ENTITY_V2_SHADOW_ADAPTER_VERSION,
  runEntityV2ShadowAdapter,
} from "../../supabase/functions/_shared/entity-engine-v2/shadow-adapter";

describe("Entity Engine v2 shadow adapter", () => {
  it("returns a deterministic empty shadow result without side effects", () => {
    const first = runEntityV2ShadowAdapter({ responseText: "", businesses: [] });
    const second = runEntityV2ShadowAdapter({ responseText: "", businesses: [] });

    expect(first).toEqual(second);
    expect(first).toEqual({
      version: ENTITY_V2_SHADOW_ADAPTER_VERSION,
      structureNodeCount: 0,
      candidateCount: 0,
      decisionCounts: {
        confirmed_business: 0,
        non_business: 0,
        unresolved: 0,
        platform: 0,
        brand_network: 0,
      },
      decisions: [],
    });
  });

  it("separates a descriptive surface from the registered business identity", () => {
    const businesses: CandidateBusinessRef[] = [
      {
        id: "xtier-pangyo",
        name: "현대엑스티어 판교",
        aliases: ["엑스티어 판교"],
      },
    ];

    const result = runEntityV2ShadowAdapter({
      responseText: "## 빠른 국산차 오일 교환: 현대엑스티어 판교",
      businesses,
    });

    const decision = result.decisions.find(
      (item) => item.canonicalBusinessId === "xtier-pangyo",
    );

    expect(decision?.decision).toBe("confirmed_business");
    expect(decision?.observedSurface).toBe(
      "빠른 국산차 오일 교환: 현대엑스티어 판교",
    );
    expect(decision?.identitySurface).toBe("현대엑스티어 판교");
    expect(decision?.canonicalDisplayName).toBe("현대엑스티어 판교");
    expect(decision?.reasons).toContain("REGISTERED_IDENTITY_SUBSPAN");
    expect(
      decision?.evidence.some(
        (item) => item.provenance === "registered_exact_subspan",
      ),
    ).toBe(true);
  });

  it("keeps a generic recommendation heading rejected while preserving a real child business", () => {
    const result = runEntityV2ShadowAdapter({
      responseText: [
        "## 1순위로 문의해볼 곳",
        "",
        "| 업체 | 연락처 |",
        "|---|---|",
        "| WrapHub | 031-123-4567 |",
      ].join("\n"),
    });

    const heading = result.decisions.find(
      (item) => item.identitySurface === "로 문의해볼 곳",
    );
    const business = result.decisions.find(
      (item) => item.identitySurface === "WrapHub",
    );

    expect(heading?.decision).toBe("non_business");
    expect(heading?.reasons).toContain("GENERIC_HEADING_SEMANTICS");
    expect(business?.decision).toBe("confirmed_business");
    expect(
      business?.evidence.some(
        (item) => item.type === "phone" && item.provenance === "same_table_row",
      ),
    ).toBe(true);
  });

  it("reports decision counts from the same decisions it returns", () => {
    const result = runEntityV2ShadowAdapter({
      responseText: [
        "## 성남 엔진오일 정비소 비교",
        "| 정비소 | 연락처 |",
        "|---|---|",
        "| 판교메젠모터스 | 031-111-2222 |",
        "| 트윈모터스 | 031-333-4444 |",
      ].join("\n"),
    });

    const countSum = Object.values(result.decisionCounts).reduce(
      (sum, value) => sum + value,
      0,
    );

    expect(countSum).toBe(result.candidateCount);
    expect(result.decisions).toHaveLength(result.candidateCount);
    expect(result.decisionCounts.non_business).toBeGreaterThanOrEqual(1);
    expect(result.decisionCounts.confirmed_business).toBeGreaterThanOrEqual(2);
  });

  it("does not promote generic platform wording to a confirmed business", () => {
    const result = runEntityV2ShadowAdapter({
      responseText: "- 지역 업체 등록 플랫폼 정비소",
    });

    const decision = result.decisions[0];
    expect(decision?.decision).toBe("platform");
    expect(decision?.decision).not.toBe("confirmed_business");
  });
});
