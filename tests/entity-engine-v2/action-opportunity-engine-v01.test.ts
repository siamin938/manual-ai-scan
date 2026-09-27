import { describe, expect, it } from "vitest";
import { buildActionOpportunityEngineV01 } from "../../src/lib/action-opportunity-engine-v01";
import type {
  BenchmarkSourceGroupDTO,
  BenchmarkCategorySourceGroupDTO,
  VisibilityBenchmarkDTO,
} from "../../src/lib/visibility-benchmark.types";

function group(args: {
  key: string;
  label: string;
  count: number;
  share: number;
  targetConnected: boolean;
  strength: "early" | "emerging" | "established";
  sites?: Array<{ label: string; domain?: string }>;
}): BenchmarkSourceGroupDTO {
  return {
    key: args.key,
    label: args.label,
    highEntityCount: args.count,
    highEntitySharePct: args.share,
    targetConnected: args.targetConnected,
    patternStrength: args.strength,
    sites: args.sites ?? [],
  };
}

function categoryGroup(args: {
  key: string;
  label: string;
  count: number;
  share: number;
  sites?: Array<{ label: string; domain?: string }>;
}): BenchmarkCategorySourceGroupDTO {
  return {
    key: args.key,
    label: args.label,
    highEntityCount: args.count,
    highEntitySharePct: args.share,
    sites: args.sites ?? [],
  };
}

function baseBenchmark(
  overrides: Partial<VisibilityBenchmarkDTO> = {},
): VisibilityBenchmarkDTO {
  return {
    windowDays: 90,
    thresholdPct: 20,
    dataStatus: "ready",
    highVisibilityEntityCount: 18,
    sourceGroups: [],
    disclaimer:
      "전체 자동차 업체의 최근 측정에서 반복 관찰된 집계 패턴이며 특정 출처가 AI 노출의 직접 원인임을 의미하지 않습니다.",
    scope: "global_automotive",
    eligibleTargetBusinessCount: 7,
    contributingOrgCount: 2,
    ...overrides,
  };
}

describe("Action Opportunity Engine v0.1", () => {
  it("dry-runs 카스페이스 using same-category patterns before global patterns", () => {
    const benchmark = baseBenchmark({
      sourceGroups: [
        group({
          key: "business_brand_site",
          label: "업체·브랜드 홈페이지·독립 사이트",
          count: 10,
          share: 55.56,
          targetConnected: false,
          strength: "established",
          sites: [
            { label: "경쟁업체A", domain: "competitor-a.example" },
            { label: "경쟁업체B", domain: "competitor-b.example" },
          ],
        }),
        group({
          key: "other",
          label: "기타 독립·정보 사이트",
          count: 9,
          share: 50,
          targetConnected: true,
          strength: "established",
        }),
        group({
          key: "profile_directory",
          label: "업체 프로필·디렉터리",
          count: 8,
          share: 44.44,
          targetConnected: false,
          strength: "emerging",
          sites: [
            { label: "당근 동네업체", domain: "daangn.com" },
            { label: "카카오톡 채널", domain: "pf.kakao.com" },
          ],
        }),
        group({
          key: "auto_platform",
          label: "자동차 전문 플랫폼",
          count: 3,
          share: 16.67,
          targetConnected: false,
          strength: "emerging",
          sites: [{ label: "오늘의카", domain: "oh-car.kr" }],
        }),
      ],
      categoryContext: {
        available: true,
        category: "썬팅/신차패키지",
        eligibleTargetBusinessCount: 3,
        highVisibilityEntityCount: 6,
        sourceGroups: [
          categoryGroup({
            key: "other",
            label: "기타 독립·정보 사이트",
            count: 4,
            share: 66.67,
          }),
          categoryGroup({
            key: "profile_directory",
            label: "업체 프로필·디렉터리",
            count: 3,
            share: 50,
            sites: [
              { label: "당근 동네업체", domain: "daangn.com" },
              { label: "플레이스뷰", domain: "placeview.co.kr" },
              { label: "카카오톡 채널", domain: "pf.kakao.com" },
            ],
          }),
          categoryGroup({
            key: "auto_platform",
            label: "자동차 전문 플랫폼",
            count: 2,
            share: 33.33,
            sites: [{ label: "오늘의카", domain: "oh-car.kr" }],
          }),
          categoryGroup({
            key: "business_brand_site",
            label: "업체·브랜드 홈페이지·독립 사이트",
            count: 2,
            share: 33.33,
            sites: [
              { label: "경쟁업체A", domain: "competitor-a.example" },
            ],
          }),
        ],
      },
    });

    const result = buildActionOpportunityEngineV01({ benchmark });

    expect(result.items.map((item) => item.kind)).toEqual([
      "profile_directory",
      "owned_web_presence",
      "auto_platform",
    ]);
    expect(result.items.map((item) => item.evidenceScope)).toEqual([
      "category",
      "category",
      "category",
    ]);
    expect(result.items[0].signalStrength).toBe("strong");
    expect(result.items[0].evidenceText).toContain(
      "같은 업종 고노출 업체 6곳 중 3곳 · 50.0%",
    );
    expect(result.items[0].sites.map((site) => site.label)).toEqual([
      "당근 동네업체",
      "플레이스뷰",
      "카카오톡 채널",
    ]);

    // Competitor-owned benchmark examples must not be presented as sites the
    // customer should edit.
    expect(result.items[1].sites).toEqual([]);
    expect(result.items[1].actionText).toContain(
      "실제 사례가 표시되면 연결된 페이지 자체를 열어",
    );

    // The vague "other" group is intentionally excluded from customer action.
    expect(result.items.some((item) => item.sourceGroupKey === "other")).toBe(
      false,
    );
  });

  it("dry-runs 타이어프로 and removes a source group already connected to the target", () => {
    const benchmark = baseBenchmark({
      sourceGroups: [
        group({
          key: "business_brand_site",
          label: "업체·브랜드 홈페이지·독립 사이트",
          count: 10,
          share: 55.56,
          targetConnected: true,
          strength: "established",
        }),
        group({
          key: "other",
          label: "기타 독립·정보 사이트",
          count: 9,
          share: 50,
          targetConnected: false,
          strength: "established",
        }),
        group({
          key: "profile_directory",
          label: "업체 프로필·디렉터리",
          count: 8,
          share: 44.44,
          targetConnected: false,
          strength: "emerging",
          sites: [
            { label: "당근 동네업체", domain: "daangn.com" },
            { label: "카카오톡 채널", domain: "pf.kakao.com" },
            { label: "숨고", domain: "soomgo.com" },
          ],
        }),
        group({
          key: "auto_platform",
          label: "자동차 전문 플랫폼",
          count: 3,
          share: 16.67,
          targetConnected: false,
          strength: "emerging",
          sites: [{ label: "오늘의카", domain: "oh-car.kr" }],
        }),
        group({
          key: "blog",
          label: "블로그",
          count: 2,
          share: 11.11,
          targetConnected: false,
          strength: "early",
        }),
      ],
      categoryContext: {
        available: false,
        category: "타이어/휠",
        eligibleTargetBusinessCount: 1,
        highVisibilityEntityCount: 4,
        sourceGroups: [],
      },
    });

    const result = buildActionOpportunityEngineV01({ benchmark });

    expect(result.items.map((item) => item.kind)).toEqual([
      "profile_directory",
    ]);
    expect(result.items.every((item) => item.evidenceScope === "global")).toBe(
      true,
    );
    expect(
      result.items.some((item) => item.kind === "owned_web_presence"),
    ).toBe(false);
    expect(
      result.items.some((item) => item.kind === "blog_presence"),
    ).toBe(false);
    expect(result.items[0].whyText).toContain(
      "전체 자동차 고노출 업체 18곳 중 8곳 · 44.4%",
    );
  });

  it("dry-runs 현대엑스티어 and adapts profile guidance when Naver Place is already verified", () => {
    const benchmark = baseBenchmark({
      sourceGroups: [
        group({
          key: "business_brand_site",
          label: "업체·브랜드 홈페이지·독립 사이트",
          count: 10,
          share: 55.56,
          targetConnected: false,
          strength: "established",
        }),
        group({
          key: "profile_directory",
          label: "업체 프로필·디렉터리",
          count: 8,
          share: 44.44,
          targetConnected: false,
          strength: "emerging",
          sites: [
            { label: "당근 동네업체", domain: "daangn.com" },
            { label: "카카오톡 채널", domain: "pf.kakao.com" },
          ],
        }),
        group({
          key: "auto_platform",
          label: "자동차 전문 플랫폼",
          count: 3,
          share: 16.67,
          targetConnected: false,
          strength: "emerging",
          sites: [{ label: "오늘의카", domain: "oh-car.kr" }],
        }),
      ],
      categoryContext: {
        available: false,
        category: "자동차 엔진오일 교환·프리미엄 윤활유 전문점",
        eligibleTargetBusinessCount: 1,
        highVisibilityEntityCount: 2,
        sourceGroups: [],
      },
    });

    const result = buildActionOpportunityEngineV01({
      benchmark,
      verifiedFirstPartySourceTypes: ["naver_place"],
    });

    expect(result.items.map((item) => item.kind)).toEqual([
      "owned_web_presence",
      "profile_directory",
    ]);
    expect(result.items[0].signalStrength).toBe("strong");
    expect(result.items[1].title).toBe(
      "업체 프로필·등록 채널에서 확인되는 차이",
    );
    expect(result.items[1].actionText).toContain(
      "실제 타업체 사례가 표시되면 링크를 열어",
    );
  });

  it("does not surface a low-share global pattern only because it appears in three entities", () => {
    const benchmark = baseBenchmark({
      highVisibilityEntityCount: 21,
      sourceGroups: [
        group({
          key: "auto_platform",
          label: "자동차 전문 플랫폼",
          count: 3,
          share: 14.29,
          targetConnected: false,
          strength: "emerging",
        }),
      ],
    });

    const result = buildActionOpportunityEngineV01({ benchmark });
    expect(result.items).toEqual([]);
  });

  it("uses only strong/moderate repeated patterns and never turns early evidence into an action", () => {
    const benchmark = baseBenchmark({
      sourceGroups: [
        group({
          key: "news",
          label: "언론·뉴스",
          count: 1,
          share: 5.56,
          targetConnected: false,
          strength: "early",
        }),
        group({
          key: "blog",
          label: "블로그",
          count: 2,
          share: 11.11,
          targetConnected: false,
          strength: "early",
        }),
      ],
    });

    const result = buildActionOpportunityEngineV01({ benchmark });
    expect(result.items).toEqual([]);
  });

  it("never emits more than three opportunities", () => {
    const benchmark = baseBenchmark({
      sourceGroups: [
        group({
          key: "profile_directory",
          label: "업체 프로필·디렉터리",
          count: 8,
          share: 44.44,
          targetConnected: false,
          strength: "emerging",
        }),
        group({
          key: "business_brand_site",
          label: "업체·브랜드 홈페이지·독립 사이트",
          count: 10,
          share: 55.56,
          targetConnected: false,
          strength: "established",
        }),
        group({
          key: "auto_platform",
          label: "자동차 전문 플랫폼",
          count: 3,
          share: 16.67,
          targetConnected: false,
          strength: "emerging",
        }),
        group({
          key: "community",
          label: "커뮤니티",
          count: 4,
          share: 22.22,
          targetConnected: false,
          strength: "emerging",
        }),
      ],
    });

    const result = buildActionOpportunityEngineV01({ benchmark });
    expect(result.items).toHaveLength(3);
  });

  it("does not create actions when benchmark data is absent", () => {
    const result = buildActionOpportunityEngineV01({ benchmark: null });
    expect(result.items).toEqual([]);
    expect(result.description).toContain("데이터가 충분하지");
  });

  it("keeps causality claims out of the output contract", () => {
    const benchmark = baseBenchmark({
      sourceGroups: [
        group({
          key: "profile_directory",
          label: "업체 프로필·디렉터리",
          count: 8,
          share: 44.44,
          targetConnected: false,
          strength: "emerging",
        }),
      ],
    });

    const text = JSON.stringify(buildActionOpportunityEngineV01({ benchmark }));
    expect(text).not.toContain("노출이 오른");
    expect(text).not.toContain("상승합니다");
    expect(text).not.toContain("보장합니다");
    expect(text).toContain("원인임을 의미하지 않으며");
  });
});
