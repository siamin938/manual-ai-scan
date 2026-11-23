import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "../../src/lib/entity-facts-v2-read-gateway.types";
import {
  buildCustomerEvidenceReadFromCurrentRun,
  isCustomerEvidenceInsightId,
} from "../../src/lib/action-opportunity-v1.customer-read";

const userId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const businessId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const measuredAt = "2026-10-05T06:00:00Z";

function fixture(args: {
  verified?: "complete" | "pending" | "not_verified";
  confirmedCount?: number;
  coreAbsent?: boolean;
} = {}): EntityFactsV2ReadGatewayDTO {
  const confirmedCount = args.confirmedCount ?? 3;
  const areas: EntityFactsV2ReadQuestionAreaDTO[] = Array.from(
    { length: 24 },
    (_, i) => {
      const confirmed =
        i >= 8 && i < 8 + confirmedCount ? 1 : 0;
      return {
        questionId: `question-${i}`,
        questionText: i === 0
          ? "경기에서 PPF 맡길 곳 추천해줘"
          : `경기/안산 PPF 질문 ${i + 1}`,
        intentType: "local",
        status: confirmed ? "covered" : "missing",
        validCount: 1,
        confirmedMentionCount: confirmed,
        unresolvedTargetCount: 0,
        visibilityLowerBoundPct: confirmed ? 100 : 0,
        visibilityUpperBoundPct: confirmed ? 100 : 0,
        confirmedTop3Count: confirmed,
        top3UncertainCount: 0,
        top3LowerBoundPct: confirmed ? 100 : 0,
        top3UpperBoundPct: confirmed ? 100 : 0,
      };
    },
  );
  const pct = Math.round((confirmedCount / 24) * 10000) / 100;
  const dto: EntityFactsV2ReadGatewayDTO = {
    gatewayVersion: "0.1",
    generatedAt: "2026-10-05T06:01:00Z",
    business: {
      id: businessId, name: "씽카스게러지 안산점",
      category: "PPF", region: "경기", city: "안산",
    },
    scope: {
      runId, runName: "통합 진단",
      questionSetName: "AI 진단 질문 · 씽카스게러지 안산점 · 2026-10-05",
      measuredAt, providers: ["openai"], repetitions: 1,
      totalJobs: 24, completedJobs: 24, failedJobs: 0,
    },
    overview: {
      validCount: 24,
      confirmedMentionCount: confirmedCount,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: pct,
      visibilityUpperBoundPct: pct,
      confirmedTop3Count: confirmedCount,
      top3UncertainCount: 0,
      top3LowerBoundPct: pct,
      top3UpperBoundPct: pct,
      measurementCount: 24,
      invalidCount: 0,
      questionCount: 24,
      coveredQuestionCount: confirmedCount,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 24 - confirmedCount,
      sourcePartialMeasurementCount: 0,
    },
    questionGroups: [{
      intentType: "local", questionCount: 24, validCount: 24,
      confirmedMentionCount: confirmedCount, unresolvedTargetCount: 0,
      visibilityLowerBoundPct: pct, visibilityUpperBoundPct: pct,
      confirmedTop3Count: confirmedCount, top3UncertainCount: 0,
      top3LowerBoundPct: pct, top3UpperBoundPct: pct,
    }],
    questionAreas: areas,
    questionLocations: areas.map((row, i) => ({
      questionId: row.questionId,
      city: args.coreAbsent && i === 0 ? "안산" : i < 8 ? null : "안산",
    })),
    competitors: [{
      name: "원투 랩핑 PPF",
      responseCount: 4,
      top3ResponseCount: 3,
      questionCount: 4,
      intentCount: 2,
    }],
    targetSources: [],
    observedSourcesStatus: "available",
    observedSources: [],
    verifiedTargetCitationPageStatus: args.verified ?? "complete",
  };
  if (!args.verified || args.verified === "complete") {
    dto.verifiedTargetCitationPages = [];
  }
  return dto;
}

function request(
  dto: EntityFactsV2ReadGatewayDTO,
  insightId: "broad_scope_gap" | "verified_page_zero" | "repeated_competitor" | "top3_unconfirmed",
  overrides: Partial<{
    userId: string; orgId: string; businessId: string; expectedRunId: string;
  }> = {},
) {
  return buildCustomerEvidenceReadFromCurrentRun({
    userId, orgId, businessId, expectedRunId: runId,
    ...overrides,
    insightId,
    dto,
  });
}

describe("customer v1 evidence read: current representative Run only", () => {
  it("accepts only explicitly supported owner summary insight ids", () => {
    for (const id of ["zero_confirmed", "broad_scope_gap", "verified_page_zero", "repeated_competitor", "top3_unconfirmed"]) {
      expect(isCustomerEvidenceInsightId(id)).toBe(true);
    }
    for (const id of [null, "", "verified_page_present", "competitor_source_difference", "__proto__", 42]) {
      expect(isCustomerEvidenceInsightId(id)).toBe(false);
    }
  });

  it("recomputes and returns Core 0/8 and Custom 3/16 from the stored current Run", () => {
    const response = request(fixture(), "broad_scope_gap");
    expect(response?.ok).toBe(true);
    expect(response?.scope).toEqual({
      orgId, businessId, runId, insightId: "broad_scope_gap",
    });
    expect(response?.detail.evidence).toContainEqual({
      label: "기준 검색 확정", value: "0/8",
    });
    expect(response?.detail.evidence).toContainEqual({
      label: "맞춤 검색 확정", value: "3/16",
    });
    const serialized = JSON.stringify(response?.detail);
    expect(serialized).not.toMatch(/"rank"|"priority"|"confidence"|"threshold"|"visibility"|"url"|"internal_only"/iu);
    expect(response?.detail.recommendedCheck.length).toBeGreaterThan(0);
  });

  it("returns the verified-page gap only for completed verification plus 0 pages", () => {
    const completed = request(fixture(), "verified_page_zero");
    expect(completed?.detail.evidence).toEqual([
      { label: "페이지 검증 상태", value: "완료" },
      { label: "확정 관련 페이지", value: "0개" },
    ]);
    expect(request(fixture({ verified: "pending" }), "verified_page_zero")).toBeNull();
    expect(request(fixture({ verified: "not_verified" }), "verified_page_zero")).toBeNull();
  });

  it("cannot request other v1 cards that are not one of the current dashboard's first two insights", () => {
    // A repeated competitor exists in this run, but does not appear in the
    // compact summary's first two items. The endpoint must not disclose it.
    expect(request(fixture(), "repeated_competitor")).toBeNull();
    expect(request(fixture(), "top3_unconfirmed")).toBeNull();
  });

  it("requires exact current business and representative Run scope", () => {
    const dto = fixture();
    expect(request(dto, "broad_scope_gap", { businessId: "99999999-9999-4999-8999-999999999999" })).toBeNull();
    expect(request(dto, "broad_scope_gap", { expectedRunId: "99999999-9999-4999-8999-999999999999" })).toBeNull();
    expect(request({ ...dto, scope: { ...dto.scope, runId: "99999999-9999-4999-8999-999999999999" } }, "broad_scope_gap")).toBeNull();
    expect(request(dto, "broad_scope_gap", { userId: "" })).toBeNull();
    expect(request(dto, "broad_scope_gap", { orgId: "" })).toBeNull();
  });

  it("does not label incomplete 8+16 metadata as a valid broad scope observation", () => {
    expect(request(fixture({ coreAbsent: true }), "broad_scope_gap")).toBeNull();
    const withoutLocations = fixture();
    delete withoutLocations.questionLocations;
    expect(request(withoutLocations, "broad_scope_gap")).toBeNull();
  });

  it("does not assign completed-0-page status to pending evidence but keeps valid broader gap", () => {
    const dto = fixture({ verified: "pending" });
    const result = request(dto, "broad_scope_gap");
    expect(result?.ok).toBe(true);
    expect(JSON.stringify(result?.detail)).not.toMatch(/"페이지 검증 상태":"완료"/u);
  });

  it("uses only the verified response safe fields and does not mount customer v1 UI", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const fn = read("src/lib/action-opportunity-v1.customer-read.functions.ts");
    const pure = read("src/lib/action-opportunity-v1.customer-read.ts");
    const dashboard = read("src/routes/_authenticated/dashboard.tsx");
    const admin = read("src/lib/action-opportunity-v1.dashboard-private.functions.ts");
    expect(fn).toContain('method: "POST"');
    expect(fn).toContain(".middleware([requireSupabaseAuth])");
    expect(fn).toContain('.from("organization_members")');
    expect(fn).toContain('.eq("user_id", context.userId)');
    expect(fn).toContain('.from("businesses")');
    expect(fn).toContain('.eq("org_id", data.orgId)');
    expect(fn).toContain('.eq("id", data.businessId)');
    expect(fn).toContain('.eq("is_client_business", true)');
    expect(fn).toContain('.eq("active", true)');
    expect(fn).toContain("gateway.data.scope.runId !== data.expectedRunId");
    expect(fn).toContain("buildCustomerEvidenceReadFromCurrentRun({");
    expect(fn.indexOf("if (!membership)")).toBeLessThan(fn.indexOf("fetchEntityFactsV2ReadGateway({"));
    expect(fn.indexOf("if (!business || business.id")).toBeLessThan(fn.indexOf("fetchEntityFactsV2ReadGateway({"));
    expect(pure).toContain("buildCompactSummaryInsights(summary)");
    expect(pure).toContain("buildActionOpportunityV1Preview(dto)");
    expect(pure).toContain("buildV1CustomerEvidenceCandidate({");
    expect(pure).not.toContain("fetchActionOpportunityEvidence");
    expect(dashboard).not.toContain("getActionOpportunityV1CustomerEvidence");
    expect(dashboard).not.toContain("buildCustomerEvidenceReadFromCurrentRun");
    expect(admin).toContain('rpc("can_view_data_asset_admin_v01")');
    for (const code of [fn, pure]) {
      for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "enqueueRun(", "measurement_credit_accounts", "fetchActionOpportunityEvidence(", ".rpc("]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });
});
