import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = resolve(
  process.cwd(),
  "scripts/sql/run-competitor-source-clue-aggregates-v2-migration-candidate.sql",
);
const sql = readFileSync(path, "utf8");
const executable = sql
  .split(/\r?\n/u)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const officialMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260921110146_run_competitor_source_clue_aggregates_v2.sql",
);
const officialSql = readFileSync(officialMigrationPath, "utf8");
const officialExecutable = officialSql
  .split(/\r?\n/u)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("Competitor source clue storage candidate", () => {
  it("remains candidate-only and separate from confirmed observed sources", () => {
    expect(path.replaceAll("\\", "/")).not.toContain("/supabase/migrations/");
    expect(sql).toContain("CANDIDATE ONLY");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.run_competitor_source_clue_aggregates_v2",
    );
    expect(sql).toContain(
      "REFERENCES public.run_observed_source_aggregates_v2(id) ON DELETE RESTRICT",
    );
    expect(executable).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM|TRUNCATE\s+TABLE)\s+public\.(?:measurement_entity_facts_v2|run_entity_fact_aggregates_v2|run_observed_source_aggregates_v2)/iu,
    );
  });

  it("has a Supabase-CLI-generated official migration that is still unapplied", () => {
    expect(officialSql).toContain("Generated with Supabase CLI");
    expect(officialSql).toContain("NOT APPLIED TO PRODUCTION");
    expect(officialExecutable).toBe(executable);
  });

  it("pins every clue supplement to the immutable aggregate and observed-source row", () => {
    for (const field of [
      "base_aggregate_id uuid NOT NULL",
      "base_observed_source_aggregate_id uuid NOT NULL",
      "base_materialization_id uuid NOT NULL",
      "clue_version text NOT NULL",
      "source_replay_version text NOT NULL",
      "engine_version text NOT NULL",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain(
      "run_competitor_source_clue_aggregates_v2_base_version_uq",
    );
    expect(sql).toContain("COMPETITOR_SOURCE_CLUE_BASE_SCOPE_MISMATCH");
    expect(sql).toContain("COMPETITOR_SOURCE_CLUE_OBSERVED_SCOPE_MISMATCH");
    expect(sql).toContain(
      "COMPETITOR_SOURCE_CLUE_OBSERVED_BASE_VERSION_MISMATCH",
    );
    expect(sql).toContain(
      "COMPETITOR_SOURCE_CLUE_REPLAY_VERSION_MISMATCH",
    );
    expect(sql).toContain(
      "NEW.source_replay_version <> v_observed.source_replay_version",
    );
  });

  it("keeps clues competitor-only, singleton, advisory and non-overlapping", () => {
    expect(sql).toContain("v_canonical_key NOT LIKE 'auto:%'");
    expect(sql).toContain(
      "v_evidence_tier IS DISTINCT FROM 'near_section_title_match'",
    );
    expect(sql).toContain("v_response_count <> 1");
    expect(sql).toContain("COMPETITOR_SOURCE_CLUE_NOT_IN_BASE_COMPETITORS");
    expect(sql).toContain("COMPETITOR_SOURCE_CLUE_ALREADY_ACCEPTED");
    expect(sql).toContain("COMPETITOR_SOURCE_CLUE_DUPLICATE_PAIR");
    expect(sql).toContain("v_base.aggregate->'competitors'");
    expect(sql).toContain("v_observed.observed_sources");
  });

  it("is append-only, server-only and hardened from the start", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON public\.run_competitor_source_clue_aggregates_v2/u,
    );
    expect(sql).toContain(
      "EXECUTE FUNCTION public.reject_entity_fact_v2_mutation()",
    );
    expect(sql).toMatch(
      /GRANT SELECT, INSERT[\s\S]*run_competitor_source_clue_aggregates_v2[\s\S]*TO service_role/iu,
    );
    expect(sql).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*FROM service_role/iu,
    );
    expect(sql).toContain("FROM anon, authenticated");
    expect(sql).not.toMatch(/CREATE\s+POLICY/iu);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/iu);
  });

  it("requires deterministic hashes and array payload storage", () => {
    expect(sql).toContain("input_fingerprint ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("source_clues_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("jsonb_typeof(source_clues) = 'array'");
  });
});
