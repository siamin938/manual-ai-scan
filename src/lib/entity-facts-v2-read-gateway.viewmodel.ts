import type {
  EntityFactsV2ReadBoundsDTO,
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "./entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_VIEW_MODEL_VERSION = "0.1" as const;

export type EntityFactsV2MetricDisplayKind =
  | "exact"
  | "range"
  | "unavailable";

export type EntityFactsV2MetricViewModel = {
  kind: EntityFactsV2MetricDisplayKind;
  valueText: string;
  lowerPct: number | null;
  upperPct: number | null;
  confirmedCount: number;
  unresolvedCount: number;
  validCount: number;
  summaryText: string;
  evidenceText: string;
};

export type EntityFactsV2QuestionStatusViewModel = {
  status: EntityFactsV2ReadQuestionAreaDTO["status"];
  label: string;
  tone: "positive" | "neutral" | "attention";
};

export type EntityFactsV2OverviewViewModel = {
  version: typeof ENTITY_FACTS_V2_VIEW_MODEL_VERSION;
  visibility: EntityFactsV2MetricViewModel;
  top3: EntityFactsV2MetricViewModel;
  questionSummaryText: string;
  uncertaintyNotice: string | null;
  sourceQualityNotice: string | null;
};

export type EntityFactsV2ReadGatewayViewModel = {
  version: typeof ENTITY_FACTS_V2_VIEW_MODEL_VERSION;
  businessName: string;
  measuredAt: string;
  overview: EntityFactsV2OverviewViewModel;
};

function formatPct(value: number | null): string {
  if (value === null) return "–";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}%`;
}

function metricViewModel(args: {
  bounds: EntityFactsV2ReadBoundsDTO;
  confirmedLabel: string;
  unresolvedLabel: string;
}): EntityFactsV2MetricViewModel {
  const { bounds } = args;
  const lower = bounds.visibilityLowerBoundPct;
  const upper = bounds.visibilityUpperBoundPct;

  if (lower === null || upper === null || bounds.validCount === 0) {
    return {
      kind: "unavailable",
      valueText: "–",
      lowerPct: lower,
      upperPct: upper,
      confirmedCount: bounds.confirmedMentionCount,
      unresolvedCount: bounds.unresolvedTargetCount,
      validCount: bounds.validCount,
      summaryText: "표시할 수 있는 유효 응답이 없습니다.",
      evidenceText: "유효 응답이 없어 비율을 계산하지 않습니다.",
    };
  }

  if (lower === upper) {
    return {
      kind: "exact",
      valueText: formatPct(lower),
      lowerPct: lower,
      upperPct: upper,
      confirmedCount: bounds.confirmedMentionCount,
      unresolvedCount: bounds.unresolvedTargetCount,
      validCount: bounds.validCount,
      summaryText: `${args.confirmedLabel} ${bounds.confirmedMentionCount}건 · 유효 응답 ${bounds.validCount}건`,
      evidenceText:
        bounds.unresolvedTargetCount === 0
          ? "이번 측정에서는 추가 확인이 필요한 대상 판정이 없습니다."
          : `${args.unresolvedLabel} ${bounds.unresolvedTargetCount}건이 있지만 현재 범위에는 영향을 주지 않았습니다.`,
    };
  }

  return {
    kind: "range",
    valueText: `${formatPct(lower)} ~ ${formatPct(upper)}`,
    lowerPct: lower,
    upperPct: upper,
    confirmedCount: bounds.confirmedMentionCount,
    unresolvedCount: bounds.unresolvedTargetCount,
    validCount: bounds.validCount,
    summaryText: `확정 기준 ${formatPct(lower)} · 추가 확인이 필요한 응답 포함 시 최대 ${formatPct(upper)}`,
    evidenceText: `유효 응답 ${bounds.validCount}건 중 ${args.confirmedLabel} ${bounds.confirmedMentionCount}건 · ${args.unresolvedLabel} ${bounds.unresolvedTargetCount}건`,
  };
}

export function buildEntityFactsV2OverviewViewModel(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2OverviewViewModel {
  const overview = dto.overview;

  const visibility = metricViewModel({
    bounds: overview,
    confirmedLabel: "확정 노출",
    unresolvedLabel: "추가 확인 필요",
  });

  const top3Bounds: EntityFactsV2ReadBoundsDTO = {
    validCount: overview.validCount,
    confirmedMentionCount: overview.confirmedTop3Count,
    unresolvedTargetCount: overview.top3UncertainCount,
    visibilityLowerBoundPct: overview.top3LowerBoundPct,
    visibilityUpperBoundPct: overview.top3UpperBoundPct,
    confirmedTop3Count: overview.confirmedTop3Count,
    top3UncertainCount: overview.top3UncertainCount,
    top3LowerBoundPct: overview.top3LowerBoundPct,
    top3UpperBoundPct: overview.top3UpperBoundPct,
  };

  const top3 = metricViewModel({
    bounds: top3Bounds,
    confirmedLabel: "상위 3곳 확정",
    unresolvedLabel: "상위 3곳 여부 추가 확인 필요",
  });

  const questionSummaryText =
    `질문 ${overview.questionCount}개 중 노출 확인 ${overview.coveredQuestionCount}개 · ` +
    `추가 확인 필요 ${overview.unresolvedQuestionCount}개 · 노출 미확인 ${overview.missingQuestionCount}개`;

  const uncertaintyNotice =
    overview.unresolvedTargetCount > 0
      ? "메인 노출률은 내 업체로 확정된 응답만 계산합니다. 동일성 확인이 더 필요한 응답은 별도로 표시하며, 상세 분석에서는 가능한 최대 범위를 함께 참고합니다."
      : null;

  const sourceQualityNotice =
    overview.sourcePartialMeasurementCount > 0
      ? `출처 연결을 추가로 확인할 응답이 ${overview.sourcePartialMeasurementCount}건 있습니다.`
      : null;

  return {
    version: ENTITY_FACTS_V2_VIEW_MODEL_VERSION,
    visibility,
    top3,
    questionSummaryText,
    uncertaintyNotice,
    sourceQualityNotice,
  };
}

export function buildEntityFactsV2ReadGatewayViewModel(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2ReadGatewayViewModel {
  return {
    version: ENTITY_FACTS_V2_VIEW_MODEL_VERSION,
    businessName: dto.business.name,
    measuredAt: dto.scope.measuredAt,
    overview: buildEntityFactsV2OverviewViewModel(dto),
  };
}

export function entityFactsV2QuestionStatusViewModel(
  status: EntityFactsV2ReadQuestionAreaDTO["status"],
): EntityFactsV2QuestionStatusViewModel {
  switch (status) {
    case "covered":
      return { status, label: "노출 확인", tone: "positive" };
    case "partial":
      return { status, label: "일부 노출 확인", tone: "neutral" };
    case "unresolved":
      return { status, label: "추가 확인 필요", tone: "attention" };
    case "missing":
      return { status, label: "노출 미확인", tone: "neutral" };
  }
}
