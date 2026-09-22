import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEntityFactsV2PriorityViewModel } from "../../src/lib/entity-facts-v2-priority.viewmodel";
import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionGroupDTO,
} from "../../src/lib/entity-facts-v2-read-gateway.types";

function bounds(overrides?: {
  validCount?: number;
  confirmedMentionCount?: number;
  unresolvedTargetCount?: number;
}) {
  const validCount = overrides?.validCount ?? 3;
  const confirmedMentionCount = overrides?.confirmedMentionCount ?? 0;
  const unresolvedTargetCount = overrides?.unresolvedTargetCount ?? 0;
  const lower =
    validCount === 0 ? null : (confirmedMentionCount / validCount) * 100;
  const upper =
    validCount === 0
      ? null
      : ((confirmedMentionCount + unresolvedTargetCount) / validCount) * 100;
  return {
    validCount,
    confirmedMentionCount,
    unresolvedTargetCount,
    visibilityLowerBoundPct: lower,
    visibilityUpperBoundPct: upper,
    confirmedTop3Count: confirmedMentionCount,
    top3UncertainCount: unresolvedTargetCount,
    top3LowerBoundPct: lower,
    top3UpperBoundPct: upper,
  };
}

function group(
  intentType: string,
  overrides?: Parameters<typeof bounds>[0],
): EntityFactsV2ReadQuestionGroupDTO {
  return { intentType, questionCount: 3, ...bounds(overrides) };
}

function dto(overrides?: Partial<EntityFactsV2ReadGatewayDTO>): EntityFactsV2ReadGatewayDTO {
  return {
    gatewayVersion: "0.1",
    generatedAt: "2026-09-22T00:00:00.000Z",
    business: {
      id: "c9cb39d5-9f04-46ec-8018-14156670446d",
      name: "카스페이스 구로점",
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
      totalJobs: 24,
      completedJobs: 24,
      failedJobs: 0,
    },
    overview: {
      ...bounds({ validCount: 24, confirmedMentionCount: 1, unresolvedTargetCount: 6 }),
      measurementCount: 24,
      invalidCount: 0,
      questionCount: 24,
      coveredQuestionCount: 1,
      unresolvedQuestionCount: 6,
      missingQuestionCount: 17,
      sourcePartialMeasurementCount: 6,
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

function carspaceFixture(): EntityFactsV2ReadGatewayDTO {
  return dto({
    observedSourcesStatus: "available",
    observedSources: [
      {
        domain: "hunnytip.kr",
        responseCount: 4,
        targetResponseCount: 0,
        competitorResponseCount: 3,
        clueResponseCount: 1,
        evidence: "confirmed",
        linkedEntities: [
          { name: "함께 관찰된 업체", isTarget: false, responseCount: 3, evidence: "confirmed" },
        ],
      },
      {
        domain: "clue-only.example.com",
        responseCount: 2,
        targetResponseCount: 0,
        competitorResponseCount: 2,
        clueResponseCount: 2,
        evidence: "clue",
        linkedEntities: [
          { name: "단서 업체", isTarget: false, responseCount: 2, evidence: "clue" },
        ],
      },
    ],
    questionGroups: [
      group("comparison", { confirmedMentionCount: 1, unresolvedTargetCount: 1 }),
      group("discovery", { unresolvedTargetCount: 1 }),
      group("local", { unresolvedTargetCount: 1 }),
      group("price_value", { unresolvedTargetCount: 1 }),
      group("recommendation", { unresolvedTargetCount: 1 }),
      group("review_quality", { unresolvedTargetCount: 1 }),
      group("service", { confirmedMentionCount: 0, unresolvedTargetCount: 0 }),
      group("trust", { confirmedMentionCount: 0, unresolvedTargetCount: 0 }),
    ],
  });
}

describe("Entity Facts v2 priority View Model", () => {
  it("builds the 카스페이스-shaped priority order with ranks [1,2,3]", () => {
    const vm = buildEntityFactsV2PriorityViewModel(carspaceFixture());

    expect(vm.version).toBe("0.1");
    expect(vm.heading).toBe("지금 어디부터 볼까요?");
    expect(vm.items.map((i) => i.kind)).toEqual([
      "confirmed_source_gap",
      "identity_check",
      "question_coverage_gap",
    ]);
    expect(vm.items.map((i) => i.rank)).toEqual([1, 2, 3]);

    const sourceGap = vm.items[0];
    expect(sourceGap.sourceDomain).toBe("hunnytip.kr");
    expect(sourceGap.whyText).toBe(
      "hunnytip.kr에서는 내 업체 연결이 확인되지 않았지만, 함께 관찰된 업체 연결이 AI 답변 3건에서 확인됐습니다.",
    );
    expect(sourceGap.evidenceText).toBe(
      "hunnytip.kr · 함께 관찰된 업체 연결 3건",
    );
    expect(sourceGap.whyText).not.toContain("함께 관찰된 업체,");

    const identity = vm.items[1];
    expect(identity.evidenceText).toBe("6개 검색 상황 · 추가 확인 6건");
    expect(identity.intentTypes).toHaveLength(6);
    // 상위 최대 3개 라벨만 문구에 사용
    expect(identity.whyText).toContain("질문에서 내 업체와 동일한지 추가 확인이 필요한 응답이 있습니다.");

    const coverage = vm.items[2];
    expect(coverage.intentTypes.sort()).toEqual(["service", "trust"]);
    expect(coverage.evidenceText).toBe("2개 검색 상황 · 총 6개 질문에서 확정 노출 없음");
  });

  it("does not treat a confirmed source with target connection as a source gap", () => {
    const vm = buildEntityFactsV2PriorityViewModel(
      dto({
        observedSourcesStatus: "available",
        observedSources: [
          {
            domain: "connected.example.com",
            responseCount: 5,
            targetResponseCount: 2,
            competitorResponseCount: 3,
            clueResponseCount: 0,
            evidence: "confirmed",
            linkedEntities: [
              { name: "내 업체", isTarget: true, responseCount: 2, evidence: "confirmed" },
              { name: "다른 업체", isTarget: false, responseCount: 3, evidence: "confirmed" },
            ],
          },
        ],
      }),
    );
    expect(vm.items.find((i) => i.kind === "confirmed_source_gap")).toBeUndefined();
  });

  it("excludes clue-only sources from source gap", () => {
    const vm = buildEntityFactsV2PriorityViewModel(
      dto({
        observedSourcesStatus: "available",
        observedSources: [
          {
            domain: "clue-only.example.com",
            responseCount: 2,
            targetResponseCount: 0,
            competitorResponseCount: 2,
            clueResponseCount: 2,
            evidence: "clue",
            linkedEntities: [
              { name: "단서 업체", isTarget: false, responseCount: 2, evidence: "clue" },
            ],
          },
        ],
      }),
    );
    expect(vm.items.find((i) => i.kind === "confirmed_source_gap")).toBeUndefined();
  });

  it("pulls identity to rank 1 when there is no source gap", () => {
    const vm = buildEntityFactsV2PriorityViewModel(
      dto({
        questionGroups: [group("local", { unresolvedTargetCount: 2 })],
      }),
    );
    expect(vm.items).toHaveLength(1);
    expect(vm.items[0].kind).toBe("identity_check");
    expect(vm.items[0].rank).toBe(1);
  });

  it("omits the identity card when no group has unresolved targets", () => {
    const vm = buildEntityFactsV2PriorityViewModel(
      dto({
        questionGroups: [
          group("service", { confirmedMentionCount: 0, unresolvedTargetCount: 0 }),
        ],
      }),
    );
    expect(vm.items.find((i) => i.kind === "identity_check")).toBeUndefined();
    expect(vm.items[0].kind).toBe("question_coverage_gap");
    expect(vm.items[0].rank).toBe(1);
  });

  it("omits the coverage card when every group has confirmed or unresolved targets", () => {
    const vm = buildEntityFactsV2PriorityViewModel(
      dto({
        questionGroups: [
          group("service", { confirmedMentionCount: 1 }),
          group("local", { unresolvedTargetCount: 1 }),
        ],
      }),
    );
    expect(vm.items.find((i) => i.kind === "question_coverage_gap")).toBeUndefined();
    expect(vm.items).toHaveLength(1);
  });

  it("returns empty items when nothing applies and keeps the description", () => {
    const vm = buildEntityFactsV2PriorityViewModel(dto());
    expect(vm.items).toEqual([]);
    expect(vm.description).toBe(
      "최근 측정에서 확인된 근거만으로 먼저 살펴볼 항목을 정리했습니다.",
    );
  });

  it("never leaks internal fields or scoring vocabulary into the output", () => {
    const json = JSON.stringify(buildEntityFactsV2PriorityViewModel(carspaceFixture()));
    for (const banned of [
      "was_client_mentioned",
      "client_position",
      "significance",
      "benchmark",
      "score",
    ]) {
      expect(json).not.toContain(banned);
    }
  });

  it("wires only the v2-native priority ViewModel into the dashboard", () => {
    const dashboardSource = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(dashboardSource).toContain(
      'import { buildEntityFactsV2PriorityViewModel } from "@/lib/entity-facts-v2-priority.viewmodel";',
    );
    expect(dashboardSource).toContain(
      "const priorityModel = dto ? buildEntityFactsV2PriorityViewModel(dto) : null;",
    );
    expect(dashboardSource).toContain(
      "<PrioritySection model={priorityModel} />",
    );
    expect(dashboardSource).toContain("지금 어디부터 볼까요?");
    expect(dashboardSource).toContain("왜 먼저 보나요?");
    expect(dashboardSource).toContain("무엇을 확인하면 되나요?");
    expect(dashboardSource).not.toContain("ActionRecommendationsSection");
    expect(dashboardSource).not.toContain("getActionRecommendations");
    expect(dashboardSource).not.toContain("visibility-actions");
    expect(dashboardSource).not.toContain("was_client_mentioned");
    expect(dashboardSource).not.toContain("client_position");
  });
});
