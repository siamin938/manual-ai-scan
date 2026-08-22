// 서버 전용 Profile Coverage → Experiment 생성 로직.
// 이 파일은 브라우저 번들로 나가지 않는다(*.server.ts import 차단).
// 외부 AI/Provider 호출 없음. 실험 초안 INSERT만 수행하며 비용이 발생하지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ACTIVE_STATUSES, ALLOWED_ROLES } from "./experiments.helpers";
import {
  COVERAGE_EXPERIMENT_ACTION_TYPE,
  EXPERIMENTABLE_COVERAGE_STATUSES,
  coverageExperimentHypothesis,
  coverageExperimentName,
  type CreateCoverageExperimentErrorCode,
  type CreateCoverageExperimentResult,
} from "./profile-coverage.helpers";

type UserClient = SupabaseClient<Database>;

function fail(
  error: CreateCoverageExperimentErrorCode,
  experimentId?: string | null,
): CreateCoverageExperimentResult {
  return experimentId ? { ok: false, error, experimentId } : { ok: false, error };
}

/** 브라우저 입력은 orgId + profileCoverageItemId만 신뢰한다. 나머지는 서버가 계보로 결정한다. */
export async function createExperimentFromCoverageItemImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  profileCoverageItemId: string;
}): Promise<CreateCoverageExperimentResult> {
  const { supabase, userId, orgId, profileCoverageItemId } = args;

  // 1) 조직 역할 검증 (RLS 적용된 사용자 클라이언트)
  const { data: membership, error: memErr } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) return fail("INTERNAL_ERROR");
  if (!membership) return fail("FORBIDDEN");
  if (!ALLOWED_ROLES.includes(membership.role as (typeof ALLOWED_ROLES)[number])) {
    return fail("FORBIDDEN");
  }

  // 검증 통과 후에만 service_role 사용 (서버 전용)
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 2) Coverage item
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("profile_coverage_items")
    .select(
      "id, org_id, business_id, coverage_run_id, question_id, coverage_status, measurement_count, mentioned_count",
    )
    .eq("id", profileCoverageItemId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (itemErr) return fail("INTERNAL_ERROR");
  if (!item) return fail("COVERAGE_ITEM_NOT_FOUND");
  if (!item.business_id || !item.coverage_run_id || !item.question_id) {
    return fail("COVERAGE_ITEM_SCOPE_MISMATCH");
  }

  // 3) missing/partial만 허용 (covered 금지)
  if (
    !EXPERIMENTABLE_COVERAGE_STATUSES.includes(
      item.coverage_status as (typeof EXPERIMENTABLE_COVERAGE_STATUSES)[number],
    )
  ) {
    return fail("COVERAGE_STATUS_NOT_EXPERIMENTABLE");
  }

  // 4) Coverage run 계보
  const { data: coverageRun, error: crErr } = await supabaseAdmin
    .from("profile_coverage_runs")
    .select("id, org_id, business_id, status, source_run_id")
    .eq("id", item.coverage_run_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (crErr) return fail("INTERNAL_ERROR");
  if (
    !coverageRun ||
    coverageRun.business_id !== item.business_id ||
    coverageRun.status !== "completed" ||
    !coverageRun.source_run_id
  ) {
    return fail("COVERAGE_RUN_NOT_USABLE");
  }

  // 5) source measurement run 존재/스코프 검증
  const { data: sourceRun, error: srcErr } = await supabaseAdmin
    .from("measurement_runs")
    .select("id, org_id, business_id, status")
    .eq("id", coverageRun.source_run_id)
    .eq("org_id", orgId)
    .eq("business_id", item.business_id)
    .maybeSingle();
  if (srcErr) return fail("INTERNAL_ERROR");
  if (!sourceRun || !["completed", "partial"].includes(sourceRun.status)) {
    return fail("COVERAGE_SOURCE_RUN_NOT_FOUND");
  }

  // 6) Question 스코프
  const { data: question, error: qErr } = await supabaseAdmin
    .from("questions")
    .select("id, org_id, prompt_text, intent_type")
    .eq("id", item.question_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (qErr) return fail("INTERNAL_ERROR");
  if (!question) return fail("QUESTION_SCOPE_MISMATCH");

  // 7) Business 존재 확인
  const { data: business, error: bizErr } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", item.business_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (bizErr) return fail("INTERNAL_ERROR");
  if (!business) return fail("BUSINESS_SCOPE_MISMATCH");

  // 8) 동일 coverage item의 active experiment 중복 차단
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("experiments")
    .select("id")
    .eq("org_id", orgId)
    .eq("source_profile_coverage_item_id", item.id)
    .in("status", [...ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existErr) return fail("INTERNAL_ERROR");
  if (existing) return fail("EXPERIMENT_ALREADY_ACTIVE", existing.id);

  // 9) INSERT (snapshot/평가 컬럼은 모두 NULL 유지)
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("experiments")
    .insert({
      org_id: orgId,
      business_id: item.business_id,
      source_type: "profile_coverage_item",
      source_profile_coverage_item_id: item.id,
      source_insight_action_id: null,
      name: coverageExperimentName(question.intent_type),
      action_type: COVERAGE_EXPERIMENT_ACTION_TYPE,
      hypothesis: coverageExperimentHypothesis({
        intent_type: question.intent_type,
        coverage_status: item.coverage_status,
        measurement_count: item.measurement_count,
        mentioned_count: item.mentioned_count,
        question_text: question.prompt_text,
      }),
      status: "draft",
      created_by: userId,
    })
    .select("id, status, name")
    .maybeSingle();

  if (insErr) {
    // 최종 중복 보장은 partial UNIQUE index (23505일 때만 재조회)
    if (insErr.code === "23505") {
      const { data: raced, error: raceErr } = await supabaseAdmin
        .from("experiments")
        .select("id")
        .eq("org_id", orgId)
        .eq("source_profile_coverage_item_id", item.id)
        .in("status", [...ACTIVE_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (raceErr) return fail("INTERNAL_ERROR");
      if (raced) return fail("EXPERIMENT_ALREADY_ACTIVE", raced.id);
      return fail("EXPERIMENT_CREATE_FAILED");
    }
    return fail("EXPERIMENT_CREATE_FAILED");
  }
  if (!inserted) return fail("EXPERIMENT_CREATE_FAILED");

  return {
    ok: true,
    experiment: { experimentId: inserted.id, status: inserted.status, name: inserted.name },
  };
}
