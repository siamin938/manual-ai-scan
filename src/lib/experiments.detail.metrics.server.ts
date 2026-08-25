// 서버 전용: 실험 상세 화면 표시용 기술통계(카운트/비율) 집계.
// 판정/threshold/classification 규칙은 포함하지 않는다. 평가 판정은 Supabase
// Edge Function `experiment-evaluation`이 전담한다.

export type DetailMeasurementFact = {
  measurementId: string;
  questionId: string;
  valid: boolean;
  wasClientMentioned: boolean;
  clientPosition: number | null;
  clientDomainCited: boolean;
  manualReviewRequired: boolean;
  parserVersion: string;
  providerModel: string;
  registeredCompetitorMention: boolean;
};

export type DetailQuestionMetrics = {
  questionId: string;
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
};

export type DetailPhaseMetrics = {
  validCount: number;
  inclusionCount: number;
  inclusionRate: number | null;
  top3Count: number;
  top3Rate: number | null;
  positionObservedCount: number;
  averagePositionAmongPositioned: number | null;
  clientDomainCitedCount: number;
  clientDomainCitedRate: number | null;
  substitutionCount: number;
  substitutionRate: number | null;
  manualReviewRequiredCount: number;
  parserVersions: string[];
  providerModels: string[];
  byQuestion: DetailQuestionMetrics[];
};

function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function isPositiveInt(v: number | null): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** valid measurement만 분모로 사용하는 표시용 집계. */
export function computeDetailPhaseMetrics(
  facts: readonly DetailMeasurementFact[],
): DetailPhaseMetrics {
  const valid = facts.filter((f) => f.valid);
  const validCount = valid.length;
  const inclusionCount = valid.filter((f) => f.wasClientMentioned).length;
  const top3Count = valid.filter(
    (f) => f.wasClientMentioned && isPositiveInt(f.clientPosition) && f.clientPosition <= 3,
  ).length;
  const positions = valid
    .filter((f) => f.wasClientMentioned && isPositiveInt(f.clientPosition))
    .map((f) => f.clientPosition as number);
  const domainCited = valid.filter((f) => f.clientDomainCited).length;
  const substitution = valid.filter(
    (f) => !f.wasClientMentioned && f.registeredCompetitorMention,
  ).length;

  const byQuestionMap = new Map<string, { valid: number; inclusion: number }>();
  for (const f of valid) {
    const cur = byQuestionMap.get(f.questionId) ?? { valid: 0, inclusion: 0 };
    cur.valid += 1;
    if (f.wasClientMentioned) cur.inclusion += 1;
    byQuestionMap.set(f.questionId, cur);
  }

  return {
    validCount,
    inclusionCount,
    inclusionRate: rate(inclusionCount, validCount),
    top3Count,
    top3Rate: rate(top3Count, validCount),
    positionObservedCount: positions.length,
    averagePositionAmongPositioned:
      positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
    clientDomainCitedCount: domainCited,
    clientDomainCitedRate: rate(domainCited, validCount),
    substitutionCount: substitution,
    substitutionRate: rate(substitution, validCount),
    manualReviewRequiredCount: valid.filter((f) => f.manualReviewRequired).length,
    parserVersions: [...new Set(facts.map((f) => f.parserVersion))].sort(),
    providerModels: [...new Set(facts.map((f) => f.providerModel))].sort(),
    byQuestion: [...byQuestionMap.entries()]
      .map(([questionId, v]) => ({
        questionId,
        validCount: v.valid,
        inclusionCount: v.inclusion,
        inclusionRate: rate(v.inclusion, v.valid),
      }))
      .sort((a, b) => (a.questionId < b.questionId ? -1 : 1)),
  };
}

/** rate 차이를 %p로. 한쪽이 null이면 null. */
export function detailDeltaPp(
  baseRate: number | null,
  followRate: number | null,
): number | null {
  if (baseRate === null || followRate === null) return null;
  return (followRate - baseRate) * 100;
}

const PROMPT_SNIPPET_MAX = 120;

/** 질문 prompt 노출 최소화용 축약. */
export function detailPromptSnippet(text: string): string {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length <= PROMPT_SNIPPET_MAX ? t : `${t.slice(0, PROMPT_SNIPPET_MAX)}…`;
}
