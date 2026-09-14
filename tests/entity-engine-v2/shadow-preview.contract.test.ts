import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EDGE = resolve(
  process.cwd(),
  "supabase/functions/entity-v2-shadow-preview/index.ts",
);
const CONFIG = resolve(process.cwd(), "supabase/config.toml");
const source = readFileSync(EDGE, "utf8");
const config = readFileSync(CONFIG, "utf8");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("Entity v2 shadow preview Edge contract", () => {
  it("is explicitly JWT protected", () => {
    expect(config).toContain("[functions.entity-v2-shadow-preview]");
    expect(config).toContain("[functions.entity-v2-shadow-preview]\nverify_jwt = true");
  });

  it("uses only stored measurements and v1 mentions for comparison", () => {
    expect(source).toContain('from("measurements")');
    expect(source).toContain('from("measurement_mentions")');
    expect(source).toContain("runEntityV2RuntimeShadowComparison");
  });

  it("contains no database mutation methods or provider execution", () => {
    const normalized = compact(source);
    expect(normalized).not.toContain(".insert(");
    expect(normalized).not.toContain(".update(");
    expect(normalized).not.toContain(".upsert(");
    expect(normalized).not.toContain(".delete(");
    expect(normalized).not.toContain("callProvider(");
    expect(normalized).not.toContain("fetch(");
  });

  it("fails closed outside standalone audit runs", () => {
    expect(source).toContain("SHADOW_PREVIEW_STANDALONE_AUDIT_ONLY");
    expect(source).toContain('run.run_type !== "audit"');
    expect(source).toContain('run.phase !== "standalone"');
  });

  it("declares no-provider and no-database-modification results", () => {
    expect(source).toContain("api_provider_called: false");
    expect(source).toContain("database_modified: false");
  });
});
