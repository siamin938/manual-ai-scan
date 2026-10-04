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

const detailServerSource = readFileSync(
  resolve(process.cwd(), "src/lib/pilot-ops-admin-detail.functions.ts"),
  "utf8",
);

const navSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
  "utf8",
);

const creditRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/measurement-credits.tsx"),
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
    expect(routeSource).toContain("PDF 전달 후 재측정 시점 안내");
  });

  it("opens result and run details through internal admin readers while keeping customer actions membership-scoped", () => {
    expect(routeSource).toContain("결과 보기");
    expect(routeSource).toContain("측정 보기");
    expect(routeSource).toContain("setResultTarget(row)");
    expect(routeSource).toContain("setRunTarget({ row, runId: row.latestRunId as string })");
    expect(routeSource).toContain("getPilotOpsAdminResult");
    expect(routeSource).toContain("getPilotOpsAdminRunDetail");
    expect(routeSource).toContain("질문 관리");
    expect(routeSource).toContain("측정 시작");
    expect(routeSource).toContain("memberships.some");
    expect(routeSource).toContain("setActiveOrgId(row.orgId)");
    expect(routeSource).toContain("질문 관리·측정 시작은 고객 조직 멤버십이 있어야 합니다.");
    expect(routeSource).toContain("측정권 지급");
    expect(routeSource).toContain('search={{ org: row.orgId }}');
  });

  it("gates internal result and run readers with the existing internal admin permission", () => {
    expect(detailServerSource).toContain('client.rpc("can_view_data_asset_admin_v01")');
    expect(detailServerSource).toContain("fetchEntityFactsV2ReadGateway");
    expect(detailServerSource).toContain('supabaseAdmin.from("measurement_runs")');
    expect(detailServerSource).toContain('supabaseAdmin.from("measurement_jobs")');
    expect(routeSource).toContain("원문 응답을 노출하지 않고 측정 실행 상태와 운영 오류만 확인합니다.");
  });

  it("keeps operational actions visible while horizontally scrolling", () => {
    expect(routeSource).toContain("sticky right-0 z-20");
    expect(routeSource).toContain("sticky right-0 z-10");
    expect(routeSource).toContain("PDF 전달 후 재측정 시점 안내");
  });

  it("preselects the requested organization on the internal credit page", () => {
    expect(creditRouteSource).toContain('type MeasurementCreditsSearch = { org?: string }');
    expect(creditRouteSource).toContain("Route.useSearch()");
    expect(creditRouteSource).toContain("requestedOrgId");
    expect(creditRouteSource).toContain("availableOrgs.some");
  });
});
