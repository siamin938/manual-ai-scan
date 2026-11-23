import { describe, expect, it } from "vitest";
import type { CompactSummaryInsight } from "../../src/lib/dashboard-compact-insights";
import type {
  CustomerPreviewV1Card,
  CustomerPreviewV1Model,
} from "../../src/lib/action-opportunity-v1.customer-preview.viewmodel";
import {
  matchOwnerSummaryInsightToV1Card,
  v1RuleForOwnerSummaryInsight,
} from "../../src/lib/action-opportunity-v1.owner-summary-bridge";

const runId = "11111111-1111-4111-8111-111111111111";

function card(
  id: CustomerPreviewV1Card["id"],
  evidence: CustomerPreviewV1Card["evidence"],
): CustomerPreviewV1Card {
  return {
    id, rank: 1, priority: "high", title: "내부 검수용",
    observation: "이번 대표 측정 관찰", recommendedCheck: "비교해 보세요.",
    explanation: "인과관계나 개선 효과를 보장하지 않습니다.",
    evidence,
  };
}

function preview(
  primary: CustomerPreviewV1Card[],
  additional: CustomerPreviewV1Card[] = [],
): CustomerPreviewV1Model {
  return {
    version: "1.0", visibility: "internal_only", businessName: "테스트 업체",
    runId, measuredAt: "2026-10-09T03:00:00Z", answeredCount: 24,
    confirmedCount: 3, top3Count: 3, relatedPageLabel: "0개",
    primary, additional, disclaimer: "원인이나 개선 효과를 보장하지 않습니다.",
  };
}

function insight(
  id: CompactSummaryInsight["id"],
  evidence: string,
): CompactSummaryInsight {
  return { id, title: "이번 측정에서 확인할 내용", evidence, recommendedCheck: "공개 정보를 확인해 보세요." };
}

describe("Action Opportunity v1.0 admin-only owner-summary bridge", () => {
  it("aligns exact 0/8 versus 3/16 evidence for an existing representative Run", () => {
    const primary = card("core_exposure_gap", [
      { label: "기준 검색 확정", value: "0/8" },
      { label: "맞춤 검색 확정", value: "3/16" },
    ]);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("broad_scope_gap", "넓은 범위 검색 0/8 · 상세 조건 검색 3/16"),
      preview: preview([primary]), expectedRunId: runId,
    })).toBe(primary);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("broad_scope_gap", "넓은 범위 검색 0/8 · 상세 조건 검색 13/16"),
      preview: preview([primary]), expectedRunId: runId,
    })).toBeNull();
  });

  it("matches complete-and-zero verified citations without turning pending into zero", () => {
    const item = card("verified_citation_page_gap", [
      { label: "페이지 검증 상태", value: "완료" },
      { label: "확정 관련 페이지", value: "0개" },
    ]);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("verified_page_zero", "이번 측정에서 인용된 페이지 검증 완료 기준입니다."),
      preview: preview([item]), expectedRunId: runId,
    })).toBe(item);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("verified_page_zero", "이번 측정에서 인용된 페이지 확인 중"),
      preview: preview([item]), expectedRunId: runId,
    })).toBeNull();
  });

  it("focuses an item located in the additional section only if its name and count agree", () => {
    const repeat = card("repeated_competitor", [
      { label: "관찰 업체", value: "원투 랩핑 PPF" },
      { label: "등장 답변", value: "4/24" },
    ]);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("repeated_competitor", "원투 랩핑 PPF · 4/24개 답변"),
      preview: preview([], [repeat]), expectedRunId: runId,
    })).toBe(repeat);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("repeated_competitor", "다른 업체 · 4/24개 답변"),
      preview: preview([], [repeat]), expectedRunId: runId,
    })).toBeNull();
  });

  it("rejects scope mismatch, absent candidate, duplicate candidate and unsupported insight", () => {
    const item = card("core_exposure_gap", [
      { label: "기준 검색 확정", value: "0/8" },
      { label: "맞춤 검색 확정", value: "3/16" },
    ]);
    const selected = insight("broad_scope_gap", "넓은 범위 검색 0/8 · 상세 조건 검색 3/16");
    const args = { insight: selected, preview: preview([item]), expectedRunId: runId };
    expect(matchOwnerSummaryInsightToV1Card({ ...args, expectedRunId: "another-run" })).toBeNull();
    expect(matchOwnerSummaryInsightToV1Card({ ...args, preview: preview([]) })).toBeNull();
    expect(matchOwnerSummaryInsightToV1Card({ ...args, preview: preview([item, item]) })).toBeNull();
    expect(matchOwnerSummaryInsightToV1Card({ ...args, insight: null })).toBeNull();
    expect(v1RuleForOwnerSummaryInsight("verified_page_present")).toBeNull();
    expect(matchOwnerSummaryInsightToV1Card({
      ...args, insight: insight("verified_page_present", "이번 측정 관련 인용 페이지 5개"),
    })).toBeNull();
  });

  it("does not bind uncertain Top3 or incomplete zero-visiblity to unrelated v1 evidence", () => {
    const noTop3 = card("top3_confirmation_gap", [
      { label: "확정 노출", value: "4/24" },
      { label: "상위 3곳 확정", value: "0/24" },
    ]);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("top3_unconfirmed", "확정 노출 4/24 · 상위 3곳 확정 0/24"),
      preview: preview([noTop3]), expectedRunId: runId,
    })).toBe(noTop3);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("top3_unconfirmed", "확정 노출 4/24 · 상위 3곳 확정 0/23"),
      preview: preview([noTop3]), expectedRunId: runId,
    })).toBeNull();
    const zero = card("zero_confirmed_visibility", [
      { label: "확정 노출", value: "0/24" },
    ]);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("zero_confirmed", "24개 유효 답변 기준입니다."),
      preview: preview([zero]), expectedRunId: runId,
    })).toBe(zero);
    expect(matchOwnerSummaryInsightToV1Card({
      insight: insight("zero_confirmed", "10개 유효 답변 기준입니다."),
      preview: preview([zero]), expectedRunId: runId,
    })).toBeNull();
  });
});
