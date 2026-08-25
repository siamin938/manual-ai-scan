// Baseline 대상 질문 선택은 비공개 Supabase Edge Function(`experiment-baseline-select`)이 전담한다.
// 이 파일은 현재 사용자 JWT로 호출해 최소 DTO만 전달하는 얇은 wrapper이며,
// 선택 규칙/정렬/임계값은 이 저장소에 존재하지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type BaselineQuestionSelection =
  | { kind: "selected"; questionIds: string[] }
  | { kind: "legacy_fallback" }
  | { kind: "insufficient"; relatedCount: number };

type SelectResponse = {
  mode?: "selected" | "legacy_fallback" | "insufficient";
  questionIds?: unknown;
  relatedCount?: unknown;
};

/**
 * Edge Function 호출 wrapper. 실패하면 호출자가 fail-closed 하도록 null을 반환한다.
 */
export async function fetchBaselineQuestionSelection(args: {
  supabase: SupabaseClient<Database>;
  orgId: string;
  experimentId: string;
}): Promise<BaselineQuestionSelection | null> {
  const { data, error } = await args.supabase.functions.invoke<SelectResponse>(
    "experiment-baseline-select",
    { body: { orgId: args.orgId, experimentId: args.experimentId } },
  );
  if (error || !data) return null;

  if (data.mode === "legacy_fallback") return { kind: "legacy_fallback" };
  if (data.mode === "insufficient") {
    const count = Number(data.relatedCount);
    return { kind: "insufficient", relatedCount: Number.isFinite(count) ? count : 0 };
  }
  if (data.mode === "selected") {
    const ids = Array.isArray(data.questionIds)
      ? data.questionIds.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    if (ids.length === 0) return null;
    return { kind: "selected", questionIds: ids };
  }
  return null;
}
