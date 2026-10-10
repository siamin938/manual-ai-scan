import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCustomerPreviewV1Model,
  type CustomerPreviewV1Input,
} from "../../src/lib/action-opportunity-v1.customer-preview.viewmodel";
import type {
  ActionOpportunityV1Item,
  ActionOpportunityV1Result,
} from "../../src/lib/action-opportunity-v1.rules";

const runId = "22222222-2222-4222-8222-222222222222";
const measuredAt = "2026-10-05T05:56:14.000Z";

function input(name = "씽카스게러지 안산점", hits = 3): CustomerPreviewV1Input {
  const bounds = {
    validCount: 24,
    confirmedMentionCount: hits,
    confirmedTop3Count: hits,
    unresolvedTargetCount: 0,
    top3UncertainCount: 0,
    visibilityLowerBoundPct: (hits / 24) * 100,
    visibilityUpperBoundPct: (hits / 24) * 100,
    top3LowerBoundPct: (hits / 24) * 100,
    top3UpperBoundPct: (hits / 24) * 100,
  };
  return {
    business: {
      id: "11111111-1111-4111-8111-111111111111",
      name,
      category: "PPF",
      region: "경기",
      city: "안산",
    },
    scope: {
      runId,
      runName: "통합 진단",
      measuredAt,
      providers: ["openai"],
      repetitions: 1,
      totalJobs: 24,
      completedJobs: 24,
      failedJobs: 0,
    },
    overview: {
      ...bounds,
      measurementCount: 24,
      questionCount: 24,
      invalidCount: 0,
      coveredQuestionCount: hits,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 24 - hits,
      sourcePartialMeasurementCount: 0,
    },
    verifiedTargetCitationPageStatus: "complete",
    verifiedTargetCitationPages: [],
  };
}

const ids = [
  "core_exposure_gap",
  "verified_citation_page_gap",
  "repeated_competitor",
  "competitor_source_difference",
] as const;

function opportunity(index: number): ActionOpportunityV1Item {
  return {
    id: ids[index]!,
    rank: index + 1,
    priority: index === 0 ? "high" : "review",
    title: "내부 기술 분석 " + index,
    observation: "이번 측정 " + (index + 1) + "건에서 관찰됨",
    whyItMatters: "확인할 수 있는 관찰 결과입니다.",
    recommendedCheck: "업체 공식 프로필 정보를 확인해 보세요.",
    evidence: [{ label: "실제 관찰", value: String(index + 1) }],
    confidence: "high",
    scope: { kind: "exact_representative_run", runId, measuredAt },
    disclaimer: "인과관계 아님",
  };
}

function result(name = "씽카스게러지 안산점", count = 4): ActionOpportunityV1Result {
  return {
    version: "1.0",
    mode: "internal_dry_run",
    status: "ready",
    runId,
    businessName: name,
    description: "대표 Run",
    disclaimer: "인과관계",
    items: Array.from({ length: count }, (_, index) => opportunity(index)),
  };
}

describe("Action Opportunity v1.0 customer-style private preview", () => {
  it("preserves the observed 3/24, Top3 3/24 and zero verified-page truth", () => {
    const model = buildCustomerPreviewV1Model(input(), result());
    expect(model).not.toBeNull();
    expect(model).toMatchObject({
      visibility: "internal_only",
      businessName: "씽카스게러지 안산점",
      answeredCount: 24,
      confirmedCount: 3,
      top3Count: 3,
      relatedPageLabel: "0개",
    });
    expect(model?.primary.map((row) => row.id)).toEqual(ids.slice(0, 2));
    expect(model?.additional.map((row) => row.id)).toEqual(ids.slice(2));
  });

  it("reproduces 16/24 and 5 verified related pages for another Run-shaped fixture", () => {
    const dto = input("카스페이스 구로점", 16);
    const sample = {
      domain: "example.com",
      title: null,
      responseCount: 1,
      citationCount: 1,
      sampleUrl: "https://example.com/page",
      confidence: "high" as const,
      basisLabel: "지점 확인",
    };
    dto.verifiedTargetCitationPages = Array.from({ length: 5 }, (_, i) => ({
      ...sample, sampleUrl: "https://example.com/" + i,
    }));
    const model = buildCustomerPreviewV1Model(dto, result("카스페이스 구로점", 3));
    expect(model?.confirmedCount).toBe(16);
    expect(model?.relatedPageLabel).toBe("5개");
    expect(model?.primary).toHaveLength(2);
    expect(model?.additional).toHaveLength(1);
  });

  it("never assigns a verified page count to pending or unverified runs", () => {
    const dto = input();
    dto.verifiedTargetCitationPageStatus = "pending";
    expect(buildCustomerPreviewV1Model(dto, result())?.relatedPageLabel).toBe("확인 중");
    dto.verifiedTargetCitationPageStatus = "not_verified";
    expect(buildCustomerPreviewV1Model(dto, result())?.relatedPageLabel).toBe("미검증");
  });

  it("fails closed on mismatched representative run, business, or item scope", () => {
    const dto = input();
    const a = result();
    a.runId = "33333333-3333-4333-8333-333333333333";
    expect(buildCustomerPreviewV1Model(dto, a)).toBeNull();
    expect(buildCustomerPreviewV1Model(dto, result("다른 업체"))).toBeNull();
    const b = result();
    b.items[0]!.scope.measuredAt = "2026-10-04T00:00:00Z";
    expect(buildCustomerPreviewV1Model(dto, b)).toBeNull();
  });

  it("has no fabricated score or technical jargon in customer titles", () => {
    const model = buildCustomerPreviewV1Model(input(), result())!;
    expect(model.primary[0]?.title).toContain("넓은 지역 검색");
    expect(model.primary[1]?.title).toContain("인용된 페이지");
    expect(JSON.stringify(model.primary.map((x) => x.title))).not.toMatch(/Core|Run|Entity Facts|향상 보장/);
    expect(model.additional[1]?.title).toContain("출처");
    expect(model.primary[0]?.rank).toBe(1);
  });

  it("does not mutate the DTO or opportunity result", () => {
    const dto = input();
    const res = result();
    const before = JSON.stringify({ dto, res });
    expect(buildCustomerPreviewV1Model(dto, res)).toEqual(buildCustomerPreviewV1Model(dto, res));
    expect(JSON.stringify({ dto, res })).toBe(before);
  });

  it("is exclusively mounted in the internal admin route, never the customer dashboard", () => {
    const admin = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/internal-observation-pipeline.tsx"),
      "utf8",
    );
    const customer = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    const component = readFileSync(
      resolve(process.cwd(), "src/components/action-opportunity-v1-customer-preview.tsx"),
      "utf8",
    );
    expect(admin).toContain("ActionOpportunityV1CustomerPreview");
    expect(admin).toContain('resultDisplayMode === "customer"');
    expect(admin).toContain("getPilotOpsAdminResult");
    expect(admin).toContain("actionOpportunityRunMismatch");
    expect(component).toContain("판단 근거 살펴보기");
    expect(component).toContain('className="group/evidence mt-4 rounded-lg border"');
    expect(component).toContain("group-open/evidence:hidden");
    expect(component).toContain('className="cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden"');
    expect(component).toContain('className="group/extra rounded-xl border bg-background"');
    expect(component).toContain("group-open/extra:hidden");
    expect(component).toContain('className="cursor-pointer list-none px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden"');
    expect(component).toContain("다른 관찰");
    expect(component).toContain('rel="noopener noreferrer"');
    expect(component).toContain("비공개 미리보기 · 고객에게 미노출");
    expect(customer).not.toContain("ActionOpportunityV1CustomerPreview");
    expect(customer).not.toContain("buildCustomerPreviewV1Model");
  });
});
