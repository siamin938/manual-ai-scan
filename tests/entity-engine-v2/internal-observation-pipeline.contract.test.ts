import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/internal-observation-pipeline.tsx"),
  "utf8",
);

const serverSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-pipeline.functions.ts"),
  "utf8",
);

const executionSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-execution.functions.ts"),
  "utf8",
);

const reconciliationSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-reconciliation.functions.ts"),
  "utf8",
);

const schedulerSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-scheduler.functions.ts"),
  "utf8",
);

const guardedSchedulerSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-guarded-scheduler.functions.ts"),
  "utf8",
);

const schedulerOperationsSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-scheduler-operations.functions.ts"),
  "utf8",
);

const unattendedExecutorSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/internal-observation-scheduler-tick/index.ts"),
  "utf8",
);

const enqueueRunSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/enqueue-run/index.ts"),
  "utf8",
);

const supabaseConfigSource = readFileSync(
  resolve(process.cwd(), "supabase/config.toml"),
  "utf8",
);

const navSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
  "utf8",
);

const businessRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/businesses.tsx"),
  "utf8",
);

const optionSource = readFileSync(
  resolve(process.cwd(), "src/lib/automotive-service-options.ts"),
  "utf8",
);

const schemaMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004053000_internal_observation_pipeline_v01.sql",
  ),
  "utf8",
);

const prepareMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004054500_internal_observation_prepare_rpc_v01.sql",
  ),
  "utf8",
);

const reconciliationMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004104000_internal_observation_reconciliation_v03.sql",
  ),
  "utf8",
);

const guardedSchedulerMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004114500_internal_observation_guarded_scheduler_v05.sql",
  ),
  "utf8",
);

const schedulerOperationsMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004123000_internal_observation_scheduler_operations_v06.sql",
  ),
  "utf8",
);

const unattendedExecutorMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004131500_internal_observation_executor_v07.sql",
  ),
  "utf8",
);

const executorDeploymentStateMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004132500_internal_observation_executor_deployment_state_v07.sql",
  ),
  "utf8",
);

const schedulerRunIdAmbiguityFixMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261005043117_fix_internal_observation_scheduler_run_id_ambiguity.sql",
  ),
  "utf8",
);

describe("internal observation pipeline v0.7 unattended executor", () => {
  it("is internal-only and defaults measurement execution to off", () => {
    expect(navSource).toContain(
      '{ to: "/internal-observation-pipeline", label: "내부 데이터 수집" }',
    );
    expect(navSource).toContain("dataAssetAccess?.allowed");
    expect(schemaMigration).toContain("execution_enabled boolean not null default false");
    expect(routeSource).toContain("Guarded Scheduler");
    expect(routeSource).toContain("실제 자동 실행 준비 Gate");
  });

  it("keeps the queue service-role only", () => {
    expect(schemaMigration).toContain(
      "revoke all on table public.internal_observation_pipeline_items from public, anon, authenticated",
    );
    expect(schemaMigration).toContain(
      "grant all on table public.internal_observation_pipeline_items to service_role",
    );
    expect(prepareMigration).toContain(
      "grant execute on function public.prepare_internal_observation_candidate_v01",
    );
    expect(prepareMigration).toContain("to service_role");
  });

  it("prepares an internal business and exactly one unified 24-question contract", () => {
    expect(serverSource).toContain("buildUnifiedDiagnosticQuestionCandidates");
    expect(serverSource).toContain("candidates.length !== 24");
    expect(serverSource).toContain("hasUnifiedDiagnosticIntentShape");
    expect(serverSource).toContain("prepare_internal_observation_candidate_v01");
    expect(prepareMigration).toContain("jsonb_array_length(p_questions) <> 24");
    expect(prepareMigration).toContain("intent_type in (");
    expect(prepareMigration).toContain("and n = 3");
    expect(prepareMigration).toContain("EXISTING_UNIFIED_SET_INVALID");
  });

  it("reuses existing business/question assets instead of duplicating them", () => {
    expect(prepareMigration).toContain("v_reused_business := true");
    expect(prepareMigration).toContain("v_reused_question_set := true");
    expect(schemaMigration).toContain("unique(org_id, idempotency_key)");
    expect(serverSource).toContain("candidateIdempotencyKey");
  });

  it("keeps preparation itself free of run creation or enqueue side effects", () => {
    expect(serverSource).not.toContain('functions.invoke("enqueue-run"');
    expect(serverSource).not.toContain('.from("measurement_runs").insert');
    expect(routeSource).toContain("준비 미리보기");
    expect(routeSource).toContain("이 단계에서는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.");
  });

  it("checks provider and measurement credit readiness without consuming a credit", () => {
    expect(serverSource).toContain('.from("provider_settings")');
    expect(serverSource).toContain('.from("measurement_credit_accounts")');
    expect(serverSource).toContain('"NO_MEASUREMENT_CREDIT"');
    expect(serverSource).toContain('"PROVIDER_NOT_READY"');
    expect(serverSource).not.toContain("measurement_debit");
  });

  it("requires an operator preview before the UI exposes preparation", () => {
    expect(serverSource).toContain("previewInternalObservationCandidate");
    expect(serverSource).toContain("async function previewOne");
    expect(routeSource).toContain("준비 미리보기");
    expect(routeSource).toContain("아직 업체나 질문을 생성하지 않습니다.");
    expect(routeSource).toContain("확인하고 준비");
    expect(routeSource).toContain("이 단계에서는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.");
    expect(routeSource).not.toContain("대기 후보 5건 준비");
    expect(serverSource).not.toContain("preparePendingInternalObservationBatch");
  });

  it("previews reuse/create/block decisions and all 24 generated questions", () => {
    expect(serverSource).toContain('businessAction: "create" | "reuse" | "blocked"');
    expect(serverSource).toContain('questionSetAction: "create" | "reuse" | "blocked"');
    expect(serverSource).toContain("existingQuestionCount");
    expect(serverSource).toContain("questions: InternalObservationPreviewQuestionDTO[]");
    expect(routeSource).toContain("생성 기준 24문항");
    expect(routeSource).toContain("preview.questions.map");
  });

  it("reuses the same category list as business registration and standardizes internal services", () => {
    expect(businessRouteSource).toContain("AUTOMOTIVE_CATEGORY_OPTIONS");
    expect(routeSource).toContain("AUTOMOTIVE_CATEGORY_OPTIONS");
    expect(routeSource).toContain("INTERNAL_OBSERVATION_SERVICE_OPTIONS");
    expect(routeSource).toContain("INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION");
    expect(optionSource).toContain('"PPF/랩핑"');
    expect(optionSource).toContain('"신차패키지"');
    expect(optionSource).toContain('"기타 직접 입력"');
    expect(routeSource).toContain("측정권 {org.creditBalance}회");
  });

  it("adds a read-only execution plan before any measurement side effect", () => {
    expect(executionSource).toContain("previewInternalObservationExecutionPlan");
    expect(executionSource).toContain("plannedJobs");
    expect(executionSource).toContain("estimatedCostUsd");
    expect(executionSource).toContain("creditBefore");
    expect(executionSource).toContain("creditAfter");
    expect(executionSource).toContain("projectedDailyRequests");
    expect(executionSource).toContain("projectedMonthlyCostUsd");
    expect(executionSource).toContain("sameConditionRun");
    expect(routeSource).toContain("실행 계획 보기");
    expect(routeSource).toContain("이 화면을 보는 것만으로는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.");
  });

  it("rechecks the plan fingerprint before explicit execution approval", () => {
    expect(executionSource).toContain("plan.planHash !== data.planHash");
    expect(executionSource).toContain('"PLAN_CHANGED"');
    expect(executionSource).toContain("stableHash(fingerprint)");
    expect(routeSource).toContain("측정 실행 승인");
    expect(routeSource).toContain("계획 fingerprint를 재검증합니다");
  });

  it("reuses the existing customer measurement path instead of creating a second enqueue engine", () => {
    expect(executionSource).toContain("createCustomerMeasurementRun");
    expect(executionSource).not.toContain('functions.invoke("enqueue-run"');
    expect(executionSource).not.toContain('.from("measurement_jobs").insert');
    expect(executionSource).toContain('"SAME_CONDITION_RUN_ACTIVE"');
    expect(executionSource).toContain('"CONCURRENT_RUN_LIMIT"');
    expect(executionSource).toContain('"DAILY_PIPELINE_RUN_LIMIT"');
    expect(executionSource).toContain("checkUsageAllowance");
  });

  it("locks the pipeline item during approval and rolls back the approval state when start fails", () => {
    expect(executionSource).toContain('status: "measuring"');
    expect(executionSource).toContain("measurement_approved_at");
    expect(executionSource).toContain("measurement_approved_by");
    expect(executionSource).toContain('status: "ready_to_measure"');
    expect(executionSource).toContain("measurement_approved_at: null");
    expect(executionSource).toContain("measurement_approved_by: null");
  });

  it("keeps automatic execution separate from manual approval", () => {
    expect(executionSource).toContain("automaticExecutionEnabled");
    expect(routeSource).toContain("Guarded Scheduler");
    expect(routeSource).toContain("이번 건은 수동 승인");
  });

  it("adds a postprocessing state and exact-run Entity Facts v2 reconciliation", () => {
    expect(reconciliationMigration).toContain("'postprocessing'");
    expect(reconciliationMigration).toContain("entity_facts_ready_at");
    expect(reconciliationMigration).toContain("terminal_at");
    expect(reconciliationSource).toContain("fetchEntityFactsV2ReadGateway");
    expect(reconciliationSource).toContain("gateway.data.scope.runId !== runId");
    expect(reconciliationSource).toContain('status: "postprocessing"');
    expect(reconciliationSource).toContain('status: "completed"');
    expect(routeSource).toContain('postprocessing: "후처리 중"');
  });

  it("only completes a pipeline item after 24/24 success and exact Entity Facts v2 readiness", () => {
    expect(reconciliationSource).toContain("totalJobs !== CUSTOMER_STANDARD_QUESTION_COUNT");
    expect(reconciliationSource).toContain("completedJobs !== CUSTOMER_STANDARD_QUESTION_COUNT");
    expect(reconciliationSource).toContain("failedJobs !== 0");
    expect(reconciliationSource).toContain('"RUN_INCOMPLETE"');
    expect(reconciliationSource).toContain('"ENTITY_FACTS_PENDING"');
    expect(reconciliationSource).toContain('"ENTITY_FACTS_RUN_MISMATCH"');
    expect(reconciliationSource).toContain("entity_facts_ready_at");
  });

  it("never auto-retries a failed measurement during reconciliation", () => {
    expect(reconciliationSource).not.toContain("createCustomerMeasurementRun");
    expect(reconciliationSource).not.toContain('functions.invoke("enqueue-run"');
    expect(reconciliationSource).toContain("자동으로 새 Run을 만들지 않습니다.");
    expect(routeSource).toContain("자동 재시도 없음");
    expect(routeSource).toContain("(item.status === \"failed\" && !item.runId)");
  });

  it("reconciles automatically on bounded overview refresh and also supports manual sync", () => {
    expect(serverSource).toContain("reconcileInternalObservationPipelineItems({ limit: 20 })");
    expect(reconciliationSource).toContain("reconcileInternalObservationPipeline");
    expect(routeSource).toContain("상태 동기화");
    expect(routeSource).toContain("15초마다 측정 종료와 Entity Facts v2 준비 여부를 자동 확인");
  });

  it("exposes a read-only result summary only after completion", () => {
    expect(routeSource).toContain("getPilotOpsAdminResult");
    expect(routeSource).toContain('item.status === "completed"');
    expect(routeSource).toContain("내부 수집 결과");
    expect(routeSource).toContain("Entity Facts v2 결과를 읽기 전용으로 확인합니다.");
    expect(routeSource).toContain("확정 노출");
    expect(routeSource).toContain("함께 관찰된 업체");
  });

  it("adds a read-only v0.4 scheduler dry-run with no execution side effects", () => {
    expect(schedulerSource).toContain("getInternalObservationSchedulerDryRun");
    expect(schedulerSource).toContain('"0.4-dry-run"');
    expect(schedulerSource).toContain('dryRunOnly: true');
    expect(schedulerSource).toContain('"oldest_ready_first"');
    expect(schedulerSource).not.toContain("createCustomerMeasurementRun");
    expect(schedulerSource).not.toContain('functions.invoke("enqueue-run"');
    expect(schedulerSource).not.toContain(".insert(");
    expect(schedulerSource).not.toContain(".update(");
    expect(routeSource).toContain("자동 스케줄 Dry-run");
    expect(routeSource).toContain("실행 없음");
  });

  it("simulates daily slots, concurrency, credits, requests, and budget cumulatively", () => {
    expect(schedulerSource).toContain("dailySlotsRemaining");
    expect(schedulerSource).toContain("dispatchSlotsNow");
    expect(schedulerSource).toContain("simulatedCredit");
    expect(schedulerSource).toContain("simulatedDailyRequests");
    expect(schedulerSource).toContain("simulatedMonthlyCost");
    expect(schedulerSource).toContain('"DAILY_PIPELINE_RUN_LIMIT"');
    expect(schedulerSource).toContain('"NO_MEASUREMENT_CREDIT"');
    expect(schedulerSource).toContain('"DAILY_USAGE_LIMIT"');
    expect(schedulerSource).toContain('"MONTHLY_USAGE_LIMIT"');
  });

  it("keeps candidate selection deterministic and validates exact ready contracts", () => {
    expect(schedulerSource).toContain('.eq("status", "ready_to_measure")');
    expect(schedulerSource).toContain('.order("prepared_at", { ascending: true })');
    expect(schedulerSource).toContain('.order("created_at", { ascending: true })');
    expect(schedulerSource).toContain("CUSTOMER_STANDARD_QUESTION_COUNT");
    expect(schedulerSource).toContain("hasUnifiedDiagnosticIntentShape");
    expect(schedulerSource).toContain("SAME_CONDITION_RUN_ACTIVE");
  });

  it("shows scheduler plan totals while keeping the dry-run side-effect free", () => {
    expect(routeSource).toContain("오늘 실행 슬롯");
    expect(routeSource).toContain("지금 시작 가능");
    expect(routeSource).toContain("계획 비용");
    expect(routeSource).toContain("Dry-run 다시 계산");
    expect(routeSource).toContain(
      "이 계획을 보는 것만으로는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.",
    );
    expect(routeSource).toContain("Pipeline v0.8 Validated");
  });

  it("adds an atomic service-role claim gate for one sequential candidate", () => {
    expect(guardedSchedulerMigration).toContain(
      "claim_internal_observation_scheduler_candidate_v05",
    );
    expect(guardedSchedulerMigration).toContain("for update skip locked");
    expect(guardedSchedulerMigration).toContain(
      "i.status in ('measuring','postprocessing')",
    );
    expect(guardedSchedulerMigration).toContain(
      "r.status in ('draft','queued','running')",
    );
    expect(guardedSchedulerMigration).toContain("s.execution_enabled=true");
    expect(guardedSchedulerMigration).toContain("s.scheduler_actor_user_id=p_actor_user_id");
    expect(guardedSchedulerMigration).toContain("to service_role");
    expect(guardedSchedulerMigration).toContain("revoke all");
  });

  it("keeps the master-switch-off tick side-effect free", () => {
    expect(guardedSchedulerSource).toContain('reason: "MASTER_SWITCH_OFF"');
    expect(guardedSchedulerSource).toContain(
      "if (!executionEnabled)",
    );
    const offGate = guardedSchedulerSource.indexOf("if (!executionEnabled)");
    const firstWrite = guardedSchedulerSource.indexOf("writeSchedulerResult", offGate);
    const offReturn = guardedSchedulerSource.indexOf('reason: "MASTER_SWITCH_OFF"', offGate);
    expect(offGate).toBeGreaterThan(-1);
    expect(offReturn).toBeGreaterThan(offGate);
    expect(firstWrite === -1 || offReturn < firstWrite).toBe(true);
    expect(routeSource).not.toContain("자동 실행 켜기");
    expect(routeSource).not.toContain("master switch ON");
  });

  it("reuses the exact measurement core and never creates a second enqueue path", () => {
    expect(executionSource).toContain("createCustomerMeasurementRun");
    expect(guardedSchedulerSource).toContain(
      "createInternalObservationScheduledMeasurementRun",
    );
    expect(guardedSchedulerSource).not.toContain('functions.invoke("enqueue-run"');
    expect(guardedSchedulerSource).not.toContain('.from("measurement_jobs").insert');
    expect(guardedSchedulerSource).not.toContain('.from("measurement_runs").insert');
    expect(guardedSchedulerSource).toContain(
      "reconcileInternalObservationPipelineItems",
    );
  });

  it("requires the dry-run first candidate to match the atomic claim", () => {
    expect(guardedSchedulerSource).toContain(
      "candidate.planned && candidate.dispatchNow",
    );
    expect(guardedSchedulerSource).toContain("itemId !== expected.itemId");
    expect(guardedSchedulerSource).toContain('"SCHEDULER_PLAN_CHANGED"');
    expect(guardedSchedulerSource).toContain("releaseClaim");
  });

  it("does not silently retry a failed guarded scheduler run", () => {
    expect(guardedSchedulerSource).toContain('"RUN_START_FAILED"');
    expect(guardedSchedulerSource).toContain(
      "자동 재시도 Run은 만들지 않습니다.",
    );
    expect(guardedSchedulerSource).toContain('status: "ready_to_measure"');
    expect(guardedSchedulerSource).not.toContain("setTimeout");
    expect(guardedSchedulerSource).not.toContain("setInterval");
  });

  it("surfaces scheduler actor readiness and guarded operations", () => {
    expect(schedulerSource).toContain("schedulerActorConfigured");
    expect(schedulerSource).toContain("lastSchedulerTickAt");
    expect(schedulerSource).toContain("lastSchedulerResult");
    expect(routeSource).toContain("Scheduler actor");
    expect(routeSource).toContain("최근 자동 tick");
    expect(routeSource).toContain("자동 실행 제어");
  });

  it("creates the recurring cron scaffold inactive and keeps executor readiness false", () => {
    expect(schedulerOperationsMigration).toContain(
      "scheduler_executor_ready boolean not null default false",
    );
    expect(schedulerOperationsMigration).toContain(
      "'internal-observation-scheduler-v06'",
    );
    expect(schedulerOperationsMigration).toContain("'*/2 * * * *'");
    expect(schedulerOperationsMigration).toContain(
      "perform cron.alter_job(job_id => v_job_id, active => false)",
    );
    expect(schedulerOperationsMigration).toContain(
      "scheduler_state text not null default 'off'",
    );
  });

  it("requires scheduler state running and executor readiness before atomic claim", () => {
    expect(schedulerOperationsMigration).toContain("s.execution_enabled=true");
    expect(schedulerOperationsMigration).toContain("s.scheduler_state='running'");
    expect(schedulerOperationsMigration).toContain("s.scheduler_executor_ready=true");
    expect(schedulerOperationsMigration).toContain(
      "s.scheduler_actor_user_id=p_actor_user_id",
    );
  });

  it("qualifies pipeline run_id in the scheduler run creation hotfix", () => {
    expect(schedulerRunIdAmbiguityFixMigration).toContain(
      "update public.internal_observation_pipeline_items as i",
    );
    expect(schedulerRunIdAmbiguityFixMigration).toContain("and i.run_id is null");
    expect(schedulerRunIdAmbiguityFixMigration).not.toContain(
      "and run_id is null;",
    );
  });

  it("uses a two-step activation request with an expiring plan hash", () => {
    expect(schedulerOperationsSource).toContain(
      'const ACTIVATION_CONFIRM_TEXT = "자동 실행 시작"',
    );
    expect(schedulerOperationsSource).toContain("ACTIVATION_TTL_MS");
    expect(schedulerOperationsSource).toContain("planHash");
    expect(schedulerOperationsSource).toContain("REQUEST_EXPIRED");
    expect(schedulerOperationsSource).toContain("PLAN_CHANGED");
    expect(schedulerOperationsSource).toContain(
      "requestInternalObservationSchedulerActivation",
    );
    expect(schedulerOperationsSource).toContain(
      "confirmInternalObservationSchedulerActivation",
    );
    expect(routeSource).toContain("활성화 요청 만들기");
    expect(routeSource).toContain("최종 활성화");
  });

  it("blocks activation until the executor is explicitly marked ready", () => {
    expect(schedulerOperationsSource).toContain('"EXECUTOR_NOT_READY"');
    expect(schedulerOperationsSource).toContain(
      'settingsRes.data["scheduler_executor_ready"] === true',
    );
    expect(routeSource).toContain("자동 실행 준비 Gate가 아직 승인되지 않았습니다.");
    expect(routeSource).toContain("executor_ready가 false인 동안 자동 실행 활성화는 차단됩니다.");
  });

  it("supports pause and stop without cancelling an active run", () => {
    expect(schedulerOperationsSource).toContain(
      "pauseInternalObservationScheduler",
    );
    expect(schedulerOperationsSource).toContain(
      "stopInternalObservationScheduler",
    );
    expect(schedulerOperationsSource).toContain(
      "activeRunsContinue: true",
    );
    expect(schedulerOperationsSource).not.toContain(
      '.from("measurement_runs").update({ status: "cancelled"',
    );
    expect(routeSource).toContain("일시정지");
    expect(routeSource).toContain("자동 실행 중지");
    expect(routeSource).toContain("진행 중 Run을 강제로 취소하지 않고");
  });

  it("keeps activation cron control service-role only", () => {
    expect(schedulerOperationsMigration).toContain(
      "set_internal_observation_scheduler_cron_active_v06",
    );
    expect(schedulerOperationsMigration).toContain(
      "grant execute on function public.set_internal_observation_scheduler_cron_active_v06(boolean) to service_role",
    );
    expect(schedulerOperationsMigration).toContain(
      "revoke all on function public.set_internal_observation_scheduler_cron_active_v06(boolean) from authenticated",
    );
    expect(schedulerOperationsSource).toContain(
      "set_internal_observation_scheduler_cron_active_v06",
    );
  });

  it("adds a custom-secret unattended executor while leaving the platform JWT gate off", () => {
    expect(supabaseConfigSource).toContain(
      "[functions.internal-observation-scheduler-tick]",
    );
    expect(supabaseConfigSource).toContain(
      "[functions.internal-observation-scheduler-tick]\nverify_jwt = false",
    );
    expect(unattendedExecutorSource).toContain("INTERNAL_CRON_SECRET");
    expect(unattendedExecutorSource).toContain("x-internal-secret");
    expect(unattendedExecutorSource).toContain("constantTimeEquals");
    expect(unattendedExecutorSource).toContain('return json({ error: "FORBIDDEN" }, 403)');
  });

  it("keeps the unattended executor hard-gated by running state and executor readiness", () => {
    expect(unattendedExecutorSource).toContain('.eq("execution_enabled", true)');
    expect(unattendedExecutorSource).toContain('.eq("scheduler_state", "running")');
    expect(unattendedExecutorSource).toContain('.eq("scheduler_executor_ready", true)');
    expect(unattendedExecutorMigration).toContain("s.execution_enabled is distinct from true");
    expect(unattendedExecutorMigration).toContain("s.scheduler_state <> 'running'");
    expect(unattendedExecutorMigration).toContain(
      "s.scheduler_executor_ready is distinct from true",
    );
  });

  it("reconciles before claim and starts at most one oldest eligible candidate per org tick", () => {
    expect(unattendedExecutorSource).toContain(
      "reconcile_internal_observation_scheduler_v07",
    );
    expect(unattendedExecutorSource).toContain(
      "claim_internal_observation_scheduler_candidate_v07",
    );
    expect(unattendedExecutorSource).toContain(
      "create_internal_observation_scheduler_run_v07",
    );
    expect(unattendedExecutorMigration).toContain("for update of i skip locked");
    expect(unattendedExecutorMigration).toContain(
      "order by i.prepared_at asc nulls last,i.created_at asc,i.id asc",
    );
    expect(unattendedExecutorSource).not.toContain("setInterval");
    expect(unattendedExecutorSource).not.toContain("setTimeout");
  });

  it("requires the same 24-question/provider/credit/usage/budget contract again at execution time", () => {
    expect(unattendedExecutorMigration).toContain("v_question_count <> 24");
    expect(unattendedExecutorMigration).toContain("v_intent_group_count <> 8");
    expect(unattendedExecutorMigration).toContain("PROVIDER_NOT_READY");
    expect(unattendedExecutorMigration).toContain("NO_MEASUREMENT_CREDIT");
    expect(unattendedExecutorMigration).toContain("DAILY_USAGE_LIMIT");
    expect(unattendedExecutorMigration).toContain("MONTHLY_USAGE_LIMIT");
    expect(unattendedExecutorMigration).toContain("QUESTION_SET_NOT_NEWEST");
  });

  it("extends enqueue-run with a narrow internal scheduler scope without weakening the user path", () => {
    expect(enqueueRunSource).toContain("internalSchedulerItemId");
    expect(enqueueRunSource).toContain("internalSchedulerActorUserId");
    expect(enqueueRunSource).toContain("INTERNAL_SCHEDULER_SCOPE_INVALID");
    expect(enqueueRunSource).toContain("INTERNAL_SCHEDULER_NOT_READY");
    expect(enqueueRunSource).toContain("measurement_approved_by");
    expect(enqueueRunSource).toContain('measurement_data_origin !== "internal_observation"');
    expect(enqueueRunSource).toContain('authorization?.startsWith("Bearer ")');
    expect(enqueueRunSource).toContain("userClient.auth.getUser()");
  });

  it("never creates a replacement Run after unattended startup failure", () => {
    expect(unattendedExecutorSource).toContain("markStartupFailure");
    expect(unattendedExecutorSource).toContain(
      "자동으로 replacement Run을 만들지 않습니다.",
    );
    expect(unattendedExecutorSource).toContain('status: "failed"');
    expect(unattendedExecutorSource).toContain('status: "cancelled"');
    expect(unattendedExecutorSource).not.toContain("while (true)");
    expect(unattendedExecutorSource).not.toContain("retryRun");
  });

  it("keeps uncertain enqueue responses fail-safe by preserving existing jobs or progressed runs", () => {
    expect(unattendedExecutorSource).toContain(
      "SCHEDULER_ENQUEUE_RESPONSE_UNCERTAIN",
    );
    expect(unattendedExecutorSource).toContain(
      '(count ?? 0) > 0 || (run && run.status !== "draft")',
    );
    expect(unattendedExecutorSource).toContain(
      "Leave the pipeline measuring so reconciliation can settle the exact Run.",
    );
  });

  it("tracks executor deployment separately from activation readiness", () => {
    expect(executorDeploymentStateMigration).toContain(
      "scheduler_executor_deployed boolean not null default false",
    );
    expect(schedulerOperationsSource).toContain("executorDeployed");
    expect(schedulerOperationsSource).toContain(
      'settingsRes.data["scheduler_executor_deployed"] === true',
    );
    expect(routeSource).toContain("배포 완료 · QA 대기");
    expect(routeSource).toContain("executor_ready");
  });

  it("adds unattended reconciliation with stale-claim fail-closed behavior and exact v2 readiness", () => {
    expect(unattendedExecutorMigration).toContain("SCHEDULER_STALE_CLAIM");
    expect(unattendedExecutorMigration).toContain("interval '5 minutes'");
    expect(unattendedExecutorMigration).toContain("run_entity_fact_aggregates_v2");
    expect(unattendedExecutorMigration).toContain("run_observed_source_aggregates_v2");
    expect(unattendedExecutorMigration).toContain(
      "run_competitor_source_clue_aggregates_v2",
    );
    expect(unattendedExecutorMigration).toContain("a.contract_ok=true");
    expect(unattendedExecutorMigration).toContain("a.valid_measurement_count=24");
  });
});
