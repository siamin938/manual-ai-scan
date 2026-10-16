import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isUnifiedDiagnosticSetName } from "../../src/lib/custom-question-suggestions";
import {
  canDisplayHistoryDetail,
  isMatchingHistoryCatalog,
  enrichMemberHistoryCatalog,
  getHistorySearchScopes,
  isValidHistoryAggregate,
  MEASUREMENT_HISTORY_PAGE_SIZE,
} from "../../src/lib/measurement-history.model";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  type EntityFactsV2ReadGatewayDTO,
} from "../../src/lib/entity-facts-v2-read-gateway.types";

const runId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const businessId = "33333333-3333-4333-8333-333333333333";

function aggregate() {
  return {
    version: "0.1", factsVersion: "0.3", contractOk: true, contractIssues: [],
    overview: {
      validCount: 24, confirmedMentionCount: 3, unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 12.5, visibilityUpperBoundPct: 12.5,
      confirmedTop3Count: 3, top3UncertainCount: 0,
      top3LowerBoundPct: 12.5, top3UpperBoundPct: 12.5,
      measurementCount: 24, invalidCount: 0, questionCount: 24,
      coveredQuestionCount: 3, unresolvedQuestionCount: 0,
      missingQuestionCount: 21, sourcePartialMeasurementCount: 0,
    },
    questionGroups: [{
      intentType: "local", questionCount: 24, validCount: 24,
      confirmedMentionCount: 3, unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 12.5, visibilityUpperBoundPct: 12.5,
      confirmedTop3Count: 3, top3UncertainCount: 0,
      top3LowerBoundPct: 12.5, top3UpperBoundPct: 12.5,
    }],
    questionAreas: [{
      questionId: "44444444-4444-4444-8444-444444444444",
      questionText: "안산에서 PPF 맡길 곳 추천해줘", intentType: "local",
      status: "covered", validCount: 1, confirmedMentionCount: 1,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 100, visibilityUpperBoundPct: 100,
      confirmedTop3Count: 1, top3UncertainCount: 0,
      top3LowerBoundPct: 100, top3UpperBoundPct: 100,
    }],
    competitors: [{
      canonicalKey: "auto:원투랩핑", responseCount: 4, questionCount: 4,
      intentCount: 2, top3ResponseCount: 3,
    }],
    targetSources: [], qualityFlagCounts: {},
  };
}

function storage() {
  return {
    requestedRunId: runId, sourceRunId: runId,
    factVersion: ENTITY_FACTS_V2_READ_FACT_VERSION,
    aggregateVersion: ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
    engineVersion: ENTITY_FACTS_V2_READ_ENGINE_VERSION,
    measurementCount: 24, validMeasurementCount: 24,
    contractOk: true, aggregate: aggregate(),
  };
}

describe("Read-only measurement history", () => {
  it("accepts a validated snapshot only when it belongs to the selected Run", () => {
    expect(isValidHistoryAggregate(storage())).toBe(true);
    expect(isValidHistoryAggregate({ ...storage(), requestedRunId: orgId })).toBe(false);
    expect(isValidHistoryAggregate({ ...storage(), sourceRunId: businessId })).toBe(false);
    expect(isValidHistoryAggregate({ ...storage(), engineVersion: "stale" })).toBe(false);
    expect(isValidHistoryAggregate({ ...storage(), validMeasurementCount: 23 })).toBe(false);
    expect(isValidHistoryAggregate({ ...storage(), contractOk: false })).toBe(false);
    expect(isValidHistoryAggregate({ ...storage(), aggregate: { overview: { validCount: 24 } } })).toBe(false);
  });

  it("shows a member-authorized catalog even when the optional snapshot index is unavailable", () => {
    const response = {
      ok: true as const,
      data: {
        orgId,
        businessId,
        page: 0,
        snapshotStatus: "temporarily_unavailable" as const,
        hasNextPage: false,
        runs: [
          {
            runId,
            runName: "완료된 고객 측정",
            measuredAt: "2026-09-27T05:43:12Z",
            status: "not_available" as const,
            validCount: null,
            confirmedCount: null,
            top3Count: null,
          },
        ],
      },
    };
    expect(isMatchingHistoryCatalog({ orgId, businessId, page: 0, response })).toBe(true);
    expect(isMatchingHistoryCatalog({ orgId, businessId, page: 1, response })).toBe(false);
    expect(isMatchingHistoryCatalog({ orgId, businessId: "another-business", page: 0, response })).toBe(false);
    expect(isMatchingHistoryCatalog({ orgId: "another-org", businessId, page: 0, response })).toBe(false);
    expect(isMatchingHistoryCatalog({ orgId, businessId, page: 0, response: undefined })).toBe(false);
    expect(isMatchingHistoryCatalog({ orgId, businessId, page: 0, response: { ok: false, error: "FORBIDDEN" } })).toBe(false);
  });

  it("reads the catalog dates with the authenticated RLS client before optional admin snapshot lookups", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const server = at("src/lib/measurement-history.server.ts");
    const wrapper = at("src/lib/measurement-history.functions.ts");
    const view = at("src/routes/_authenticated/measurement-history.tsx");

    const catalogStart = server.indexOf("export async function fetchMeasurementHistoryCatalog(");
    const catalogEnd = server.indexOf("function getBusinessIdFromKey(");
    expect(catalogStart).toBeGreaterThan(-1);
    expect(catalogEnd).toBeGreaterThan(catalogStart);
    const catalog = server.slice(catalogStart, catalogEnd);
    expect(catalog).toContain('memberClient\n    .from("businesses")');
    expect(catalog).toContain('memberClient\n    .from("measurement_runs")');
    expect(catalog).toContain('.eq("org_id", orgId).eq("business_id", businessId)');
    expect(catalog.indexOf('.from("measurement_runs")')).toBeLessThan(
      catalog.indexOf('.from("run_entity_fact_aggregates_v2")'),
    );
    expect(catalog).toContain('snapshotStatus = "temporarily_unavailable"');
    expect(catalog).toContain("catch {");
    expect(catalog).not.toContain('if (aggregateError) return { ok: false');
    expect(wrapper).toContain("fetchMeasurementHistoryCatalog(data, context.supabase)");
    expect(view).toContain("isMatchingHistoryCatalog({");
    expect(view).toContain('catalog.snapshotStatus === "temporarily_unavailable"');
    expect(view).toContain("측정 기록 다시 불러오기");
    expect(view).toContain("상세 결과 다시 확인");
    expect(view).not.toContain("disabled={!available}");
    expect(view).toContain("fetchMemberHistoryCatalog({");
    expect(view).toContain("enrichMemberHistoryCatalog(catalogQuery.data, serverCatalogQuery.data)");
    expect(view).toContain("serverCatalogQuery");
    expect(view).toContain("catalog?.runs.some((item) => item.runId === choice.runId)");
    expect(view).not.toContain("catalog?.runs[0]?.runId ?? null");
  });

  it("keeps the member-authorized dates when server fact enrichment fails or mismatches", () => {
    const member = {
      ok: true as const,
      data: {
        orgId, businessId, page: 0,
        snapshotStatus: "temporarily_unavailable" as const,
        hasNextPage: false,
        runs: [{
          runId, runName: "완료된 측정",
          measuredAt: "2026-09-27T05:43:12Z",
          status: "not_available" as const,
          validCount: null, confirmedCount: null, top3Count: null,
        }],
      },
    };
    const enriched = {
      ok: true as const,
      data: {
        ...member.data,
        snapshotStatus: "ready" as const,
        runs: [{
          ...member.data.runs[0]!,
          status: "available" as const,
          validCount: 24, confirmedCount: 16, top3Count: 16,
        }],
      },
    };
    expect(enrichMemberHistoryCatalog(member, undefined)).toEqual(member);
    expect(enrichMemberHistoryCatalog(member, { ok: false, error: "INTERNAL_ERROR" })).toEqual(member);
    expect(enrichMemberHistoryCatalog(member, enriched)).toEqual(enriched);
    expect(enrichMemberHistoryCatalog(member, {
      ...enriched, data: { ...enriched.data, orgId: "other-org" },
    })).toEqual(member);
    expect(enrichMemberHistoryCatalog(member, {
      ...enriched, data: { ...enriched.data, businessId: "other-business" },
    })).toEqual(member);
    expect(enrichMemberHistoryCatalog(member, {
      ...enriched, data: { ...enriched.data, page: 1 },
    })).toEqual(member);
    expect(enrichMemberHistoryCatalog(member, {
      ...enriched, data: { ...enriched.data, runs: [{
        ...enriched.data.runs[0]!, runId: "other-run",
      }] },
    })).toEqual(member);
    expect(enrichMemberHistoryCatalog(member, {
      ...enriched, data: { ...enriched.data, runs: [{
        ...enriched.data.runs[0]!, measuredAt: "2026-09-26T05:43:12Z",
      }] },
    })).toEqual(member);
  });

  it("uses existing member RLS for date-only catalog, no frontend private materialization", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const browser = at("src/lib/measurement-history.member-catalog.ts");
    const view = at("src/routes/_authenticated/measurement-history.tsx");
    const privileged = at("src/lib/measurement-history.functions.ts");
    expect(browser).toContain('import { supabase }');
    expect(browser).toContain('.from("measurement_runs")');
    expect(browser).toContain('.select("id,name,completed_at,created_at")');
    expect(browser).toContain('.eq("org_id", orgId)');
    expect(browser).toContain('.eq("business_id", businessId)');
    expect(browser).toContain('.eq("status", "completed")');
    expect(browser).toContain('.range(start, start + MEASUREMENT_HISTORY_PAGE_SIZE)');
    expect(browser).not.toContain("supabaseAdmin");
    expect(browser).not.toContain('from("run_entity_fact_aggregates_v2")');
    expect(browser).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(browser).not.toContain("measurement_credit_accounts");
    expect(view).toContain("queryKey: [\"measurement-history-member-dates\", session?.user.id");
    expect(view).toContain("enabled: isMatchingHistoryCatalog({");
    expect(view).toContain("snapshotStatus === \"temporarily_unavailable\"");
    expect(view).toContain("const selectedRunId = choice?");
    expect(privileged).toContain(".middleware([requireSupabaseAuth])");
  });

  it("refuses stale cross-org, cross-business or cross-Run cached results", () => {
    const report = {
      business: { id: businessId }, scope: { runId },
    } as EntityFactsV2ReadGatewayDTO;
    const response = { ok: true as const, data: { orgId, businessId, runId, report } };
    const selected = { orgId, businessId, runId, response };
    expect(canDisplayHistoryDetail(selected)).toBe(true);
    expect(canDisplayHistoryDetail({ ...selected, orgId: "another-org" })).toBe(false);
    expect(canDisplayHistoryDetail({ ...selected, businessId: "another-business" })).toBe(false);
    expect(canDisplayHistoryDetail({ ...selected, runId: "another-run" })).toBe(false);
    expect(canDisplayHistoryDetail({ ...selected, response: undefined })).toBe(false);
    expect(canDisplayHistoryDetail({
      ...selected, response: { ok: true, data: { ...response.data, report: {
        ...report, scope: { runId: "another-run" },
      } } },
    })).toBe(false);
  });

  it("only presents 8+16 scope labels when all the selected Run questions match", () => {
    const questionAreas = Array.from({ length: 24 }, (_, i) => ({
      questionId: `question-${i}`, validCount: 1,
      confirmedMentionCount: i >= 8 && i < 11 ? 1 : 0,
    }));
    const questionLocations = questionAreas.map((row, i) => ({
      questionId: row.questionId, city: i < 8 ? null : "안산",
    }));
    const report = { questionAreas, questionLocations } as EntityFactsV2ReadGatewayDTO;
    expect(getHistorySearchScopes(report)).toEqual({
      core: { valid: 8, confirmed: 0 },
      custom: { valid: 16, confirmed: 3 },
    });
    expect(getHistorySearchScopes({ ...report, questionLocations: undefined })).toBeNull();
    expect(getHistorySearchScopes({ ...report, questionLocations: questionLocations.slice(1) })).toBeNull();
    expect(getHistorySearchScopes({
      ...report, questionLocations: [...questionLocations.slice(0, 23), { questionId: "wrong", city: null }],
    })).toBeNull();
    expect(getHistorySearchScopes({
      ...report, questionLocations: questionLocations.map((row, i) => i === 0 ? { ...row, city: "안산" } : row),
    })).toBeNull();
  });

  it("explains legacy question sets without mislabeling them as current 8+16 measurements", () => {
    expect(isUnifiedDiagnosticSetName("카스페이스 구로점 AI 검색 질문 2026-09-18")).toBe(false);
    expect(isUnifiedDiagnosticSetName("AI 진단 질문 · 카스페이스 구로점 · 2026-09-26")).toBe(true);
    const source = readFileSync(resolve(process.cwd(), "src/routes/_authenticated/measurement-history.tsx"), "utf8");
    expect(source).toContain("!isUnifiedDiagnosticSetName(report.scope.questionSetName)");
    expect(source).toContain("이전 방식의 질문 세트로 진행한 측정입니다.");
    expect(source).toContain("전체 24개 질문과 당시 결과는 그대로 보존됩니다.");
    expect(source).toContain("이 회차는 현행 8개·16개 질문 구분을 검증할 수 없어");
    expect(source).toContain("getHistorySearchScopes(report)");
  });

  it("keeps all archived citation source links accessible with a concise default view", () => {
    const source = readFileSync(resolve(process.cwd(), "src/routes/_authenticated/measurement-history.tsx"), "utf8");
    expect(source).toContain("const INITIAL_CITATION_SOURCES = 10");
    expect(source).toContain("citations.slice(0, INITIAL_CITATION_SOURCES).map");
    expect(source).toContain("citations.slice(INITIAL_CITATION_SOURCES).map");
    expect(source).toContain("나머지 인용 출처");
    expect(source).toContain('className="grid gap-5 lg:grid-cols-2 lg:items-start"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain("CitationSourceLink");
    expect(source).toContain('observed.map((row)');
    expect(source).toContain("verified === \"complete\"");
  });

  it("preserves the existing live dashboard and protects member-only archive reads", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const wrapper = at("src/lib/measurement-history.functions.ts");
    const server = at("src/lib/measurement-history.server.ts");
    const history = at("src/routes/_authenticated/measurement-history.tsx");
    const nav = at("src/routes/_authenticated/route.tsx");
    const dashboard = at("src/routes/_authenticated/dashboard.tsx");

    expect(MEASUREMENT_HISTORY_PAGE_SIZE).toBe(20);
    expect(wrapper.match(/\.middleware\(\[requireSupabaseAuth\]\)/gu)).toHaveLength(2);
    expect(wrapper.match(/\.from\("organization_members"\)/gu)).toHaveLength(2);
    expect(wrapper.match(/\.eq\("user_id", context.userId\)/gu)).toHaveLength(2);
    expect(wrapper.indexOf('if (!membership) return { ok: false, error: "FORBIDDEN" };')).toBeLessThan(
      wrapper.indexOf("fetchMeasurementHistoryCatalog(data, context.supabase)"),
    );
    expect(wrapper).toContain("fetchMeasurementHistoryDetail(data)");
    expect(server).toContain('.eq("org_id", orgId).eq("business_id", businessId)');
    expect(server).toContain('.eq("source_run_id", runId)');
    expect(server).toContain('.eq("status", "completed")');
    expect(server).toContain('isValidHistoryAggregate(');
    expect(server).toContain("buildEntityFactsV2ReadGatewayFromSnapshot(");
    expect(server).toContain("confirmedIds.size === report.overview.confirmedMentionCount");
    for (const file of [wrapper, server, history]) {
      for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "enqueueRun(", "debitCredit(", "startMeasurement("]) {
        expect(file).not.toContain(forbidden);
      }
    }
    expect(history).toContain("canDisplayHistoryDetail({");
    expect(history).toContain("getHistorySearchScopes(report)");
    expect(history).toContain("report.questionAreas.map((area)");
    expect(history).toContain("report.competitors.map((row");
    expect(history).toContain("report.citationSources");
    expect(history).toContain('verified === "complete"');
    expect(nav).toContain('{ to: "/measurement-history", label: "측정 기록" }');
    expect(dashboard).toContain("getEntityFactsV2ReadGateway");
    expect(dashboard).not.toContain("getMeasurementHistoryDetail");
  });
});
