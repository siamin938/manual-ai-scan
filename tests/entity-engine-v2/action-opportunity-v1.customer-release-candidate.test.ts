import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildV1CustomerEvidenceCandidate,
  type V1CandidateCurrentScope,
  type V1CandidatePreviewScope,
} from "../../src/lib/action-opportunity-v1.customer-release-candidate";
import type { CustomerPreviewV1Card } from "../../src/lib/action-opportunity-v1.customer-preview.viewmodel";
import type { ActionOpportunityV1RuleId } from "../../src/lib/action-opportunity-v1.rules";
import type { CompactSummaryInsight } from "../../src/lib/dashboard-compact-insights";

const userId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const businessId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const measuredAt = "2026-10-05T06:00:00Z";

function current(): V1CandidateCurrentScope {
  return {
    userId, orgId, businessId, runId, businessName: "씽카스게러지 안산점",
    measuredAt, validCount: 24, confirmedCount: 3, top3Count: 3,
    relatedPageLabel: "0개",
  };
}

function card(
  id: ActionOpportunityV1RuleId,
  evidence: Array<{ label: string; value: string }>,
): CustomerPreviewV1Card {
  return {
    id, rank: 1, priority: "high", title: "먼저 확인할 사항",
    observation: "이번 측정에서 관찰된 결과입니다.",
    recommendedCheck: "업체의 실제 공개 정보를 비교해 보세요.",
    explanation: "노출 원인이나 개선 효과를 보장하지 않습니다.",
    evidence,
  };
}

function preview(
  primary: CustomerPreviewV1Card[],
  additional: CustomerPreviewV1Card[] = [],
): V1CandidatePreviewScope {
  return {
    userId, orgId, businessId, runId,
    model: {
      visibility: "internal_only", version: "1.0",
      businessName: "씽카스게러지 안산점", runId, measuredAt,
      answeredCount: 24, confirmedCount: 3, top3Count: 3,
      relatedPageLabel: "0개", primary, additional,
      disclaimer: "특정 확인 작업이 AI 노출의 원인이라고 단정할 수 없습니다.",
    },
  };
}

function insight(
  id: CompactSummaryInsight["id"],
  evidence: string,
): CompactSummaryInsight {
  return {
    id, title: "이번 측정에서 확인할 2가지", evidence,
    recommendedCheck: "공개 정보를 비교해 보세요.",
  };
}

const coreCard = card("core_exposure_gap", [
  { label: "기준 검색 확정", value: "0/8" },
  { label: "맞춤 검색 확정", value: "3/16" },
  { label: "기준 검색 질문 예", value: "경기에서 PPF 맡길 곳 추천해줘" },
]);
const coreInsight = insight(
  "broad_scope_gap", "넓은 범위 검색 0/8 · 상세 조건 검색 3/16",
);

describe("Action Opportunity v1 customer release candidate (NOT mounted)", () => {
  it("returns only customer-safe evidence for the matching Core 0/8 / Custom 3/16", () => {
    const result = buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([coreCard]), insight: coreInsight,
    });
    expect(result).toMatchObject({
      title: "먼저 확인할 사항",
      recommendedCheck: "업체의 실제 공개 정보를 비교해 보세요.",
      observation: "이번 측정에서 관찰된 결과입니다.",
      evidence: [
        { label: "기준 검색 확정", value: "0/8" },
        { label: "맞춤 검색 확정", value: "3/16" },
        { label: "기준 검색 질문 예", value: "경기에서 PPF 맡길 곳 추천해줘" },
      ],
    });
    expect(Object.keys(result ?? {}).sort()).toEqual(
      ["title", "recommendedCheck", "observation", "explanation", "evidence", "disclaimer"].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/internal_only|priority|rank|confidence|threshold|highVisibilityThresholdPct|sourceDomain|userId|orgId|businessId|runId/iu);
  });

  it("does not connect a different 8+16 ratio even for the same advisory id", () => {
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([coreCard]),
      insight: insight("broad_scope_gap", "넓은 범위 검색 0/8 · 상세 조건 검색 13/16"),
    })).toBeNull();
  });

  it("only promotes verified-page zero when the completed verifier and owner label agree", () => {
    const verifiedCard = card("verified_citation_page_gap", [
      { label: "페이지 검증 상태", value: "완료" },
      { label: "확정 관련 페이지", value: "0개" },
    ]);
    const verifiedInsight = insight(
      "verified_page_zero", "이번 측정에서 인용된 페이지 검증 완료 기준입니다.",
    );
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([verifiedCard]), insight: verifiedInsight,
    })?.evidence).toEqual(verifiedCard.evidence);

    const stalePreview = preview([verifiedCard]);
    stalePreview.model.relatedPageLabel = "확인 중";
    expect(buildV1CustomerEvidenceCandidate({
      current: { ...current(), relatedPageLabel: "확인 중" },
      preview: stalePreview, insight: verifiedInsight,
    })).toBeNull();
    stalePreview.model.relatedPageLabel = "미검증";
    expect(buildV1CustomerEvidenceCandidate({
      current: { ...current(), relatedPageLabel: "미검증" },
      preview: stalePreview, insight: verifiedInsight,
    })).toBeNull();
  });

  it("only links the exactly matched repeated competitor's name and response count", () => {
    const repeated = card("repeated_competitor", [
      { label: "관찰 업체", value: "원투 랩핑 PPF" },
      { label: "등장 답변", value: "4/24" },
    ]);
    const envelope = preview([coreCard], [repeated]);
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: envelope,
      insight: insight("repeated_competitor", "원투 랩핑 PPF · 4/24개 답변"),
    })?.evidence).toEqual(repeated.evidence);
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: envelope,
      insight: insight("repeated_competitor", "다른 업체 · 4/24개 답변"),
    })).toBeNull();
  });

  it("rejects cross-session, cross-organization, cross-business and cross-run caches", () => {
    const selected = current();
    const ready = preview([coreCard]);
    const run = (scope: V1CandidateCurrentScope, data: V1CandidatePreviewScope | null) =>
      buildV1CustomerEvidenceCandidate({ current: scope, preview: data, insight: coreInsight });
    expect(run({ ...selected, userId: "another-user" }, ready)).toBeNull();
    expect(run({ ...selected, orgId: "another-org" }, ready)).toBeNull();
    expect(run({ ...selected, businessId: "another-business" }, ready)).toBeNull();
    expect(run({ ...selected, runId: "another-run" }, ready)).toBeNull();
    expect(run({ ...selected, measuredAt: "2026-10-06T00:00:00Z" }, ready)).toBeNull();
    expect(run({ ...selected, businessName: "다른 지점" }, ready)).toBeNull();
    expect(run({ ...selected, userId: null }, ready)).toBeNull();
    expect(run(selected, null)).toBeNull();
    expect(run(selected, { ...ready, runId: "another-run" })).toBeNull();
    expect(run(selected, { ...ready, model: { ...ready.model, runId: "another-run" } })).toBeNull();
  });

  it("rejects mismatched measured counts, verified-page state or duplicate candidates", () => {
    const ready = preview([coreCard]);
    expect(buildV1CustomerEvidenceCandidate({
      current: { ...current(), confirmedCount: 4 }, preview: ready, insight: coreInsight,
    })).toBeNull();
    expect(buildV1CustomerEvidenceCandidate({
      current: { ...current(), top3Count: 2 }, preview: ready, insight: coreInsight,
    })).toBeNull();
    expect(buildV1CustomerEvidenceCandidate({
      current: { ...current(), relatedPageLabel: "미검증" },
      preview: ready, insight: coreInsight,
    })).toBeNull();
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([coreCard, coreCard]), insight: coreInsight,
    })).toBeNull();
  });

  it("fails closed when unreviewed internal rows or duplicate evidence labels appear", () => {
    const injected = card("core_exposure_gap", [
      ...coreCard.evidence,
      { label: "내부 threshold", value: "0.8" },
    ]);
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([injected]), insight: coreInsight,
    })).toBeNull();
    const duplicate = card("core_exposure_gap", [
      ...coreCard.evidence,
      { label: "기준 검색 확정", value: "0/8" },
    ]);
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([duplicate]), insight: coreInsight,
    })).toBeNull();
  });

  it("does not create a new advisory where the compact owner insight has no v1 rule", () => {
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([coreCard]),
      insight: insight("verified_page_present", "관련성 확정 5개"),
    })).toBeNull();
    const unsupported = card("competitor_source_difference", [
      { label: "출처", value: "daangn.com" },
    ]);
    expect(buildV1CustomerEvidenceCandidate({
      current: current(), preview: preview([unsupported]),
      insight: insight("repeated_competitor", "원투 랩핑 PPF · 4/24개 답변"),
    })).toBeNull();
  });

  it("remains read-only, admin QA mounted and not customer released", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const candidate = read("src/lib/action-opportunity-v1.customer-release-candidate.ts");
    const component = read("src/components/action-opportunity-v1-customer-evidence-candidate.tsx");
    const dashboard = read("src/routes/_authenticated/dashboard.tsx");
    const privateFn = read("src/lib/action-opportunity-v1.dashboard-private.functions.ts");

    expect(component).toContain("이번 측정에서 확인된 사실");
    expect(component).toContain("판단 근거");
    expect(component).not.toContain("<details");
    expect(component).not.toContain("useState(");
    expect(component).not.toContain("{detail.recommendedCheck}");
    expect(candidate).toContain("matchOwnerSummaryInsightToV1Card");
    expect(candidate).not.toContain("supabaseAdmin");
    expect(candidate).not.toContain("createServerFn");
    expect(dashboard).not.toContain("ActionOpportunityV1CustomerEvidenceCandidate");
    expect(dashboard).toContain("관리자 상세 검수 도구");
    expect(dashboard).toContain("privateV1AdminAllowed &&");
    expect(dashboard).not.toContain("buildV1CustomerEvidenceCandidate");
    expect(dashboard).toContain("getActionOpportunityV1DashboardPrivatePreview");
    expect(privateFn).toContain('rpc("can_view_data_asset_admin_v01")');
    expect(privateFn).toContain(".middleware([requireSupabaseAuth])");
    for (const text of [candidate, component]) {
      for (const forbidden of [".insert(", ".upsert(", ".delete(", "enqueueRun", "measurement_credit_accounts", "getServiceRoleKey"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
