import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canRenderDashboardPrivateV1Preview } from "../../src/lib/action-opportunity-v1.dashboard-private-scope";

const orgId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const selected = { orgId, businessId, runId };
const preview = { orgId, businessId, runId, model: { runId } };

function gate(partial: Parameters<typeof canRenderDashboardPrivateV1Preview>[0] = {
  adminAllowed: true,
  selected,
  current: selected,
  preview,
}): boolean {
  return canRenderDashboardPrivateV1Preview(partial);
}

describe("Action Opportunity v1.0 dashboard private preview isolation", () => {
  it("allows an authorized administrator to render the exact selected Run", () => {
    expect(gate()).toBe(true);
  });

  it("fails closed for non-admins and when the toggle is closed", () => {
    const args = { adminAllowed: false, selected, current: selected, preview };
    expect(gate(args)).toBe(false);
    expect(gate({ ...args, adminAllowed: true, selected: null })).toBe(false);
    expect(gate({ ...args, adminAllowed: true, preview: null })).toBe(false);
  });

  it("never renders a cached result for another business or organization", () => {
    expect(gate({ adminAllowed: true, selected, current: {
      ...selected, businessId: "44444444-4444-4444-8444-444444444444",
    }, preview })).toBe(false);
    expect(gate({ adminAllowed: true, selected, current: {
      ...selected, orgId: "55555555-5555-4555-8555-555555555555",
    }, preview })).toBe(false);
    expect(gate({ adminAllowed: true, selected, current: selected, preview: {
      ...preview, businessId: "44444444-4444-4444-8444-444444444444",
    }})).toBe(false);
  });

  it("fails closed when a new representative Run supersedes the displayed preview", () => {
    expect(gate({ adminAllowed: true, selected, current: {
      ...selected, runId: "66666666-6666-4666-8666-666666666666",
    }, preview })).toBe(false);
    expect(gate({ adminAllowed: true, selected, current: selected, preview: {
      ...preview, model: { runId: "66666666-6666-4666-8666-666666666666" },
    }})).toBe(false);
  });

  it("does not display previews while the customer dashboard has no active Run", () => {
    expect(gate({ adminAllowed: true, selected, current: {
      ...selected, runId: null,
    }, preview })).toBe(false);
  });

  it("requires both server-side admin RPC and RLS-scoped org membership", () => {
    const server = readFileSync(
      resolve(process.cwd(), "src/lib/action-opportunity-v1.dashboard-private.functions.ts"),
      "utf8",
    );
    expect(server).toContain(".middleware([requireSupabaseAuth])");
    expect(server).toContain('rpc("can_view_data_asset_admin_v01")');
    expect(server).toContain(".eq(\"org_id\", data.orgId)");
    expect(server).toContain(".eq(\"user_id\", context.userId)");
    expect(server.indexOf('rpc("can_view_data_asset_admin_v01")')).toBeLessThan(
      server.indexOf("fetchEntityFactsV2ReadGateway("),
    );
    expect(server).toContain("fetchEntityFactsV2ReadGateway(");
    expect(server).toContain("buildCustomerPreviewV1Model(");
    expect(server).toContain("expectedRunId: gateway.data.scope.runId");
    expect(server).toContain("focusDomain: sourceDomain");
    for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "enqueueRun", "measurement_credit_accounts"]) {
      expect(server).not.toContain(forbidden);
    }
  });

  it("keeps the customer route as a manual, administrator-only, no-print addition", () => {
    const dashboard = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(dashboard).toContain("getActionOpportunityV1DashboardPrivatePreview");
    expect(dashboard).toContain('queryKey: ["can-view-data-asset-admin", session?.user.id]');
    expect(dashboard).toContain("privateV1AdminAllowed && dto && model");
    expect(dashboard).toContain('open={privateV1AdminAllowed && privateV1Selected}');
    expect(dashboard).toContain("canRenderDashboardPrivateV1Preview");
    expect(dashboard).toContain('className="no-print max-h-[90vh] overflow-y-auto sm:max-w-4xl"');
    expect(dashboard).toContain("ActionOpportunityV1CustomerPreview");
    expect(dashboard).toContain("privateV1PreviewQuery.data?.ok");
    expect(dashboard).toContain("privateV1AdminAllowed && activeOrgId && businessId && dto");
    expect(dashboard).toContain("setPrivateV1Focus(insight)");
    expect(dashboard).toContain("focusedInsight={privateV1Focus}");
    expect(dashboard).toContain("v1RuleForOwnerSummaryInsight(item.id)");
    expect(dashboard).toContain('className="no-print mt-1 h-auto px-0 py-1 text-xs"');
    expect(dashboard).toContain("session?.user.id,");
    expect(dashboard).toContain("dto?.scope.runId,");
    expect(dashboard).not.toContain("publicV1Enabled");
    expect(dashboard).toContain("print-report");
  });
});
