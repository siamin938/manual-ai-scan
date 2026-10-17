import type {
  EntityFactsV2ReadQuestionAreaDTO,
  EntityFactsV2ReadQuestionGroupDTO,
} from "./entity-facts-v2-read-gateway.types";

type SearchContextGroup = Pick<
  EntityFactsV2ReadQuestionGroupDTO,
  "intentType" | "questionCount" | "validCount" |
  "confirmedMentionCount" | "unresolvedTargetCount"
>;
type SearchContextQuestion = Pick<
  EntityFactsV2ReadQuestionAreaDTO,
  "questionId" | "questionText" | "intentType" |
  "validCount" | "confirmedMentionCount" | "unresolvedTargetCount"
>;

export type SearchContextQuestionEvidence = {
  intentType: string;
  questionCount: number;
  validCount: number;
  confirmedMentionCount: number;
  /** Null means the saved group cannot be proved from this Run's question rows. */
  questions: readonly SearchContextQuestion[] | null;
};

/**
 * Display-only join between one Run's SAVED intent groups and its SAVED
 * question texts. The original intentType is the question's creation-time
 * classification. Never infer a different intent from its wording and never
 * recompute the dashboard's authoritative v2 visibility numbers.
 */
export function buildSearchContextQuestionEvidence(
  groups: readonly SearchContextGroup[],
  areas: readonly SearchContextQuestion[],
): SearchContextQuestionEvidence[] {
  const duplicateGroup = new Set<string>();
  const seenGroup = new Set<string>();
  for (const group of groups) {
    if (seenGroup.has(group.intentType)) duplicateGroup.add(group.intentType);
    seenGroup.add(group.intentType);
  }

  return groups.map((group) => {
    const matching = areas.filter((area) => area.intentType === group.intentType);
    const ids = new Set(matching.map((area) => area.questionId));
    const valid = matching.reduce((sum, row) => sum + row.validCount, 0);
    const confirmed = matching.reduce((sum, row) => sum + row.confirmedMentionCount, 0);
    const unresolved = matching.reduce((sum, row) => sum + row.unresolvedTargetCount, 0);
    const consistent =
      !duplicateGroup.has(group.intentType) &&
      group.questionCount > 0 &&
      matching.length === group.questionCount &&
      ids.size === matching.length &&
      matching.every((row) =>
        row.questionId.trim().length > 0 &&
        row.questionText.trim().length > 0 &&
        Number.isInteger(row.validCount) && row.validCount >= 0 &&
        Number.isInteger(row.confirmedMentionCount) &&
        Number.isInteger(row.unresolvedTargetCount) &&
        row.confirmedMentionCount >= 0 &&
        row.unresolvedTargetCount >= 0 &&
        row.confirmedMentionCount + row.unresolvedTargetCount <= row.validCount
      ) &&
      valid === group.validCount &&
      confirmed === group.confirmedMentionCount &&
      unresolved === group.unresolvedTargetCount;

    return {
      intentType: group.intentType,
      questionCount: group.questionCount,
      validCount: group.validCount,
      confirmedMentionCount: group.confirmedMentionCount,
      questions: consistent ? matching : null,
    };
  });
}

export function searchContextQuestionEvidenceLabel(
  question: SearchContextQuestion,
): string {
  if (question.validCount === 0) return "유효 답변 없음";
  if (question.confirmedMentionCount > 0 && question.unresolvedTargetCount > 0) {
    return `확정 ${question.confirmedMentionCount} · 추가 확인 ${question.unresolvedTargetCount}`;
  }
  if (question.confirmedMentionCount > 0) {
    return `확정 노출 ${question.confirmedMentionCount}/${question.validCount}`;
  }
  if (question.unresolvedTargetCount > 0) {
    return `추가 확인 ${question.unresolvedTargetCount}/${question.validCount}`;
  }
  return "확정 노출 없음";
}
