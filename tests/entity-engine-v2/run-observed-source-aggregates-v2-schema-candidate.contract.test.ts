import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const candidatePath = resolve(
  process.cwd(),
  "scripts/sql/run-observed-source-aggregates-v2-migration-candidate.sql",
);
const sql = readFileSync(candidatePath, "utf8");
const executableSql = sql
  .split(/\r?\n/u)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const officialMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260921084448_run_observed_source_aggregates_v2.sql",
);
const officialSql = readFileSync(officialMigrationPath, "utf8");
const officialExecutableSql = officialSql
  .split(/\r?\n/u)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("Observed source aggregate storage candidate contract", () => {
  it("stays outside the applied Supabase migration directory", () => {
    expect(candidatePath.replaceAll("\\", "/")).not.toContain(
      "/supabase/migrations/",
    );
    expect(sql).toContain("CANDIDATE ONLY");
    expect(sql).toContain("do not apply directly to Production");
  });

  it("matches the Production-applied official migration executable SQL", () => {
    expect(officialSql).toContain("Generated with Supabase CLI");
    expect(officialSql).not.toContain("CANDIDATE ONLY");
    expect(officialExecutableSql).toBe(executableSql);
  });

  it("creates a separate append-only supplement instead of altering Entity Facts v2", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.run_observed_source_aggregates_v2",
    );
    expect(sql).toContain(
      "REFERENCES public.run_entity_fact_aggregates_v2(id) ON DELETE RESTRICT",
    );
    expect(executableSql).not.toMatch(
      /ALTER\s+TABLE\s+public\.(?:measurement_entity_facts_v2|run_entity_fact_aggregates_v2)\s+(?:ADD|DROP|ALTER)/iu,
    );
    expect(executableSql).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM|TRUNCATE\s+TABLE)\s+public\.(?:measurement_entity_facts_v2|run_entity_fact_aggregates_v2)/iu,
    );
  });

  it("pins each supplement to one immutable base aggregate and version", () => {
    expect(sql).toContain("base_aggregate_id uuid NOT NULL");
    expect(sql).toContain("base_materialization_id uuid NOT NULL");
    expect(sql).toContain("observed_sources_version text NOT NULL");
    expect(sql).toContain("source_replay_version text NOT NULL");
    expect(sql).toContain("engine_version text NOT NULL");
    expect(sql).toContain(
      "run_observed_source_aggregates_v2_base_version_uq",
    );
    expect(sql).toMatch(
      /base_aggregate_id,[\s\S]*observed_sources_version,[\s\S]*source_replay_version,[\s\S]*engine_version/u,
    );
  });

  it("validates base scope before accepting a supplement", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_run_observed_source_aggregate_v2()",
    );
    expect(sql).toContain("OBSERVED_SOURCE_BASE_AGGREGATE_NOT_FOUND");
    expect(sql).toContain("OBSERVED_SOURCE_BASE_AGGREGATE_NOT_CONTRACT_OK");
    expect(sql).toContain("OBSERVED_SOURCE_BASE_SCOPE_MISMATCH");
    expect(sql).toContain(
      "NEW.base_materialization_id <> v_base.materialization_id",
    );
    expect(sql).toContain("NEW.org_id <> v_base.org_id");
    expect(sql).toContain("NEW.business_id <> v_base.business_id");
    expect(sql).toContain("NEW.source_run_id <> v_base.source_run_id");
  });

  it("keeps observed target truth identical to the base targetSources contract", () => {
    expect(sql).toContain("OBSERVED_SOURCE_TARGET_DOMAIN_PARITY_MISMATCH");
    expect(sql).toContain("OBSERVED_SOURCE_TARGET_RESPONSE_COUNT_MISMATCH");
    expect(sql).toContain("OBSERVED_SOURCE_TARGET_KEY_MISMATCH");
    expect(sql).toContain("v_base.aggregate->'targetSources'");
    expect(sql).toContain("v_target_key := 'business:' || NEW.business_id::text");
  });

  it("allows only competitors already present in the base aggregate", () => {
    expect(sql).toContain("v_base.aggregate->'competitors'");
    expect(sql).toContain("OBSERVED_SOURCE_COMPETITOR_NOT_IN_BASE");
    expect(sql).toContain("v_entity_key = ANY(v_base_competitor_keys)");
  });

  it("fails closed on malformed or internally inconsistent source rows", () => {
    expect(sql).toContain("OBSERVED_SOURCE_DOMAIN_INVALID");
    expect(sql).toContain("OBSERVED_SOURCE_DOMAIN_DUPLICATE");
    expect(sql).toContain("OBSERVED_SOURCE_JSON_CONTRACT_INVALID");
    expect(sql).toContain("OBSERVED_SOURCE_COUNT_INVALID");
    expect(sql).toContain("OBSERVED_SOURCE_ENTITY_LIST_EMPTY");
    expect(sql).toContain("OBSERVED_SOURCE_SIDE_COUNT_MISMATCH");
    expect(sql).toContain("OBSERVED_SOURCE_ATTRIBUTION_COUNT_MISMATCH");
    expect(sql).toContain("OBSERVED_SOURCE_ENTITY_DUPLICATE");
    expect(sql).toContain("OBSERVED_SOURCE_ENTITY_CONTRACT_INVALID");
    expect(sql).toContain("OBSERVED_SOURCE_ENTITY_COUNT_INVALID");
    expect(sql).toContain("IS DISTINCT FROM 'number'");
  });

  it("keeps the supplement immutable and server-only", () => {
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON public\.run_observed_source_aggregates_v2/u,
    );
    expect(sql).toContain(
      "EXECUTE FUNCTION public.reject_entity_fact_v2_mutation()",
    );
    expect(sql).toContain(
      "ALTER TABLE public.run_observed_source_aggregates_v2\n  ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE public.run_observed_source_aggregates_v2\n  FORCE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.run_observed_source_aggregates_v2 FROM PUBLIC",
    );
    expect(sql).toContain("FROM anon, authenticated");
    expect(sql).toMatch(
      /GRANT SELECT, INSERT[\s\S]*run_observed_source_aggregates_v2[\s\S]*TO service_role/iu,
    );
    expect(sql).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE[\s\S]*run_observed_source_aggregates_v2[\s\S]*FROM service_role/iu,
    );
    expect(sql).not.toMatch(/CREATE\s+POLICY/iu);
  });

  it("does not introduce a security-definer function or customer access path", () => {
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/iu);
    expect(sql).toContain(
      "REVOKE ALL\n  ON FUNCTION public.validate_run_observed_source_aggregate_v2()",
    );
    expect(sql).not.toMatch(/GRANT[^;]*(?:anon|authenticated)/iu);
  });

  it("requires hashes and JSON array storage for reproducible append-only rows", () => {
    expect(sql).toContain(
      "input_fingerprint ~ '^[0-9a-f]{64}$'",
    );
    expect(sql).toContain(
      "observed_sources_hash ~ '^[0-9a-f]{64}$'",
    );
    expect(sql).toContain(
      "jsonb_typeof(observed_sources) = 'array'",
    );
  });
});
