import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITY_FACTS_V2_BACKFILL_CONFIRMATION,
  ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT,
  ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT,
  ENTITY_FACTS_V2_BACKFILL_PROJECT_REF,
  ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN,
  PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION,
} from "../../scripts/entity-facts-v2-production-backfill";

const runnerPath = resolve(
  process.cwd(),
  "scripts/entity-facts-v2-production-backfill.ts",
);
const source = readFileSync(runnerPath, "utf8");

describe("Entity Facts v2 production backfill runner contract", () => {
  it("pins the reviewed production engine/version/corpus contract", () => {
    expect(PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION).toBe(
      "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
    );
    expect(ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT).toBe(23);
    expect(ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT).toBe(428);
    expect(ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN).toBe(
      "28a793c9-c24d-41ff-9037-f08abc21b3ca",
    );
    expect(ENTITY_FACTS_V2_BACKFILL_PROJECT_REF).toBe(
      "qoirkwmnyolquvsgbian",
    );
    expect(ENTITY_FACTS_V2_BACKFILL_CONFIRMATION).toBe(
      "BACKFILL_ENTITY_FACTS_V2_428_23",
    );
  });

  it("uses one explicit database transaction for all production writes", () => {
    expect(source.match(/\bdb\.begin\s*\(/gu)).toHaveLength(1);
    expect(source).toContain(
      'await tx.unsafe("set transaction isolation level serializable")',
    );
    expect(source).not.toMatch(/\bdb\.unsafe\s*\([^)]*insert/iu);
    expect(source).not.toMatch(/\bcommit\b/iu);
    expect(source).not.toMatch(/\brollback\b/iu);
  });

  it("checks both v2 tables are empty before the first insert", () => {
    const preflight = source.indexOf("BACKFILL_PREFLIGHT_TABLES_NOT_EMPTY");
    const firstInsert = source.indexOf("await insertMeasurementRows");
    const secondInsert = source.indexOf("await insertAggregateRows");

    expect(preflight).toBeGreaterThan(0);
    expect(firstInsert).toBeGreaterThan(preflight);
    expect(secondInsert).toBeGreaterThan(firstInsert);
    expect(source).toContain(
      "(select count(*) from public.measurement_entity_facts_v2)",
    );
    expect(source).toContain(
      "(select count(*) from public.run_entity_fact_aggregates_v2)",
    );
  });

  it("writes only append-only INSERT statements to the two v2 tables", () => {
    expect(source).toContain(
      "insert into public.measurement_entity_facts_v2",
    );
    expect(source).toContain(
      "insert into public.run_entity_fact_aggregates_v2",
    );
    expect(source).not.toMatch(/\bupdate\s+public\./iu);
    expect(source).not.toMatch(/\bdelete\s+from\s+public\./iu);
    expect(source).not.toMatch(/\bupsert\b/iu);
    expect(source).not.toMatch(/\btruncate\b/iu);
    expect(source).not.toMatch(/\bdrop\b/iu);
    expect(source).not.toMatch(/\balter\b/iu);
    expect(source).not.toMatch(/\bcreate\s+(?:table|function|trigger|index)/iu);
  });

  it("verifies counts, versions, hashes and the KASPACe regression before returning", () => {
    const measurementInsert = source.indexOf("await insertMeasurementRows");
    const aggregateInsert = source.indexOf("await insertAggregateRows");
    const postMeasurement = source.indexOf(
      "BACKFILL_POST_MEASUREMENT_COUNT_MISMATCH",
    );
    const postAggregate = source.indexOf(
      "BACKFILL_POST_AGGREGATE_COUNT_MISMATCH",
    );
    const factHash = source.indexOf("BACKFILL_FACT_HASH_MISMATCH");
    const aggregateHash = source.indexOf("BACKFILL_AGGREGATE_HASH_MISMATCH");
    const regression = source.indexOf("BACKFILL_REGRESSION_DB_BOUNDS_MISMATCH");
    const returnSummary = source.indexOf("committedMeasurementRows: 428");

    expect(postMeasurement).toBeGreaterThan(aggregateInsert);
    expect(postAggregate).toBeGreaterThan(postMeasurement);
    expect(factHash).toBeGreaterThan(postAggregate);
    expect(aggregateHash).toBeGreaterThan(factHash);
    expect(regression).toBeGreaterThan(aggregateHash);
    expect(returnSummary).toBeGreaterThan(regression);
    expect(aggregateInsert).toBeGreaterThan(measurementInsert);
    expect(source).toContain("visibilityLowerBoundPct === 4.17");
    expect(source).toContain("visibilityUpperBoundPct === 29.17");
  });

  it("requires explicit runtime confirmation and never embeds credentials", () => {
    expect(source).toContain("ENTITY_FACTS_V2_BACKFILL_DATABASE_URL");
    expect(source).toContain("ENTITY_FACTS_V2_BACKFILL_CONFIRM");
    expect(source).toContain("ENTITY_FACTS_V2_BACKFILL_PROJECT_REF");
    expect(source).toContain("BACKFILL_EXPLICIT_CONFIRMATION_REQUIRED");
    expect(source).not.toMatch(/sbp_[A-Za-z0-9_-]+/u);
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^"']+:[^"']+@/u);
    expect(source).not.toContain("SUPABASE_ACCESS_TOKEN");
    expect(source).not.toContain("api.supabase.com");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });

  it("is not wired to any GitHub Actions workflow", () => {
    const workflowsDir = resolve(process.cwd(), ".github/workflows");
    const workflowFiles = readdirSync(workflowsDir).filter((name) =>
      /\.ya?ml$/u.test(name)
    );
    const references = workflowFiles.filter((name) =>
      readFileSync(resolve(workflowsDir, name), "utf8").includes(
        "entity-facts-v2-production-backfill",
      )
    );

    expect(references).toEqual([]);
  });
});
