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
    });
  }

  if (summary.topCompetitor && summary.topCompetitor.responseCount >= 2) {
    items.push({
      id: "repeated_competitor",
      title: "다른 업체가 여러 답변에 반복 등장했습니다",
      evidence:
        summary.topCompetitor.name + " · " +
        summary.topCompetitor.responseCount + "/" + total + "개 답변",
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
    });
  }

  return items.slice(0, 2);
}
