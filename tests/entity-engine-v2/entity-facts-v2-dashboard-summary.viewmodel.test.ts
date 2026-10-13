import { describe, expect, it } from "vitest";
import type { ActionOpportunityEngineResult } from "../../src/lib/action-opportunity-engine-v01";
import type { EntityFactsV2DashboardCutoverModel } from "../../src/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import { buildEntityFactsV2DashboardSummaryViewModel } from "../../src/lib/entity-facts-v2-dashboard-summary.viewmodel";

const metric = (count: number, total: number, pct: number | null) => ({
  kind: pct === null ? ("unavailable" as const) : ("exact" as const),
  valueText: pct === null ? "–" : `${pct}%`,
  lowerPct: pct,
  upperPct: pct,
  confirmedCount: count,
  unresolvedCount: 0,
  validCount: total,
  summaryText: "",
  evidenceText: "",
});

function makeModel(): EntityFactsV2DashboardCutoverModel {
  return {
    version: "0.1",
    businessName: "테스트 업체",
    measuredAt: "2026-09-30T00:00:00.000Z",
    recentSummary: {
      visibility: metric(4, 24, 16.67),
      top3: metric(2, 24, 8.33),
      validCount: 24,
      invalidCount: 0,
      questionSummaryText: "",
      uncertaintyNotice: null,
      sourceQualityNotice: null,
      topCompetitor: { name: "함께 나온 업체", responseCount: 7 },
    },
    metricCards: {
      visibility: metric(4, 24, 16.67),
      top3: metric(2, 24, 8.33),
      competitorCount: 1,
      targetSourceCount: 0,
      citationSourceCount: 0,
      observedSourceCount: 0,
    },
    competitors: {
      heading: "AI 답변에서 함께 관찰된 업체",
      rows: [
        {
          name: "함께 나온 업체",
          responseCount: 7,
          questionCount: 7,
          top3ResponseCount: 2,
          label: "함께 관찰",
        },
      ],
      legacyBadgesAvailable: false,
    },
    weakQuestions: { heading: "내 업체가 잘 보이지 않거나 추가 확인이 필요한 검색 질문", rows: [] },
    citationSources: { heading: "AI 답변에서 실제 인용된 출처", rows: [] },
    targetReferenceSources: { heading: "AI 답변 내 근접 단서", rows: [] },
    targetExposureCitationSources: { heading: "함께 인용된 전체 출처", available: true, rows: [] },
    verifiedTargetCitationPages: {
      heading: "페이지 내용 기준 관련 확인",
      status: "complete",
      available: true,
      rows: [
        { domain: "one.example", title: "첫 페이지", responseCount: 2, citationCount: 2, sampleUrl: "https://one.example/a", confidence: "high", basisLabel: "확인" },
        { domain: "two.example", title: "둘째 페이지", responseCount: 1, citationCount: 1, sampleUrl: "https://two.example/b", confidence: "medium", basisLabel: "확인" },
        { domain: "three.example", title: null, responseCount: 1, citationCount: 1, sampleUrl: "https://three.example/c", confidence: "medium", basisLabel: "확인" },
        { domain: "four.example", title: "넷째 페이지", responseCount: 1, citationCount: 1, sampleUrl: "https://four.example/d", confidence: "medium", basisLabel: "확인" },
      ],
    },
    sources: { heading: "업체 연결까지 확인된 출처", available: true, rows: [], referenceSourcesAvailable: false },
    questionGroups: [
      { intentType: "discovery", questionCount: 3, validCount: 3, confirmedMentionCount: 1, unresolvedTargetCount: 0, visibilityLowerBoundPct: 33.33, visibilityUpperBoundPct: 33.33, top3LowerBoundPct: 0, top3UpperBoundPct: 0 },
      { intentType: "service", questionCount: 3, validCount: 3, confirmedMentionCount: 2, unresolvedTargetCount: 0, visibilityLowerBoundPct: 66.67, visibilityUpperBoundPct: 66.67, top3LowerBoundPct: 0, top3UpperBoundPct: 0 },
      { intentType: "local", questionCount: 3, validCount: 3, confirmedMentionCount: 1, unresolvedTargetCount: 0, visibilityLowerBoundPct: 33.33, visibilityUpperBoundPct: 33.33, top3LowerBoundPct: 0, top3UpperBoundPct: 0 },
      { intentType: "price", questionCount: 3, validCount: 3, confirmedMentionCount: 0, unresolvedTargetCount: 0, visibilityLowerBoundPct: 0, visibilityUpperBoundPct: 0, top3LowerBoundPct: 0, top3UpperBoundPct: 0 },
    ],
  };
}

const opportunities: ActionOpportunityEngineResult = {
  version: "0.1",
  heading: "우선 확인해볼 차이",
  description: "",
  disclaimer: "",
  items: [1, 2, 3].map((rank) => ({
    rank,
    kind: "profile_directory",
    sourceGroupKey: `group-${rank}`,
    sourceGroupLabel: `그룹 ${rank}`,
    evidenceScope: "category",
    signalStrength: "strong",
    title: `확인 항목 ${rank}`,
    whyText: `관찰 근거 ${rank}`,
    actionText: "",
    evidenceText: "",
    highEntityCount: 3,
    highVisibilityEntityCount: 5,
    highEntitySharePct: 60,
    sites: [],
  })),
};

describe("entity facts v2 dashboard summary view model", () => {
  it("reuses the detailed dashboard truth values without business-specific content", () => {
    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model: makeModel(),
      unifiedLayerSummary: {
        custom: { questionCount: 16, validCount: 16, confirmedCount: 3, unresolvedCount: 0 },
        core: { questionCount: 8, validCount: 8, confirmedCount: 1, unresolvedCount: 0 },
        overall: { questionCount: 24, validCount: 24, confirmedCount: 4, unresolvedCount: 0 },
      },
      actionOpportunityModel: opportunities,
      hasVerifiedOwnedDomain: true,
      broadSearchObservation: {
        validCount: 8,
        targetIndependentSourceResponseCount: 1,
        repeatedCompetitors: [],
      },
    });

    expect(summary.visibility).toEqual({ count: 4, total: 24, pct: 16.67 });
    expect(summary.top3).toEqual({ count: 2, total: 24, pct: 8.33 });
    expect(summary.heroVariant).toBe("visible_top3");
    expect(summary.verifiedPageCount).toBe(4);
    expect(summary.competitorCount).toBe(1);
    expect(summary.topCompetitor).toEqual({ name: "함께 나온 업체", responseCount: 7 });
    expect(summary.topCompetitors).toEqual([
      { name: "함께 나온 업체", responseCount: 7, top3ResponseCount: 2 },
    ]);
    expect(summary.searchContexts.map((item) => [item.intentType, item.confirmedCount])).toEqual([
      ["service", 2],
      ["discovery", 1],
      ["local", 1],
    ]);
    expect(summary.searchScopes?.map((item) => [item.kind, item.confirmedCount, item.validCount])).toEqual([
      ["custom", 3, 16],
      ["core", 1, 8],
      ["overall", 4, 24],
    ]);
    expect(summary.searchScopeObservation).toBeNull();
    expect(summary.opportunities).toHaveLength(2);
    expect(summary.verifiedPages).toHaveLength(3);
    expect(JSON.stringify(summary)).not.toContain("현대 엑스티어");
  });

  it("sorts three recorded competitors deterministically without inventing a new score", () => {
    const model = makeModel();
    model.metricCards.competitorCount = 5;
    model.competitors.rows = [
      { name: "둘째 업체", responseCount: 3, questionCount: 3, top3ResponseCount: 1, label: "함께 관찰" },
      { name: "첫째 업체", responseCount: 6, questionCount: 6, top3ResponseCount: 3, label: "함께 관찰" },
      { name: "넷째 업체", responseCount: 1, questionCount: 1, top3ResponseCount: 1, label: "함께 관찰" },
      { name: "셋째 업체", responseCount: 3, questionCount: 3, top3ResponseCount: 2, label: "함께 관찰" },
      { name: "다섯째 업체", responseCount: 1, questionCount: 1, top3ResponseCount: 0, label: "함께 관찰" },
    ];
    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model, unifiedLayerSummary: null, actionOpportunityModel: null,
    });
    expect(summary.topCompetitors.map(({ name, responseCount }) => [name, responseCount])).toEqual([
      ["첫째 업체", 6],
      ["셋째 업체", 3],
      ["둘째 업체", 3],
    ]);
    expect(summary.competitorCount).toBe(5);
    expect(summary.visibility.count).toBe(4);
    expect(summary.verifiedPageCount).toBe(4);
  });

  it("does not invent a ranked competitor list when there are no actual rows", () => {
    const model = makeModel();
    model.metricCards.competitorCount = 0;
    model.competitors.rows = [];
    model.recentSummary.topCompetitor = null;
    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model, unifiedLayerSummary: null, actionOpportunityModel: null,
    });
    expect(summary.topCompetitors).toEqual([]);
    expect(summary.competitorCount).toBe(0);
  });

  it("surfaces a non-causal observation when detail search is visible but broad search is not", () => {
    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model: makeModel(),
      unifiedLayerSummary: {
        custom: { questionCount: 16, validCount: 16, confirmedCount: 14, unresolvedCount: 0 },
        core: { questionCount: 8, validCount: 8, confirmedCount: 0, unresolvedCount: 0 },
        overall: { questionCount: 24, validCount: 24, confirmedCount: 14, unresolvedCount: 0 },
      },
      actionOpportunityModel: opportunities,
      hasVerifiedOwnedDomain: true,
      broadSearchObservation: {
        validCount: 8,
        targetIndependentSourceResponseCount: 0,
        repeatedCompetitors: [
          {
            name: "퀀텀팩토리 서초점",
            responseCount: 5,
            questionCount: 5,
            top3ResponseCount: 4,
            intentCount: 5,
            strongestIndependentSource: {
              domain: "carcarescenter.com",
              responseCount: 5,
              directAttributionCount: 1,
            },
          },
          {
            name: "국스월드",
            responseCount: 4,
            questionCount: 4,
            top3ResponseCount: 0,
            intentCount: 4,
            strongestIndependentSource: {
              domain: "kugs.net",
              responseCount: 4,
              directAttributionCount: 1,
            },
          },
          {
            name: "세 번째 업체",
            responseCount: 3,
            questionCount: 3,
            top3ResponseCount: 1,
            intentCount: 2,
            strongestIndependentSource: null,
          },
        ],
      },
    });

    expect(summary.searchScopeObservation).toEqual({
      kind: "custom_without_core",
      headline: "상세 조건 검색 14/16에서는 확인됐지만, 넓은 범위 검색 0/8에서는 확인되지 않았습니다.",
      evidence:
        "공식 홈페이지는 등록돼 있지만, 이번 넓은 범위 검색 답변에서는 내 업체와 독립 웹 출처 연결이 확인되지 않았습니다.",
      repeatedCompetitors: [
        {
          name: "퀀텀팩토리 서초점",
          responseCount: 5,
          top3ResponseCount: 4,
          intentCount: 5,
          independentSourceDomain: "carcarescenter.com",
          independentSourceResponseCount: 5,
        },
        {
          name: "국스월드",
          responseCount: 4,
          top3ResponseCount: 0,
          intentCount: 4,
          independentSourceDomain: "kugs.net",
          independentSourceResponseCount: 4,
        },
      ],
    });
  });

  it("does not create the observation when broad search visibility is already confirmed", () => {
    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model: makeModel(),
      unifiedLayerSummary: {
        custom: { questionCount: 16, validCount: 16, confirmedCount: 3, unresolvedCount: 0 },
        core: { questionCount: 8, validCount: 8, confirmedCount: 1, unresolvedCount: 0 },
        overall: { questionCount: 24, validCount: 24, confirmedCount: 4, unresolvedCount: 0 },
      },
      actionOpportunityModel: null,
      hasVerifiedOwnedDomain: true,
      broadSearchObservation: {
        validCount: 8,
        targetIndependentSourceResponseCount: 0,
        repeatedCompetitors: [],
      },
    });

    expect(summary.searchScopeObservation).toBeNull();
  });

  it("uses a dedicated zero-visibility hero state", () => {
    const model = makeModel();
    model.metricCards.visibility = metric(0, 24, 0);
    model.metricCards.top3 = metric(0, 24, 0);

    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model,
      unifiedLayerSummary: null,
      actionOpportunityModel: null,
    });

    expect(summary.heroVariant).toBe("not_visible");
    expect(summary.visibility).toEqual({ count: 0, total: 24, pct: 0 });
    expect(summary.top3).toEqual({ count: 0, total: 24, pct: 0 });
    expect(summary.competitorCount).toBe(1);
  });

  it("distinguishes visibility without a Top3 appearance", () => {
    const model = makeModel();
    model.metricCards.visibility = metric(4, 24, 16.67);
    model.metricCards.top3 = metric(0, 24, 0);

    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model,
      unifiedLayerSummary: null,
      actionOpportunityModel: null,
    });

    expect(summary.heroVariant).toBe("visible_no_top3");
  });

  it("preserves legacy unverified page state instead of calling it pending", () => {
    const model = makeModel();
    model.verifiedTargetCitationPages.status = "not_verified";
    model.verifiedTargetCitationPages.available = false;
    model.verifiedTargetCitationPages.rows = [];

    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model,
      unifiedLayerSummary: null,
      actionOpportunityModel: null,
    });

    expect(summary.verifiedPageStatus).toBe("not_verified");
    expect(summary.verifiedPageCount).toBeNull();
    expect(summary.verifiedPages).toEqual([]);
  });

  it("does not turn unavailable values into zero", () => {
    const model = makeModel();
    model.metricCards.visibility = metric(0, 0, null);
    model.metricCards.top3 = metric(0, 0, null);
    model.verifiedTargetCitationPages.available = false;
    model.verifiedTargetCitationPages.status = "pending";

    const summary = buildEntityFactsV2DashboardSummaryViewModel({
      model,
      unifiedLayerSummary: null,
      actionOpportunityModel: null,
    });

    expect(summary.visibility).toEqual({ count: null, total: null, pct: null });
    expect(summary.top3).toEqual({ count: null, total: null, pct: null });
    expect(summary.heroVariant).toBe("unavailable");
    expect(summary.verifiedPageStatus).toBe("pending");
    expect(summary.verifiedPageCount).toBeNull();
    expect(summary.searchScopes).toBeNull();
    expect(summary.searchScopeObservation).toBeNull();
    expect(summary.opportunities).toEqual([]);
    expect(summary.verifiedPages).toEqual([]);
  });
});