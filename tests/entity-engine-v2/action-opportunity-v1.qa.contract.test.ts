import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const searchSource = readFileSync(
  resolve(process.cwd(), "src/lib/action-opportunity-v1.qa.functions.ts"),
  "utf8",
);
const internalRoute = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/internal-observation-pipeline.tsx"),
  "utf8",
);
const customerRoute = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
  "utf8",
);

describe("Action Opportunity v1.0 internal-only QA search contract", () => {
  it("requires authenticated admin and an eligible internal observation org", () => {
    expect(searchSource).toContain(".middleware([requireSupabaseAuth])");
    expect(searchSource).toContain('rpc("can_view_data_asset_admin_v01")');
    expect(searchSource).toContain('"measurement_data_origin", "internal_observation"');
    expect(searchSource).toContain('.eq("is_client_business", true)');
    expect(searchSource).toContain('.eq("active", true)');
    expect(searchSource).toContain('.eq("org_id", data.orgId)');
    expect(searchSource).toContain(".limit(15)");
  });

  it("performs only read-only name search and reuses the existing admin result gateway", () => {
    expect(searchSource).toContain('.from("businesses")');
    for (const prohibited of [".insert(", ".update(", ".delete(", ".upsert(", "enqueue", "ready_to_measure"]) {
      expect(searchSource).not.toContain(prohibited);
    }
    expect(internalRoute).toContain("searchActionOpportunityV1QaBusinesses");
    expect(internalRoute).toContain("setResultTarget({");
    expect(internalRoute).toContain("getPilotOpsAdminResult");
    expect(internalRoute).toContain("actionOpportunityRunMismatch");
    expect(customerRoute).not.toContain("searchActionOpportunityV1QaBusinesses");
    expect(customerRoute).not.toContain("buildActionOpportunityV1Preview");
  });
});
