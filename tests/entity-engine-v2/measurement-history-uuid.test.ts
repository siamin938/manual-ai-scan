import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isUuid } from "../../src/lib/customer-measurement.helpers";

const orgId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

describe("measurement history canonical UUID acceptance regression", () => {
  it("accepts real 8-4-4-4-12 UUIDs for organization, business and Run", () => {
    for (const id of [orgId, businessId, runId]) expect(isUuid(id)).toBe(true);
    expect(isUuid(orgId.toUpperCase())).toBe(true);
  });

  it("does not accept 8-4-4-12 or untrusted/invalid identifiers", () => {
    for (const id of [
      "11111111-1111-4111-111111111111",
      "22222222-2222-4222-222222222222",
      "",
      "other-org",
      "11111111-1111-4111-8111-111111111111'; --",
      null,
      undefined,
      {},
    ]) expect(isUuid(id)).toBe(false);
  });

  it("requires the same canonical validator in the browser catalog and both server paths", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const browser = at("src/lib/measurement-history.member-catalog.ts");
    const functions = at("src/lib/measurement-history.functions.ts");
    const server = at("src/lib/measurement-history.server.ts");

    for (const file of [browser, functions, server]) {
      expect(file).toContain("isUuid");
      expect(file).not.toContain("UUID_RE");
      expect(file).not.toMatch(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/iu);
    }
    expect(browser).toContain("!isUuid(orgId) || !isUuid(businessId)");
    expect(functions).toContain("!isUuid(orgId) || !isUuid(businessId)");
    expect(functions).toContain("!isUuid(input.runId)");
    expect(server).toContain("!isUuid(orgId) || !isUuid(businessId)");
    expect(server).toContain("return isUuid(id) ? id : null;");
    expect(server).toContain(".every((id) => isUuid(id))");
  });

  it("keeps member RLS and exact Run gates, never adds writes or unscoped materialization", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const browser = at("src/lib/measurement-history.member-catalog.ts");
    const functions = at("src/lib/measurement-history.functions.ts");
    const server = at("src/lib/measurement-history.server.ts");

    expect(browser).toContain('from("measurement_runs")');
    expect(browser).toContain('.eq("org_id", orgId)');
    expect(browser).toContain('.eq("business_id", businessId)');
    expect(functions).toContain(".middleware([requireSupabaseAuth])");
    expect(functions).toContain('.from("organization_members")');
    expect(functions).toContain(".eq(\"user_id\", context.userId)");
    expect(server).toContain('.eq("source_run_id", runId)');
    expect(server).toContain("isValidHistoryAggregate({");
    for (const file of [browser, functions, server]) {
      for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "enqueueRun(", "measurement_credit_accounts"]) {
        expect(file).not.toContain(forbidden);
      }
    }
  });
});
