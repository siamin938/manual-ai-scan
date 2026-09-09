import { describe, expect, it } from "vitest";
import { parseVisibilityDiagnosticResponse } from "./visibility-diagnostic.server";

function source(domain: string, extra: Record<string, unknown> = {}) {
  return {
    domain,
    citationCount: 3,
    responseCount: 2,
    responseRatePct: 50,
    sampleTitle: null,
    ...extra,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    generatedAt: "2026-09-02T00:00:00.000Z",
    business: { id: "b1", name: "테스트업체", category: null, region: null, city: null },
    trend: [],
    diagnostic: {
      scope: {
        runId: "r1",
        runName: "run",
        measuredAt: "2026-09-01T00:00:00.000Z",
        runType: "audit",
        phase: "standalone",
        providers: ["openai"],
        repetitions: 1,
        totalJobs: 24,
        completedJobs: 24,
        failedJobs: 0,
        experimentRunsExcluded: true,
      },
      overview: {
        validCount: 24,
        invalidCount: 0,
        mentionCount: 17,
        visibilityRatePct: 70.8,
        top3Count: 13,
        top3RatePct: 54.2,
        questionCount: 24,
        coveredQuestionCount: 17,
        questionCoverageRatePct: 70.8,
      },
      questionGroups: [],
      competitors: [],
      competitorGate: null,
      sources: [source("a.com")],
      referenceSources: [source("b.com")],
      priorityAreas: [],
      dataQuality: { measurementRowsCapped: false, sourceRowsCapped: false },
      ...overrides,
    },
  };
}

describe("parseVisibilityDiagnosticResponse", () => {
  it("sources와 referenceSources를 정상 파싱한다", () => {
    const result = parseVisibilityDiagnosticResponse(payload());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostic.diagnostic.sources.map((s) => s.domain)).toEqual(["a.com"]);
    expect(result.diagnostic.diagnostic.referenceSources.map((s) => s.domain)).toEqual(["b.com"]);
  });

  it("referenceSources가 누락되면 INVALID_DTO", () => {
    const body = payload();
    delete (body.diagnostic as Record<string, unknown>)["referenceSources"];
    expect(parseVisibilityDiagnosticResponse(body)).toEqual({ ok: false, error: "INVALID_DTO" });
  });

  it("referenceSources 타입이 잘못되면 INVALID_DTO", () => {
    expect(
      parseVisibilityDiagnosticResponse(payload({ referenceSources: [{ domain: "x.com" }] })),
    ).toEqual({ ok: false, error: "INVALID_DTO" });
  });

  it("계약 외 필드는 반환 DTO에 노출하지 않는다", () => {
    const result = parseVisibilityDiagnosticResponse(
      payload({
        sources: [source("a.com", { internalScore: 9, attributionLevel: "direct" })],
        referenceSources: [source("b.com", { internalScore: 1 })],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = Object.keys(result.diagnostic.diagnostic.sources[0]!).sort();
    expect(keys).toEqual(
      ["citationCount", "domain", "responseCount", "responseRatePct", "sampleTitle"].sort(),
    );
    expect(result.diagnostic.diagnostic.referenceSources[0]).not.toHaveProperty("internalScore");
  });

  it("tier=watch competitor를 정상 계약으로 허용한다", () => {
    const result = parseVisibilityDiagnosticResponse(
      payload({
        competitors: [
          {
            name: "관찰업체",
            mentionCount: 1,
            responseCount: 1,
            responseRatePct: 4.2,
            tier: "watch",
            tierLabel: "추가 관찰",
            questionCount: 1,
            top3ResponseCount: 0,
            priorRunPresenceCount: 0,
            isNew: true,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostic.diagnostic.competitors[0]?.tier).toBe("watch");
  });

  it("계약 외 tier는 INVALID_DTO", () => {
    expect(
      parseVisibilityDiagnosticResponse(
        payload({
          competitors: [
            {
              name: "잘못된업체",
              mentionCount: 1,
              responseCount: 1,
              responseRatePct: 4.2,
              tier: "unknown",
              tierLabel: "???",
              questionCount: 1,
              top3ResponseCount: 0,
              priorRunPresenceCount: 0,
              isNew: true,
            },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: "INVALID_DTO" });
  });
});
