import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ACTIVE_STATUSES,
  ALLOWED_ROLES,
  EXPERIMENTABLE_ACTION_STATUSES,
  EXPERIMENTABLE_MODES,
  badRequest,
  buildHypothesis,
  buildName,
  fail,
  isUuid,
  type CreateExperimentInput,
  type CreateExperimentResult,
  type FinalizeExperimentBaselineInput,
  type FinalizeExperimentBaselineResult,
  type PreviewExperimentBaselineInput,
  type PreviewExperimentBaselineResult,
  type RecordActionAppliedInput,
  type ActionAppliedResult,
  type StartExperimentBaselineInput,
  type StartExperimentBaselineResult,
} from "./experiments.helpers";
import type {
  PreviewExperimentFollowupInput,
  PreviewExperimentFollowupResult,
  StartExperimentFollowupInput,
  StartExperimentFollowupResult,
  FinalizeExperimentFollowupInput,
  FinalizeExperimentFollowupResult,
} from "./experiments.helpers";
import type {
  PreviewExperimentEvaluationInput,
  PreviewExperimentEvaluationResult,
  FinalizeExperimentEvaluationInput,
  FinalizeExperimentEvaluationResult,
} from "./experiments.evaluation.helpers";
import type {
  CreateCoverageExperimentInput,
  CreateCoverageExperimentResult,
} from "./profile-coverage.helpers";

export type {
  CreateCoverageExperimentInput,
  CreateCoverageExperimentResult,
  CreateCoverageExperimentDTO,
  CreateCoverageExperimentErrorCode,
} from "./profile-coverage.helpers";


export type {
  PreviewExperimentEvaluationInput,
  PreviewExperimentEvaluationResult,
  FinalizeExperimentEvaluationInput,
  FinalizeExperimentEvaluationResult,
  ExperimentEvaluationDTO,
  EvaluationErrorCode,
  EvaluationOutcome,
} from "./experiments.evaluation.helpers";

export type {
  CreateExperimentInput,
  CreateExperimentResult,
  CreateExperimentDTO,
  CreateExperimentErrorCode,
  StartExperimentBaselineInput,
  StartExperimentBaselineResult,
  PreviewExperimentBaselineInput,
  PreviewExperimentBaselineResult,
  BaselineErrorCode,
  BaselinePlanSummary,
  BaselineRunStateDTO,
  FinalizeExperimentBaselineInput,
  FinalizeExperimentBaselineResult,
  ExperimentConditionSnapshotV1,
  RecordActionAppliedInput,
  ActionAppliedResult,
  ActionAppliedDTO,
  ActionAppliedErrorCode,
  PreviewExperimentFollowupInput,
  PreviewExperimentFollowupResult,
  StartExperimentFollowupInput,
  StartExperimentFollowupResult,
  FinalizeExperimentFollowupInput,
  FinalizeExperimentFollowupResult,
  FollowupErrorCode,
  FollowupPlanSummary,
  FollowupRunStateDTO,
} from "./experiments.helpers";




export const createExperimentFromInsightAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateExperimentInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.insightActionId)) throw badRequest("INVALID_ACTION");
    return { orgId: input.orgId, insightActionId: input.insightActionId };
  })
  .handler(async ({ data, context }): Promise<CreateExperimentResult> => {
    // 1) 인증: requireSupabaseAuth가 401을 담당. 방어적 확인만 수행.
    if (!context.userId) return fail("FORBIDDEN");

    // 2) 조직 역할 검증 (사용자 권한 클라이언트, RLS 적용)
    const { data: membership, error: memErr } = await context.supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) return fail("INTERNAL_ERROR"); // DB 실패를 FORBIDDEN으로 위장하지 않음
    if (!membership) return fail("FORBIDDEN");
    if (!ALLOWED_ROLES.includes(membership.role as (typeof ALLOWED_ROLES)[number])) {
      return fail("FORBIDDEN");
    }

    // 검증 통과 후에만 service_role 사용 (서버 전용, 응답/로그에 노출 금지)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 3) Insight Action 조회 (id + 검증된 org_id 범위)
    const { data: action, error: actErr } = await supabaseAdmin
      .from("insight_actions")
      .select(
        "id, org_id, business_id, engine_run_id, action_type, title, rationale, recommended_action, recommendation_mode, primary_finding_id, status",
      )
      .eq("id", data.insightActionId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (actErr) return fail("INTERNAL_ERROR");
    if (!action) return fail("INSIGHT_ACTION_NOT_FOUND");
    if (action.org_id !== data.orgId || !action.business_id || !action.engine_run_id) {
      return fail("ACTION_SCOPE_MISMATCH");
    }

    // 3-1) 실험 가능한 mode / status만 허용
    if (
      !EXPERIMENTABLE_MODES.includes(
        action.recommendation_mode as (typeof EXPERIMENTABLE_MODES)[number],
      )
    ) {
      return fail("ACTION_MODE_NOT_EXPERIMENTABLE");
    }
    if (
      !EXPERIMENTABLE_ACTION_STATUSES.includes(
        action.status as (typeof EXPERIMENTABLE_ACTION_STATUSES)[number],
      )
    ) {
      return fail("ACTION_STATUS_NOT_EXPERIMENTABLE");
    }

    // 4) Business 무결성 (클라이언트 값 미신뢰, Action의 business_id 사용)
    const { data: business, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .select("id, org_id")
      .eq("id", action.business_id)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (bizErr) return fail("INTERNAL_ERROR");
    if (!business) return fail("BUSINESS_SCOPE_MISMATCH");

    // 5) Engine Run 무결성 (동일 org + 동일 business)
    const { data: engineRun, error: runErr } = await supabaseAdmin
      .from("insight_engine_runs")
      .select("id")
      .eq("id", action.engine_run_id)
      .eq("org_id", action.org_id)
      .eq("business_id", action.business_id)
      .maybeSingle();
    if (runErr) return fail("INTERNAL_ERROR");
    if (!engineRun) return fail("ENGINE_RUN_SCOPE_MISMATCH");

    // 6) Primary Finding 4중 scope 검증 (우회 진행 금지)
    let metricHint: string | null = null;
    if (action.primary_finding_id) {
      const { data: finding, error: findErr } = await supabaseAdmin
        .from("insight_findings")
        .select("id, title, metric_name")
        .eq("id", action.primary_finding_id)
        .eq("org_id", action.org_id)
        .eq("business_id", action.business_id)
        .eq("engine_run_id", action.engine_run_id)
        .maybeSingle();
      if (findErr) return fail("INTERNAL_ERROR");
      if (!finding) return fail("PRIMARY_FINDING_SCOPE_MISMATCH");
      metricHint = finding.title ?? finding.metric_name ?? null;
    }

    // 7) 사전 active Experiment 조회 (UX 최적화). DB 실패는 "없음"으로 간주하지 않음.
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("experiments")
      .select("id")
      .eq("org_id", action.org_id)
      .eq("source_insight_action_id", action.id)
      .in("status", [...ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existErr) return fail("INTERNAL_ERROR");
    if (existing) return fail("EXPERIMENT_ALREADY_ACTIVE", existing.id);

    // 8) INSERT — snapshot/평가 컬럼은 모두 NULL 유지
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("experiments")
      .insert({
        org_id: action.org_id,
        business_id: action.business_id,
        source_insight_action_id: action.id,
        name: buildName(action.title),
        action_type: action.action_type,
        hypothesis: buildHypothesis({
          recommended_action: action.recommended_action,
          rationale: action.rationale,
          title: action.title,
          metric_hint: metricHint,
        }),
        status: "draft",
        created_by: context.userId,
      })
      .select("id, status, name, business_id, source_insight_action_id")
      .maybeSingle();

    if (insErr) {
      // 최종 중복 보장은 partial UNIQUE index. 오류 메시지 문자열에 의존하지 않고
      // 23505인 경우에만 동일 조건의 active Experiment를 재조회한다.
      if (insErr.code === "23505") {
        const { data: raced, error: raceErr } = await supabaseAdmin
          .from("experiments")
          .select("id")
          .eq("org_id", action.org_id)
          .eq("source_insight_action_id", action.id)
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
      experiment: {
        experimentId: inserted.id,
        status: inserted.status,
        name: inserted.name,
        businessId: inserted.business_id,
        sourceInsightActionId: inserted.source_insight_action_id ?? action.id,
      },
    };
  });

/**
 * Profile Coverage 공백 항목에서 실험 초안을 생성한다.
 * 브라우저는 orgId + profileCoverageItemId만 전달하며, 나머지는 서버가 계보로 결정한다.
 * 외부 AI/Provider 호출 없음 → 이 호출 자체로는 측정 비용이 발생하지 않는다.
 */
export const createExperimentFromCoverageItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateCoverageExperimentInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.profileCoverageItemId)) throw badRequest("INVALID_ACTION");
    return { orgId: input.orgId, profileCoverageItemId: input.profileCoverageItemId };
  })
  .handler(async ({ data, context }): Promise<CreateCoverageExperimentResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { createExperimentFromCoverageItemImpl } = await import("./experiments.coverage.server");
    return createExperimentFromCoverageItemImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      profileCoverageItemId: data.profileCoverageItemId,
    });
  });

/** READ ONLY. 비용 확인 Dialog용 safe summary만 반환한다. */

export const previewExperimentBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PreviewExperimentBaselineInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<PreviewExperimentBaselineResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { previewExperimentBaselineImpl } = await import("./experiments.baseline.server");
    return previewExperimentBaselineImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });

/**
 * Baseline 실행 준비 + enqueue. 실제 OpenAI 측정 비용이 발생할 수 있는 경로이므로
 * UI에서 확인 Dialog의 최종 버튼에서만 호출한다.
 */
export const startExperimentBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StartExperimentBaselineInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<StartExperimentBaselineResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { startExperimentBaselineImpl } = await import("./experiments.baseline.server");
    return startExperimentBaselineImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });


/** Baseline 완료 후 실제 조건 검증 + observed 기록. Provider 호출 없음. UI 호출 없음. */
export const finalizeExperimentBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FinalizeExperimentBaselineInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<FinalizeExperimentBaselineResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { finalizeExperimentBaselineImpl } = await import("./experiments.baseline.server");
    return finalizeExperimentBaselineImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });

/**
 * "실제로 적용 완료한 변경"을 기록한다(Follow-up 비교 기준).
 * 추가 측정/Run 생성/enqueue/Provider 호출 없음. 사용자의 명시적 클릭에서만 호출.
 */
export const recordExperimentActionApplied = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: RecordActionAppliedInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return {
      orgId: input.orgId,
      experimentId: input.experimentId,
      actualChangeSummary: typeof input.actualChangeSummary === "string" ? input.actualChangeSummary : "",
      evidenceNote: typeof input.evidenceNote === "string" ? input.evidenceNote : null,
      appliedAt: typeof input.appliedAt === "string" ? input.appliedAt : "",
    };
  })
  .handler(async ({ data, context }): Promise<ActionAppliedResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { recordExperimentActionAppliedImpl } = await import("./experiments.action.server");
    return recordExperimentActionAppliedImpl({
      supabase: context.supabase,
      userId: context.userId,
      input: data,
    });
  });

/* =========================================================================
 * Follow-up v0.1 — Baseline과 동일한 pinned 조건으로만 재측정한다.
 * ========================================================================= */

/** READ ONLY. 비용 확인 Dialog용 safe summary만 반환한다. */
export const previewExperimentFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PreviewExperimentFollowupInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<PreviewExperimentFollowupResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { previewExperimentFollowupImpl } = await import("./experiments.followup.server");
    return previewExperimentFollowupImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });

/** Follow-up Run 생성 + enqueue. 실제 측정 비용이 발생할 수 있다. */
export const startExperimentFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StartExperimentFollowupInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<StartExperimentFollowupResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { startExperimentFollowupImpl } = await import("./experiments.followup.server");
    return startExperimentFollowupImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });

/** Follow-up 완료 후 observed 기록. Provider 호출 없음. */
export const finalizeExperimentFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FinalizeExperimentFollowupInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<FinalizeExperimentFollowupResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { finalizeExperimentFollowupImpl } = await import("./experiments.followup.server");
    return finalizeExperimentFollowupImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });

/* =========================================================================
 * Evaluation v0.1 — Baseline vs Follow-up 방향성 비교 (통계적 유의성 판정 아님)
 * ========================================================================= */

/** READ ONLY. 비교 결과 미리보기. Provider/Edge 호출 없음. */
export const previewExperimentEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PreviewExperimentEvaluationInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<PreviewExperimentEvaluationResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { previewExperimentEvaluationImpl } = await import("./experiments.evaluation.server");
    return previewExperimentEvaluationImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });

/** 비교 결과 확정(CAS). 서버에서 전부 재계산하며 덮어쓰기하지 않는다. */
export const finalizeExperimentEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FinalizeExperimentEvaluationInput) => {
    if (!isUuid(input?.orgId)) throw badRequest("INVALID_ORG");
    if (!isUuid(input?.experimentId)) throw badRequest("INVALID_EXPERIMENT");
    return { orgId: input.orgId, experimentId: input.experimentId };
  })
  .handler(async ({ data, context }): Promise<FinalizeExperimentEvaluationResult> => {
    if (!context.userId) return { ok: false, error: "FORBIDDEN" };
    const { finalizeExperimentEvaluationImpl } = await import("./experiments.evaluation.server");
    return finalizeExperimentEvaluationImpl({
      supabase: context.supabase,
      userId: context.userId,
      orgId: data.orgId,
      experimentId: data.experimentId,
    });
  });
