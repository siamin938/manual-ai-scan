import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  HISTORICAL_MEASUREMENT_REPLAY_VERSION,
  TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION,
} from "../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";
import { MEASUREMENT_ENTITY_FACTS_VERSION } from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";
import { RUN_ENTITY_FACTS_AGGREGATE_VERSION } from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import { RUN_SOURCE_REPLAY_VERSION } from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";
import {
  buildEntityFactsV2Materialization,
  ENTITY_FACTS_V2_MATERIALIZER_VERSION,
  type EntityFactsV2MaterializationBundle,
  type Phase2CMaterializationDataset,
} from "./entity-facts-v2-materialize";
import { validateEntityFactsV2MaterializationDryRun } from "./entity-facts-v2-materialize-dry-run";

export const ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT = 23 as const;
export const ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT = 428 as const;
export const ENTITY_FACTS_V2_BACKFILL_CONFIRMATION =
  "BACKFILL_ENTITY_FACTS_V2_428_23" as const;
export const ENTITY_FACTS_V2_BACKFILL_PROJECT_REF =
  "qoirkwmnyolquvsgbian" as const;
export const ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN =
  "28a793c9-c24d-41ff-9037-f08abc21b3ca" as const;

export const PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION =
  `entity-facts-v2:mef${MEASUREMENT_ENTITY_FACTS_VERSION}:hist${HISTORICAL_MEASUREMENT_REPLAY_VERSION}:te${TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION}:src${RUN_SOURCE_REPLAY_VERSION}:agg${RUN_ENTITY_FACTS_AGGREGATE_VERSION}:mat${ENTITY_FACTS_V2_MATERIALIZER_VERSION}` as const;

const SHA256_RE = /^[0-9a-f]{64}$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type SqlRows = Array<Record<string, unknown>>;

export interface EntityFactsV2ProductionBackfillSummary {
  engineVersion: typeof PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION;
  runCount: number;
  measurementCount: number;
  measurementRowCount: number;
  aggregateRowCount: number;
  factVersion: typeof MEASUREMENT_ENTITY_FACTS_VERSION;
  aggregateVersion: typeof RUN_ENTITY_FACTS_AGGREGATE_VERSION;
  preflightMeasurementRows: 0;
  preflightAggregateRows: 0;
  committedMeasurementRows: 428;
  committedAggregateRows: 23;
  regressionRun: {
    runId: typeof ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN;
    visibilityLowerBoundPct: 4.17;
    visibilityUpperBoundPct: 29.17;
  };
}

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  invariant(Number.isFinite(parsed), "BACKFILL_NUMERIC_RESULT_INVALID");
  return parsed;
}

function assertBundle(bundle: EntityFactsV2MaterializationBundle): void {
  invariant(
    bundle.engineVersion === PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION,
    "BACKFILL_ENGINE_VERSION_MISMATCH",
  );
  invariant(
    bundle.measurementRows.length ===
      ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT,
    "BACKFILL_MEASUREMENT_ROW_COUNT_MISMATCH",
  );
  invariant(
    bundle.aggregateRows.length === ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT,
    "BACKFILL_AGGREGATE_ROW_COUNT_MISMATCH",
  );
  invariant(
    bundle.measurementRows.every(
      (row) =>
        row.fact_version === MEASUREMENT_ENTITY_FACTS_VERSION &&
        row.facts.version === MEASUREMENT_ENTITY_FACTS_VERSION &&
        row.engine_version === PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION &&
        UUID_RE.test(row.materialization_id) &&
        UUID_RE.test(row.measurement_id) &&
        SHA256_RE.test(row.input_fingerprint) &&
        SHA256_RE.test(row.facts_hash),
    ),
    "BACKFILL_MEASUREMENT_ROW_CONTRACT_MISMATCH",
  );
  invariant(
    bundle.aggregateRows.every(
      (row) =>
        row.fact_version === MEASUREMENT_ENTITY_FACTS_VERSION &&
        row.aggregate_version === RUN_ENTITY_FACTS_AGGREGATE_VERSION &&
        row.aggregate.version === RUN_ENTITY_FACTS_AGGREGATE_VERSION &&
        row.aggregate.factsVersion === MEASUREMENT_ENTITY_FACTS_VERSION &&
        row.engine_version === PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION &&
        row.contract_ok === true &&
        row.aggregate.contractOk === true &&
        row.aggregate.contractIssues.length === 0 &&
        UUID_RE.test(row.materialization_id) &&
        SHA256_RE.test(row.input_fingerprint) &&
        SHA256_RE.test(row.aggregate_hash),
    ),
    "BACKFILL_AGGREGATE_ROW_CONTRACT_MISMATCH",
  );

  const measurementIds = bundle.measurementRows.map((row) => row.measurement_id);
  invariant(
    new Set(measurementIds).size === measurementIds.length,
    "BACKFILL_DUPLICATE_MEASUREMENT_ID",
  );

  const regression = bundle.aggregateRows.find(
    (row) => row.source_run_id === ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN,
  );
  invariant(regression, "BACKFILL_REGRESSION_RUN_MISSING");
  invariant(
    regression.aggregate.overview.visibilityLowerBoundPct === 4.17 &&
      regression.aggregate.overview.visibilityUpperBoundPct === 29.17,
    "BACKFILL_REGRESSION_BOUNDS_MISMATCH",
  );
}

export function buildProductionEntityFactsV2BackfillBundle(
  dataset: Phase2CMaterializationDataset,
): EntityFactsV2MaterializationBundle {
  validateEntityFactsV2MaterializationDryRun(dataset, {
    expectedRunCount: ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT,
    expectedMeasurementCount:
      ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT,
    regressionRun: {
      runId: ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN,
      expectedVisibilityLowerPct: 4.17,
      expectedVisibilityUpperPct: 29.17,
    },
  });

  const runIds = [
    ...new Set(dataset.rows.map((row) => row.runId.toLowerCase())),
  ].sort((a, b) => a.localeCompare(b, "en"));

  const materializationIds = Object.fromEntries(
    runIds.map((runId) => [runId, randomUUID()]),
  );

  const bundle = buildEntityFactsV2Materialization(dataset, {
    engineVersion: PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION,
    materializationIds,
  });
  assertBundle(bundle);
  return bundle;
}

async function insertMeasurementRows(
  tx: ReturnType<typeof postgres>,
  bundle: EntityFactsV2MaterializationBundle,
): Promise<void> {
  for (const row of bundle.measurementRows) {
    await tx.unsafe(
      `
        insert into public.measurement_entity_facts_v2 (
          materialization_id,
          org_id,
          business_id,
          source_run_id,
          measurement_id,
          fact_version,
          engine_version,
          input_fingerprint,
          facts,
          facts_hash
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::uuid,
          $6::text,
          $7::text,
          $8::text,
          $9::jsonb,
          $10::text
        )
      `,
      [
        row.materialization_id,
        row.org_id,
        row.business_id,
        row.source_run_id,
        row.measurement_id,
        row.fact_version,
        row.engine_version,
        row.input_fingerprint,
        JSON.stringify(row.facts),
        row.facts_hash,
      ],
    );
  }
}

async function insertAggregateRows(
  tx: ReturnType<typeof postgres>,
  bundle: EntityFactsV2MaterializationBundle,
): Promise<void> {
  for (const row of bundle.aggregateRows) {
    await tx.unsafe(
      `
        insert into public.run_entity_fact_aggregates_v2 (
          materialization_id,
          org_id,
          business_id,
          source_run_id,
          fact_version,
          aggregate_version,
          engine_version,
          input_fingerprint,
          measurement_count,
          valid_measurement_count,
          contract_ok,
          aggregate,
          aggregate_hash
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::text,
          $6::text,
          $7::text,
          $8::text,
          $9::integer,
          $10::integer,
          $11::boolean,
          $12::jsonb,
          $13::text
        )
      `,
      [
        row.materialization_id,
        row.org_id,
        row.business_id,
        row.source_run_id,
        row.fact_version,
        row.aggregate_version,
        row.engine_version,
        row.input_fingerprint,
        row.measurement_count,
        row.valid_measurement_count,
        row.contract_ok,
        JSON.stringify(row.aggregate),
        row.aggregate_hash,
      ],
    );
  }
}

function compareHashRows(
  actual: SqlRows,
  expected: Array<{ key: string; hash: string }>,
  keyField: string,
  hashField: string,
  errorCode: string,
): void {
  const actualMap = new Map(
    actual.map((row) => [String(row[keyField]), String(row[hashField])]),
  );
  invariant(actualMap.size === expected.length, errorCode);
  for (const item of expected) {
    invariant(actualMap.get(item.key) === item.hash, errorCode);
  }
}

export async function executeProductionEntityFactsV2Backfill(
  databaseUrl: string,
  dataset: Phase2CMaterializationDataset,
): Promise<EntityFactsV2ProductionBackfillSummary> {
  const url = databaseUrl.trim();
  invariant(url.length > 0, "BACKFILL_DATABASE_URL_REQUIRED");

  const bundle = buildProductionEntityFactsV2BackfillBundle(dataset);
  const db = postgres(url, {
    ssl: "require",
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    max_lifetime: 180,
    connection: {
      application_name: "chaboim-entity-facts-v2-production-backfill",
    },
  });

  try {
    return await db.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable");
      await tx.unsafe("set local role service_role");
      await tx.unsafe("set local statement_timeout = '180s'");
      await tx.unsafe("set local lock_timeout = '5s'");

      const roleCheck = (await tx.unsafe(
        `
          select
            current_user::text as current_user,
            session_user::text as session_user
        `,
      )) as SqlRows;
      const currentUser = String(roleCheck[0]?.current_user ?? "");
      const sessionUser = String(roleCheck[0]?.session_user ?? "");
      invariant(
        roleCheck.length === 1 &&
          /^cli_login_postgres(?:_|$)/u.test(sessionUser),
        "BACKFILL_TEMP_CLI_SESSION_REQUIRED",
      );
      invariant(
        currentUser === "service_role",
        "BACKFILL_SERVICE_ROLE_DOWNGRADE_FAILED",
      );

      const preflight = (await tx.unsafe(
        `
          select
            (select count(*) from public.measurement_entity_facts_v2)
              as measurement_fact_rows,
            (select count(*) from public.run_entity_fact_aggregates_v2)
              as aggregate_rows
        `,
      )) as SqlRows;

      const preflightMeasurementRows = numberValue(
        preflight[0]?.measurement_fact_rows,
      );
      const preflightAggregateRows = numberValue(
        preflight[0]?.aggregate_rows,
      );

      invariant(
        preflightMeasurementRows === 0 && preflightAggregateRows === 0,
        `BACKFILL_PREFLIGHT_TABLES_NOT_EMPTY:${preflightMeasurementRows}:${preflightAggregateRows}`,
      );

      await insertMeasurementRows(tx as ReturnType<typeof postgres>, bundle);
      await insertAggregateRows(tx as ReturnType<typeof postgres>, bundle);

      const postCounts = (await tx.unsafe(
        `
          select
            (select count(*) from public.measurement_entity_facts_v2)
              as measurement_fact_rows,
            (select count(*) from public.run_entity_fact_aggregates_v2)
              as aggregate_rows,
            (select count(*)
               from public.measurement_entity_facts_v2
              where fact_version = $1
                and engine_version = $2)
              as expected_measurement_rows,
            (select count(*)
               from public.run_entity_fact_aggregates_v2
              where fact_version = $1
                and aggregate_version = $3
                and engine_version = $2
                and contract_ok = true)
              as expected_aggregate_rows
        `,
        [
          MEASUREMENT_ENTITY_FACTS_VERSION,
          PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION,
          RUN_ENTITY_FACTS_AGGREGATE_VERSION,
        ],
      )) as SqlRows;

      invariant(
        numberValue(postCounts[0]?.measurement_fact_rows) ===
          ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT &&
          numberValue(postCounts[0]?.expected_measurement_rows) ===
            ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT,
        "BACKFILL_POST_MEASUREMENT_COUNT_MISMATCH",
      );
      invariant(
        numberValue(postCounts[0]?.aggregate_rows) ===
          ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT &&
          numberValue(postCounts[0]?.expected_aggregate_rows) ===
            ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT,
        "BACKFILL_POST_AGGREGATE_COUNT_MISMATCH",
      );

      const actualFactHashes = (await tx.unsafe(
        `
          select measurement_id::text as measurement_id, facts_hash
          from public.measurement_entity_facts_v2
          where engine_version = $1
          order by measurement_id
        `,
        [PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION],
      )) as SqlRows;
      compareHashRows(
        actualFactHashes,
        bundle.measurementRows.map((row) => ({
          key: row.measurement_id,
          hash: row.facts_hash,
        })),
        "measurement_id",
        "facts_hash",
        "BACKFILL_FACT_HASH_MISMATCH",
      );

      const actualAggregateHashes = (await tx.unsafe(
        `
          select source_run_id::text as source_run_id, aggregate_hash
          from public.run_entity_fact_aggregates_v2
          where engine_version = $1
          order by source_run_id
        `,
        [PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION],
      )) as SqlRows;
      compareHashRows(
        actualAggregateHashes,
        bundle.aggregateRows.map((row) => ({
          key: row.source_run_id,
          hash: row.aggregate_hash,
        })),
        "source_run_id",
        "aggregate_hash",
        "BACKFILL_AGGREGATE_HASH_MISMATCH",
      );

      const regression = (await tx.unsafe(
        `
          select
            (aggregate #>> '{overview,visibilityLowerBoundPct}')::numeric
              as visibility_lower_bound_pct,
            (aggregate #>> '{overview,visibilityUpperBoundPct}')::numeric
              as visibility_upper_bound_pct
          from public.run_entity_fact_aggregates_v2
          where source_run_id = $1::uuid
            and engine_version = $2
        `,
        [
          ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN,
          PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION,
        ],
      )) as SqlRows;

      invariant(regression.length === 1, "BACKFILL_REGRESSION_ROW_MISSING");
      invariant(
        numberValue(regression[0]?.visibility_lower_bound_pct) === 4.17 &&
          numberValue(regression[0]?.visibility_upper_bound_pct) === 29.17,
        "BACKFILL_REGRESSION_DB_BOUNDS_MISMATCH",
      );

      return {
        engineVersion: PRODUCTION_ENTITY_FACTS_V2_ENGINE_VERSION,
        runCount: ENTITY_FACTS_V2_BACKFILL_EXPECTED_RUN_COUNT,
        measurementCount: ENTITY_FACTS_V2_BACKFILL_EXPECTED_MEASUREMENT_COUNT,
        measurementRowCount: bundle.measurementRows.length,
        aggregateRowCount: bundle.aggregateRows.length,
        factVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
        aggregateVersion: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
        preflightMeasurementRows: 0,
        preflightAggregateRows: 0,
        committedMeasurementRows: 428,
        committedAggregateRows: 23,
        regressionRun: {
          runId: ENTITY_FACTS_V2_BACKFILL_REGRESSION_RUN,
          visibilityLowerBoundPct: 4.17,
          visibilityUpperBoundPct: 29.17,
        },
      };
    });
  } finally {
    await db.end({ timeout: 5 });
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const inputPath = process.argv[2];
  const databaseUrl =
    process.env.ENTITY_FACTS_V2_BACKFILL_DATABASE_URL?.trim() ?? "";
  const confirmation =
    process.env.ENTITY_FACTS_V2_BACKFILL_CONFIRM?.trim() ?? "";
  const projectRef =
    process.env.ENTITY_FACTS_V2_BACKFILL_PROJECT_REF?.trim() ?? "";

  if (!inputPath || inputPath.startsWith("--")) {
    console.error(
      "Usage: bun scripts/entity-facts-v2-production-backfill.ts <dataset.json>",
    );
    process.exitCode = 2;
  } else if (
    confirmation !== ENTITY_FACTS_V2_BACKFILL_CONFIRMATION ||
    projectRef !== ENTITY_FACTS_V2_BACKFILL_PROJECT_REF
  ) {
    console.error("BACKFILL_EXPLICIT_CONFIRMATION_REQUIRED");
    process.exitCode = 2;
  } else if (!databaseUrl) {
    console.error("BACKFILL_DATABASE_URL_REQUIRED");
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(
      readFileSync(resolve(inputPath), "utf8"),
    ) as Phase2CMaterializationDataset;

    const summary = await executeProductionEntityFactsV2Backfill(
      databaseUrl,
      dataset,
    );
    console.log(JSON.stringify(summary, null, 2));
  }
}
