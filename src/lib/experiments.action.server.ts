// 서버 전용 Action Applied 기록 로직.
// 이 파일은 브라우저 번들로 나가지 않는다(*.server.ts import 차단).
// Experiment write는 service_role 서버 경로만 사용한다. Provider/Edge 호출 없음.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  ACTION_APPLY_CLOCK_SKEW_MS,
  ACTION_SUMMARY_MAX,
  ACTION_SUMMARY_MIN,
  ACTION_NOTE_MAX,
  ALLOWED_ROLES,
  type ActionAppliedErrorCode,
  type ActionAppliedResult,
  type RecordActionAppliedInput,
} from "./experiments.helpers";


type UserClient = SupabaseClient<Database>;

function fail(error: ActionAppliedErrorCode): ActionAppliedResult {
  return { ok: false, error };
}

async function hasStaffRole(
  supabase: UserClient,
  orgId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: ActionAppliedErrorCode }> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: "INTERNAL_ERROR" };
  if (!data) return { ok: false, error: "FORBIDDEN" };
  if (!ALLOWED_ROLES.includes(data.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: "FORBIDDEN" };
  }
  return { ok: true };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Action Applied 기록. 사용자의 명시적 클릭에서만 호출된다.
 * 새 Run 생성 / enqueue / OpenAI 호출 / reparse 없음.
 */
export async function recordExperimentActionAppliedImpl(args: {
  supabase: UserClient;
  userId: string;
  input: RecordActionAppliedInput;
}): Promise<ActionAppliedResult> {
  const { supabase, userId, input } = args;
  const orgId = input.orgId;
  const experimentId = input.experimentId;

  // 1) 조직 역할 검증 (RLS 적용된 사용자 클라이언트)
  const role = await hasStaffRole(supabase, orgId, userId);
  if (!role.ok) return fail(role.error);

  // 2) 입력 검증 (서버 기준)
  const summary = normalizeText(input.actualChangeSummary);
  if (summary.length < ACTION_SUMMARY_MIN || summary.length > ACTION_SUMMARY_MAX) {
    return fail("ACTION_APPLY_INVALID_INPUT");
  }
  const noteRaw = normalizeText(input.evidenceNote);
  if (noteRaw.length > ACTION_NOTE_MAX) return fail("ACTION_APPLY_INVALID_INPUT");
  const note = noteRaw.length > 0 ? noteRaw : null;

  const appliedMs = Date.parse(input.appliedAt ?? "");
  if (!Number.isFinite(appliedMs)) return fail("ACTION_APPLY_TIME_INVALID");
  const nowMs = Date.now();
  if (appliedMs > nowMs + ACTION_APPLY_CLOCK_SKEW_MS) return fail("ACTION_APPLY_TIME_INVALID");
  const appliedAtIso = new Date(appliedMs).toISOString();

  // 검증 통과 후에만 service_role 사용 (응답/로그에 노출 금지)
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 3) Experiment 조회 (id + 검증된 org 범위)
  const { data: experiment, error: expErr } = await supabaseAdmin
    .from("experiments")
    .select(
      "id, org_id, business_id, name, action_type, status, baseline_run_id, baseline_start_at, baseline_end_at, baseline_condition_snapshot, source_type, source_insight_action_id, source_profile_coverage_item_id, intervention_at, intervention_confirmed_at, changed_by, action_application_snapshot",
    )
    .eq("id", experimentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (expErr) return fail("INTERNAL_ERROR");
  if (!experiment) return fail("ACTION_APPLY_INVALID_STATE");

  // 3-1) 이미 기록된 경우 overwrite 금지
  const alreadyRecorded =
    experiment.status === "action_applied" ||
    !!experiment.intervention_at ||
    !!experiment.intervention_confirmed_at ||
    !!experiment.action_application_snapshot;
  if (alreadyRecorded) return fail("ACTION_APPLY_ALREADY_RECORDED");

  if (experiment.status !== "baseline") return fail("ACTION_APPLY_INVALID_STATE");

  const sourceType =
    experiment.source_type === "profile_coverage_item" ? "profile_coverage_item" : "insight_action";
  if (sourceType === "insight_action" && !experiment.source_insight_action_id) {
    return fail("ACTION_APPLY_INVALID_STATE");
  }
  if (sourceType === "profile_coverage_item" && !experiment.source_profile_coverage_item_id) {
    return fail("ACTION_APPLY_INVALID_STATE");
  }


  const baselineRunId = experiment.baseline_run_id;
  if (!baselineRunId) return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  if (!experiment.baseline_start_at || !experiment.baseline_end_at) {
    return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  }

  const snapshot = experiment.baseline_condition_snapshot as Record<string, unknown> | null;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  }
  const observed = snapshot["observed"] as Record<string, unknown> | undefined;
  const finalizedAt = observed && typeof observed === "object" ? observed["finalized_at"] : null;
  if (typeof finalizedAt !== "string" || finalizedAt.length === 0) {
    return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  }
  const conditionHash = snapshot["condition_hash"];
  if (typeof conditionHash !== "string" || conditionHash.length === 0) {
    return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  }

  // 4) canonical Baseline Run 검증 (완료 상태만 허용)
  const { data: run, error: runErr } = await supabaseAdmin
    .from("measurement_runs")
    .select("id, org_id, business_id, experiment_id, status, completed_at")
    .eq("id", baselineRunId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (runErr) return fail("INTERNAL_ERROR");
  if (
    !run ||
    run.business_id !== experiment.business_id ||
    run.experiment_id !== experiment.id ||
    run.status !== "completed" ||
    !run.completed_at
  ) {
    return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  }

  // 5) applied_at은 baseline 종료 이후여야 한다
  const baselineEndMs = Date.parse(experiment.baseline_end_at);
  if (!Number.isFinite(baselineEndMs)) return fail("ACTION_APPLY_BASELINE_NOT_FINALIZED");
  if (appliedMs < baselineEndMs) return fail("ACTION_APPLY_TIME_INVALID");

  // 6) 추천 액션 정보는 브라우저 입력이 아니라 DB에서 서버가 읽는다 (source_type 분기)
  let recommendedAction: {
    action_type: string;
    title: string;
    recommended_action: string | null;
    recommendation_mode: string | null;
  };

  if (sourceType === "insight_action") {
    const { data: action, error: actErr } = await supabaseAdmin
      .from("insight_actions")
      .select("id, org_id, business_id, action_type, title, recommended_action, recommendation_mode")
      .eq("id", experiment.source_insight_action_id!)
      .eq("org_id", orgId)
      .eq("business_id", experiment.business_id)
      .maybeSingle();
    if (actErr) return fail("INTERNAL_ERROR");
    if (!action) return fail("ACTION_APPLY_INVALID_STATE");
    recommendedAction = {
      action_type: action.action_type,
      title: action.title,
      recommended_action: action.recommended_action,
      recommendation_mode: action.recommendation_mode,
    };
  } else {
    const { data: item, error: itemErr } = await supabaseAdmin
      .from("profile_coverage_items")
      .select("id, org_id, business_id")
      .eq("id", experiment.source_profile_coverage_item_id!)
      .eq("org_id", orgId)
      .eq("business_id", experiment.business_id)
      .maybeSingle();
    if (itemErr) return fail("INTERNAL_ERROR");
    if (!item) return fail("ACTION_APPLY_INVALID_STATE");

    // 추천 문구/action_type은 실험 생성 시 Edge Function이 결정해 저장한 값을 그대로 사용한다.
    recommendedAction = {
      action_type: experiment.action_type,
      title: experiment.name,
      recommended_action: null,
      recommendation_mode: "test",
    };
  }

  const recordedAtIso = new Date(nowMs).toISOString();

  // 7) snapshot v1 (secret / raw provider response / baseline parsing_context 복제 금지)
  const applicationSnapshot = {
    snapshot_version: "1",
    experiment_id: experiment.id,
    org_id: experiment.org_id,
    business_id: experiment.business_id,
    source_type: sourceType,
    source_insight_action_id:
      sourceType === "insight_action" ? experiment.source_insight_action_id : null,
    source_profile_coverage_item_id:
      sourceType === "profile_coverage_item" ? experiment.source_profile_coverage_item_id : null,
    baseline_run_id: baselineRunId,
    baseline_condition_hash: conditionHash,
    recommended_action: recommendedAction,
    actual_change_summary: summary,
    evidence_note: note,
    applied_at: appliedAtIso,
    recorded_at: recordedAtIso,
    recorded_by: userId,
  };


  // 8) CAS write (동시 기록 안전)
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("experiments")
    .update({
      status: "action_applied",
      intervention_at: appliedAtIso,
      intervention_confirmed_at: recordedAtIso,
      changed_by: userId,
      intervention_description: summary,
      action_application_snapshot: applicationSnapshot,
    })
    .eq("id", experiment.id)
    .eq("org_id", orgId)
    .eq("status", "baseline")
    .eq("baseline_run_id", baselineRunId)
    .is("intervention_at", null)
    .is("intervention_confirmed_at", null)
    .is("action_application_snapshot", null)
    .select("id, status, intervention_at, intervention_confirmed_at, action_application_snapshot")
    .maybeSingle();

  if (updErr) return fail("ACTION_APPLY_FAILED");

  if (!updated) {
    // CAS 경쟁: 이미 다른 호출이 기록했는지 확인 (overwrite 금지)
    const { data: reloaded, error: reErr } = await supabaseAdmin
      .from("experiments")
      .select("id, status, intervention_at, action_application_snapshot")
      .eq("id", experiment.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (reErr) return fail("INTERNAL_ERROR");
    if (
      reloaded &&
      reloaded.status === "action_applied" &&
      reloaded.intervention_at &&
      reloaded.action_application_snapshot
    ) {
      return fail("ACTION_APPLY_ALREADY_RECORDED");
    }
    return fail("ACTION_APPLY_FAILED");
  }

  // 9) postcondition 재검증
  const { data: verify, error: verErr } = await supabaseAdmin
    .from("experiments")
    .select("status, intervention_at, intervention_confirmed_at, changed_by, action_application_snapshot")
    .eq("id", experiment.id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (verErr) return fail("INTERNAL_ERROR");
  if (
    !verify ||
    verify.status !== "action_applied" ||
    !verify.intervention_at ||
    !verify.intervention_confirmed_at ||
    verify.changed_by !== userId ||
    !verify.action_application_snapshot
  ) {
    return fail("ACTION_APPLY_FAILED");
  }

  return {
    ok: true,
    experiment: {
      experimentId: experiment.id,
      status: "action_applied",
      actionAppliedAt: appliedAtIso,
    },
  };
}
