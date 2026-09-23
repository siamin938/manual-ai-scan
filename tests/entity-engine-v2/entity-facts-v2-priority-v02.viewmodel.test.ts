import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEntityFactsV2PriorityV02ViewModel } from "../../src/lib/entity-facts-v2-priority-v02.viewmodel";
import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "../../src/lib/entity-facts-v2-read-gateway.types";

function area(args: {
  questionText: string;
  intentType: string;
  confirmed?: number;
  top3?: number;
  top3Uncertain?: number;
  unresolved?: number;
}): EntityFactsV2ReadQuestionAreaDTO {
  const confirmed = args.confirmed ?? 0;
  const unresolved = args.unresolved ?? 0;
  const top3 = args.top3 ?? 0;
  const top3Uncertain = args.top3Uncertain ?? 0;
  return {
    questionId: `q:${args.questionText}`,
    questionText: args.questionText,
    intentType: args.intentType,
    status:
      unresolved > 0
        ? "unresolved"
        : confirmed > 0
          ? "covered"
          : "missing",
    validCount: 1,
    confirmedMentionCount: confirmed,
    unresolvedTargetCount: unresolved,
    visibilityLowerBoundPct: confirmed > 0 ? 100 : 0,
    visibilityUpperBoundPct: confirmed + unresolved > 0 ? 100 : 0,
    confirmedTop3Count: top3,
    top3UncertainCount: top3Uncertain,
    top3LowerBoundPct: top3 > 0 ? 100 : 0,
    top3UpperBoundPct: top3 + top3Uncertain > 0 ? 100 : 0,
  };
}

function dto(overrides: Partial<EntityFactsV2ReadGatewayDTO>): EntityFactsV2ReadGatewayDTO {
  return {
    gatewayVersion: "0.1",
    generatedAt: "2026-09-23T00:00:00.000Z",
    business: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "테스트 업체",
      category: null,
      region: null,
      city: null,
    },
    scope: {
      runId: "22222222-2222-4222-8222-222222222222",
      runName: "최근 측정",
      measuredAt: "2026-09-23T00:00:00.000Z",
      providers: ["openai"],
      repetitions: 1,
      totalJobs: 24,
      completedJobs: 24,
      failedJobs: 0,
    },
    overview: {
      validCount: 24,
      invalidCount: 0,
      confirmedMentionCount: 0,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 0,
      visibilityUpperBoundPct: 0,
      confirmedTop3Count: 0,
      top3UncertainCount: 0,
      top3LowerBoundPct: 0,
      top3UpperBoundPct: 0,
      measurementCount: 24,
      questionCount: 24,
      coveredQuestionCount: 0,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 24,
      sourcePartialMeasurementCount: 0,
    },
    questionGroups: [],
    questionAreas: [],
    competitors: [],
    targetSources: [],
    observedSourcesStatus: "not_materialized",
    observedSources: [],
    ...overrides,
  };
}

function confirmedGap(domain: string, responseCount: number) {
  return {
    domain,
    responseCount,
    targetResponseCount: 0,
    competitorResponseCount: responseCount,
    clueResponseCount: 0,
    evidence: "confirmed" as const,
    linkedEntities: [
      {
        name: "함께 관찰된 업체",
        isTarget: false,
        responseCount,
        evidence: "confirmed" as const,
      },
    ],
  };
}

describe("Entity Facts v2 Priority v0.2", () => {
  it("dry-runs the current 카스페이스 pattern as source gap -> visible-not-top3 -> identity uncertainty", () => {
    const vm = buildEntityFactsV2PriorityV02ViewModel(
      dto({
        business: {
          id: "c9cb39d5-9f04-46ec-8018-14156670446d",
          name: "카스페이스 구로점",
          category: "썬팅/신차패키지",
          region: "서울특별시",
          city: "구로구",
        },
        observedSourcesStatus: "available",
        observedSources: [
          confirmedGap("3msunting.kr", 2),
          confirmedGap("fivemoneys.com", 1),
        ],
        questionAreas: [
          area({
            questionText: "구로구에서 신차패키지 경험 많은 곳 추천해줘",
            intentType: "recommendation",
            confirmed: 1,
            top3: 0,
            top3Uncertain: 0,
          }),
          area({
            questionText: "구로구 가격 괜찮은 썬팅 업체 찾아줘",
            intentType: "price_value",
            unresolved: 1,
          }),
          area({
            questionText: "구로구 신차패키지 상담 후기가 좋은 곳 어디야?",
            intentType: "review_quality",
            unresolved: 1,
          }),
          area({
            questionText: "구로구 썬팅 시공점 어디가 있어?",
            intentType: "service",
          }),
        ],
      }),
    );

    expect(vm.version).toBe("0.2");
    expect(vm.items.map((item) => item.kind)).toEqual([
      "confirmed_source_gap",
      "visible_not_top3",
      "identity_uncertain",
    ]);
    expect(vm.items.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(vm.items[0].sourceDomain).toBe("3msunting.kr");
    expect(vm.items[1].examples[0]?.questionText).toBe(
      "구로구에서 신차패키지 경험 많은 곳 추천해줘",
    );
    expect(vm.items[2].examples.map((item) => item.questionText)).toContain(
      "구로구 가격 괜찮은 썬팅 업체 찾아줘",
    );
  });

  it("dry-runs the current 타이어프로 pattern and prefers the concrete Top3 gap before identity uncertainty", () => {
    const vm = buildEntityFactsV2PriorityV02ViewModel(
      dto({
        business: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "타이어프로 봉일천점",
          category: "타이어/휠",
          region: "경기도",
          city: "파주시",
        },
        observedSourcesStatus: "available",
        observedSources: [confirmedGap("service.mycle.co.kr", 10)],
        questionAreas: [
          area({
            questionText:
              "파주 타이어·휠 매장 중 공개된 평판과 작업 완성도를 기준으로 몇 군데 비교해줘.",
            intentType: "comparison",
            confirmed: 1,
            top3: 0,
            top3Uncertain: 0,
          }),
          area({
            questionText:
              "타이어나 휠을 처음 알아보는 사람에게 파주 쪽에서 추천할 만한 곳 몇 군데 알려줘.",
            intentType: "recommendation",
            unresolved: 1,
          }),
          area({
            questionText:
              "타이어와 휠 작업 경험이 많은 곳을 중심으로 파주 지역 매장들을 비교해줘.",
            intentType: "recommendation",
            unresolved: 1,
          }),
          area({
            questionText:
              "파주 타이어·휠 매장들을 상담 방식과 제공하는 작업 범위를 기준으로 비교해줘.",
            intentType: "comparison",
          }),
        ],
      }),
    );

    expect(vm.items.map((item) => item.kind)).toEqual([
      "confirmed_source_gap",
      "visible_not_top3",
      "identity_uncertain",
    ]);
    expect(vm.items[0].sourceDomain).toBe("service.mycle.co.kr");
    expect(vm.items[1].examples[0]?.questionText).toContain(
      "공개된 평판과 작업 완성도",
    );
    expect(vm.items[2].evidenceText).toBe(
      "2개 질문 · 업체 동일성 추가 확인 2건",
    );
  });

  it("dry-runs the current 현대엑스티어 pattern as source gap + concrete missing questions", () => {
    const vm = buildEntityFactsV2PriorityV02ViewModel(
      dto({
        business: {
          id: "44444444-4444-4444-8444-444444444444",
          name: "현대엑스티어 판교",
          category: "엔진오일/정비",
          region: "경기도",
          city: "성남시",
        },
        observedSourcesStatus: "available",
        observedSources: [confirmedGap("service.mycle.co.kr", 4)],
        questionAreas: [
          area({
            questionText: "분당구 프리미엄 엔진오일 업체별 작업 범위 비교해줘",
            intentType: "comparison",
          }),
          area({
            questionText: "분당구 프리미엄 오일 업체 실제 이용 후기 좋은 곳 알려줘",
            intentType: "review_quality",
          }),
          area({
            questionText: "분당구에서 가격 대비 괜찮은 엔진오일 업체 어디야?",
            intentType: "price_value",
          }),
        ],
      }),
    );

    expect(vm.items.map((item) => item.kind)).toEqual([
      "confirmed_source_gap",
      "missing_questions",
    ]);
    expect(vm.items[0].sourceDomain).toBe("service.mycle.co.kr");
    expect(vm.items[1].examples).toHaveLength(2);
    expect(vm.items[1].examples[0]?.questionText).toBe(
      "분당구에서 가격 대비 괜찮은 엔진오일 업체 어디야?",
    );
  });

  it("does not call Top3 uncertain questions a confirmed Top3 gap", () => {
    const vm = buildEntityFactsV2PriorityV02ViewModel(
      dto({
        questionAreas: [
          area({
            questionText: "서울 썬팅 업체 어디 있어?",
            intentType: "local",
            confirmed: 1,
            top3: 0,
            top3Uncertain: 1,
          }),
        ],
      }),
    );

    expect(
      vm.items.find((item) => item.kind === "visible_not_top3"),
    ).toBeUndefined();
  });

  it("excludes clue-only or target-connected sources from the source-gap candidate", () => {
    const vm = buildEntityFactsV2PriorityV02ViewModel(
      dto({
        observedSourcesStatus: "available",
        observedSources: [
          {
            domain: "clue.example.com",
            responseCount: 3,
            targetResponseCount: 0,
            competitorResponseCount: 3,
            clueResponseCount: 3,
            evidence: "clue",
            linkedEntities: [
              {
                name: "단서 업체",
                isTarget: false,
                responseCount: 3,
                evidence: "clue",
              },
            ],
          },
          {
            domain: "connected.example.com",
            responseCount: 4,
            targetResponseCount: 1,
            competitorResponseCount: 3,
            clueResponseCount: 0,
            evidence: "confirmed",
            linkedEntities: [
              {
                name: "내 업체",
                isTarget: true,
                responseCount: 1,
                evidence: "confirmed",
              },
              {
                name: "다른 업체",
                isTarget: false,
                responseCount: 3,
                evidence: "confirmed",
              },
            ],
          },
        ],
      }),
    );

    expect(
      vm.items.find((item) => item.kind === "confirmed_source_gap"),
    ).toBeUndefined();
  });

  it("keeps v0.2 isolated from the live dashboard until dry-run approval", () => {
    const dashboard = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(dashboard).not.toContain("entity-facts-v2-priority-v02");
    expect(dashboard).not.toContain("buildEntityFactsV2PriorityV02ViewModel");
  });

  it("does not introduce legacy scoring or recommendation dependencies", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/entity-facts-v2-priority-v02.viewmodel.ts",
      ),
      "utf8",
    );
    for (const banned of [
      "visibility-actions",
      "ActionRecommendations",
      "was_client_mentioned",
      "client_position",
      "significance",
      "benchmark",
      "score",
    ]) {
      expect(source).not.toContain(banned);
    }
  });
});
