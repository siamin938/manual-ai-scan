import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(
  resolve(process.cwd(), "src/lib/customer-measurement.server.ts"),
  "utf8",
);
const runsSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/runs.index.tsx"),
  "utf8",
);

describe("customer measurement retry and duplicate guard contract", () => {
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
