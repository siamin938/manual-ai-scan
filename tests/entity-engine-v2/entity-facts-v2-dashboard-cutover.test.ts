import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITY_FACTS_V2_DASHBOARD_CUTOVER_MAP,
  buildEntityFactsV2DashboardCutoverModel,
} from "../../src/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import type { EntityFactsV2ReadGatewayDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";

function fixture(): EntityFactsV2ReadGatewayDTO {
  const baseBounds = {
    validCount: 24,
    confirmedMentionCount: 1,
    unresolvedTargetCount: 6,
    visibilityLowerBoundPct: 4.17,
    visibilityUpperBoundPct: 29.17,
    confirmedTop3Count: 1,
    top3UncertainCount: 6,
    top3LowerBoundPct: 4.17,
    top3UpperBoundPct: 29.17,
  };

  return {
    gatewayVersion: "0.1",
    generatedAt: "2026-09-20T00:00:00.000Z",
    business: {
      id: "c9cb39d5-9f04-46ec-8018-14156670446d",
      name: "카스페이스 구로점",
      category: "썬팅/신차패키지",
      region: "서울특별시",
      city: "구로구",
    },
    scope: {
      runId: "28a793c9-c24d-41ff-9037-f08abc21b3ca",
      runName: "카스페이스 구로점 측정 2026-09-18",
      measuredAt: "2026-09-18T12:59:10.936577+00:00",
      providers: ["openai"],
      repetitions: 1,
      totalJobs: 24,
      completedJobs: 24,
      failedJobs: 0,
    },
    overview: {
      ...baseBounds,
      measurementCount: 24,
      invalidCount: 0,
      questionCount: 24,
      coveredQuestionCount: 1,
      unresolvedQuestionCount: 6,
      missingQuestionCount: 17,
      sourcePartialMeasurementCount: 6,
    },
    questionGroups: [
      {
        intentType: "comparison",
        questionCount: 3,
        validCount: 3,
        confirmedMentionCount: 1,
        unresolvedTargetCount: 1,
        visibilityLowerBoundPct: 33.33,
        visibilityUpperBoundPct: 66.67,
        confirmedTop3Count: 1,
        top3UncertainCount: 1,
        top3LowerBoundPct: 33.33,
        top3UpperBoundPct: 66.67,
      },
    ],
    questionAreas: [
      {
        questionId: "11111111-1111-4111-8111-111111111111",
        questionText: "구로구 신차패키지 업체 어디야?",
        intentType: "local",
        status: "unresolved",
        validCount: 1,
        confirmedMentionCount: 0,
        unresolvedTargetCount: 1,
        visibilityLowerBoundPct: 0,
        visibilityUpperBoundPct: 100,
        confirmedTop3Count: 0,
        top3UncertainCount: 1,
        top3LowerBoundPct: 0,
        top3UpperBoundPct: 100,
      },
      {
        questionId: "22222222-2222-4222-8222-222222222222",
        questionText: "서울 썬팅 업체 어디 있어?",
        intentType: "local",
        status: "missing",
        validCount: 1,
        confirmedMentionCount: 0,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: 0,
        visibilityUpperBoundPct: 0,
        confirmedTop3Count: 0,
        top3UncertainCount: 0,
        top3LowerBoundPct: 0,
        top3UpperBoundPct: 0,
      },
      {
        questionId: "33333333-3333-4333-8333-333333333333",
        questionText: "구로구 썬팅 비교",
        intentType: "comparison",
        status: "partial",
        validCount: 2,
        confirmedMentionCount: 1,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: 50,
        visibilityUpperBoundPct: 50,
        confirmedTop3Count: 1,
        top3UncertainCount: 0,
        top3LowerBoundPct: 50,
        top3UpperBoundPct: 50,
      },
      {
        questionId: "44444444-4444-4444-8444-444444444444",
        questionText: "구로구 후기 좋은 썬팅",
        intentType: "review_quality",
        status: "covered",
        validCount: 1,
        confirmedMentionCount: 1,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: 100,
        visibilityUpperBoundPct: 100,
        confirmedTop3Count: 1,
        top3UncertainCount: 0,
        top3LowerBoundPct: 100,
        top3UpperBoundPct: 100,
      },
    ],
    competitors: [
      {
        name: "레이노 개봉점",
        responseCount: 2,
        questionCount: 2,
        intentCount: 2,
        top3ResponseCount: 2,
      },
      {
        name: "모터큐브",
        responseCount: 1,
        questionCount: 1,
        intentCount: 1,
        top3ResponseCount: 1,
      },
    ],
    targetSources: [
      {
        domain: "example.com",
        responseCount: 3,
        completeResponseCount: 2,
        partialResponseCount: 1,
      },
    ],
    observedSourcesStatus: "available",
    observedSources: [
      {
        domain: "hunnytip.kr",
        responseCount: 2,
        targetResponseCount: 0,
        competitorResponseCount: 2,
        clueResponseCount: 0,
        evidence: "confirmed",
        linkedEntities: [
          {
            name: "레이노 개봉점",
            isTarget: false,
            responseCount: 2,
            evidence: "confirmed",
          },
          {
            name: "루마썬팅 오류점",
            isTarget: false,
            responseCount: 1,
            evidence: "confirmed",
          },
        ],
      },
      {
        domain: "silliskorea.com",
        responseCount: 1,
        targetResponseCount: 0,
        competitorResponseCount: 0,
        clueResponseCount: 1,
        evidence: "clue",
        linkedEntities: [
          {
            name: "실리스코리아",
            isTarget: false,
            responseCount: 1,
            evidence: "clue",
          },
        ],
      },
    ],
  };
}

describe("Entity Facts v2 dashboard cutover mapping", () => {
  it("classifies dashboard areas into direct, separate and deferred paths", () => {
    const bySection = new Map(
      ENTITY_FACTS_V2_DASHBOARD_CUTOVER_MAP.map((rule) => [rule.section, rule.mode]),
    );

    expect(bySection.get("recent_summary")).toBe("direct_v2");
    expect(bySection.get("visibility_metric")).toBe("direct_v2");
    expect(bySection.get("competitor_list")).toBe("direct_v2");
    expect(bySection.get("weak_questions")).toBe("direct_v2");
    expect(bySection.get("source_list")).toBe("direct_v2");
    expect(bySection.get("question_groups")).toBe("direct_v2");

    expect(bySection.get("business_selector")).toBe("separate_existing");
    expect(bySection.get("action_recommendations")).toBe("defer");
    expect(bySection.get("benchmark")).toBe("separate_existing");

    expect(bySection.get("repeat_aggregate")).toBe("defer");
    expect(bySection.get("repeat_context")).toBe("defer");
    expect(bySection.get("trend")).toBe("defer");
    expect(bySection.get("competitor_detail")).toBe("defer");
    expect(bySection.get("reference_sources")).toBe("defer");

    expect(new Set(ENTITY_FACTS_V2_DASHBOARD_CUTOVER_MAP.map((r) => r.section)).size).toBe(
      ENTITY_FACTS_V2_DASHBOARD_CUTOVER_MAP.length,
    );
  });

  it("preserves the 4.17% to 29.17% current-run range in dashboard metrics", () => {
    const model = buildEntityFactsV2DashboardCutoverModel(fixture());

    expect(model.recentSummary.visibility.kind).toBe("range");
    expect(model.recentSummary.visibility.valueText).toBe("4.17% ~ 29.17%");
    expect(model.metricCards.visibility.valueText).toBe("4.17% ~ 29.17%");
    expect(model.recentSummary.visibility.valueText).not.toContain("25%");
    expect(model.recentSummary.uncertaintyNotice).not.toBeNull();
  });

  it("maps v2 competitors without fabricating legacy tier or newness", () => {
    const model = buildEntityFactsV2DashboardCutoverModel(fixture());

    expect(model.competitors.rows).toEqual([
      {
        name: "레이노 개봉점",
        responseCount: 2,
        questionCount: 2,
        top3ResponseCount: 2,
        label: "함께 관찰",
      },
      {
        name: "모터큐브",
        responseCount: 1,
        questionCount: 1,
        top3ResponseCount: 1,
        label: "함께 관찰",
      },
    ]);
    expect(model.competitors.legacyBadgesAvailable).toBe(false);

    const serialized = JSON.stringify(model.competitors);
    expect(serialized).not.toContain('"tier"');
    expect(serialized).not.toContain('"isNew"');
    expect(serialized).not.toContain('"priorRunPresenceCount"');
    expect(serialized).not.toContain('"responseRatePct"');
  });

  it("uses observed source supplement without overstating source trust", () => {
    const model = buildEntityFactsV2DashboardCutoverModel(fixture());

    expect(model.sources.heading).toBe("AI 답변에서 관찰된 주요 출처");
    expect(model.sources.available).toBe(true);
    expect(model.sources.referenceSourcesAvailable).toBe(false);
    expect(model.metricCards.targetSourceCount).toBe(1);
    expect(model.metricCards.observedSourceCount).toBe(2);
    expect(model.sources.rows).toEqual([
      {
        domain: "hunnytip.kr",
        responseCount: 2,
        targetResponseCount: 0,
        competitorResponseCount: 2,
        clueResponseCount: 0,
        evidence: "confirmed",
        linkedEntities: [
          {
            name: "레이노 개봉점",
            isTarget: false,
            responseCount: 2,
            evidence: "confirmed",
          },
          {
            name: "루마썬팅 오류점",
            isTarget: false,
            responseCount: 1,
            evidence: "confirmed",
          },
        ],
      },
      {
        domain: "silliskorea.com",
        responseCount: 1,
        targetResponseCount: 0,
        competitorResponseCount: 0,
        clueResponseCount: 1,
        evidence: "clue",
        linkedEntities: [
          {
            name: "실리스코리아",
            isTarget: false,
            responseCount: 1,
            evidence: "clue",
          },
        ],
      },
    ]);

    const serialized = JSON.stringify(model.sources);
    expect(serialized).not.toContain("sampleTitle");
    expect(serialized).not.toContain("citationCount");
    expect(serialized).not.toContain("canonicalKey");
  });

  it("keeps weak-question uncertainty distinct from confirmed missing", () => {
    const model = buildEntityFactsV2DashboardCutoverModel(fixture());

    expect(model.weakQuestions.rows.map((row) => row.status)).toEqual([
      "unresolved",
      "missing",
      "partial",
    ]);
    expect(model.weakQuestions.rows[0]).toMatchObject({
      status: "unresolved",
      statusLabel: "추가 확인 필요",
      confirmedMentionCount: 0,
      unresolvedTargetCount: 1,
      visibilityLowerBoundPct: 0,
      visibilityUpperBoundPct: 100,
      visibilityDisplayText: null,
    });
    expect(model.weakQuestions.rows.some((row) => row.status === "covered")).toBe(false);
  });

  it("keeps question-group lower and upper bounds instead of one legacy rate", () => {
    const model = buildEntityFactsV2DashboardCutoverModel(fixture());

    expect(model.questionGroups).toEqual([
      {
        intentType: "comparison",
        questionCount: 3,
        validCount: 3,
        confirmedMentionCount: 1,
        unresolvedTargetCount: 1,
        visibilityLowerBoundPct: 33.33,
        visibilityUpperBoundPct: 66.67,
        top3LowerBoundPct: 33.33,
        top3UpperBoundPct: 66.67,
      },
    ]);

    const serialized = JSON.stringify(model.questionGroups);
    expect(serialized).not.toContain("visibilityRatePct");
    expect(serialized).not.toContain("mentionCount");
  });

  it("wires only approved v2/separate sections into the live dashboard", () => {
    const dashboardSource = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );

    expect(dashboardSource).toContain("entity-facts-v2-read-gateway.dashboard-cutover");
    expect(dashboardSource).toContain("getEntityFactsV2ReadGateway");
    expect(dashboardSource).toContain("buildEntityFactsV2DashboardCutoverModel");

    expect(dashboardSource).not.toContain("ActionRecommendationsSection");
    expect(dashboardSource).toContain("getVisibilityBenchmark");
    expect(dashboardSource).toContain('label="확정 AI 노출률"');
    expect(dashboardSource).toContain('label="확정 상위 3곳 노출률"');
    expect(dashboardSource).toContain(
      "추가 확인이 필요한 응답까지 모두 같은 업체로 확인될 경우 최대",
    );
    expect(dashboardSource).toContain("확인된 연결과 연결 단서를 포함한 출처");
    expect(dashboardSource).toContain("상위 3곳 여부 추가 확인");
    expect(dashboardSource).toContain('note="이번 측정에서 업체로 확인된 항목"');
    expect(dashboardSource).toContain("같은 업체가 여러 답변에서");
    expect(dashboardSource).toContain(
      "연결이 아직 충분히 확인되지 않은 경우에는 ‘연결 단서’로 표시합니다.",
    );
    expect(dashboardSource).toContain("showAllCompetitors");
    expect(dashboardSource).toContain("showAllWeakQuestions");
    expect(dashboardSource).toContain("model.competitors.rows.length > 6");
    expect(dashboardSource).toContain("weakQuestionRows.length > 6");
    expect(dashboardSource).toContain("전체 ${model.competitors.rows.length}곳 보기");
    expect(dashboardSource).toContain("전체 ${weakQuestionRows.length}개 질문 보기");
    expect(dashboardSource).not.toContain("노출 범위 ${q.visibilityDisplayText}");
    expect(dashboardSource).toContain("AI 답변 {s.clueResponseCount}건에서 단서 확인");
    expect(dashboardSource).toContain("최근 측정에서 내 업체 직접 연결 미확인");
    expect(dashboardSource).toContain("기본 진단 최근 측정 결과");
    expect(dashboardSource).toContain("기본 진단 기준");
    expect(dashboardSource).toContain("AI 진단 기준");
    expect(dashboardSource).toContain("isUnifiedDiagnosticSetName");
    expect(dashboardSource).toContain("내 업체 AI 진단");
    expect(dashboardSource).toContain("AI 진단 최근 측정 결과");
    expect(dashboardSource).toContain("active-unified-diagnostic-set");
    expect(dashboardSource).toContain("UNIFIED_DIAGNOSTIC_SET_PREFIX");
    expect(dashboardSource).toContain("hasUnifiedDiagnosticSet");
    expect(dashboardSource).toContain("UNIFIED_V2_RETRY_DELAYS_MS");
    expect(dashboardSource).toContain("isTransientV2ReadError");
    expect(dashboardSource).toContain('"NO_V2_DATA"');
    expect(dashboardSource).toContain('"INVALID_V2_DATA"');
    expect(dashboardSource).toContain("waitForDashboardRetry");
    expect(dashboardSource).toContain("questionUsesDetailedLocation");
    expect(dashboardSource).toContain("unifiedWeakQuestionPriority");
    expect(dashboardSource).toContain("맞춤 검색");
    expect(dashboardSource).toContain("기준 검색");
    expect(dashboardSource).toContain("가장 자주 함께 관찰된 업체");
    expect(dashboardSource).toContain("(공동)");
    expect(dashboardSource).toContain("confirmedRatio");
    expect(dashboardSource).toContain(
      "AI에 자주 관찰되는 업체들은 어떤 출처와 함께 보일까요?",
    );
    expect(dashboardSource).toContain("buildUnifiedDiagnosticLayerSummary");
    expect(dashboardSource).toContain("unified-diagnostic-question-layers");
    expect(dashboardSource).toContain('.select("id, city")');
    expect(dashboardSource).toContain("검색 범위별 확정 노출");
    expect(dashboardSource).toContain("전체 AI 노출");
    expect(dashboardSource).toContain("맞춤 검색");
    expect(dashboardSource).toContain("기준 검색");
    expect(dashboardSource).toContain(
      "상세 지역·브랜드/차종 검색에서는 확인됐지만, 더 넓은 기준 검색에서는 확인되지 않았습니다.",
    );
    expect(dashboardSource).toContain("!isUnifiedDiagnostic");
    expect(dashboardSource).toContain(
      "아래 상세 분석과 벤치마크는 기본 24문항 측정을 기준으로 합니다.",
    );
    expect(dashboardSource).not.toContain("내 업체에서는 미관찰");

    expect(dashboardSource).not.toContain("getVisibilityDiagnostic");
    expect(dashboardSource).not.toContain("getVisibilityRepeatAggregate");
    expect(dashboardSource).not.toContain("getVisibilityRepeatContext");
    expect(dashboardSource).not.toContain("CompetitorDetailDialog");
    expect(dashboardSource).not.toContain("LineChart");
    expect(dashboardSource).not.toContain("responseRatePct");
    expect(dashboardSource).not.toContain("priorRunPresenceCount");
    expect(dashboardSource).not.toContain("isNew");
  });
});
