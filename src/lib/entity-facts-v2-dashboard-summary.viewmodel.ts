import type { ActionOpportunityEngineResult } from "./action-opportunity-engine-v01";
import type { EntityFactsV2DashboardCutoverModel } from "./entity-facts-v2-read-gateway.dashboard-cutover";
import {
  confirmedRatePct,
  type UnifiedDiagnosticLayerSummary,
} from "./unified-diagnostic-layer-summary";

export const ENTITY_FACTS_V2_DASHBOARD_SUMMARY_VERSION = "0.1" as const;

export type DashboardSummaryMetric = {
  count: number | null;
  total: number | null;
  pct: number | null;
};

export type DashboardSummarySearchContext = {
  intentType: string;
  confirmedCount: number;
  validCount: number;
  confirmedPct: number | null;
};

export type DashboardSummarySearchScope = {
  kind: "custom" | "core" | "overall";
  confirmedCount: number;
  validCount: number;
  confirmedPct: number | null;
};

export type DashboardSummarySearchScopeObservation = {
  kind: "custom_without_core";
  headline: string;
  evidence: string | null;
};

export type DashboardSummaryHeroVariant =
  | "unavailable"
  | "not_visible"
  | "visible_no_top3"
  | "visible_top3";

export type EntityFactsV2DashboardSummaryViewModel = {
  version: typeof ENTITY_FACTS_V2_DASHBOARD_SUMMARY_VERSION;
  businessName: string;
  measuredAt: string;
  visibility: DashboardSummaryMetric;
  top3: DashboardSummaryMetric;
  heroVariant: DashboardSummaryHeroVariant;
  verifiedPageCount: number | null;
  competitorCount: number;
  topCompetitor: { name: string; responseCount: number } | null;
  searchContexts: DashboardSummarySearchContext[];
  searchScopes: DashboardSummarySearchScope[] | null;
  searchScopeObservation: DashboardSummarySearchScopeObservation | null;
  opportunities: Array<{
    rank: number;
    title: string;
    observation: string;
  }>;
  verifiedPages: Array<{
    domain: string;
    title: string | null;
    responseCount: number;
    sampleUrl: string;
  }>;
};

function heroVariantFor(
  visibility: DashboardSummaryMetric,
  top3: DashboardSummaryMetric,
): DashboardSummaryHeroVariant {
  if (
    visibility.count === null ||
    visibility.total === null ||
    top3.count === null
  ) {
    return "unavailable";
  }
  if (visibility.count === 0) return "not_visible";
  if (top3.count === 0) return "visible_no_top3";
  return "visible_top3";
}

function exactMetric(args: {
  count: number;
  total: number;
  lowerPct: number | null;
}): DashboardSummaryMetric {
  if (args.total <= 0 || args.lowerPct === null) {
    return { count: null, total: null, pct: null };
  }

  return {
    count: args.count,
    total: args.total,
    pct: args.lowerPct,
  };
}

function buildSearchScopeObservation(args: {
  unifiedLayerSummary: UnifiedDiagnosticLayerSummary | null;
  hasVerifiedOwnedDomain: boolean;
  broadSearchObservation:
    | {
        validCount: number;
        targetIndependentSourceResponseCount: number;
      }
    | null;
}): DashboardSummarySearchScopeObservation | null {
  const summary = args.unifiedLayerSummary;
  if (
    !summary ||
    summary.custom.confirmedCount <= 0 ||
    summary.core.confirmedCount !== 0
  ) {
    return null;
  }

  const headline =
    `상세 검색 ${summary.custom.confirmedCount}/${summary.custom.validCount}에서는 확인됐지만, ` +
    `기준 검색 ${summary.core.confirmedCount}/${summary.core.validCount}에서는 확인되지 않았습니다.`;

  let evidence: string | null = null;
  if (
    args.broadSearchObservation &&
    args.broadSearchObservation.targetIndependentSourceResponseCount === 0
  ) {
    evidence = args.hasVerifiedOwnedDomain
      ? "공식 홈페이지는 등록돼 있지만, 이번 기준 검색 답변에서는 내 업체와 독립 웹 출처 연결이 확인되지 않았습니다."
      : "이번 기준 검색 답변에서는 내 업체와 독립 웹 출처 연결이 확인되지 않았습니다.";
  }

  return {
    kind: "custom_without_core",
    headline,
    evidence,
  };
}

export function buildEntityFactsV2DashboardSummaryViewModel(args: {
  model: EntityFactsV2DashboardCutoverModel;
  unifiedLayerSummary: UnifiedDiagnosticLayerSummary | null;
  actionOpportunityModel: ActionOpportunityEngineResult | null;
  hasVerifiedOwnedDomain?: boolean;
  broadSearchObservation?:
    | {
        validCount: number;
        targetIndependentSourceResponseCount: number;
      }
    | null;
}): EntityFactsV2DashboardSummaryViewModel {
  const { model, unifiedLayerSummary, actionOpportunityModel } = args;

  const searchContexts = model.questionGroups
    .filter((group) => group.confirmedMentionCount > 0)
    .slice()
    .sort(
      (a, b) =>
        b.confirmedMentionCount - a.confirmedMentionCount ||
        b.validCount - a.validCount ||
        a.intentType.localeCompare(b.intentType, "ko"),
    )
    .slice(0, 3)
    .map((group) => ({
      intentType: group.intentType,
      confirmedCount: group.confirmedMentionCount,
      validCount: group.validCount,
      confirmedPct: group.visibilityLowerBoundPct,
    }));

  const searchScopes = unifiedLayerSummary
    ? ([
        { kind: "custom" as const, metric: unifiedLayerSummary.custom },
        { kind: "core" as const, metric: unifiedLayerSummary.core },
        { kind: "overall" as const, metric: unifiedLayerSummary.overall },
      ].map(({ kind, metric }) => ({
        kind,
        confirmedCount: metric.confirmedCount,
        validCount: metric.validCount,
        confirmedPct: confirmedRatePct(metric),
      })))
    : null;

  const visibility = exactMetric({
    count: model.metricCards.visibility.confirmedCount,
    total: model.metricCards.visibility.validCount,
    lowerPct: model.metricCards.visibility.lowerPct,
  });
  const top3 = exactMetric({
    count: model.metricCards.top3.confirmedCount,
    total: model.metricCards.top3.validCount,
    lowerPct: model.metricCards.top3.lowerPct,
  });
  const searchScopeObservation = buildSearchScopeObservation({
    unifiedLayerSummary,
    hasVerifiedOwnedDomain: args.hasVerifiedOwnedDomain === true,
    broadSearchObservation: args.broadSearchObservation ?? null,
  });

  return {
    version: ENTITY_FACTS_V2_DASHBOARD_SUMMARY_VERSION,
    businessName: model.businessName,
    measuredAt: model.measuredAt,
    visibility,
    top3,
    heroVariant: heroVariantFor(visibility, top3),
    verifiedPageCount: model.verifiedTargetCitationPages.available
      ? model.verifiedTargetCitationPages.rows.length
      : null,
    competitorCount: model.metricCards.competitorCount,
    topCompetitor: model.recentSummary.topCompetitor,
    searchContexts,
    searchScopes,
    searchScopeObservation,
    opportunities:
      actionOpportunityModel?.items.slice(0, 2).map((item) => ({
        rank: item.rank,
        title: item.title,
        observation: item.whyText,
      })) ?? [],
    verifiedPages: model.verifiedTargetCitationPages.available
      ? model.verifiedTargetCitationPages.rows.slice(0, 3).map((page) => ({
          domain: page.domain,
          title: page.title,
          responseCount: page.responseCount,
          sampleUrl: page.sampleUrl,
        }))
      : [],
  };
}