/**
 * 고객용 standalone audit 측정 생성 (서버 전용).
 *
 * SECURITY CONTRACT
 * - 인증된 사용자 클라이언트(RLS)만 사용. service_role 미사용.
 * - provider / 단가 / max_cost_usd / repetitions는 서버에서만 결정하고 DTO로 반환하지 않는다.
 * - 실패는 구조화된 에러코드만 반환하고 내부 설정명/SQL/비용을 노출하지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  CUSTOMER_RUN_REPETITIONS,
  CUSTOMER_STANDARD_QUESTION_COUNT,
  calcEstimatedCostUsd,
  calcInternalMaxCostUsd,
  calcPlannedJobs,
  checkUsageAllowance,
  defaultRunName,
  type CreateCustomerMeasurementResult,
  type CustomerMeasurementErrorCode,
} from "./customer-measurement.helpers";
import {
  hasUnifiedDiagnosticIntentShape,
  isUnifiedDiagnosticSetName,
} from "./custom-question-suggestions";

type UserClient = SupabaseClient<Database>;

const WRITE_ROLES = new Set(["owner", "admin", "analyst"]);

function fail(error: CustomerMeasurementErrorCode): CreateCustomerMeasurementResult {
  return { ok: false, error };
}

export async function createCustomerMeasurementRun(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  businessId: string;
  questionSetId: string;
  name?: string | null;
}): Promise<CreateCustomerMeasurementResult> {
  const { supabase, userId, orgId, businessId, questionSetId } = args;

  // A) membership + write role
  const { data: membership, error: memErr } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr || !membership || !WRITE_ROLES.has(String(membership.role))) return fail("FORBIDDEN");

  // B) business scope
  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .eq("is_client_business", true)
    .eq("active", true)
    .maybeSingle();
  if (bizErr || !business) return fail("INVALID_BUSINESS");

  // C) question set scope.
  // 통합 AI 진단 세트가 하나라도 생긴 업체는 서버에서도 legacy 세트로 새 고객 측정을 만들지 않는다.
  // UI 선택 제한만 믿지 않고 direct call도 같은 계약으로 fail-closed 한다.
  const { data: activeQuestionSets, error: setErr } = await supabase
    .from("question_sets")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("active", true);
  if (setErr) return fail("INTERNAL_ERROR");

  const questionSet = (activeQuestionSets ?? []).find((set) => set.id === questionSetId);
  if (!questionSet) return fail("INVALID_QUESTION_SET");

  const hasUnifiedSet = (activeQuestionSets ?? []).some((set) =>
    isUnifiedDiagnosticSetName(set.name),
  );
  if (hasUnifiedSet && !isUnifiedDiagnosticSetName(questionSet.name)) {
    return fail("INVALID_QUESTION_SET");
  }

  // D) active questions, fail-closed on non-public data_class.
  const { data: questions, error: qErr } = await supabase
    .from("questions")
    .select("id, data_class, intent_type")
    .eq("org_id", orgId)
    .eq("question_set_id", questionSetId)
    .eq("active", true);
  if (qErr) return fail("INTERNAL_ERROR");
  const activeQuestions = questions ?? [];
  if (activeQuestions.length === 0) return fail("NO_ACTIVE_QUESTIONS");
  if (activeQuestions.some((q) => q.data_class !== "public")) return fail("RESTRICTED_QUESTIONS");

  if (isUnifiedDiagnosticSetName(questionSet.name)) {
    if (
      activeQuestions.length !== CUSTOMER_STANDARD_QUESTION_COUNT ||
      !hasUnifiedDiagnosticIntentShape(activeQuestions.map((q) => q.intent_type))
    ) {
      return fail("INVALID_QUESTION_SET");
    }
  }

  // E) provider readiness (내부 설정명은 고객에게 노출하지 않음)
  const { data: providerSettings, error: psErr } = await supabase
    .from("provider_settings")
    .select(
      "enabled, estimated_cost_per_request_usd, paid_account_confirmed, terms_reviewed, automated_benchmark_approved",
    )
    .eq("org_id", orgId)
    .eq("provider", "openai")
    .maybeSingle();
  if (psErr || !providerSettings) return fail("MEASUREMENT_NOT_READY");
  if (
    !providerSettings.enabled ||
    !providerSettings.paid_account_confirmed ||
    !providerSettings.terms_reviewed ||
    !providerSettings.automated_benchmark_approved
  ) {
    return fail("MEASUREMENT_NOT_READY");
  }

  // E-2) 측정권 사전 확인 (UX precheck 전용. 실제 차감은 DB 트리거가 담당한다.)
  const { data: creditAccount, error: creditErr } = await supabase
    .from("measurement_credit_accounts")
    .select("balance")
    .eq("org_id", orgId)
    .maybeSingle();
  if (creditErr) return fail("INTERNAL_ERROR");
  if (!creditAccount || Number(creditAccount.balance ?? 0) < 1) return fail("NO_MEASUREMENT_CREDIT");

  // F~H) 서버 강제 provider/repetitions + 용량/비용 계산
  const plannedJobs = calcPlannedJobs(activeQuestions.length);
  if (plannedJobs <= 0) return fail("NO_ACTIVE_QUESTIONS");
  const estimatedCostUsd = calcEstimatedCostUsd(
    Number(providerSettings.estimated_cost_per_request_usd ?? 0),
    plannedJobs,
  );
  const maxCostUsd = calcInternalMaxCostUsd(estimatedCostUsd);

  // 3) 조직 사용량/예산 선검증
  const [orgRes, usageRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("daily_request_limit, monthly_budget_usd")
      .eq("id", orgId)
      .maybeSingle(),
    supabase.rpc("get_org_usage", { p_org_id: orgId }),
  ]);
  if (orgRes.error || !orgRes.data) return fail("INTERNAL_ERROR");
  if (usageRes.error) return fail("INTERNAL_ERROR");
  const usageRow = (Array.isArray(usageRes.data) ? usageRes.data[0] : usageRes.data) as
    | {
        daily_requests: number | string | null;
        monthly_actual_cost_usd: number | string | null;
        monthly_reserved_cost_usd: number | string | null;
      }
    | null
    | undefined;

  const limitError = checkUsageAllowance({
    usage: {
      dailyRequests: Number(usageRow?.daily_requests ?? 0),
      monthlyActualCostUsd: Number(usageRow?.monthly_actual_cost_usd ?? 0),
      monthlyReservedCostUsd: Number(usageRow?.monthly_reserved_cost_usd ?? 0),
    },
    limits: {
      dailyRequestLimit: Number(orgRes.data.daily_request_limit ?? 0),
      monthlyBudgetUsd: Number(orgRes.data.monthly_budget_usd ?? 0),
    },
    plannedJobs,
    maxCostUsd,
  });
  if (limitError) return fail(limitError);

  // 4) run 생성 (재시도 시 최근 draft 재사용 → 중복 run 방지)
  const now = new Date();
  const runName = (args.name ?? "").trim() || defaultRunName(business.name, now);

  const reuseSince = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const { data: existingDraft } = await supabase
    .from("measurement_runs")
    .select("id")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("question_set_id", questionSetId)
    .eq("run_type", "audit")
    .eq("phase", "standalone")
    .eq("diagnostic_scope", "customer")
    .eq("status", "draft")
    .eq("created_by", userId)
    .gte("created_at", reuseSince)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let runId = existingDraft?.id ?? null;
  if (!runId) {
    // data_origin은 조직 설정값을 그대로 승계한다(NOT NULL, DB 기본값 없음).
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("measurement_data_origin")
      .eq("id", orgId)
      .maybeSingle();

    const { data: inserted, error: insertErr } = await supabase
      .from("measurement_runs")
      .insert({
        org_id: orgId,
        business_id: businessId,
        question_set_id: questionSetId,
        data_origin: orgRow?.measurement_data_origin ?? "internal_observation",

        name: runName,
        run_type: "audit",
        phase: "standalone",
        diagnostic_scope: "customer",
        status: "draft",
        selected_providers: ["openai"],
        repetitions: CUSTOMER_RUN_REPETITIONS,
        max_cost_usd: maxCostUsd,
        scheduled_at: now.toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) return fail("MEASUREMENT_NOT_READY");
    runId = inserted.id;
  }

  // enqueue-run은 runId 기준 idempotent → 같은 run 재호출 안전
  const { error: fnError } = await supabase.functions.invoke("enqueue-run", {
    body: { runId },
  });
  if (fnError) {
    console.error("[customer-measurement] enqueue-run failed");
    return fail("MEASUREMENT_NOT_READY");
  }

  return { ok: true, runId, plannedJobs };
}
