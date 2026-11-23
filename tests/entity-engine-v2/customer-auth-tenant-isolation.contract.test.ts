import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const auth = read("src/routes/auth.tsx");
const layout = read("src/routes/_authenticated/route.tsx");
const org = read("src/lib/org.tsx");
const options = read("src/lib/client-business-options.functions.ts");
const report = read("src/lib/customer-report.functions.ts");
const insight = read("src/lib/insights.functions.ts");
const evidence = read("src/lib/action-opportunity-evidence.functions.ts");
const gateway = read("src/lib/entity-facts-v2-read-gateway.functions.ts");
const gatewayServer = read("src/lib/entity-facts-v2-read-gateway.server.ts");
const privatePreview = read("src/lib/action-opportunity-v1.dashboard-private.functions.ts");
const admin = read("src/lib/data-asset-admin.functions.ts");

function expectOrgMembershipGate(source: string): void {
  expect(source).toContain(".middleware([requireSupabaseAuth])");
  expect(source).toContain('.from("organization_members")');
  expect(source).toContain('.eq("org_id", data.orgId)');
  expect(source).toContain('.eq("user_id", context.userId)');
  expect(source).toContain(".maybeSingle()");
}

describe("customer auth and tenant security contract", () => {
  it("maintains closed self-signup, authenticated route gating, and recovery", () => {
    expect(auth).toContain("const SELF_SIGNUP_ENABLED = false;");
    expect(layout).toContain("beforeLoad: async () => {");
    expect(layout).toContain("supabase.auth.getUser()");
    expect(layout).toContain('if (error || !data.user) throw redirect({ to: "/auth" });');
    expect(auth).toContain('event === "PASSWORD_RECOVERY"');
    expect(auth).toContain("resetPasswordForEmail");
    expect(auth).toContain("window.location.origin");
    expect(auth).toContain("/auth?mode=recovery");
    expect(auth).toContain("updateUser({ password: newPassword })");
  });

  it("clears customer caches and stored business selections on sign-out or account switch", () => {
    expect(org).toContain("useQueryClient");
    expect(org).toContain("shouldDiscardCustomerState(event, previousUserId, nextUserId)");
    expect(org).toContain("queryClient.clear();");
    expect(org).toContain("clearStoredTargetBusinessSelections(window.localStorage)");
    expect(org.indexOf("queryClient.clear()")).toBeLessThan(org.indexOf("setSession(nextSession);"));
    expect(org).toContain("if (eventRevision === initialRevision)");
    expect(layout).toContain("key={session.user.id}");
    expect(layout).toContain("if (!ready || !session)");
    expect(layout).toContain("if (ready && !session)");
    expect(layout).toContain('navigate({ to: "/auth", replace: true })');
    expect(layout).toContain("setIsSigningOut(true)");
    expect(layout).toContain("await supabase.auth.signOut()");
    expect(layout).toContain('navigate({ to: "/auth" })');
  });

  it("requires current JWT plus tenant membership before customer server reads", () => {
    for (const source of [options, report, insight, evidence, gateway, privatePreview]) {
      expectOrgMembershipGate(source);
    }
    expect(gateway.indexOf('if (!membership) return { ok: false, error: "FORBIDDEN" }')).toBeLessThan(
      gateway.indexOf("return fetchEntityFactsV2ReadGateway("),
    );
    expect(report.indexOf('if (!membership) throw new Error("FORBIDDEN")')).toBeLessThan(
      report.indexOf("const { supabaseAdmin }"),
    );
    expect(insight.indexOf('if (!membership) throw new Error("FORBIDDEN")')).toBeLessThan(
      insight.indexOf("const { supabaseAdmin }"),
    );
    expect(evidence.indexOf('if (!membership) return { ok: false, error: "FORBIDDEN" }')).toBeLessThan(
      evidence.indexOf("const result = await fetchActionOpportunityEvidence(data)"),
    );
  });

  it("matches target business to organization before service-role diagnostic data reads", () => {
    expect(gatewayServer).toContain('.eq("id", businessId)');
    expect(gatewayServer).toContain('.eq("org_id", orgId)');
    expect(gatewayServer).toContain('.eq("is_client_business", true)');
    expect(gatewayServer).toContain('.eq("active", true)');
    expect(report).toContain('.eq("org_id", data.orgId)');
    expect(report).toContain("businesses.find((b) => b.id === data.businessId)");
    expect(insight).toContain('.eq("id", data.businessId)');
    expect(insight).toContain('.eq("org_id", data.orgId)');
    expect(options).toContain('.select("id, name")');
    expect(options).toContain('.eq("is_client_business", true)');
    expect(options).toContain('.eq("active", true)');
  });

  it("enforces an independent server administrator gate on internal and private v1 features", () => {
    expect(admin).toContain(".middleware([requireSupabaseAuth])");
    expect(admin).toContain('client.rpc("can_view_data_asset_admin_v01")');
    expect(admin).toContain("if (permission.error || permission.data !== true)");
    expect(privatePreview).toContain('rpc("can_view_data_asset_admin_v01")');
    expect(privatePreview).toContain("if (permission.error || permission.data !== true)");
    expect(privatePreview.indexOf('rpc("can_view_data_asset_admin_v01")')).toBeLessThan(
      privatePreview.indexOf("fetchEntityFactsV2ReadGateway("),
    );
    expect(privatePreview).toContain("expectedRunId: gateway.data.scope.runId");
    for (const mutator of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(privatePreview).not.toContain(mutator);
    }
  });
});
