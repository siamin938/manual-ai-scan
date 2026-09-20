import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";


const workflow = readFileSync(
  resolve(
    process.cwd(),
    ".github/workflows/entity-facts-v2-production-preflight.yml",
  ),
  "utf8",
);

const source = readFileSync(
  resolve(
    process.cwd(),
    "scripts/entity-facts-v2-production-preflight.ts",
  ),
  "utf8",
);

describe("Entity Facts v2 production preflight contract", () => {
  it("mints only a temporary write-capable CLI login role and uses session pooler mode", () => {
    expect(source).toContain("/cli/login-role");
    expect(source).toContain("JSON.stringify({ read_only: false })");
    expect(source).toContain("/config/database/pooler");
    expect(source).toContain('url.port = "5432"');
    expect(source).toContain('url.hostname.endsWith(EXPECTED_POOLER_SUFFIX)');
    expect(source).toContain(
      "/^cli_login_postgres(?:_|$)/u.test(body.role)",
    );
    expect(source).toContain(
      "${loginRole.role}.${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}",
    );
  });

  it("contains no business-data mutation SQL", () => {
    expect(source).not.toMatch(/insert\s+into\s+public\./iu);
    expect(source).not.toMatch(/update\s+public\./iu);
    expect(source).not.toMatch(/delete\s+from\s+public\./iu);
    expect(source).not.toMatch(/truncate\s+(?:table\s+)?public\./iu);
    expect(source).not.toMatch(/alter\s+table\s+public\./iu);
    expect(source).not.toMatch(/create\s+(?:table|function|trigger|index)/iu);
    expect(source).not.toContain(
      "entity-facts-v2-production-backfill.ts <dataset.json>",
    );
  });

  it("downgrades to service_role before reading v2 tables", () => {
    const downgrade = source.indexOf(
      'await tx.unsafe("set local role service_role")',
    );
    const roleCheck = source.indexOf(
      "PREFLIGHT_SERVICE_ROLE_DOWNGRADE_FAILED",
    );
    const counts = source.indexOf(
      "(select count(*) from public.measurement_entity_facts_v2)",
    );

    expect(downgrade).toBeGreaterThan(0);
    expect(roleCheck).toBeGreaterThan(downgrade);
    expect(counts).toBeGreaterThan(roleCheck);
    expect(source).toContain(
      "/^cli_login_postgres(?:_|$)/u.test(sessionUser)",
    );
  });

  it("requires empty tables and append-only service_role privileges", () => {
    expect(source).toContain("PREFLIGHT_TABLES_NOT_EMPTY");
    expect(source).toContain("'SELECT'");
    expect(source).toContain("'INSERT'");
    expect(source).toContain("'UPDATE'");
    expect(source).toContain("'DELETE'");
    expect(source).toContain("'TRUNCATE'");
    expect(source).toContain("PREFLIGHT_APPEND_ONLY_PRIVILEGES_INVALID");
    expect(source).toContain("PREFLIGHT_RLS_CONTRACT_INVALID");
    expect(source).toContain("PREFLIGHT_TRIGGER_CONTRACT_INVALID");
  });

  it("always attempts to delete temporary login roles", () => {
    const finallyIndex = source.indexOf("} finally {");
    const deleteCall = source.lastIndexOf(
      "await deleteTemporaryLoginRoles(token)",
    );

    expect(finallyIndex).toBeGreaterThan(0);
    expect(deleteCall).toBeGreaterThan(finallyIndex);
    expect(source).toContain("PREFLIGHT_TEMP_ROLE_DELETE_NOT_CONFIRMED");
  });

  it("never prints or embeds credentials", () => {
    expect(source).not.toMatch(/sbp_[A-Za-z0-9_-]+/u);
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^"']+:[^"']+@/u);
    expect(source).not.toMatch(/console\.log\([^)]*(?:token|password)/iu);
    expect(source).not.toMatch(/console\.error\([^)]*(?:token|password)/iu);
  });

  it("workflow is trigger-file-only and never calls the backfill runner", () => {
    expect(workflow).toContain(
      '.github/entity-facts-v2-production-preflight-trigger',
    );
    expect(workflow).toContain(
      'bun scripts/entity-facts-v2-production-preflight.ts',
    );
    expect(workflow).not.toContain(
      'bun scripts/entity-facts-v2-production-backfill.ts',
    );
    expect(workflow).not.toMatch(/workflow_dispatch:/u);
    expect(workflow).not.toMatch(/schedule:/u);
    expect(workflow).not.toMatch(/pull_request:/u);
    expect(workflow).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(workflow).toContain('.measurementFactRows == 0');
    expect(workflow).toContain('.aggregateRows == 0');
    expect(workflow).toContain('.temporaryLoginRoleDeleted == true');
  });
});
