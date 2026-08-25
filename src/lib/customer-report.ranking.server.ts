// Core Engine Isolation: 이 파일은 Supabase Edge Function `customer-report-action-ranking`
// 호출 wrapper일 뿐이다. 우선순위/정렬/상위 선택 규칙은 이 저장소에 없다.
// 요청은 현재 사용자 JWT로 전송되며 최소 식별자만 보낸다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type UserClient = SupabaseClient<Database>;

const RANKING_FUNCTION = "customer-report-action-ranking";

export type RankedCustomerActionDTO = {
  id: string;
  title: string;
  actionType: string | null;
  recommendedAction: string;
  rationale: string;
  validationPlan: string;
  evidenceGrade: string;
  recommendationMode: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Edge Function이 준 최소 DTO를 형태만 확인하고 통과시킨다. */
function asRankedAction(value: unknown): RankedCustomerActionDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  const id = a["id"] ?? a["action_id"];
  if (typeof id !== "string") return null;
  return {
    id,
    title: str(a["title"]),
    actionType: typeof a["actionType"] === "string"
      ? a["actionType"]
      : typeof a["action_type"] === "string"
        ? a["action_type"]
        : null,
    recommendedAction: str(a["recommendedAction"] ?? a["recommended_action"]),
    rationale: str(a["rationale"]),
    validationPlan: str(a["validationPlan"] ?? a["validation_plan"]),
    evidenceGrade: str(a["evidenceGrade"] ?? a["evidence_grade"]),
    recommendationMode: str(a["recommendationMode"] ?? a["recommendation_mode"]),
  };
}

/** 고객 보고서용 Action 목록. 순서와 상위 선택은 Edge Function이 결정한다. */
export async function fetchRankedCustomerActions(args: {
  supabase: UserClient;
  orgId: string;
  engineRunId: string;
  limit: number;
}): Promise<RankedCustomerActionDTO[]> {
  const { data, error } = await args.supabase.functions.invoke(RANKING_FUNCTION, {
    body: { orgId: args.orgId, engineRunId: args.engineRunId, limit: args.limit },
  });

  if (error) {
    console.error(`[customer-report] ${RANKING_FUNCTION} invoke failed`);
    return [];
  }

  const payload = (data ?? null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || payload["ok"] !== true) return [];
  const raw = payload["actions"];
  if (!Array.isArray(raw)) return [];
  return raw.map(asRankedAction).filter((a): a is RankedCustomerActionDTO => a !== null);
}
