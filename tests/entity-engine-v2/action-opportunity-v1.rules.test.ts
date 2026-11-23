import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildActionOpportunityV1Preview } from "../../src/lib/action-opportunity-v1.rules";
import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "../../src/lib/entity-facts-v2-read-gateway.types";

function fixture(coreHits = 0, customHits = 16): EntityFactsV2ReadGatewayDTO {
  const totalHits = coreHits + customHits;
  const questionAreas: EntityFactsV2ReadQuestionAreaDTO[] =
    Array.from({ length: 24 }, (_, index) => {
      const found = index < 8 ? index < coreHits : index - 8 < customHits;
      return {
        questionId: "question-" + (index + 1),
        questionText: "측정 질문 " + (index + 1),
        intentType: "local",
        status: found ? "covered" : "missing",
        validCount: 1,
        confirmedMentionCount: found ? 1 : 0,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: found ? 100 : 0,
        visibilityUpperBoundPct: found ? 100 : 0,
        confirmedTop3Count: found ? 1 : 0,
        top3UncertainCount: 0,
        top3LowerBoundPct: found ? 100 : 0,
        top3UpperBoundPct: found ? 100 : 0,
      };
    });

  return {
    gatewayVersion: "0.1",
    generatedAt: "2026-10-09T00:00:00.000Z",
    business: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "테스트 업체",
      category: "PPF",
      region: "경기",
      city: "안산",
    },
    scope: {
      runId: "22222222-2222-4222-8222-222222222222",
      runName: "통합 진단",
      measuredAt: "2026-10-08T00:00:00.000Z",
      providers: ["openai"],
      repetitions: 1,
      totalJobs: 24,
      completedJobs: 24,
      failedJobs: 0,
    },
    questionLocations: questionAreas.map((row, index) => ({
      questionId: row.questionId,
      city: index < 8 ? null : "안산",
    })),
    overview: {
      measurementCount: 24,
      invalidCount: 0,
      questionCount: 24,
      coveredQuestionCount: totalHits,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 24 - totalHits,
      sourcePartialMeasurementCount: 0,
      validCount: 24,
      confirmedMentionCount: totalHits,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: totalHits * 100 / 24,
      visibilityUpperBoundPct: totalHits * 100 / 24,
      confirmedTop3Count: totalHits,
      top3UncertainCount: 0,
      top3LowerBoundPct: totalHits * 100 / 24,
      top3UpperBoundPct: totalHits * 100 / 24,
    },
    questionGroups: [],
    questionAreas,
    competitors: [],
    targetSources: [],
    verifiedTargetCitationPageStatus: "not_verified",
    observedSourcesStatus: "not_materialized",
    observedSources: [],
  };
}

const ids = (dto: EntityFactsV2ReadGatewayDTO) =>
  buildActionOpportunityV1Preview(dto).items.map((item) => item.id);

describe("Action Opportunity v1.0 internal deterministic dry-run", () => {
  it("finds 카스페이스 구로점 pattern Core 0/8 vs Custom 16/16", () => {
    const dto = fixture(0, 16);
    const result = buildActionOpportunityV1Preview(dto);
    expect(ids(dto)).toContain("core_exposure_gap");
    const item = result.items.find((row) => row.id === "core_exposure_gap")!;
    expect(item.priority).toBe("high");
    expect(item.observation).toContain("기준 검색 8개 답변에서는 확정 노출이 확인되지 않았습니다");
    expect(item.evidence).toContainEqual({ label: "맞춤 검색 확정", value: "16/16" });
    expect(item.evidence).toContainEqual({
      label: "기준 검색 질문 예",
      value: "측정 질문 1",
    });
    expect(item.observation).toContain("기준 검색 8개 답변에서는 확정 노출이 확인되지 않았습니다");
    expect(item.scope.runId).toBe(dto.scope.runId);
    expect(result.mode).toBe("internal_dry_run");
  });

  it("finds 씽카스게러지 pattern: Core gap, completed zero pages and competitor recurrence", () => {
    const dto = fixture(0, 3);
    dto.verifiedTargetCitationPageStatus = "complete";
    dto.verifiedTargetCitationPages = [];
    dto.competitors = [{
      name: "원투 랩핑 PPF",
      responseCount: 4,
      questionCount: 4,
      intentCount: 2,
      top3ResponseCount: 2,
    }];
    expect(ids(dto)).toEqual([
      "core_exposure_gap",
      "verified_citation_page_gap",
      "repeated_competitor",
    ]);
    expect(buildActionOpportunityV1Preview(dto).items[1]?.observation).toContain("0개");
  });

  it("only emits objective zero visibility for a fully resolved 24/24 Run", () => {
    const dto = fixture(0, 0);
    expect(ids(dto)).toEqual(["zero_confirmed_visibility"]);
    dto.overview.unresolvedTargetCount = 1;
    expect(ids(dto)).not.toContain("zero_confirmed_visibility");
  });

  it("never treats pending, legacy not_verified, or missing page rows as zero verified pages", () => {
    const dto = fixture(1, 4);
    for (const status of ["pending", "not_verified"] as const) {
      dto.verifiedTargetCitationPageStatus = status;
      dto.verifiedTargetCitationPages = [];
      expect(ids(dto)).not.toContain("verified_citation_page_gap");
    }
    dto.verifiedTargetCitationPageStatus = "complete";
    dto.verifiedTargetCitationPages = undefined;
    expect(ids(dto)).not.toContain("verified_citation_page_gap");
  });

  it("fails closed for incomplete/unresolved Core classification", () => {
    const dto = fixture(0, 10);
    dto.questionLocations = undefined;
    expect(ids(dto)).not.toContain("core_exposure_gap");
    const again = fixture(0, 10);
    again.questionAreas[0]!.unresolvedTargetCount = 1;
    again.overview.unresolvedTargetCount = 1;
    expect(ids(again)).not.toContain("core_exposure_gap");
  });

  it("shows Top3 gap only when all Top3 positions have determinate outcomes", () => {
    const dto = fixture(1, 3);
    dto.overview.confirmedTop3Count = 0;
    expect(ids(dto)).toContain("top3_confirmation_gap");
    dto.overview.top3UncertainCount = 1;
    expect(ids(dto)).not.toContain("top3_confirmation_gap");
  });

  it("uses confirmed repeated competitor-only domains and rejects clue evidence", () => {
    const dto = fixture(0, 3);
    dto.observedSourcesStatus = "available";
    dto.observedSources = [{
      domain: "example.com",
      responseCount: 3,
      targetResponseCount: 0,
      competitorResponseCount: 3,
      clueResponseCount: 0,
      evidence: "confirmed",
      linkedEntities: [{
        name: "비교 업체",
        isTarget: false,
        responseCount: 3,
        evidence: "confirmed",
      }],
    }];
    expect(ids(dto)).toContain("competitor_source_difference");
    dto.observedSources[0]!.evidence = "clue";
    expect(ids(dto)).not.toContain("competitor_source_difference");
    dto.observedSources[0]!.evidence = "confirmed";
    dto.observedSources[0]!.targetResponseCount = 1;
    expect(ids(dto)).not.toContain("competitor_source_difference");
  });

  it("does not mistake a zero-exposure Run for a citation page opportunity", () => {
    const dto = fixture(0, 0);
    dto.verifiedTargetCitationPageStatus = "complete";
    dto.verifiedTargetCitationPages = [];
    expect(ids(dto)).toEqual(["zero_confirmed_visibility"]);
  });

  it("reproduces current completed 카스페이스 contrast without leaking earlier Runs", () => {
    const dto = fixture(0, 16);
    dto.business.name = "카스페이스 구로점";
    dto.competitors = [{
      name: "퀀텀팩토리 서초점",
      responseCount: 6,
      questionCount: 6,
      intentCount: 6,
      top3ResponseCount: 6,
    }];
    dto.verifiedTargetCitationPageStatus = "complete";
    dto.verifiedTargetCitationPages = Array.from({ length: 5 }, (_, index) => ({
      domain: "example.test",
      title: null,
      responseCount: 1,
      citationCount: 1,
      sampleUrl: "https://example.test/" + index,
      confidence: "high" as const,
      basisLabel: "검증 완료",
    }));
    dto.observedSourcesStatus = "available";
    dto.observedSources = [{
      domain: "carcarescenter.com",
      responseCount: 5,
      targetResponseCount: 0,
      competitorResponseCount: 5,
      clueResponseCount: 0,
      evidence: "confirmed",
      linkedEntities: [{
        name: "퀀텀팩토리 서초점",
        isTarget: false,
        responseCount: 5,
        evidence: "confirmed",
      }],
    }];
    const result = buildActionOpportunityV1Preview(dto);
    expect(result.items.map((row) => row.id)).toEqual([
      "core_exposure_gap",
      "repeated_competitor",
      "competitor_source_difference",
    ]);
    expect(result.items[1]?.observation).toContain("6개에 등장했습니다");
    expect(result.items[2]?.observation).toContain("carcarescenter.com");
  });

  it("reproduces current completed 씽카스게러지 contrast without causal wording", () => {
    const dto = fixture(0, 3);
    dto.business.name = "씽카스게러지 안산점";
    dto.competitors = [{
      name: "원투 랩핑 PPF",
      responseCount: 4,
      questionCount: 4,
      intentCount: 4,
      top3ResponseCount: 4,
    }];
    dto.verifiedTargetCitationPageStatus = "complete";
    dto.verifiedTargetCitationPages = [];
    dto.observedSourcesStatus = "available";
    dto.observedSources = [{
      domain: "daangn.com",
      responseCount: 6,
      targetResponseCount: 0,
      competitorResponseCount: 6,
      clueResponseCount: 0,
      evidence: "confirmed",
      linkedEntities: [{
        name: "원투 랩핑 PPF",
        isTarget: false,
        responseCount: 4,
        evidence: "confirmed",
      }],
    }];
    const result = buildActionOpportunityV1Preview(dto);
    expect(result.items.map((row) => row.id)).toEqual([
      "core_exposure_gap",
      "verified_citation_page_gap",
      "repeated_competitor",
      "competitor_source_difference",
    ]);
    expect(result.items[1]?.observation).toContain("0개");
    expect(result.items[3]?.observation).toContain("daangn.com");
    expect(JSON.stringify(result)).not.toMatch(/노출이 증가합니다|원인입니다|보장합니다/);
  });

  it("remains pure, stable, and scoped to one representative run", () => {
    const dto = fixture(0, 3);
    const unchanged = JSON.stringify(dto);
    const one = buildActionOpportunityV1Preview(dto);
    const two = buildActionOpportunityV1Preview(dto);
    expect(two).toEqual(one);
    expect(JSON.stringify(dto)).toBe(unchanged);
    expect(one.items.every((row) =>
      row.scope.kind === "exact_representative_run" &&
      row.scope.runId === dto.scope.runId
    )).toBe(true);
    expect(JSON.stringify(one)).not.toMatch(/노출이 올라|노출이 증가합니다|보장합니다/);
  });

  it("is wired only into the internal admin result dialog, not customer dashboard", () => {
    const internal = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/internal-observation-pipeline.tsx"),
      "utf8",
    );
    const customer = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(internal).toContain("buildActionOpportunityV1Preview");
    expect(internal).toContain("고객 화면 미노출");
    expect(customer).not.toContain("buildActionOpportunityV1Preview");
  });
});
