import type {
  EntityFactsV2ComparisonDTO,
  EntityFactsV2ComparisonMetricDTO,
  EntityFactsV2ComparisonMetricSnapshot,
} from "./entity-facts-v2-comparison.types";

export const ENTITY_FACTS_V2_COMPARISON_VIEW_MODEL_VERSION = "0.1" as const;

export type EntityFactsV2ComparisonDisplayMode =
  | "comparison"
  | "trend"
  | "waiting"
  | "not_comparable"
  | "unavailable";

export type EntityFactsV2ComparisonMetricViewModel = {
  label: string;
  currentValueText: string;
  previousValueText: string | null;
  deltaText: string | null;
  comparisonSentence: string | null;
  uncertaintyText: string | null;
  maximumNotice: string | null;
};

export type EntityFactsV2ComparisonTrendPointViewModel = {
  measuredAt: string;
  confirmedPct: number | null;
  unresolvedCount: number;
};

export type EntityFactsV2ComparisonViewModel = {
  version: typeof ENTITY_FACTS_V2_COMPARISON_VIEW_MODEL_VERSION;
  mode: EntityFactsV2ComparisonDisplayMode;
  heading: string;
  description: string;
  comparisonAvailable: boolean;
  trendAvailable: boolean;
  compatibleMeasurementCount: number | null;
  visibility: EntityFactsV2ComparisonMetricViewModel | null;
  top3: EntityFactsV2ComparisonMetricViewModel | null;
  trendSeries: EntityFactsV2ComparisonTrendPointViewModel[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatPct(value: number | null): string {
  if (value === null) return "–";
  return `${round2(value)}%`;
}

function formatDelta(delta: number): string {
  const rounded = round2(delta);
  if (rounded > 0) return `+${rounded}%p`;
  if (rounded < 0) return `${rounded}%p`;
  return "0%p";
}

function deltaSentence(label: string, delta: number): string {
  const rounded = round2(delta);
  if (rounded > 0) {
    return `이전 동일 조건 측정보다 ${label}이 ${rounded}%p 높게 관찰되었습니다.`;
  }
  if (rounded < 0) {
    return `이전 동일 조건 측정보다 ${label}이 ${Math.abs(rounded)}%p 낮게 관찰되었습니다.`;
  }
  return `이전 동일 조건 측정과 ${label}이 같게 관찰되었습니다.`;
}

function uncertaintyText(
  current: EntityFactsV2ComparisonMetricSnapshot,
  previous: EntityFactsV2ComparisonMetricSnapshot | null,
): string | null {
  if (!previous) {
    return current.unresolvedCount > 0
      ? `현재 추가 확인이 필요한 응답 ${current.unresolvedCount}건`
      : null;
  }

  if (current.unresolvedCount === 0 && previous.unresolvedCount === 0) {
    return null;
  }

  return `추가 확인 응답: 이전 ${previous.unresolvedCount}건 · 현재 ${current.unresolvedCount}건`;
}

function maximumNotice(
  current: EntityFactsV2ComparisonMetricSnapshot,
): string | null {
  if (
    current.confirmedPct === null ||
    current.maxPct === null ||
    current.unresolvedCount <= 0 ||
    current.maxPct <= current.confirmedPct
  ) {
    return null;
  }

  return `추가 확인이 필요한 응답까지 모두 같은 업체로 확인될 경우 현재 최대 ${formatPct(current.maxPct)}`;
}

function metricViewModel(args: {
  label: string;
  metric: EntityFactsV2ComparisonMetricDTO;
  comparisonAvailable: boolean;
}): EntityFactsV2ComparisonMetricViewModel {
  const previous = args.comparisonAvailable ? args.metric.previous : null;
  const delta =
    args.comparisonAvailable ? args.metric.confirmedDeltaPctPoints : null;

  return {
    label: args.label,
    currentValueText: formatPct(args.metric.current.confirmedPct),
    previousValueText: previous
      ? formatPct(previous.confirmedPct)
      : null,
    deltaText: delta === null ? null : formatDelta(delta),
    comparisonSentence:
      delta === null ? null : deltaSentence(args.label, delta),
    uncertaintyText: uncertaintyText(args.metric.current, previous),
    maximumNotice: maximumNotice(args.metric.current),
  };
}

function unavailable(args: {
  heading: string;
  description: string;
}): EntityFactsV2ComparisonViewModel {
  return {
    version: ENTITY_FACTS_V2_COMPARISON_VIEW_MODEL_VERSION,
    mode: "unavailable",
    heading: args.heading,
    description: args.description,
    comparisonAvailable: false,
    trendAvailable: false,
    compatibleMeasurementCount: null,
    visibility: null,
    top3: null,
    trendSeries: [],
  };
}

export function buildEntityFactsV2ComparisonViewModel(
  dto: EntityFactsV2ComparisonDTO,
): EntityFactsV2ComparisonViewModel {
  if (dto.status === "unavailable") {
    if (dto.reason === "NO_CURRENT_CUSTOMER_RUN") {
      return unavailable({
        heading: "아직 비교할 측정 결과가 없습니다",
        description: "완료된 고객 측정이 생기면 이전 결과와의 비교 가능 여부를 확인합니다.",
      });
    }

    return unavailable({
      heading: "최근 측정의 비교 정보를 준비할 수 없습니다",
      description: "최근 측정의 진단 데이터가 준비된 뒤 비교 가능 여부를 다시 확인합니다.",
    });
  }

  if (!dto.currentRun || !dto.visibility || !dto.top3) {
    return unavailable({
      heading: "측정 비교를 준비할 수 없습니다",
      description: "비교에 필요한 최근 측정 정보를 확인할 수 없습니다.",
    });
  }

  if (dto.status === "unverified") {
    return {
      version: ENTITY_FACTS_V2_COMPARISON_VIEW_MODEL_VERSION,
      mode: "not_comparable",
      heading: "이전 측정과 직접 비교하지 않습니다",
      description:
        "현재 측정은 이전 측정과 조건이 같았는지 확인할 기록이 충분하지 않아 증감 수치를 만들지 않습니다. 다음 동일 조건 측정부터 안전하게 비교할 수 있습니다.",
      comparisonAvailable: false,
      trendAvailable: false,
      compatibleMeasurementCount: null,
      visibility: metricViewModel({
        label: "확정 AI 노출률",
        metric: dto.visibility,
        comparisonAvailable: false,
      }),
      top3: metricViewModel({
        label: "확정 상위 3곳 노출률",
        metric: dto.top3,
        comparisonAvailable: false,
      }),
      trendSeries: [],
    };
  }

  if (dto.status === "single") {
    return {
      version: ENTITY_FACTS_V2_COMPARISON_VIEW_MODEL_VERSION,
      mode: "waiting",
      heading: "비교 가능한 이전 측정이 아직 없습니다",
      description:
        "같은 질문과 측정 조건으로 한 번 더 측정을 완료하면 이전 결과와 안전하게 비교할 수 있습니다.",
      comparisonAvailable: false,
      trendAvailable: false,
      compatibleMeasurementCount: 1,
      visibility: metricViewModel({
        label: "확정 AI 노출률",
        metric: dto.visibility,
        comparisonAvailable: false,
      }),
      top3: metricViewModel({
        label: "확정 상위 3곳 노출률",
        metric: dto.top3,
        comparisonAvailable: false,
      }),
      trendSeries: [],
    };
  }

  const structurallyComparable =
    dto.status === "verified" &&
    dto.compatibleRunCount >= 2 &&
    dto.previousRun !== null &&
    dto.visibility.previous !== null &&
    dto.top3.previous !== null;

  if (!structurallyComparable) {
    return unavailable({
      heading: "측정 비교를 준비할 수 없습니다",
      description: "비교 조건은 확인됐지만 이전 측정 정보를 완전하게 확인할 수 없습니다.",
    });
  }

  const trendAvailable =
    dto.trendEligible &&
    dto.compatibleRunCount >= 3 &&
    dto.series.length >= 3;

  return {
    version: ENTITY_FACTS_V2_COMPARISON_VIEW_MODEL_VERSION,
    mode: trendAvailable ? "trend" : "comparison",
    heading: trendAvailable
      ? "동일 조건 측정 추세"
      : "이전 동일 조건 측정과 비교",
    description:
      "같은 질문과 측정 조건으로 확인된 결과끼리 비교합니다. 확정된 노출률의 변화만 비교하고 추가 확인이 필요한 응답은 별도로 표시합니다.",
    comparisonAvailable: true,
    trendAvailable,
    compatibleMeasurementCount: dto.compatibleRunCount,
    visibility: metricViewModel({
      label: "확정 AI 노출률",
      metric: dto.visibility,
      comparisonAvailable: true,
    }),
    top3: metricViewModel({
      label: "확정 상위 3곳 노출률",
      metric: dto.top3,
      comparisonAvailable: true,
    }),
    trendSeries: trendAvailable
      ? dto.series.map((point) => ({
          measuredAt: point.measuredAt,
          confirmedPct: point.visibility.confirmedPct,
          unresolvedCount: point.visibility.unresolvedCount,
        }))
      : [],
  };
}
