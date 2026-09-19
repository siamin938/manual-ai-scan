import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260919144500_entity_facts_v2_materialization.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("Entity Facts v2 materialization schema contract", () => {
  it("creates separate measurement authority and run aggregate cache tables", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.measurement_entity_facts_v2",
    );
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.run_entity_fact_aggregates_v2",
    );
    expect(sql).toContain(
      "UNIQUE INDEX IF NOT EXISTS measurement_entity_facts_v2_materialization_measurement_uq",
    );
    expect(sql).toContain(
      "UNIQUE INDEX IF NOT EXISTS run_entity_fact_aggregates_v2_materialization_uq",
    );
  });

  it("keeps materialized rows append-only and preserves parent history", () => {
    expect(sql).toMatch(
      /REFERENCES public\.measurements\(id\) ON DELETE RESTRICT/u,
    );
    expect(sql).toMatch(
      /REFERENCES public\.measurement_runs\(id\) ON DELETE RESTRICT/u,
    );
    expect(sql).toContain("ENTITY_FACT_MATERIALIZATION_IMMUTABLE");
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON public\.measurement_entity_facts_v2/u,
    );
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON public\.run_entity_fact_aggregates_v2/u,
    );
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON TABLE public.measurement_entity_facts_v2 TO service_role",
    );
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON TABLE public.run_entity_fact_aggregates_v2 TO service_role",
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*measurement_entity_facts_v2/iu,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*run_entity_fact_aggregates_v2/iu,
    );
  });

  it("keeps internal entity provenance server-only", () => {
    expect(sql).toContain(
      "ALTER TABLE public.measurement_entity_facts_v2 ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE public.measurement_entity_facts_v2 FORCE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE public.run_entity_fact_aggregates_v2 ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE public.run_entity_fact_aggregates_v2 FORCE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.measurement_entity_facts_v2 FROM anon, authenticated",
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.run_entity_fact_aggregates_v2 FROM anon, authenticated",
    );
    expect(sql).not.toMatch(
      /CREATE\s+POLICY[\s\S]*measurement_entity_facts_v2/iu,
    );
    expect(sql).not.toMatch(
      /CREATE\s+POLICY[\s\S]*run_entity_fact_aggregates_v2/iu,
    );
  });

  it("binds stored JSON to the same measurement and fact versions", () => {
    expect(sql).toContain("facts->>'version' = fact_version");
    expect(sql).toContain("facts->>'measurementId' = measurement_id::text");
    expect(sql).toContain("aggregate->>'version' = aggregate_version");
    expect(sql).toContain("aggregate->>'factsVersion' = fact_version");
    expect(sql).toContain(
      "(aggregate #>> '{overview,measurementCount}')::integer = measurement_count",
    );
    expect(sql).toContain(
      "(aggregate #>> '{overview,validCount}')::integer = valid_measurement_count",
    );
  });

  it("rejects cross-org/run measurement scope mismatches", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_measurement_entity_facts_v2_scope()",
    );
    expect(sql).toContain("ENTITY_FACT_RUN_SCOPE_MISMATCH");
    expect(sql).toContain("ENTITY_FACT_MEASUREMENT_SCOPE_MISMATCH");
  });

  it("uses the aggregate row as a complete materialization commit marker", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_run_entity_fact_aggregate_v2_materialization()",
    );
    expect(sql).toContain("ENTITY_FACT_AGGREGATE_MEASUREMENT_COUNT_MISMATCH");
    expect(sql).toContain("ENTITY_FACT_AGGREGATE_VALID_COUNT_MISMATCH");
    expect(sql).toContain("ENTITY_FACT_MATERIALIZATION_SCOPE_MIXED");
    expect(sql).toContain("ENTITY_FACT_MATERIALIZATION_INCOMPLETE");
    expect(sql).toMatch(
      /WHERE f\.materialization_id = NEW\.materialization_id[\s\S]*f\.fact_version = NEW\.fact_version[\s\S]*f\.engine_version = NEW\.engine_version/u,
    );
  });

  it("does not mutate legacy parser or provider storage", () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.measurements/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.measurements/iu);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.measurements\s+(ADD|DROP|ALTER)/iu);
    expect(sql).not.toMatch(/UPDATE\s+public\.measurement_mentions/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.measurement_mentions/iu);
  });
});
