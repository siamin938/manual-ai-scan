import type {
  EntityFactsV2DashboardSummaryViewModel,
  DashboardSummaryMetric,
  DashboardSummarySearchScope,
} from "./entity-facts-v2-dashboard-summary.viewmodel";

export type CompactSummaryInsight = {
  id:
    | "zero_confirmed"
    | "broad_scope_gap"
    | "verified_page_zero"
    | "repeated_competitor"
    | "top3_unconfirmed"
    | "verified_page_present";
  title: string;
  evidence: string;
  recommendedCheck: string;
};

export type CompactSummarySource = Pick<
  EntityFactsV2DashboardSummaryViewModel,
  | "visibility"
  | "top3"
  | "searchScopes"
  | "topCompetitor"
  | "verifiedPageCount"
  | "verifiedPageStatus"
>;

/**
 * Simplified labels for compact summary only. Retain original intent IDs and
 * canonical labels throughout detailed reporting and the measurement engine.
 */
const OWNER_INTENT_LABELS: Record<string, string> = {
  comparison: "업체 비교",
  discovery: "업체 찾아보기",
  local: "지역에서 업체 찾기",
  recommendation: "업체 추천",
  service: "시공·서비스 문의",
  review_quality: "업체 후기·평판",
  trust: "전문성·신뢰도 확인",
  price_value: "가격·가성비 비교",
};

export function ownerSearchContextLabel(intent: string): string {
  return OWNER_INTENT_LABELS[intent] ?? "기타 검색 질문";
}

/** Count valid AI answers in this intent, not an ordinal search rank. */
export function ownerSearchContextAnswerText(confirmed: number, valid: number): string {
  return valid > 0 && confirmed >= 0 && confirmed <= valid
    ? valid + "개 답변 중 " + confirmed + "개에서 등장"
    : "확인 가능한 답변 없음";
}

export function compactSummaryCount(metric: DashboardSummaryMetric): string {
  return metric.count === null || metric.total === null
    ? "확인 불가"
    : String(metric.count) + "/" + String(metric.total);
}

export function compactSummarySearchScopes(summary: CompactSummarySource): {
  core: DashboardSummarySearchScope;
  custom: DashboardSummarySearchScope;
} | null {
  const core = summary.searchScopes?.find((scope) => scope.kind === "core");
  const custom = summary.searchScopes?.find((scope) => scope.kind === "custom");
  // Do not label incomplete/legacy question sets as Core 8 + Custom 16.
  if (!core || !custom || core.validCount !== 8 || custom.validCount !== 16) {
    return null;
  }
  return { core, custom };
}

/**
 * A two-line owner overview, never an AI optimization score or causal claim.
 * All values come from the same existing v2 dashboard summary model.
 */
export function buildCompactSummaryInsights(
  summary: CompactSummarySource,
): CompactSummaryInsight[] {
  const items: CompactSummaryInsight[] = [];
  const total = summary.visibility.total;
  const visibility = summary.visibility.count;
  const scopes = compactSummarySearchScopes(summary);
  if (visibility === null || total === null || total <= 0) return items;

  if (visibility === 0) {
    items.push({
      id: "zero_confirmed",
      title: "이번 측정에서 내 업체의 확정 노출이 0건입니다",
      evidence: String(total) + "개 유효 답변 기준입니다. 전체 AI 검색에서 보이지 않는다는 뜻은 아닙니다.",
      recommendedCheck: "공식 홈페이지와 공개 프로필의 업체명·지점명·서비스·지역 표기를 비교해 보세요.",
    });
  } else if (
    scopes &&
    scopes.core.confirmedCount === 0 &&
    scopes.custom.confirmedCount > 0
  ) {
    items.push({
      id: "broad_scope_gap",
      title: "넓은 지역 기준 검색에서 확정 노출 0건",
      evidence:
        "기준 검색 0/8 · 맞춤 검색 " +
        scopes.custom.confirmedCount + "/16",
      recommendedCheck: "공식 홈페이지와 공개 프로필의 서비스 가능 지역·주력 서비스가 일관되게 안내되는지 확인해 보세요.",
    });
  }

  if (
    visibility > 0 &&
    summary.verifiedPageStatus === "complete" &&
    summary.verifiedPageCount === 0
  ) {
    items.push({
      id: "verified_page_zero",
      title: "인용된 페이지 중 내 업체 관련성 확정 0개",
      evidence: "이번 측정에서 인용된 페이지 검증 완료 기준입니다.",
      recommendedCheck: "실제 인용 페이지와 공식 채널의 업체명·지점·서비스 표기를 대조해 보세요.",
    });
  }

  if (summary.topCompetitor && summary.topCompetitor.responseCount >= 2) {
    items.push({
      id: "repeated_competitor",
      title: "다른 업체가 여러 답변에 반복 등장했습니다",
      evidence:
        summary.topCompetitor.name + " · " +
        summary.topCompetitor.responseCount + "/" + total + "개 답변",
      recommendedCheck: "반복 관찰된 업체의 검색 질문과 인용 출처를 내 업체의 관찰 결과와 비교해 보세요.",
    });
  }

  if (
    visibility > 0 &&
    summary.top3.count === 0 &&
    summary.top3.total !== null
  ) {
    items.push({
      id: "top3_unconfirmed",
      title: "내 업체의 상위 3곳 확정 노출은 0건입니다",
      evidence: "확정 노출 " + visibility + "/" + total +
        " · 상위 3곳 확정 0/" + summary.top3.total,
      recommendedCheck: "내 업체가 등장한 질문에서 상위 3곳에 확인된 업체를 함께 비교해 보세요.",
    });
  }

  if (
    visibility > 0 &&
    summary.verifiedPageStatus === "complete" &&
    summary.verifiedPageCount !== null &&
    summary.verifiedPageCount > 0
  ) {
    items.push({
      id: "verified_page_present",
      title: "내 업체 관련 인용 페이지가 확인됐습니다",
      evidence: "이번 측정에서 관련성 확정 " + summary.verifiedPageCount + "개",
      recommendedCheck: "관련성이 확인된 인용 페이지에서 업체명·지점·서비스 정보가 정확하게 안내되는지 확인해 보세요.",
    });
  }

  return items.slice(0, 2);
}
