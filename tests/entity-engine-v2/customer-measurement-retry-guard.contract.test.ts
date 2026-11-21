import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCustomerMeasurementRun } from "../../src/lib/customer-measurement.server";

const serverSource = readFileSync(
  resolve(process.cwd(), "src/lib/customer-measurement.server.ts"),
  "utf8",
);
const runsSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/runs.index.tsx"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261003084606_customer_measurement_active_run_unique_v01.sql",
  ),
  "utf8",
);

describe("customer measurement retry and duplicate guard contract", () => {
  it.each([true, false])("handles a zero balance when a matching run exists = %s", async (active) => {
    const reads: string[] = [];
    const rows: Record<string, unknown> = {
      organization_members: { role: "owner" },
      businesses: { id: "business", name: "정비소" },
      question_sets: [{ id: "set", name: "기존 질문" }],
      questions: [{ id: "q", data_class: "public", intent_type: "service" }],
      measurement_runs: active ? { id: "existing", total_jobs: 24 } : null,
      provider_settings: { enabled: true, paid_account_confirmed: true, terms_reviewed: true,
        automated_benchmark_approved: true, estimated_cost_per_request_usd: 0.01 },
      measurement_credit_accounts: { balance: 0 },
    };
    const client = {
      from(table: string) {
        reads.push(table);
        if (!(table in rows)) throw new Error("Unexpected read: " + table);
        const result = { data: rows[table], error: null };
        return {
          select() { return this; }, eq() { return this; }, is() { return this; },
          in() { return this; }, order() { return this; }, limit() { return this; },
          maybeSingle() { return result; },
          then(resolve: (value: typeof result) => void) { resolve(result); },
        };
      },
    };
    const result = await createCustomerMeasurementRun({
      supabase: client as unknown as Parameters<typeof createCustomerMeasurementRun>[0]["supabase"],
      userId: "user", orgId: "org", businessId: "business", questionSetId: "set",
    });
    expect(result).toEqual(active
      ? { ok: true, runId: "existing", plannedJobs: 24 }
      : { ok: false, error: "NO_MEASUREMENT_CREDIT" });
    expect(reads.includes("measurement_credit_accounts")).toBe(!active);
  });

  it("reuses same-condition queued/running customer runs before creating a new draft", () => {
    const activeLookup = serverSource.indexOf(
      '.in("status", ["queued", "running"])',
    );
    const insertRun = serverSource.indexOf('.from("measurement_runs")\n      .insert({');
    expect(activeLookup).toBeGreaterThan(-1);
    expect(insertRun).toBeGreaterThan(activeLookup);
    expect(serverSource).toContain('.eq("diagnostic_scope", "customer")');
    expect(serverSource).toContain('.eq("question_set_id", questionSetId)');
  });

  it("keeps recent same-user draft reuse for pre-enqueue retries", () => {
    expect(serverSource).toContain('.eq("status", "draft")');
    expect(serverSource).toContain('.eq("created_by", userId)');
    expect(serverSource).toContain("30 * 60 * 1000");
  });


  it("enforces one active customer run per org/business/question-set at the DB layer", () => {
    expect(migrationSource).toContain(
      "create unique index measurement_runs_customer_active_condition_uq",
    );
    expect(migrationSource).toContain(
      "on public.measurement_runs (org_id, business_id, question_set_id)",
    );
    expect(migrationSource).toContain(
      "diagnostic_scope = 'customer'",
    );
    expect(migrationSource).toContain(
      "'draft'::public.run_status",
    );
    expect(migrationSource).toContain(
      "'queued'::public.run_status",
    );
    expect(migrationSource).toContain(
      "'running'::public.run_status",
    );
  });

  it("recovers a 23505 insert race by reusing the DB-winning active run", () => {
    expect(serverSource).toContain('insertErr?.code !== "23505"');
    expect(serverSource).toContain(
      '.in("status", ["draft", "queued", "running"])',
    );
    expect(serverSource).toContain("runId = racedRun.id");
  });

  it("still delegates final per-run enqueue idempotency to enqueue-run", () => {
    expect(serverSource).toContain('supabase.functions.invoke("enqueue-run"');
    expect(serverSource).toContain("body: { runId }");
  });

  it("guards ordinary UI double-submit and avoids an absolute cross-tab guarantee", () => {
    expect(runsSource).toContain(
      "if (blockers.length > 0 || submitting || !activeOrgId) return;",
    );
    expect(runsSource).toContain(
      'disabled={blockers.length > 0 || submitting}',
    );
    expect(runsSource).toContain(
      "같은 조건의 최근 측정이 이미 준비·진행 중이면 해당 측정을 이어서 사용합니다.",
    );
    expect(runsSource).not.toContain(
      "같은 조건으로 다시 시작해도 중복 측정은 생성되지 않습니다.",
    );
  });
});
