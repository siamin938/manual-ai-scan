import type { EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";
import { buildUnifiedDiagnosticLayerSummary } from "./unified-diagnostic-layer-summary";

/**
 * CHABOIM Action Opportunity v1.0 — internal dry-run only.
 *
 * Pure, deterministic advisory rules over ONE exact representative Entity
 * Facts v2 read-gateway DTO. Never mixes Runs, changes measurement facts,
 * mutates storage, or promises that a suggested check increases AI exposure.
 *
 * This is separate from the existing benchmark-oriented v0.1 engine.
 */
export const ACTION_OPPORTUNITY_V1_VERSION = "1.0" as const;

export type ActionOpportunityV1RuleId =
  | "core_exposure_gap"
  | "zero_confirmed_visibility"
  | "verified_citation_page_gap"
  | "top3_confirmation_gap"
  | "repeated_competitor"
  | "competitor_source_difference";

export type ActionOpportunityV1Item = {
  id: ActionOpportunityV1RuleId;
  rank: number;
  priority: "high" | "review";
  title: string;
  observation: string;
  whyItMatters: string;
  recommendedCheck: string;
  evidence: Array<{ label: string; value: string }>;
  confidence: "high" | "moderate";
  /** The only permitted fact scope. No other Run may enter an item. */
  scope: { kind: "exact_representative_run"; runId: string; measuredAt: string };
  disclaimer: string;
};

export type ActionOpportunityV1Result = {
  version: typeof ACTION_OPPORTUNITY_V1_VERSION;
  mode: "internal_dry_run";
  status: "ready" | "insufficient_data";
  runId: string;
  businessName: string;
  description: string;
  items: ActionOpportunityV1Item[];
  disclaimer: string;
};

const DISCLAIMER =
  "현재 대표 측정에서 관찰된 사실에 따른 확인 항목입니다. 원인이나 개선 효과를 입증하거나 보장하지 않습니다.";

type DraftItem = Omit<ActionOpportunityV1Item, "rank" | "scope" | "disclaimer">;

export function buildActionOpportunityV1Preview(
  dto: EntityFactsV2ReadGatewayDTO,
): ActionOpportunityV1Result {
  const items: ActionOpportunityV1Item[] = [];
  const runId = dto.scope.runId;
  const total = dto.overview.validCount;
  const observed = dto.overview.confirmedMentionCount;

  const add = (item: DraftItem): void => {
    items.push({
      ...item,
      rank: items.length + 1,
      scope: {
        kind: "exact_representative_run",
        runId,
        measuredAt: dto.scope.measuredAt,
      },
      disclaimer: DISCLAIMER,
    });
  };

  const base: ActionOpportunityV1Result = {
    version: ACTION_OPPORTUNITY_V1_VERSION,
    mode: "internal_dry_run",
    status: "insufficient_data",
    runId,
    businessName: dto.business.name,
    description: "현재 대표 측정의 관찰 근거만 사용합니다.",
    items,
    disclaimer: DISCLAIMER,
  };
  if (!runId || total <= 0 || dto.overview.measurementCount <= 0) {
    return { ...base, description: "분석할 수 있는 유효 측정 결과가 없습니다." };
  }

  const layer = dto.questionLocations
    ? buildUnifiedDiagnosticLayerSummary({
        questionAreas: dto.questionAreas,
        questionLocations: dto.questionLocations,
        overview: dto.overview,
      })
    : null;

  // Never label an incomplete or uncertain Core scope as an absent exposure.
  if (
    layer &&
    layer.core.validCount === 8 &&
    layer.core.unresolvedCount === 0 &&
    layer.core.confirmedCount === 0 &&
    layer.custom.confirmedCount > 0
  ) {
    const fullyLocal = layer.custom.validCount === 16 &&
      layer.custom.unresolvedCount === 0 &&
      layer.custom.confirmedCount === 16;

    add({
      id: "core_exposure_gap",
      priority: "high",
      title: "넓은 지역 기준 검색 노출을 우선 확인하세요",
      observation:
        "상세 지역 검색 " + layer.custom.confirmedCount + "/" +
        layer.custom.validCount + "건에서는 확정 노출됐지만, 넓은 지역 기준 검색 8건에서는 확정 노출이 0건이었습니다.",
      whyItMatters: fullyLocal
        ? "상세 지역 검색 16건 모두에 등장한 반면 넓은 지역 검색에서는 등장하지 않은 패턴입니다."
        : "이번 측정의 확정 노출이 상세 지역 검색에 집중되어 있습니다.",
      recommendedCheck:
        "공식 홈페이지와 공개 업체 프로필에서 실제 서비스 가능 지역과 핵심 서비스 설명이 일관되게 확인되는지 점검해보세요.",
      evidence: [
        { label: "기준 검색 확정", value: "0/8" },
        { label: "맞춤 검색 확정", value: layer.custom.confirmedCount + "/" + layer.custom.validCount },
      ],
      confidence: "high",
    });
  }

  // Zero is an objective rule, not an arbitrary 'low visibility' percentile.
  const fullyResolved24 =
    dto.overview.questionCount === 24 &&
    dto.overview.measurementCount === 24 &&
    dto.overview.validCount === 24 &&
    dto.overview.invalidCount === 0 &&
    dto.overview.unresolvedTargetCount === 0 &&
    dto.scope.totalJobs === 24 &&
    dto.scope.completedJobs === 24 &&
    dto.scope.failedJobs === 0;

  if (fullyResolved24 && observed === 0) {
    add({
      id: "zero_confirmed_visibility",
      priority: "high",
      title: "이번 진단의 확정 노출 0건을 확인하세요",
      observation: "유효한 24개 측정 답변에서 내 업체의 확정 노출은 0건으로 관찰됐습니다.",
      whyItMatters: "이번 질문과 측정 조건에서는 확정된 노출 사례가 없습니다. 전체 AI 검색에서 전혀 보이지 않는다는 의미는 아닙니다.",
      recommendedCheck:
        "업체명·지점명·주력 서비스·영업 지역이 공식 채널과 공개 프로필에 정확히 안내되어 있는지 먼저 확인해보세요.",
      evidence: [
        { label: "확정 노출", value: "0/24" },
        { label: "미확정·불확실", value: "0건" },
      ],
      confidence: "high",
    });
  }

  // 'complete + zero' must never be conflated with pending or not_verified.
  if (
    dto.verifiedTargetCitationPageStatus === "complete" &&
    dto.verifiedTargetCitationPages !== undefined &&
    dto.verifiedTargetCitationPages.length === 0
  ) {
    add({
      id: "verified_citation_page_gap",
      priority: "review",
      title: "AI가 인용한 페이지의 업체 관련성을 확인하세요",
      observation:
        "이번 측정에서 인용 페이지 검증은 완료됐으나 현재 업체·지점과 직접 관련 있다고 확정된 페이지는 0개입니다.",
      whyItMatters:
        "이 값은 AI가 인용한 페이지 중 관련성을 확정한 고유 페이지 수입니다. 인터넷 전체에 존재하는 업체 페이지 수가 아닙니다.",
      recommendedCheck:
        "실제로 인용된 페이지와 업체 공식 채널에서 업체명·지점·서비스 식별 정보를 비교해보세요.",
      evidence: [
        { label: "페이지 검증 상태", value: "완료" },
        { label: "확정 관련 페이지", value: "0개" },
      ],
      confidence: "high",
    });
  }

  if (
    observed > 0 &&
    dto.overview.confirmedTop3Count === 0 &&
    dto.overview.top3UncertainCount === 0 &&
    dto.overview.validCount > 0
  ) {
    add({
      id: "top3_confirmation_gap",
      priority: "review",
      title: "확정 노출과 상위 3곳 노출의 차이를 살펴보세요",
      observation:
        "내 업체는 " + total + "개 유효 답변 중 " + observed +
        "개에서 확정 노출됐지만, 상위 3곳 내 확정 노출은 0건이었습니다.",
      whyItMatters: "이번 측정에서는 업체가 등장한 횟수와 상위 3곳에서 확인된 횟수에 차이가 있습니다.",
      recommendedCheck:
        "업체가 등장한 질문과 등장하지 않은 질문을 비교해 어떤 검색 상황에서 차이가 있었는지 점검해보세요.",
      evidence: [
        { label: "확정 노출", value: observed + "/" + total },
        { label: "상위 3곳 확정", value: "0/" + total },
      ],
      confidence: "high",
    });
  }

  const repeated = dto.competitors
    .filter((row) => row.name.trim() && row.responseCount >= 2)
    .slice()
    .sort((a, b) =>
      b.responseCount - a.responseCount ||
      a.name.localeCompare(b.name, "ko")
    )[0];

  if (repeated) {
    add({
      id: "repeated_competitor",
      priority: "review",
      title: "반복 관찰된 다른 업체의 등장 상황을 확인하세요",
      observation:
        "이번 측정에서 " + repeated.name + " 업체가 " +
        repeated.responseCount + "개 답변에 반복 관찰됐습니다.",
      whyItMatters: "동일한 질문 세트 내에서 반복적으로 관찰된 업체를 구분할 수 있습니다. 경쟁 우위나 노출 원인을 증명하는 지표는 아닙니다.",
      recommendedCheck:
        "해당 업체가 등장한 검색 질문과 확인 가능한 인용 출처를 내 업체의 관찰 결과와 나란히 비교해보세요.",
      evidence: [
        { label: "관찰 업체", value: repeated.name },
        { label: "등장 답변", value: repeated.responseCount + "/" + total },
      ],
      confidence: "high",
    });
  }

  // A confirmed competitor-linked domain in this same Run is descriptive
  // co-observation, never proof that the domain caused competitor exposure.
  const competitorOnlySource =
    dto.observedSourcesStatus === "available"
      ? dto.observedSources
          .filter((row) =>
            row.domain.trim() &&
            row.evidence !== "clue" &&
            row.targetResponseCount === 0 &&
            row.competitorResponseCount >= 2 &&
            row.linkedEntities.some((entity) =>
              !entity.isTarget &&
              entity.evidence === "confirmed" &&
              entity.responseCount >= 2
            )
          )
          .slice()
          .sort((a, b) =>
            b.competitorResponseCount - a.competitorResponseCount ||
            a.domain.localeCompare(b.domain, "en")
          )[0]
      : undefined;

  if (competitorOnlySource) {
    const linked = competitorOnlySource.linkedEntities
      .filter((entity) => !entity.isTarget && entity.evidence === "confirmed")
      .sort((a, b) => b.responseCount - a.responseCount)[0];

    add({
      id: "competitor_source_difference",
      priority: "review",
      title: "다른 업체와 함께 관찰된 출처를 비교하세요",
      observation:
        competitorOnlySource.domain + " 출처에서 다른 업체 연결은 " +
        competitorOnlySource.competitorResponseCount +
        "개 답변에서 관찰됐지만, 내 업체와의 확정 연결은 관찰되지 않았습니다.",
      whyItMatters:
        "현재 대표 Run의 동일 출처에서 업체별 연결 여부에 차이가 관찰됐습니다. 특정 출처가 노출을 만든 원인이라는 뜻은 아닙니다.",
      recommendedCheck:
        "해당 도메인에서 실제 인용된 페이지와 공개 업체 정보를 확인해 어떤 업체와 연결되어 있는지 직접 비교해보세요.",
      evidence: [
        { label: "출처", value: competitorOnlySource.domain },
        { label: "다른 업체 연결 답변", value: String(competitorOnlySource.competitorResponseCount) },
        { label: "내 업체 연결 답변", value: "0" },
        ...(linked ? [{ label: "관찰 업체 예", value: linked.name }] : []),
      ],
      confidence: "moderate",
    });
  }

  return { ...base, status: "ready", items };
}
