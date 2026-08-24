// 순수 helper: Insight Action의 source findings에서 Baseline 대상 질문을 결정적으로 선택한다.
// DB/네트워크 접근 없음. 클라이언트 입력을 신뢰하지 않는 서버 로직에서만 사용된다.

export type BaselineFindingCandidate = {
  finding_key: string;
  question_id: string | null;
  priority_score: number | null;
  metric_value: number | null;
};

export type BaselineQuestionSelection =
  | { kind: "selected"; questionIds: string[] }
  | { kind: "legacy_fallback" }
  | { kind: "insufficient"; relatedCount: number };

/**
 * 결정적 정렬:
 *  priority_score DESC → metric_value ASC (NULLS LAST) → finding_key ASC
 * question_id dedupe 후 상위 expectedCount개를 선택한다.
 */
export function selectBaselineQuestionIds(
  findings: readonly BaselineFindingCandidate[],
  expectedCount: number,
): BaselineQuestionSelection {
  const candidates = findings.filter(
    (f): f is BaselineFindingCandidate & { question_id: string } =>
      typeof f.question_id === "string" && f.question_id.length > 0,
  );

  const sorted = [...candidates].sort((a, b) => {
    const pa = Number.isFinite(a.priority_score) ? Number(a.priority_score) : -Infinity;
    const pb = Number.isFinite(b.priority_score) ? Number(b.priority_score) : -Infinity;
    if (pa !== pb) return pb - pa;

    const ma = a.metric_value === null || !Number.isFinite(a.metric_value) ? null : Number(a.metric_value);
    const mb = b.metric_value === null || !Number.isFinite(b.metric_value) ? null : Number(b.metric_value);
    if (ma !== mb) {
      if (ma === null) return 1; // NULLS LAST
      if (mb === null) return -1;
      return ma - mb;
    }
    return a.finding_key < b.finding_key ? -1 : a.finding_key > b.finding_key ? 1 : 0;
  });

  const unique: string[] = [];
  for (const f of sorted) {
    if (!unique.includes(f.question_id)) unique.push(f.question_id);
  }

  if (unique.length === 0) return { kind: "legacy_fallback" };
  if (unique.length < expectedCount) return { kind: "insufficient", relatedCount: unique.length };
  return { kind: "selected", questionIds: unique.slice(0, expectedCount) };
}
