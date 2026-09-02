import { describe, expect, it } from "vitest";
import { parseActionRecommendationsResponse } from "./visibility-actions.server";

const platform = {
  key: "naver-blog",
  name: "네이버 블로그",
  actionType: "publish_candidate",
  actionLabel: "작성 후보",
  responseCount: 3,
  relatedResponseTotal: 10,
  citationCount: 5,
  distinctCompetitorCount: 2,
  domains: ["blog.naver.com"],
  evidenceGrade: "priority",
  evidenceLabel: "우선 확인",
  scopeLabel: "같은 검색 상황",
  clientOverallResponseCount: 1,
};

const group = {
  key: "blog",
  name: "블로그",
  actionType: "publish_candidate",
  actionLabel: "작성 후보",
  reason: "경쟁업체 답변에서 자주 연결됨",
  responseCount: 4,
  relatedResponseTotal: 10,
  citationCount: 7,
  distinctCompetitorCount: 3,
  platforms: [platform],
  evidenceGrade: "candidate",
  evidenceLabel: "확인 후보",
  scopeLabel: "같은 검색 상황",
  clientOverallResponseCount: 2,
};

const recommendation = {
  id: "rec-1",
  rank: 1,
  kind: "source_gap",
  title: "블로그 출처 차이",
  evidenceLevel: "worth_review",
  evidenceLabel: "검토 권장",
  summary: "요약",
  steps: ["단계 1"],
  sampleQuestions: ["질문 1"],
  evidence: {
    clientResponseCount: 1,
    competitorResponseCount: 4,
    distinctCompetitorCount: 3,
    measurementCount: 24,
    questionCount: 24,
    domains: ["blog.naver.com"],
  },
  channelSuggestions: [],
  sourceGroups: [group],
  referenceSourceGroups: [{ ...group, key: "ref", evidenceGrade: "reference" }],
};

const payload = {
  ok: true,
  generatedAt: "2026-09-02T00:00:00.000Z",
  disclaimer: "관찰 결과이며 인과를 확정하지 않습니다.",
  business: { id: "biz-1", name: "테스트 업체" },
  scope: null,
  recommendations: [recommendation],
};

describe("parseActionRecommendationsResponse", () => {
  it("optional 출처 근거 필드와 referenceSourceGroups를 보존한다", () => {
    const result = parseActionRecommendationsResponse(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.data.recommendations[0]!;
    const g = rec.sourceGroups[0]!;
    expect(g.evidenceGrade).toBe("candidate");
    expect(g.evidenceLabel).toBe("확인 후보");
    expect(g.scopeLabel).toBe("같은 검색 상황");
    expect(g.clientOverallResponseCount).toBe(2);
    expect(g.platforms[0]!.evidenceGrade).toBe("priority");
    expect(g.platforms[0]!.clientOverallResponseCount).toBe(1);
    expect(rec.referenceSourceGroups?.[0]?.evidenceGrade).toBe("reference");
  });

  it("optional 필드가 없어도 파싱된다", () => {
    const bare = {
      ...payload,
      recommendations: [
        {
          ...recommendation,
          sourceGroups: [{ ...group, platforms: [{ ...platform }] }],
          referenceSourceGroups: undefined,
        },
      ],
    };
    delete (bare.recommendations[0]!.sourceGroups[0] as Record<string, unknown>)["evidenceGrade"];
    const result = parseActionRecommendationsResponse(bare);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recommendations[0]!.sourceGroups[0]!.evidenceGrade).toBeUndefined();
    expect(result.data.recommendations[0]!.referenceSourceGroups).toBeUndefined();
  });

  it("optional 필드 타입이 계약과 다르면 fail-closed 처리한다", () => {
    const bad = {
      ...payload,
      recommendations: [
        {
          ...recommendation,
          sourceGroups: [{ ...group, evidenceGrade: "unknown_grade" }],
        },
      ],
    };
    expect(parseActionRecommendationsResponse(bad)).toEqual({ ok: false, error: "INVALID_DTO" });
  });

  it("계약 외 필드는 노출하지 않는다", () => {
    const extra = {
      ...payload,
      recommendations: [{ ...recommendation, secretScore: 0.42 }],
    };
    const result = parseActionRecommendationsResponse(extra);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recommendations[0]).not.toHaveProperty("secretScore");
  });
});
