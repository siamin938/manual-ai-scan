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

const navSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
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

describe("internal observation pipeline v0.1", () => {
  it("is internal-only and defaults measurement execution to off", () => {
    expect(navSource).toContain(
      '{ to: "/internal-observation-pipeline", label: "내부 데이터 수집" }',
    );
    expect(navSource).toContain("dataAssetAccess?.allowed");
    expect(schemaMigration).toContain("execution_enabled boolean not null default false");
    expect(routeSource).toContain("자동 측정 실행은 잠겨 있습니다.");
    expect(routeSource).toContain("실제 AI 측정을 자동 실행하지 않습니다.");
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

  it("stops before run creation or enqueue in v0.1", () => {
    expect(serverSource).not.toContain('functions.invoke("enqueue-run"');
    expect(serverSource).not.toContain('.from("measurement_runs").insert');
    expect(routeSource).toContain("실행 승인 대기");
    expect(routeSource).toContain("Run 생성과 AI 호출은 수행하지 않습니다.");
  });

  it("checks provider and measurement credit readiness without consuming a credit", () => {
    expect(serverSource).toContain('.from("provider_settings")');
    expect(serverSource).toContain('.from("measurement_credit_accounts")');
    expect(serverSource).toContain('"NO_MEASUREMENT_CREDIT"');
    expect(serverSource).toContain('"PROVIDER_NOT_READY"');
    expect(serverSource).not.toContain("measurement_debit");
  });
});
