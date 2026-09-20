import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 2C historical materializer workflow read-only contract", () => {
  it("uses the Supabase Management API read-only SQL endpoint", () => {
    const workflow = readFileSync(
      resolve(
        process.cwd(),
        ".github/workflows/entity-facts-phase2c-historical-replay.yml",
      ),
      "utf8",
    );

    expect(workflow).toContain("/database/query/read-only");
    expect(workflow).not.toMatch(/\/database\/query["']/u);
    expect(workflow).not.toMatch(
      /\b(?:insert|update|delete|upsert|merge|truncate|alter|drop|create)\b/iu,
    );
  });
});
