/* =========================================================================
 * 고객 보고서 v0.2 — Action 표시 우선순위 (읽기 전용 정렬 규칙)
 * DB/엔진 계산식은 수정하지 않고, 표시 순서만 결정한다.
 * ========================================================================= */

/** 근거 수준(보수적 의미 보존): 높은 근거가 항상 먼저 검토된다. */
const GRADE_RANK: Record<string, number> = {
  strong: 3,
  supported: 2,
  directional: 1,
  insufficient: 0,
};

/** 같은 근거 수준 안에서의 고객 실행 우선순위. */
const ACTION_TYPE_RANK: Record<string, number> = {
  visibility_gap_test: 0,
  question_sensitivity_test: 1,
  competitor_substitution_test: 2,
  source_association_test: 3,
};

const OTHER_ACTION_RANK = 99;

export function gradeRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}

export function actionTypeRank(actionType: string | null | undefined): number {
  if (!actionType) return OTHER_ACTION_RANK;
  return ACTION_TYPE_RANK[actionType] ?? OTHER_ACTION_RANK;
}

export type OrderableAction = {
  actionType: string | null;
  evidenceGrade: string | null;
  priorityScore: number;
};

/**
 * 1) 근거 수준 높은 순 (evidence 의미 보존)
 * 2) 같은 근거 수준 내에서 고객 실행 우선순위
 * 3) 동일 조건이면 기존 priority_score 높은 순
 */
export function compareCustomerActions(a: OrderableAction, b: OrderableAction): number {
  const g = gradeRank(b.evidenceGrade) - gradeRank(a.evidenceGrade);
  if (g !== 0) return g;
  const t = actionTypeRank(a.actionType) - actionTypeRank(b.actionType);
  if (t !== 0) return t;
  return b.priorityScore - a.priorityScore;
}
