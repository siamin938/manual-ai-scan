// Core Engine Isolation: 이 파일은 Supabase Edge Function `experiment-evaluation`
// 호출 wrapper일 뿐이다. 평가 지표 계산/판정/threshold/누적 규칙은 이 저장소에 없다.
// 요청은 현재 사용자 JWT로 전송되며 { mode, orgId, experimentId }만 보낸다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  evaluationFail,
  type EvaluationErrorCode,
  type ExperimentEvaluationDTO,
  type FinalizeExperimentEvaluationResult,
  type PreviewExperimentEvaluationResult,
} from "./experiments.evaluation.helpers";

type UserClient = SupabaseClient<Database>;

const EVALUATION_FUNCTION = "experiment-evaluation";

const ERROR_CODES = new Set<EvaluationErrorCode>([
  "FORBIDDEN",
  "EXPERIMENT_NOT_FOUND",
  "EVALUATION_INVALID_STATE",
  "EVALUATION_BASELINE_NOT_FINALIZED",
  "EVALUATION_FOLLOWUP_NOT_FINALIZED",
  "EVALUATION_CONDITION_MISMATCH",
  "EVALUATION_PARSER_DRIFT",
  "EVALUATION_DATA_MISMATCH",
  "EVALUATION_PIPELINE_PROVENANCE_MISMATCH",
  "EVALUATION_ALREADY_RECORDED",
  "INTERNAL_ERROR",
]);

function asErrorCode(value: unknown): EvaluationErrorCode {
  return typeof value === "string" && ERROR_CODES.has(value as EvaluationErrorCode)
    ? (value as EvaluationErrorCode)
    : "INTERNAL_ERROR";
}

/** Edge Function이 준 최소 DTO를 그대로 통과시키되, 형태만 확인한다. */
function asEvaluationDTO(value: unknown): ExperimentEvaluationDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dto = value as Partial<ExperimentEvaluationDTO>;
  if (typeof dto.experimentId !== "string" || typeof dto.outcome !== "string") return null;
  if (!dto.baseline || !dto.followup || !dto.delta || !Array.isArray(dto.questionResults)) {
    return null;
  }
  return dto as ExperimentEvaluationDTO;
}

async function invokeEvaluation(args: {
  supabase: UserClient;
  mode: "preview" | "finalize";
  orgId: string;
  experimentId: string;
}): Promise<{ ok: true; evaluation: ExperimentEvaluationDTO } | { ok: false; error: EvaluationErrorCode }> {
  const { data, error } = await args.supabase.functions.invoke(EVALUATION_FUNCTION, {
    body: { mode: args.mode, orgId: args.orgId, experimentId: args.experimentId },
  });

  if (error) {
    // Edge Function이 비2xx로 응답하면 body의 error code를 우선 사용한다.
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body = (await ctx.clone().json()) as { error?: unknown };
        if (body?.error !== undefined) return evaluationFail(asErrorCode(body.error));
      } catch {
        /* body 파싱 실패는 INTERNAL_ERROR로 취급 */
      }
    }
    console.error(`[evaluation] ${EVALUATION_FUNCTION} invoke failed`);
    return evaluationFail("INTERNAL_ERROR");
  }

  const payload = data as { ok?: boolean; error?: unknown; evaluation?: unknown } | null;
  if (!payload || payload.ok !== true) return evaluationFail(asErrorCode(payload?.error));

  const evaluation = asEvaluationDTO(payload.evaluation);
  if (!evaluation) {
    console.error(`[evaluation] ${EVALUATION_FUNCTION} returned unexpected payload shape`);
    return evaluationFail("INTERNAL_ERROR");
  }
  return { ok: true, evaluation };
}

export async function previewExperimentEvaluationImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<PreviewExperimentEvaluationResult> {
  return invokeEvaluation({
    supabase: args.supabase,
    mode: "preview",
    orgId: args.orgId,
    experimentId: args.experimentId,
  });
}

export async function finalizeExperimentEvaluationImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  experimentId: string;
}): Promise<FinalizeExperimentEvaluationResult> {
  return invokeEvaluation({
    supabase: args.supabase,
    mode: "finalize",
    orgId: args.orgId,
    experimentId: args.experimentId,
  });
}
