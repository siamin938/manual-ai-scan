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

export type EntityFactsV2DashboardSummaryViewModel = {
  version: typeof ENTITY_FACTS_V2_DASHBOARD_SUMMARY_VERSION;
  businessName: string;
  measuredAt: string;
  visibility: DashboardSummaryMetric;
  top3: DashboardSummaryMetric;
  verifiedPageCount: number | null;
  topCompetitor: { name: string; responseCount: number } | null;
  searchContexts: DashboardSummarySearchContext[];
  searchScopes: DashboardSummarySearchScope[] | null;
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

export function buildEntityFactsV2DashboardSummaryViewModel(args: {
  model: EntityFactsV2DashboardCutoverModel;
  unifiedLayerSummary: UnifiedDiagnosticLayerSummary | null;
  actionOpportunityModel: ActionOpportunityEngineResult | null;
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

  return {
    version: ENTITY_FACTS_V2_DASHBOARD_SUMMARY_VERSION,
    businessName: model.businessName,
    measuredAt: model.measuredAt,
    visibility: exactMetric({
      count: model.metricCards.visibility.confirmedCount,
      total: model.metricCards.visibility.validCount,
      lowerPct: model.metricCards.visibility.lowerPct,
    }),
    top3: exactMetric({
      count: model.metricCards.top3.confirmedCount,
      total: model.metricCards.top3.validCount,
      lowerPct: model.metricCards.top3.lowerPct,
    }),
    verifiedPageCount: model.verifiedTargetCitationPages.available
      ? model.verifiedTargetCitationPages.rows.length
      : null,
    topCompetitor: model.recentSummary.topCompetitor,
    searchContexts,
    searchScopes,
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