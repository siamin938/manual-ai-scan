import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const functionsSource = readFileSync(
  resolve(process.cwd(), "src/lib/measurement-credit-admin.functions.ts"),
  "utf8",
);

const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261003090348_revoke_legacy_measurement_credit_admin_overview_v01.sql",
  ),
  "utf8",
);

describe("measurement-credit admin SECURITY DEFINER surface", () => {
  it("uses v0.2 as the current authenticated admin overview path", () => {
    expect(functionsSource).toContain(
      'client.rpc("get_measurement_credit_admin_overview_v02"',
    );
    expect(functionsSource).not.toContain(
      'client.rpc("get_measurement_credit_admin_overview_v01"',
    );
  });

  it("revokes the superseded v0.1 overview from authenticated callers", () => {
    expect(migrationSource).toContain(
      "revoke execute on function public.get_measurement_credit_admin_overview_v01(integer)",
    );
    expect(migrationSource).toContain("from authenticated");
    expect(migrationSource).toContain("to service_role");
  });
});
