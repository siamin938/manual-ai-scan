import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEntityFactsV2MetricComparison,
  isEntityFactsV2TrendEligible,
} from "../../src/lib/entity-facts-v2-comparison.types";

const serverSource = readFileSync(
  resolve(process.cwd(), "src/lib/entity-facts-v2-comparison.server.ts"),
  "utf8",
);
const functionsSource = readFileSync(
  resolve(process.cwd(), "src/lib/entity-facts-v2-comparison.functions.ts"),
  "utf8",
);
const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
  "utf8",
);
const comparisonCardSource = readFileSync(
  resolve(process.cwd(), "src/components/diagnostic-comparison-card.tsx"),
  "utf8",
);

describe("Entity Facts v2 comparison contract", () => {
  it("calculates change only from confirmed lower-bound truth", () => {
    const result = buildEntityFactsV2MetricComparison(
      {
        validCount: 24,
        confirmedCount: 4,
        unresolvedCount: 2,
        confirmedPct: 16.67,
        maxPct: 25,
      },
      {
        validCount: 24,
        confirmedCount: 7,
        unresolvedCount: 0,
        confirmedPct: 29.17,
        maxPct: 29.17,
      },
    );

    expect(result.confirmedDeltaPctPoints).toBe(-12.5);
    expect(result.current.confirmedPct).toBe(16.67);
    expect(result.current.maxPct).toBe(25);
    expect(result.previous?.confirmedPct).toBe(29.17);
  });

  it("calculates percentage-point change from exact counts, not rounded display percentages", () => {
    const result = buildEntityFactsV2MetricComparison(
      {
        validCount: 24,
        confirmedCount: 2,
        unresolvedCount: 0,
        confirmedPct: 8.33,
        maxPct: 8.33,
      },
      {
        validCount: 24,
        confirmedCount: 1,
        unresolvedCount: 0,
        confirmedPct: 4.17,
        maxPct: 4.17,
      },
    );

    expect(result.confirmedDeltaPctPoints).toBe(4.17);
  });

  it("does not invent a delta without a verified previous run", () => {
    const result = buildEntityFactsV2MetricComparison(
      {
        validCount: 24,
        confirmedCount: 1,
        unresolvedCount: 6,
        confirmedPct: 4.17,
        maxPct: 29.17,
      },
      null,
    );

    expect(result.confirmedDeltaPctPoints).toBeNull();
  });

  it("enables a trend only after at least three compatible runs", () => {
    expect(isEntityFactsV2TrendEligible(0)).toBe(false);
    expect(isEntityFactsV2TrendEligible(1)).toBe(false);
    expect(isEntityFactsV2TrendEligible(2)).toBe(false);
    expect(isEntityFactsV2TrendEligible(3)).toBe(true);
    expect(isEntityFactsV2TrendEligible(6)).toBe(true);
  });

  it("selects only customer standalone completed audits for current and prior runs", () => {
    expect(
      serverSource.match(/\.eq\("diagnostic_scope", "customer"\)/gu)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(serverSource.match(/\.eq\("run_type", "audit"\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(serverSource.match(/\.eq\("phase", "standalone"\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(serverSource.match(/\.eq\("status", "completed"\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(serverSource.match(/\.is\("experiment_id", null\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(serverSource).toContain(
      '.order("completed_at", { ascending: false })',
    );
    expect(serverSource).not.toContain("get_compatible_audit_runs_v01");
  });

  it("requires durable request fingerprints and never infers missing history", () => {
    expect(serverSource).toContain('.from("measurement_request_contracts")');
    expect(serverSource).toContain(
      '.select("job_id, request_fingerprint")',
    );
    expect(serverSource).toContain("REQUEST_FINGERPRINT_RE");
    expect(serverSource).toContain(
      "Missing durable request fingerprints are never inferred",
    );
    expect(serverSource).toContain("if (!currentSignature)");
    expect(serverSource).toContain('status: "unverified"');
    expect(serverSource).toContain(
      'reason: "CURRENT_REQUEST_CONTRACT_UNAVAILABLE"',
    );
  });

  it("compares the full request and parser contract rather than question count alone", () => {
    expect(serverSource).toContain("questionSetId: run.question_set_id");
    expect(serverSource).toContain("selectedProviders:");
    expect(serverSource).toContain("repetitions: run.repetitions");
    expect(serverSource).toContain("dataOrigin: run.data_origin");
    expect(serverSource).toContain("providerModel: job.provider_model");
    expect(serverSource).toContain("requestFingerprint");
    expect(serverSource).toContain("parserVersions");
    expect(serverSource).toContain(
      "engineVersion: ENTITY_FACTS_V2_READ_ENGINE_VERSION",
    );
    expect(serverSource).toContain("signature !== currentSignature");
  });

  it("reads only parser metadata from legacy measurements and never legacy visibility truth", () => {
    expect(serverSource).toContain('.from("measurements")');
    expect(serverSource).toContain(
      '.select("run_id, job_id, parser_version")',
    );
    expect(serverSource).not.toContain(
      '.select("id, run_id, question_id, was_client_mentioned")',
    );
    expect(serverSource).not.toContain(
      '.select("run_id, was_client_mentioned")',
    );
    expect(serverSource).not.toContain(
      '.select("client_position")',
    );
  });

  it("uses only the exact current customer run v2 aggregate and never falls back", () => {
    expect(serverSource).toContain(
      '.from("run_entity_fact_aggregates_v2")',
    );
    expect(serverSource).toContain(
      '.eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION)',
    );
    expect(serverSource).toContain(
      '.eq("aggregate_version", ENTITY_FACTS_V2_READ_AGGREGATE_VERSION)',
    );
    expect(serverSource).toContain(
      '.eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION)',
    );
    expect(serverSource).toContain('.eq("contract_ok", true)');
    expect(serverSource).toContain(
      "aggregateRowsByRun.get(currentRun.id)",
    );
    expect(serverSource).toContain(
      "Never fall back to an older",
    );
    expect(serverSource).toContain(
      'reason: "CURRENT_V2_UNAVAILABLE"',
    );
  });

  it("checks membership before entering the server-only comparison reader", () => {
    const membershipIndex = functionsSource.indexOf(
      '.from("organization_members")',
    );
    const fetchIndex = functionsSource.indexOf(
      "return fetchEntityFactsV2Comparison",
    );
    expect(membershipIndex).toBeGreaterThan(0);
    expect(fetchIndex).toBeGreaterThan(membershipIndex);
    expect(functionsSource).toContain('.eq("user_id", context.userId)');
    expect(functionsSource).toContain(
      'if (!membership) return { ok: false, error: "FORBIDDEN" };',
    );
  });

  it("adds unified search-scope detail only after verified compatible-run matching", () => {
    expect(serverSource).toContain("buildUnifiedDiagnosticLayerSummary");
    expect(serverSource).toContain("questionChangeCounts");
    expect(serverSource).toContain('.from("questions")');
    expect(serverSource).toContain('.select("id, city")');
    expect(serverSource).toContain("currentUnifiedSet?.id === currentRun.question_set_id");
    expect(serverSource).toContain("Search-scope detail is supplemental");
    expect(serverSource).toContain("searchScope = {");
    expect(serverSource).toContain("newlyConfirmedQuestionCount");
    expect(serverSource).toContain("noLongerConfirmedQuestionCount");
    expect(comparisonCardSource).toContain("검색 유형별 변화");
    expect(comparisonCardSource).toContain("새로 등장");
    expect(comparisonCardSource).toContain("이번에 등장 미확인");
    expect(comparisonCardSource).toContain("이전에는 확정됐지만 이번에는 확정되지 않은 질문");
    expect(comparisonCardSource).toContain("변화의 원인을");
  });

  it("wires the customer-safe comparison path into the dashboard without legacy repeat truth", () => {
    expect(dashboardSource).toContain("getEntityFactsV2Comparison");
    expect(dashboardSource).toContain(
      "buildEntityFactsV2ComparisonViewModel",
    );
    expect(dashboardSource).toContain(
      'queryKey: ["entity-facts-v2-comparison", activeOrgId, businessId]',
    );
    expect(dashboardSource).not.toContain("getVisibilityRepeatAggregate");
    expect(dashboardSource).not.toContain("getVisibilityRepeatContext");
    expect(dashboardSource).not.toContain("was_client_mentioned");
    expect(dashboardSource).not.toContain("client_position");
  });
});
