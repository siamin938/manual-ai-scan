import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/pilot-ops.tsx"),
  "utf8",
);

const serverSource = readFileSync(
  resolve(process.cwd(), "src/lib/pilot-ops-admin.functions.ts"),
  "utf8",
);

const navSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
  "utf8",
);

const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261004042000_pilot_ops_admin_overview_v01.sql",
  ),
  "utf8",
);

describe("pilot operations admin overview", () => {
  it("keeps the page internal-only and read-only", () => {
    expect(navSource).toContain('{ to: "/pilot-ops", label: "파일럿 운영" }');
    expect(navSource).toContain("dataAssetAccess?.allowed");
    expect(routeSource).toContain("내부 운영자 전용");
    expect(routeSource).toContain("읽기 전용 화면");
    expect(routeSource).not.toContain(".insert(");
    expect(routeSource).not.toContain(".update(");
    expect(routeSource).not.toContain(".delete(");
  });

  it("derives operational stages from existing data rather than storing a new customer status", () => {
    expect(migrationSource).toContain("when question_set_id is null then 'questions_needed'");
    expect(migrationSource).toContain("when active_question_count <> 24 then 'questions_review'");
    expect(migrationSource).toContain("when latest_run_id is null then 'first_measurement_needed'");
    expect(migrationSource).toContain("then 'measurement_in_progress'");
    expect(migrationSource).toContain("then 'result_ready'");
    expect(migrationSource).toContain("'결과 전달 · 재측정 안내'");
  });

  it("gates the cross-organization reader with the existing internal admin permission", () => {
    expect(migrationSource).toContain("security definer");
    expect(migrationSource).toContain("public.can_view_data_asset_admin_v01()");
    expect(migrationSource).toContain(
      "revoke all on function public.get_pilot_ops_admin_overview_v01(text,integer) from anon",
    );
    expect(serverSource).toContain('client.rpc("can_view_data_asset_admin_v01")');
    expect(serverSource).toContain('client.rpc("get_pilot_ops_admin_overview_v01"');
  });

  it("shows the core pilot handoff signals in one table", () => {
    expect(routeSource).toContain("질문 준비");
    expect(routeSource).toContain("최근 측정");
    expect(routeSource).toContain("측정권");
    expect(routeSource).toContain("다음 작업");
    expect(routeSource).toContain("결과 전달 가능");
    expect(routeSource).toContain("고객 결과 확인 후 PDF 전달");
  });
});
