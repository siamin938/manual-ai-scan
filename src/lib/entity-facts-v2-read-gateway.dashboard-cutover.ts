import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "./entity-facts-v2-read-gateway.types";
import {
  buildEntityFactsV2OverviewViewModel,
  entityFactsV2QuestionStatusViewModel,
  type EntityFactsV2MetricViewModel,
} from "./entity-facts-v2-read-gateway.viewmodel";

export const ENTITY_FACTS_V2_DASHBOARD_CUTOVER_VERSION = "0.1" as const;

export type EntityFactsV2DashboardCutoverMode =
  | "direct_v2"
  | "separate_existing"
  | "defer";

export type EntityFactsV2DashboardCutoverSection =
  | "recent_summary"
  | "visibility_metric"
  | "top3_metric"
  | "competitor_count"
  | "source_count"
  | "competitor_list"
  | "weak_questions"
  | "source_list"
  | "question_groups"
  | "business_selector"
  | "action_recommendations"
  | "benchmark"
  | "repeat_aggregate"
  | "repeat_context"
  | "trend"
  | "competitor_detail"
  | "reference_sources";

export type EntityFactsV2DashboardCutoverRule = {
  section: EntityFactsV2DashboardCutoverSection;
  mode: EntityFactsV2DashboardCutoverMode;
  note: string;
};

export const ENTITY_FACTS_V2_DASHBOARD_CUTOVER_MAP: readonly EntityFactsV2DashboardCutoverRule[] =
  [
    {
      section: "recent_summary",
      mode: "direct_v2",
      note: "Use v2 overview bounds and explicit uncertainty copy.",
    },
    {
      section: "visibility_metric",
      mode: "direct_v2",
      note: "Use the v2 View Model exact/range/unavailable state. Never collapse a range.",
    },
    {
      section: "top3_metric",
      mode: "direct_v2",
      note: "Use v2 Top3 lower/upper bounds with the same uncertainty semantics.",
    },
    {
      section: "competitor_count",
      mode: "direct_v2",
      note: "Use the customer-safe v2 competitor list length.",
    },
    {
      section: "source_count",
      mode: "direct_v2",
      note: "Use the observed-source supplement domain count while preserving strict targetSources separately.",
    },
    {
      section: "competitor_list",
      mode: "direct_v2",
      note: "Use v2 names/counts only. Do not synthesize legacy tier, repeat, newness or response-rate fields.",
    },
    {
      section: "weak_questions",
      mode: "direct_v2",
      note: "Use v2 questionAreas with partial/unresolved/missing states; exclude covered rows.",
    },
    {
      section: "source_list",
      mode: "direct_v2",
      note: "Use the accepted observed-source supplement for target + confirmed competitors. Do not claim source trust or causal recommendation reason.",
    },
    {
      section: "question_groups",
      mode: "direct_v2",
      note: "Use v2 lower/upper bounds per intent; do not replace them with one legacy mention rate.",
    },
    {
      section: "business_selector",
      mode: "separate_existing",
      note: "Navigation/scope selection is independent of Entity Facts truth.",
    },
    {
      section: "action_recommendations",
      mode: "defer",
      note: "Hide the legacy recommendation surface until its displayed counts use the same v2 truth contract.",
    },
    {
      section: "benchmark",
      mode: "separate_existing",
      note: "Keep benchmark as a separately sourced product surface; do not present it as v2 current-run truth.",
    },
    {
      section: "repeat_aggregate",
      mode: "defer",
      note: "Current repeat aggregate exposes one legacy mention rate; wait for v2 historical bounds.",
    },
    {
      section: "repeat_context",
      mode: "defer",
      note: "Current repeat context reads legacy measurements.was_client_mentioned and competitor significance.",
    },
    {
      section: "trend",
      mode: "defer",
      note: "Current trend uses legacy single-rate run metrics; wait for v2 lower/upper history.",
    },
    {
      section: "competitor_detail",
      mode: "defer",
      note: "Current detail/resolve functions use the legacy competitor contract; do not attach them to v2 rows yet.",
    },
    {
      section: "reference_sources",
      mode: "defer",
      note: "v2 targetSources does not provide the legacy referenceSources/sample-title contract.",
    },
  ] as const;

export type EntityFactsV2DashboardCompetitorRow = {
  name: string;
  responseCount: number;
  questionCount: number;
  top3ResponseCount: number;
  label: "함께 관찰";
};

export type EntityFactsV2DashboardSourceRow = {
  domain: string;
  responseCount: number;
  targetResponseCount: number;
  competitorResponseCount: number;
  clueResponseCount: number;
  evidence: "confirmed" | "mixed" | "clue";
  linkedEntities: Array<{
    name: string;
    isTarget: boolean;
    responseCount: number;
    evidence: "confirmed" | "clue";
  }>;
};

export type EntityFactsV2DashboardCitationSourceRow = {
  domain: string;
  responseCount: number;
  citationCount: number;
  sampleUrl: string;
};

export type EntityFactsV2DashboardTargetReferenceSourceRow = {
  domain: string;
  responseCount: number;
  sampleUrl: string;
};

export type EntityFactsV2DashboardVerifiedTargetCitationPageRow = {
  domain: string;
  title: string | null;
  responseCount: number;
  citationCount: number;
  sampleUrl: string;
  confidence: "high" | "medium";
  basisLabel: string;
};

export type EntityFactsV2DashboardQuestionAreaRow = {
  questionId: string;
  questionText: string;
  intentType: string;
  status: EntityFactsV2ReadQuestionAreaDTO["status"];
  statusLabel: string;
  statusTone: "positive" | "neutral" | "attention";
  confirmedMentionCount: number;
  unresolvedTargetCount: number;
  visibilityLowerBoundPct: number | null;
  visibilityUpperBoundPct: number | null;
  visibilityDisplayText: string | null;
};

export type EntityFactsV2DashboardQuestionGroupRow = {
  intentType: string;
  questionCount: number;
  validCount: number;
  confirmedMentionCount: number;
  unresolvedTargetCount: number;
  visibilityLowerBoundPct: number | null;
  visibilityUpperBoundPct: number | null;
  top3LowerBoundPct: number | null;
  top3UpperBoundPct: number | null;
};

export type EntityFactsV2DashboardCutoverModel = {
  version: typeof ENTITY_FACTS_V2_DASHBOARD_CUTOVER_VERSION;
  businessName: string;
  measuredAt: string;
  recentSummary: {
    visibility: EntityFactsV2MetricViewModel;
    top3: EntityFactsV2MetricViewModel;
    validCount: number;
    invalidCount: number;
    questionSummaryText: string;
    uncertaintyNotice: string | null;
    sourceQualityNotice: string | null;
    topCompetitor: { name: string; responseCount: number } | null;
  };
  metricCards: {
    visibility: EntityFactsV2MetricViewModel;
    top3: EntityFactsV2MetricViewModel;
    competitorCount: number;
    targetSourceCount: number;
    citationSourceCount: number;
    observedSourceCount: number;
  };
  competitors: {
    heading: "AI 답변에서 함께 관찰된 업체";
    rows: EntityFactsV2DashboardCompetitorRow[];
    legacyBadgesAvailable: false;
  };
  weakQuestions: {
    heading: "내 업체가 잘 보이지 않거나 추가 확인이 필요한 검색 질문";
    rows: EntityFactsV2DashboardQuestionAreaRow[];
  };
  citationSources: {
    heading: "AI 답변에서 실제 인용된 출처";
    rows: EntityFactsV2DashboardCitationSourceRow[];
  };
  targetReferenceSources: {
    heading: "내 업체 근접 연결 단서";
    rows: EntityFactsV2DashboardTargetReferenceSourceRow[];
  };
  targetExposureCitationSources: {
    heading: "내 업체 노출 답변에서 함께 인용된 출처";
    available: boolean;
    rows: EntityFactsV2DashboardCitationSourceRow[];
  };
  verifiedTargetCitationPages: {
    heading: "내 업체 관련성이 확인된 출처";
    available: boolean;
    rows: EntityFactsV2DashboardVerifiedTargetCitationPageRow[];
  };
  sources: {
    heading: "업체 연결까지 확인된 출처";
    available: boolean;
    rows: EntityFactsV2DashboardSourceRow[];
    referenceSourcesAvailable: false;
  };
  questionGroups: EntityFactsV2DashboardQuestionGroupRow[];
};

function formatQuestionPct(value: number): string {
  return `${Math.round(value * 100) / 100}%`;
}

function weakQuestionVisibilityDisplayText(
  item: EntityFactsV2ReadQuestionAreaDTO,
): string | null {
  const lower = item.visibilityLowerBoundPct;
  const upper = item.visibilityUpperBoundPct;

  // A single fully unresolved response gives the mathematically valid 0–100%
  // interval, but that number is not useful to a customer. Keep the
  // uncertainty explicit through the status/counts instead of showing it.
  if (
    item.status === "unresolved" &&
    item.confirmedMentionCount === 0 &&
    item.unresolvedTargetCount > 0 &&
    lower === 0 &&
    upper === 100
  ) {
    return null;
  }

  if (lower === null || upper === null) return null;
  return lower === upper
    ? formatQuestionPct(lower)
    : `${formatQuestionPct(lower)} ~ ${formatQuestionPct(upper)}`;
}

function weakQuestionRank(
  status: EntityFactsV2ReadQuestionAreaDTO["status"],
): number {
  switch (status) {
    case "unresolved":
      return 0;
    case "missing":
      return 1;
    case "partial":
      return 2;
    case "covered":
      return 3;
  }
}

export function buildEntityFactsV2DashboardCutoverModel(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2DashboardCutoverModel {
  const overviewVm = buildEntityFactsV2OverviewViewModel(dto);

  const topCompetitor =
    dto.competitors.length === 0
      ? null
      : dto.competitors.reduce((best, current) =>
          current.responseCount > best.responseCount ? current : best,
        );

  const competitors: EntityFactsV2DashboardCompetitorRow[] =
    dto.competitors.map((item) => ({
      name: item.name,
      responseCount: item.responseCount,
      questionCount: item.questionCount,
      top3ResponseCount: item.top3ResponseCount,
      label: "함께 관찰",
    }));

  const weakQuestions: EntityFactsV2DashboardQuestionAreaRow[] =
    dto.questionAreas
      .filter((item) => item.status !== "covered")
      .slice()
      .sort(
        (a, b) =>
          weakQuestionRank(a.status) - weakQuestionRank(b.status) ||
          (a.visibilityLowerBoundPct ?? 0) -
            (b.visibilityLowerBoundPct ?? 0) ||
          a.questionText.localeCompare(b.questionText, "ko"),
      )
      .map((item) => {
        const statusVm = entityFactsV2QuestionStatusViewModel(item.status);
        return {
          questionId: item.questionId,
          questionText: item.questionText,
          intentType: item.intentType,
          status: item.status,
          statusLabel: statusVm.label,
          statusTone: statusVm.tone,
          confirmedMentionCount: item.confirmedMentionCount,
          unresolvedTargetCount: item.unresolvedTargetCount,
          visibilityLowerBoundPct: item.visibilityLowerBoundPct,
          visibilityUpperBoundPct: item.visibilityUpperBoundPct,
          visibilityDisplayText: weakQuestionVisibilityDisplayText(item),
        };
      });

  const sources: EntityFactsV2DashboardSourceRow[] =
    dto.observedSources.map((item) => ({
      domain: item.domain,
      responseCount: item.responseCount,
      targetResponseCount: item.targetResponseCount,
      competitorResponseCount: item.competitorResponseCount,
      clueResponseCount: item.clueResponseCount,
      evidence: item.evidence,
      linkedEntities: item.linkedEntities.map((entity) => ({
        name: entity.name,
        isTarget: entity.isTarget,
        responseCount: entity.responseCount,
        evidence: entity.evidence,
      })),
    }));

  const citationSources: EntityFactsV2DashboardCitationSourceRow[] =
    (dto.citationSources ?? []).map((item) => ({
      domain: item.domain,
      responseCount: item.responseCount,
      citationCount: item.citationCount,
      sampleUrl: item.sampleUrl,
    }));

  const targetReferenceSources: EntityFactsV2DashboardTargetReferenceSourceRow[] =
    (dto.targetReferenceSources ?? []).map((item) => ({
      domain: item.domain,
      responseCount: item.responseCount,
      sampleUrl: item.sampleUrl,
    }));

  const targetExposureCitationSources: EntityFactsV2DashboardCitationSourceRow[] =
    (dto.targetExposureCitationSources ?? []).map((item) => ({
      domain: item.domain,
      responseCount: item.responseCount,
      citationCount: item.citationCount,
      sampleUrl: item.sampleUrl,
    }));

  const verifiedTargetCitationPages:
    EntityFactsV2DashboardVerifiedTargetCitationPageRow[] =
    (dto.verifiedTargetCitationPages ?? []).map((item) => ({
      domain: item.domain,
      title: item.title,
      responseCount: item.responseCount,
      citationCount: item.citationCount,
      sampleUrl: item.sampleUrl,
      confidence: item.confidence,
      basisLabel: item.basisLabel,
    }));

  const questionGroups: EntityFactsV2DashboardQuestionGroupRow[] =
    dto.questionGroups.map((item) => ({
      intentType: item.intentType,
      questionCount: item.questionCount,
      validCount: item.validCount,
      confirmedMentionCount: item.confirmedMentionCount,
      unresolvedTargetCount: item.unresolvedTargetCount,
      visibilityLowerBoundPct: item.visibilityLowerBoundPct,
      visibilityUpperBoundPct: item.visibilityUpperBoundPct,
      top3LowerBoundPct: item.top3LowerBoundPct,
      top3UpperBoundPct: item.top3UpperBoundPct,
    }));

  return {
    version: ENTITY_FACTS_V2_DASHBOARD_CUTOVER_VERSION,
    businessName: dto.business.name,
    measuredAt: dto.scope.measuredAt,
    recentSummary: {
      visibility: overviewVm.visibility,
      top3: overviewVm.top3,
      validCount: dto.overview.validCount,
      invalidCount: dto.overview.invalidCount,
      questionSummaryText: overviewVm.questionSummaryText,
      uncertaintyNotice: overviewVm.uncertaintyNotice,
      sourceQualityNotice: overviewVm.sourceQualityNotice,
      topCompetitor: topCompetitor
        ? { name: topCompetitor.name, responseCount: topCompetitor.responseCount }
        : null,
    },
    metricCards: {
      visibility: overviewVm.visibility,
      top3: overviewVm.top3,
      competitorCount: dto.competitors.length,
      targetSourceCount: dto.targetSources.length,
      citationSourceCount: citationSources.length,
      observedSourceCount: dto.observedSources.length,
    },
    competitors: {
      heading: "AI 답변에서 함께 관찰된 업체",
      rows: competitors,
      legacyBadgesAvailable: false,
    },
    weakQuestions: {
      heading: "내 업체가 잘 보이지 않거나 추가 확인이 필요한 검색 질문",
      rows: weakQuestions,
    },
    citationSources: {
      heading: "AI 답변에서 실제 인용된 출처",
      rows: citationSources,
    },
    targetReferenceSources: {
      heading: "내 업체 근접 연결 단서",
      rows: targetReferenceSources,
    },
    targetExposureCitationSources: {
      heading: "내 업체 노출 답변에서 함께 인용된 출처",
      available: dto.targetExposureCitationSources !== undefined,
      rows: targetExposureCitationSources,
    },
    verifiedTargetCitationPages: {
      heading: "내 업체 관련성이 확인된 출처",
      available: dto.verifiedTargetCitationPages !== undefined,
      rows: verifiedTargetCitationPages,
    },
    sources: {
      heading: "업체 연결까지 확인된 출처",
      available: dto.observedSourcesStatus === "available",
      rows: sources,
      referenceSourcesAvailable: false,
    },
    questionGroups,
  };
}
