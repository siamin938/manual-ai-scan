import type { EntityFactsV2ReadQuestionAreaDTO } from "./entity-facts-v2-read-gateway.types";

export type UnifiedDiagnosticQuestionLocation = {
  id: string;
  city: string | null;
};

export type UnifiedDiagnosticLayerMetric = {
  questionCount: number;
  validCount: number;
  confirmedCount: number;
  unresolvedCount: number;
};

export type UnifiedDiagnosticLayerSummary = {
  overall: UnifiedDiagnosticLayerMetric;
  custom: UnifiedDiagnosticLayerMetric;
  core: UnifiedDiagnosticLayerMetric;
};

function summarize(
  rows: readonly EntityFactsV2ReadQuestionAreaDTO[],
): UnifiedDiagnosticLayerMetric {
  return rows.reduce<UnifiedDiagnosticLayerMetric>(
    (acc, row) => ({
      questionCount: acc.questionCount + 1,
      validCount: acc.validCount + row.validCount,
      confirmedCount: acc.confirmedCount + row.confirmedMentionCount,
      unresolvedCount: acc.unresolvedCount + row.unresolvedTargetCount,
    }),
    {
      questionCount: 0,
      validCount: 0,
      confirmedCount: 0,
      unresolvedCount: 0,
    },
  );
}

/**
 * 통합 진단 v0.2의 저장 계약을 이용해 Core 8 + Custom 16을 안전하게 분리한다.
 *
 * - Core: city = null (8문항)
 * - Custom: city != null (16문항)
 * - 모든 questionArea가 실제 questions row와 1:1 매칭되어야 한다.
 * - overview 합계와 맞지 않으면 고객 화면에는 분리 요약을 표시하지 않는다.
 *
 * 광역 지역만 등록된 업체처럼 이 계약으로 역할을 확정할 수 없는 경우 null을 반환한다.
 */
export function buildUnifiedDiagnosticLayerSummary(args: {
  questionAreas: readonly EntityFactsV2ReadQuestionAreaDTO[];
  questionLocations: readonly UnifiedDiagnosticQuestionLocation[];
  overview: {
    validCount: number;
    confirmedMentionCount: number;
    unresolvedTargetCount: number;
  };
}): UnifiedDiagnosticLayerSummary | null {
  const { questionAreas, questionLocations, overview } = args;
  if (questionAreas.length !== 24 || questionLocations.length !== 24) return null;

  const locationById = new Map<string, UnifiedDiagnosticQuestionLocation>();
  for (const row of questionLocations) {
    if (!row.id || locationById.has(row.id)) return null;
    locationById.set(row.id, row);
  }

  const coreRows: EntityFactsV2ReadQuestionAreaDTO[] = [];
  const customRows: EntityFactsV2ReadQuestionAreaDTO[] = [];

  for (const area of questionAreas) {
    const location = locationById.get(area.questionId);
    if (!location) return null;
    if (location.city === null) coreRows.push(area);
    else if (location.city.trim().length > 0) customRows.push(area);
    else return null;
  }

  if (coreRows.length !== 8 || customRows.length !== 16) return null;

  const overall = summarize(questionAreas);
  const core = summarize(coreRows);
  const custom = summarize(customRows);

  if (
    overall.validCount !== overview.validCount ||
    overall.confirmedCount !== overview.confirmedMentionCount ||
    overall.unresolvedCount !== overview.unresolvedTargetCount ||
    core.validCount + custom.validCount !== overall.validCount ||
    core.confirmedCount + custom.confirmedCount !== overall.confirmedCount ||
    core.unresolvedCount + custom.unresolvedCount !== overall.unresolvedCount
  ) {
    return null;
  }

  return { overall, custom, core };
}

export function confirmedRatePct(metric: UnifiedDiagnosticLayerMetric): number | null {
  if (metric.validCount <= 0) return null;
  return Math.round((metric.confirmedCount / metric.validCount) * 10000) / 100;
}
