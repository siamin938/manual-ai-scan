import type {
  ActionOpportunityV1Item,
  ActionOpportunityV1Result,
  ActionOpportunityV1RuleId,
} from "./action-opportunity-v1.rules";
import { splitActionOpportunityV1Items } from "./action-opportunity-v1.presentation";
import type { EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";
import { buildVerifiedTargetCitationPageSummary } from "./verified-target-citation-page-summary";

export type CustomerPreviewV1Input = Pick<
  EntityFactsV2ReadGatewayDTO,
  | "business"
  | "scope"
  | "overview"
  | "verifiedTargetCitationPageStatus"
  | "verifiedTargetCitationPages"
>;

export type CustomerPreviewV1Card = Pick<
  ActionOpportunityV1Item,
  "id" | "rank" | "priority" | "observation" | "recommendedCheck" | "evidence"
> & {
  title: string;
  explanation: string;
};

export type CustomerPreviewV1Model = {
  version: "1.0";
  visibility: "internal_only";
  businessName: string;
  runId: string;
  measuredAt: string;
  answeredCount: number;
  confirmedCount: number;
  top3Count: number;
  relatedPageLabel: string;
  primary: CustomerPreviewV1Card[];
  additional: CustomerPreviewV1Card[];
  disclaimer: string;
};

const TITLES: Record<ActionOpportunityV1RuleId, string> = {
  core_exposure_gap: "넓은 지역 검색에서는 내 업체가 확인되지 않았습니다",
  zero_confirmed_visibility: "이번 측정에서는 내 업체가 확인되지 않았습니다",
  verified_citation_page_gap: "인용된 페이지에서 내 업체 관련성을 확정하지 못했습니다",
  top3_confirmation_gap: "내 업체는 나왔지만 상위 3곳에서는 확인되지 않았습니다",
  repeated_competitor: "다른 업체가 여러 답변에 반복 등장했습니다",
  competitor_source_difference: "다른 업체와 함께 관찰된 출처를 확인해 보세요",
};

function toCustomerCard(item: ActionOpportunityV1Item): CustomerPreviewV1Card {
  return {
    id: item.id,
    rank: item.rank,
    priority: item.priority,
    title: TITLES[item.id],
    observation: item.observation,
    recommendedCheck: item.recommendedCheck,
    // Business-owner wording stays descriptive, not causal.
    explanation:
      item.id === "competitor_source_difference"
        ? "이번 측정에서는 업체별로 같은 출처와 함께 관찰된 연결에 차이가 있었습니다. 이 사실만으로 노출 차이의 이유를 알 수는 없습니다."
        : item.whyItMatters,
    evidence: item.evidence.map((row) => ({ ...row })),
  };
}

/**
 * Internal-only rendering contract: accept only an exact representative Run
 * and its matching v1.0 result. No separate measurements, history merging,
 * new scoring, mutation, or customer-route switch.
 */
export function buildCustomerPreviewV1Model(
  input: CustomerPreviewV1Input,
  result: ActionOpportunityV1Result,
): CustomerPreviewV1Model | null {
  if (
    result.version !== "1.0" ||
    result.mode !== "internal_dry_run" ||
    result.runId !== input.scope.runId ||
    result.businessName !== input.business.name ||
    input.overview.validCount <= 0 ||
    result.items.some(
      (item) =>
        item.scope.kind !== "exact_representative_run" ||
        item.scope.runId !== input.scope.runId ||
        item.scope.measuredAt !== input.scope.measuredAt,
    )
  ) {
    return null;
  }

  const sections = splitActionOpportunityV1Items(result.items);
  const pageSummary = buildVerifiedTargetCitationPageSummary(input);
  return {
    version: "1.0",
    visibility: "internal_only",
    businessName: input.business.name,
    runId: input.scope.runId,
    measuredAt: input.scope.measuredAt,
    answeredCount: input.overview.validCount,
    confirmedCount: input.overview.confirmedMentionCount,
    top3Count: input.overview.confirmedTop3Count,
    relatedPageLabel: pageSummary.label,
    primary: sections.primary.map(toCustomerCard),
    additional: sections.additional.map(toCustomerCard),
    disclaimer:
      "이 내용은 이번에 측정한 질문과 AI 답변에서 관찰된 결과입니다. 특정 페이지나 확인 작업이 AI 노출에 영향을 준 원인이라고 단정하거나 개선 효과를 보장하지 않습니다.",
  };
}
