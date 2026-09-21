import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { EntityFactsV2ReadGatewayDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";
import {
  buildEntityFactsV2OverviewViewModel,
  buildEntityFactsV2ReadGatewayViewModel,
  entityFactsV2QuestionStatusViewModel,
} from "../../src/lib/entity-facts-v2-read-gateway.viewmodel";

function dto(overrides?: {
  validCount?: number;
  confirmedMentionCount?: number;
  unresolvedTargetCount?: number;
  visibilityLowerBoundPct?: number | null;
  visibilityUpperBoundPct?: number | null;
  confirmedTop3Count?: number;
  top3UncertainCount?: number;
  top3LowerBoundPct?: number | null;
  top3UpperBoundPct?: number | null;
  coveredQuestionCount?: number;
  unresolvedQuestionCount?: number;
  missingQuestionCount?: number;
  sourcePartialMeasurementCount?: number;
}): EntityFactsV2ReadGatewayDTO {
  const validCount = overrides?.validCount ?? 24;
  return {
    gatewayVersion: "0.1",
    generatedAt: "2026-09-20T00:00:00.000Z",
    business: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "테스트 업체",
      category: "썬팅/신차패키지",
      region: "서울특별시",
      city: "구로구",
    },
    scope: {
      runId: "22222222-2222-4222-8222-222222222222",
      runName: "최근 측정",
      measuredAt: "2026-09-18T12:59:10.000Z",
      providers: ["openai"],
      repetitions: 1,
      totalJobs: validCount,
      completedJobs: validCount,
      failedJobs: 0,
    },
    overview: {
      validCount,
      invalidCount: 0,
      confirmedMentionCount: overrides?.confirmedMentionCount ?? 1,
      unresolvedTargetCount: overrides?.unresolvedTargetCount ?? 6,
      visibilityLowerBoundPct: overrides?.visibilityLowerBoundPct ?? 4.17,
      visibilityUpperBoundPct: overrides?.visibilityUpperBoundPct ?? 29.17,
      confirmedTop3Count: overrides?.confirmedTop3Count ?? 1,
      top3UncertainCount: overrides?.top3UncertainCount ?? 6,
      top3LowerBoundPct: overrides?.top3LowerBoundPct ?? 4.17,
      top3UpperBoundPct: overrides?.top3UpperBoundPct ?? 29.17,
      measurementCount: validCount,
      questionCount: validCount,
      coveredQuestionCount: overrides?.coveredQuestionCount ?? 1,
      unresolvedQuestionCount: overrides?.unresolvedQuestionCount ?? 6,
      missingQuestionCount: overrides?.missingQuestionCount ?? 17,
      sourcePartialMeasurementCount:
        overrides?.sourcePartialMeasurementCount ?? 6,
    },
    questionGroups: [],
    questionAreas: [],
    competitors: [],
    targetSources: [],
    observedSourcesStatus: "not_materialized",
    observedSources: [],
  };
}

describe("Entity Facts v2 customer View Model", () => {
  it("shows unresolved target truth as a range without inventing a midpoint", () => {
    const vm = buildEntityFactsV2OverviewViewModel(dto());

    expect(vm.visibility.kind).toBe("range");
    expect(vm.visibility.valueText).toBe("4.17% ~ 29.17%");
    expect(vm.visibility.lowerPct).toBe(4.17);
    expect(vm.visibility.upperPct).toBe(29.17);
    expect(vm.visibility.summaryText).toBe(
      "확정 기준 4.17% · 추가 확인이 필요한 응답 포함 시 최대 29.17%",
    );
    expect(vm.visibility.evidenceText).toBe(
      "유효 응답 24건 중 확정 노출 1건 · 추가 확인 필요 6건",
    );
    expect(vm.uncertaintyNotice).toContain(
      "메인 노출률은 내 업체로 확정된 응답만 계산",
    );
    expect(vm.sourceQualityNotice).toBe(
      "출처 연결 판정이 일부 미완료인 응답이 6건 있습니다.",
    );
    expect(vm.visibility.valueText).not.toContain("25%");
  });

  it("shows a single exact percentage when lower and upper are equal", () => {
    const vm = buildEntityFactsV2OverviewViewModel(
      dto({
        confirmedMentionCount: 3,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: 12.5,
        visibilityUpperBoundPct: 12.5,
        confirmedTop3Count: 3,
        top3UncertainCount: 0,
        top3LowerBoundPct: 12.5,
        top3UpperBoundPct: 12.5,
        coveredQuestionCount: 3,
        unresolvedQuestionCount: 0,
        missingQuestionCount: 21,
        sourcePartialMeasurementCount: 0,
      }),
    );

    expect(vm.visibility.kind).toBe("exact");
    expect(vm.visibility.valueText).toBe("12.5%");
    expect(vm.visibility.summaryText).toBe(
      "확정 노출 3건 · 유효 응답 24건",
    );
    expect(vm.uncertaintyNotice).toBeNull();
    expect(vm.sourceQualityNotice).toBeNull();
  });

  it("keeps confirmed zero as an exact 0% when there is no unresolved target", () => {
    const vm = buildEntityFactsV2OverviewViewModel(
      dto({
        confirmedMentionCount: 0,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: 0,
        visibilityUpperBoundPct: 0,
        confirmedTop3Count: 0,
        top3UncertainCount: 0,
        top3LowerBoundPct: 0,
        top3UpperBoundPct: 0,
        coveredQuestionCount: 0,
        unresolvedQuestionCount: 0,
        missingQuestionCount: 24,
      }),
    );

    expect(vm.visibility.kind).toBe("exact");
    expect(vm.visibility.valueText).toBe("0%");
    expect(vm.visibility.summaryText).toBe(
      "확정 노출 0건 · 유효 응답 24건",
    );
  });

  it("does not manufacture a percentage when there are no valid responses", () => {
    const vm = buildEntityFactsV2OverviewViewModel(
      dto({
        validCount: 0,
        confirmedMentionCount: 0,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: null,
        visibilityUpperBoundPct: null,
        confirmedTop3Count: 0,
        top3UncertainCount: 0,
        top3LowerBoundPct: null,
        top3UpperBoundPct: null,
        coveredQuestionCount: 0,
        unresolvedQuestionCount: 0,
        missingQuestionCount: 0,
        sourcePartialMeasurementCount: 0,
      }),
    );

    expect(vm.visibility.kind).toBe("unavailable");
    expect(vm.visibility.valueText).toBe("–");
    expect(vm.visibility.summaryText).toBe(
      "표시할 수 있는 유효 응답이 없습니다.",
    );
  });

  it("uses the same uncertainty semantics for Top3", () => {
    const vm = buildEntityFactsV2OverviewViewModel(dto());
    expect(vm.top3.kind).toBe("range");
    expect(vm.top3.valueText).toBe("4.17% ~ 29.17%");
    expect(vm.top3.evidenceText).toBe(
      "유효 응답 24건 중 상위 3곳 확정 1건 · 상위 3곳 여부 추가 확인 필요 6건",
    );
  });

  it("maps question states to cautious customer-facing labels", () => {
    expect(entityFactsV2QuestionStatusViewModel("covered")).toEqual({
      status: "covered",
      label: "노출 확인",
      tone: "positive",
    });
    expect(entityFactsV2QuestionStatusViewModel("partial")).toEqual({
      status: "partial",
      label: "일부 노출 확인",
      tone: "neutral",
    });
    expect(entityFactsV2QuestionStatusViewModel("unresolved")).toEqual({
      status: "unresolved",
      label: "추가 확인 필요",
      tone: "attention",
    });
    expect(entityFactsV2QuestionStatusViewModel("missing")).toEqual({
      status: "missing",
      label: "노출 미확인",
      tone: "neutral",
    });
  });

  it("keeps the display model compatible with the live v2 dashboard cutover", () => {
    const vm = buildEntityFactsV2ReadGatewayViewModel(dto());
    expect(vm.businessName).toBe("테스트 업체");
    expect(vm.overview.visibility.valueText).toBe("4.17% ~ 29.17%");

    const dashboardSource = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(dashboardSource).toContain(
      "buildEntityFactsV2DashboardCutoverModel",
    );
    expect(dashboardSource).toContain("getEntityFactsV2ReadGateway");
  });
});
