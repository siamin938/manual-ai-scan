import type { SnapshotQuestion } from "./experiments.helpers";

export type LiveQuestionRow = {
  id: string;
  prompt_text: string;
  prompt_hash: string | null;
  intent_type: string;
  language: string;
  country_code: string;
  region: string | null;
  city: string | null;
  weight: number | string;
  data_class: string;
  active: boolean;
};

export type PinnedLiveQuestionsResult =
  | { ok: true; questions: SnapshotQuestion[] }
  | { ok: false; error: "FOLLOWUP_CONDITION_DRIFT" };

/**
 * Follow-up live condition은 Baseline snapshot에 pin된 질문만 대상으로 한다.
 * question_set에 추가 active 질문이 있어도 실험 조건이 아니므로 hash 입력에서 제외한다.
 */
export function buildPinnedLiveQuestions(
  baselineQuestions: readonly Pick<SnapshotQuestion, "id">[],
  liveRows: readonly LiveQuestionRow[],
): PinnedLiveQuestionsResult {
  const pinnedIds = baselineQuestions.map((q) => q.id);
  const uniquePinnedIds = new Set(pinnedIds);
  if (pinnedIds.length === 0 || uniquePinnedIds.size !== pinnedIds.length) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }

  const pinnedIdSet = new Set(pinnedIds);
  const rowById = new Map<string, LiveQuestionRow>();
  for (const row of liveRows) {
    if (pinnedIdSet.has(row.id)) rowById.set(row.id, row);
  }

  const questions: SnapshotQuestion[] = [];
  for (const id of pinnedIds) {
    const row = rowById.get(id);
    if (!row || !row.active || row.data_class !== "public") {
      return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
    }
    questions.push({
      id: row.id,
      prompt_text: row.prompt_text,
      prompt_hash: row.prompt_hash ?? null,
      intent_type: row.intent_type,
      language: row.language,
      country_code: row.country_code,
      region: row.region ?? null,
      city: row.city ?? null,
      weight: Number(row.weight),
      data_class: row.data_class,
      active: row.active,
    });
  }

  if (questions.length !== baselineQuestions.length) {
    return { ok: false, error: "FOLLOWUP_CONDITION_DRIFT" };
  }
  return { ok: true, questions };
}