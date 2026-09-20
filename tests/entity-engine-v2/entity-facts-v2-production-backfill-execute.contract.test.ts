import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "scripts/entity-facts-v2-production-backfill-execute.ts",
  ),
  "utf8",
);

const workflow = readFileSync(
  resolve(
    process.cwd(),
    ".github/workflows/entity-facts-v2-production-backfill.yml",
  ),
  "utf8",
);

describe("Entity Facts v2 approved Production backfill executor contract", () => {
  it("requires the reviewed confirmation and project ref", () => {
    expect(source).toContain("ENTITY_FACTS_V2_BACKFILL_CONFIRMATION");
    expect(source).toContain("ENTITY_FACTS_V2_BACKFILL_PROJECT_REF");
    expect(source).toContain("BACKFILL_EXPLICIT_CONFIRMATION_REQUIRED");
  });

  it("uses only a temporary CLI login role through session pooler", () => {
    expect(source).toContain("/cli/login-role");
    expect(source).toContain("JSON.stringify({ read_only: false })");
    expect(source).toContain("/config/database/pooler");
    expect(source).toContain('url.port = "5432"');
    expect(source).toContain(
      "${loginRole.role}.${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}",
    );
    expect(source).toContain(
      "/^cli_login_postgres(?:_|$)/u.test(body.role)",
    );
  });

  it("delegates all data mutation to the guarded transactional runner", () => {
    expect(source).toContain("executeProductionEntityFactsV2Backfill");
    expect(source).not.toMatch(/insert\s+into\s+public\./iu);
    expect(source).not.toMatch(/update\s+public\./iu);
    expect(source).not.toMatch(/delete\s+from\s+public\./iu);
    expect(source).not.toMatch(/truncate\s+(?:table\s+)?public\./iu);
    expect(source).not.toMatch(/alter\s+table\s+public\./iu);
  });

  it("always deletes the temporary login role after execution", () => {
    const finallyIndex = source.indexOf("} finally {");
    const deleteCall = source.lastIndexOf(
      "await deleteTemporaryLoginRoles(token)",
    );
    expect(finallyIndex).toBeGreaterThan(0);
    expect(deleteCall).toBeGreaterThan(finallyIndex);
    expect(source).toContain("BACKFILL_TEMP_ROLE_DELETE_NOT_CONFIRMED");
  });

  it("never prints or embeds credentials", () => {
    expect(source).not.toMatch(/sbp_[A-Za-z0-9_-]+/u);
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^"']+:[^"']+@/u);
    expect(source).not.toMatch(/console\.log\([^)]*(?:token|password)/iu);
    expect(source).not.toMatch(/console\.error\([^)]*(?:token|password)/iu);
  });

  it("workflow is explicit-trigger-only and preserves the reviewed write order", () => {
    expect(workflow).toContain(
      '.github/entity-facts-v2-production-backfill-trigger',
    );
    expect(workflow).not.toMatch(/workflow_dispatch:/u);
    expect(workflow).not.toMatch(/schedule:/u);
    expect(workflow).not.toMatch(/pull_request:/u);

    const exportIndex = workflow.indexOf(
      "Export exact Production replay dataset read-only",
    );
    const dryRunIndex = workflow.indexOf(
      "Re-run full materializer dry-run immediately before write",
    );
    const emptyIndex = workflow.indexOf(
      "Verify v2 tables are empty before write",
    );
    const executeIndex = workflow.indexOf(
      "Execute approved single-transaction Production backfill",
    );
    const verifyIndex = workflow.indexOf(
      "Verify committed Production materialization read-only",
    );

    expect(exportIndex).toBeGreaterThan(0);
    expect(dryRunIndex).toBeGreaterThan(exportIndex);
    expect(emptyIndex).toBeGreaterThan(dryRunIndex);
    expect(executeIndex).toBeGreaterThan(emptyIndex);
    expect(verifyIndex).toBeGreaterThan(executeIndex);

    expect(workflow).toContain("--expected-runs=23");
    expect(workflow).toContain("--expected-measurements=428");
    expect(workflow).toContain("--expected-lower=4.17");
    expect(workflow).toContain("--expected-upper=29.17");
    expect(workflow).toContain(
      "bun scripts/entity-facts-v2-production-backfill-execute.ts",
    );
    expect(workflow).toContain(".committedMeasurementRows == 428");
    expect(workflow).toContain(".committedAggregateRows == 23");
    expect(workflow).toContain("(.[0].measurement_fact_rows | tonumber) == 428");
    expect(workflow).toContain("(.[0].aggregate_rows | tonumber) == 23");
  });
});
