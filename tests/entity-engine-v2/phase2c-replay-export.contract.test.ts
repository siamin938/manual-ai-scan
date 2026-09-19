import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../scripts/sql/export-entity-facts-phase2c-replay.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = sql
  .split(/\r?\n/u)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("Phase 2C replay export contract", () => {
  it("is read-only", () => {
    expect(executableSql).not.toMatch(
      /\b(?:insert|update|delete|alter|drop|truncate|create)\b/iu,
    );
  });

  it("exports the Phase 2C wrapped dataset shape", () => {
    expect(executableSql).toContain(
      "'version', 'entity-facts-phase2c-export-v0.1'",
    );
    expect(executableSql).toContain("'publicIdentities'");
    expect(executableSql).toContain("'registeredBusinesses'");
    expect(executableSql).toContain("'storedMentions'");
    expect(executableSql).toContain("'attributions'");
    expect(executableSql).toContain("'currentCompetitors'");
    expect(executableSql).toContain("'currentTargetSources'");
    expect(executableSql).toContain("'attributionId'");
    expect(executableSql).toContain("'measurementMentionId'");
    expect(executableSql).toContain("'citationStartIndex'");
    expect(executableSql).toContain("'entityEndIndex'");
    expect(executableSql).toContain("'rawParser'");
    expect(executableSql).toContain("'target'");
  });

  it("preserves raw parser audit fields without using them as identity evidence", () => {
    expect(executableSql).toContain("'wasClientMentioned'");
    expect(executableSql).toContain("'clientPosition'");
    expect(executableSql).toContain("m.was_client_mentioned");
    expect(executableSql).toContain("m.client_position");
  });

  it("does not manufacture phone or verified concrete URL evidence", () => {
    expect(executableSql).toContain("'verifiedPhone', null");
    expect(executableSql).toContain(
      "'verifiedConcreteOfficialUrls', '[]'::jsonb",
    );
  });

  it("uses current Production competitor/source readers as replay baselines", () => {
    expect(executableSql).toContain(
      "public.get_competitor_significance_v02",
    );
    expect(executableSql).toContain(
      "public.measurement_citation_attributions_actionable_v2",
    );
    expect(executableSql).toContain(
      "a.canonical_key='business:'||rc.business_id::text",
    );
  });

  it("uses only stored versioned citation attribution rows", () => {
    expect(executableSql).toContain(
      "public.measurement_citation_attributions",
    );
    expect(executableSql).toContain(
      "a.attribution_version='0.1.0'",
    );
    expect(executableSql).toContain("'url', a.citation_url");
    expect(executableSql).toContain("'domain', a.domain");
    expect(executableSql).toContain("'evidence', a.evidence");
  });

  it("exports all completed standalone measurement rows including invalid rows", () => {
    expect(executableSql).toContain("'valid', rm.valid");
    expect(executableSql).not.toMatch(/where\s+m\.valid\s*=\s*true/iu);
  });
});
