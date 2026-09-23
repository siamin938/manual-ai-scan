import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sqlUrl = new URL(
  "../../scripts/sql/export-entity-v2-replay.sql",
  import.meta.url,
);
const sql = readFileSync(fileURLToPath(sqlUrl), "utf8");
const executableSql = sql
  .split(/\r?\n/u)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("Entity Engine v2 replay export contract", () => {
  it("remains read-only", () => {
    expect(executableSql).not.toMatch(
      /\b(?:insert|update|delete|alter|drop|truncate|create)\b/iu,
    );
  });

  it("exports the wrapped dataset shape consumed by the replay runner", () => {
    expect(executableSql).toContain("'version', 'production-export-v0.1'");
    expect(executableSql).toContain("'rows', coalesce(");
    expect(executableSql).toContain("jsonb_agg(row_json order by run_id, measurement_id)");
    expect(executableSql).toContain("'responseText', em.response_text");
    expect(executableSql).toContain("'businesses', coalesce(bc.businesses,'[]'::jsonb)");
    expect(executableSql).toContain("'v1Entities', coalesce(v1.entities,'[]'::jsonb)");
  });

  it("exports the v1 canonical and verification fields required by the blocking gate", () => {
    expect(executableSql).toContain("'verificationStatus', ev.verification_status");
    expect(executableSql).toContain("'matchedBusinessId', mm.matched_business_id");
    expect(executableSql).toContain("'canonicalKey', c.canonical_key");
    expect(executableSql).toContain("'canonicalDisplayName', c.canonical_display_name");
    expect(executableSql).toContain("ev.verifier_version='0.1.5'");
    expect(executableSql).toContain("cc.resolver_version='0.1.1'");
  });
});
