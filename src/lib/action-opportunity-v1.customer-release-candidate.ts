import type { CompactSummaryInsight } from "./dashboard-compact-insights";
import type { CustomerPreviewV1Model } from "./action-opportunity-v1.customer-preview.viewmodel";
import type { ActionOpportunityV1RuleId } from "./action-opportunity-v1.rules";
import { matchOwnerSummaryInsightToV1Card } from "./action-opportunity-v1.owner-summary-bridge";

/**
 * RELEASE PREPARATION ONLY. This pure adapter is intentionally NOT imported by
 * any route, customer endpoint, or the existing admin modal. It may be used only
 * after separately approved customer authentication/organization/run gates.
 *
 * Do not convert the internal admin preview endpoint into a customer endpoint.
 * A future server endpoint must independently authenticate and rederive all
 * inputs from the same current representative Run (never trust client counts).
 */
export type V1CandidateCurrentScope = {
  userId: string | null;
  orgId: string | null;
  businessId: string | null;
  runId: string | null;
  businessName: string | null;
  measuredAt: string | null;
  validCount: number | null;
  confirmedCount: number | null;
  top3Count: number | null;
  relatedPageLabel: string | null;
};

export type V1CandidatePreviewScope = {
  userId: string;
  orgId: string;
  businessId: string;
  runId: string;
  model: CustomerPreviewV1Model;
};

export type V1CustomerEvidenceCandidate = {
  title: string;
  recommendedCheck: string;
  observation: string;
  explanation: string;
  evidence: ReadonlyArray<{ label: string; value: string }>;
  disclaimer: string;
};

/**
 * Explicit allow-list. Never expose admin-only thresholds, confidence,
 * priority, rank, internal score or source-ownership inference.
 */
const CUSTOMER_EVIDENCE_LABELS: Partial<
  Record<ActionOpportunityV1RuleId, readonly string[]>
> = {
  core_exposure_gap: [
    "기준 검색 확정",
    "맞춤 검색 확정",
    "기준 검색 질문 예",
  ],
  zero_confirmed_visibility: [
    "확정 노출",
    "미확정·불확실",
  ],
  verified_citation_page_gap: [
    "페이지 검증 상태",
    "확정 관련 페이지",
  ],
  top3_confirmation_gap: [
    "확정 노출",
    "상위 3곳 확정",
  ],
  repeated_competitor: [
    "관찰 업체",
    "등장 답변",
  ],
};

function isNonEmpty(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildV1CustomerEvidenceCandidate(args: {
  current: V1CandidateCurrentScope;
  preview: V1CandidatePreviewScope | null;
  insight: CompactSummaryInsight | null;
}): V1CustomerEvidenceCandidate | null {
  const { current, preview, insight } = args;
  if (!preview || !insight ||
    !isNonEmpty(current.userId) ||
    !isNonEmpty(current.orgId) ||
    !isNonEmpty(current.businessId) ||
    !isNonEmpty(current.runId) ||
    !isNonEmpty(current.businessName) ||
    !isNonEmpty(current.measuredAt) ||
    !isNonEmpty(current.relatedPageLabel) ||
    !Number.isInteger(current.validCount ?? NaN) ||
    !Number.isInteger(current.confirmedCount ?? NaN) ||
    !Number.isInteger(current.top3Count ?? NaN) ||
    (current.validCount ?? 0) <= 0 ||
    (current.confirmedCount ?? -1) < 0 ||
    (current.top3Count ?? -1) < 0 ||
    (current.confirmedCount ?? Infinity) > (current.validCount ?? 0) ||
    (current.top3Count ?? Infinity) > (current.validCount ?? 0)
  ) {
    return null;
  }

  const model = preview.model;
  if (preview.userId !== current.userId ||
    preview.orgId !== current.orgId ||
    preview.businessId !== current.businessId ||
    preview.runId !== current.runId ||
    model.visibility !== "internal_only" ||
    model.runId !== current.runId ||
    model.businessName !== current.businessName ||
    model.measuredAt !== current.measuredAt ||
    model.answeredCount !== current.validCount ||
    model.confirmedCount !== current.confirmedCount ||
    model.top3Count !== current.top3Count ||
    model.relatedPageLabel !== current.relatedPageLabel
  ) {
    return null;
  }

  // A stale card must never turn 'pending' or 'not_verified' into
  // 'verification completed + zero related pages'.
  if (insight.id === "verified_page_zero" && model.relatedPageLabel !== "0개") {
    return null;
  }

  // The existing bridge requires the unique advisory rule and its exact stored
  // numerical/name/verification evidence to match the selected owner summary.
  const card = matchOwnerSummaryInsightToV1Card({
    insight,
    preview: model,
    expectedRunId: current.runId,
  });
  if (!card) return null;

  const allowedLabels = CUSTOMER_EVIDENCE_LABELS[card.id];
  if (!allowedLabels || card.evidence.length === 0 ||
    card.evidence.some((row) =>
      !allowedLabels.includes(row.label) ||
      !row.label.trim() ||
      !row.value.trim()
    ) ||
    new Set(card.evidence.map((row) => row.label)).size !== card.evidence.length ||
    !card.title.trim() ||
    !card.recommendedCheck.trim() ||
    !card.observation.trim() ||
    !card.explanation.trim() ||
    !model.disclaimer.trim()
  ) {
    return null;
  }

  // Keep only customer-oriented copy and explicitly checked evidence. Internal
  // ids, priorities, ranks, confidence, scoring and source links are excluded.
  return {
    title: card.title,
    recommendedCheck: card.recommendedCheck,
    observation: card.observation,
    explanation: card.explanation,
    evidence: card.evidence.map(({ label, value }) => ({ label, value })),
    disclaimer: model.disclaimer,
  };
}
