import type { CompactSummaryInsight } from "./dashboard-compact-insights";
import type {
  CustomerPreviewV1Card,
  CustomerPreviewV1Model,
} from "./action-opportunity-v1.customer-preview.viewmodel";
import type { ActionOpportunityV1RuleId } from "./action-opportunity-v1.rules";

/**
 * Internal-only bridge between the current owner summary and the admin v1.0 QA
 * preview. Identifiers alone never prove that two observations describe the same
 * evidence: both the exact representative Run and each item's relevant stored
 * counts must agree. No new scoring, AI calls, customer routes, or mutations.
 */
const RULE_BY_SUMMARY_INSIGHT: Partial<
  Record<CompactSummaryInsight["id"], ActionOpportunityV1RuleId>
> = {
  zero_confirmed: "zero_confirmed_visibility",
  broad_scope_gap: "core_exposure_gap",
  verified_page_zero: "verified_citation_page_gap",
  repeated_competitor: "repeated_competitor",
  top3_unconfirmed: "top3_confirmation_gap",
  // A verified page being present does not itself have a v1.0 advisory rule.
};

export function v1RuleForOwnerSummaryInsight(
  insightId: CompactSummaryInsight["id"],
): ActionOpportunityV1RuleId | null {
  return RULE_BY_SUMMARY_INSIGHT[insightId] ?? null;
}

function evidenceValue(card: CustomerPreviewV1Card, label: string): string | null {
  return card.evidence.find((entry) => entry.label === label)?.value ?? null;
}

function containsExactRatio(text: string, expected: string | null): boolean {
  return expected !== null && (text.match(/\d+\/\d+/gu) ?? []).includes(expected);
}

function hasMatchingEvidence(
  insight: CompactSummaryInsight,
  card: CustomerPreviewV1Card,
): boolean {
  switch (insight.id) {
    case "broad_scope_gap":
      return containsExactRatio(insight.evidence, evidenceValue(card, "기준 검색 확정")) &&
        containsExactRatio(insight.evidence, evidenceValue(card, "맞춤 검색 확정"));
    case "zero_confirmed":
      return evidenceValue(card, "확정 노출") === "0/24" &&
        insight.evidence.includes("24개 유효 답변");
    case "verified_page_zero":
      return evidenceValue(card, "페이지 검증 상태") === "완료" &&
        evidenceValue(card, "확정 관련 페이지") === "0개" &&
        insight.evidence.includes("검증 완료");
    case "repeated_competitor": {
      const name = evidenceValue(card, "관찰 업체");
      const answers = evidenceValue(card, "등장 답변");
      return !!name && insight.evidence.startsWith(name + " · ") &&
        containsExactRatio(insight.evidence, answers);
    }
    case "top3_unconfirmed":
      return containsExactRatio(insight.evidence, evidenceValue(card, "확정 노출")) &&
        containsExactRatio(insight.evidence, evidenceValue(card, "상위 3곳 확정"));
    case "verified_page_present":
      return false;
  }
}

export function matchOwnerSummaryInsightToV1Card(args: {
  insight: CompactSummaryInsight | null;
  preview: CustomerPreviewV1Model | null;
  expectedRunId: string | null;
}): CustomerPreviewV1Card | null {
  const { insight, preview, expectedRunId } = args;
  if (!insight || !preview || !expectedRunId ||
    preview.visibility !== "internal_only" || preview.runId !== expectedRunId) {
    return null;
  }
  const ruleId = v1RuleForOwnerSummaryInsight(insight.id);
  if (!ruleId) return null;

  const candidates = [...preview.primary, ...preview.additional]
    .filter((card) => card.id === ruleId);
  if (candidates.length !== 1) return null;
  return hasMatchingEvidence(insight, candidates[0]!) ? candidates[0]! : null;
}
