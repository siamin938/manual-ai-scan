import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEntityFactsV2Materialization,
  type Phase2CMaterializationDataset,
} from "./entity-facts-v2-materialize";
import {
  replayPhase2CDataset,
  type Phase2CRunDiff,
} from "./entity-facts-phase2c-replay";
import { MEASUREMENT_ENTITY_FACTS_VERSION } from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";
import { RUN_ENTITY_FACTS_AGGREGATE_VERSION } from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";

export const ENTITY_FACTS_V2_DRY_RUN_VERSION = "0.1" as const;
export const ENTITY_FACTS_V2_DRY_RUN_ENGINE_VERSION =
  "entity-facts-v2-materializer-dry-run-0.1" as const;

const SHA256_RE = /^[0-9a-f]{64}$/u;

export interface EntityFactsV2DryRunOptions {
  expectedRunCount?: number;
  expectedMeasurementCount?: number;
  regressionRun?: {
    runId: string;
    expectedVisibilityLowerPct: number;
    expectedVisibilityUpperPct: number;
  };
}

export interface EntityFactsV2DryRunSummary {
  version: typeof ENTITY_FACTS_V2_DRY_RUN_VERSION;
  engineVersion: typeof ENTITY_FACTS_V2_DRY_RUN_ENGINE_VERSION;
  datasetVersion: string;
  runCount: number;
  measurementCount: number;
  validMeasurementCount: number;
  measurementRowCount: number;
  aggregateRowCount: number;
  factVersion: string;
  aggregateVersion: string;
  contractOk: true;
  semanticMatch: true;
  unresolvedRunCount: number;
  sourcePartialRunCount: number;
  observedSourceRunCount: number;
  observedCompetitorSourceRunCount: number;
  observedSourceDomainCount: number;
  observedTargetSourceDomainCount: number;
  observedCompetitorSourceDomainCount: number;
  sourceLinkedCompetitorCount: number;
  hashChecksOk: true;
  scopeChecksOk: true;
  duplicateMeasurementIds: 0;
  regressionRun?: {
    runId: string;
    visibilityLowerBoundPct: number | null;
    visibilityUpperBoundPct: number | null;
    matched: true;
  };
}

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function deterministicMaterializationId(runId: string): string {
  const chars = createHash("sha256")
    .update(`entity-facts-v2-dry-run:${runId.toLowerCase()}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");

  chars[12] = "4";
  chars[16] = (8 + (Number.parseInt(chars[16]!, 16) % 4)).toString(16);

  const hex = chars.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}

function replaySemantics(run: Phase2CRunDiff) {
  return {
    businessId: run.businessId,
    contractOk: run.contractOk,
    confirmedMentionCount: run.proposed.confirmedMentionCount,
    unresolvedTargetCount: run.proposed.unresolvedTargetCount,
    visibilityLowerBoundPct: run.proposed.visibilityLowerBoundPct,
    visibilityUpperBoundPct: run.proposed.visibilityUpperBoundPct,
    confirmedTop3Count: run.proposed.confirmedTop3Count,
    top3UncertainCount: run.proposed.top3UncertainCount,
    top3LowerBoundPct: run.proposed.top3LowerBoundPct,
    top3UpperBoundPct: run.proposed.top3UpperBoundPct,
    sourcePartialMeasurementCount:
      run.proposed.sourcePartialMeasurementCount,
    questionGroups: run.proposed.questionGroups,
    questionAreas: run.proposed.questionAreas,
    competitors: run.proposed.competitors,
    targetSources: run.proposed.targetSources,
    qualityFlagCounts: run.qualityFlagCounts,
  };
}

function aggregateSemantics(
  businessId: string,
  aggregate: ReturnType<
    typeof buildEntityFactsV2Materialization
  >["aggregateRows"][number]["aggregate"],
) {
  return {
    businessId,
    contractOk: aggregate.contractOk,
    confirmedMentionCount: aggregate.overview.confirmedMentionCount,
    unresolvedTargetCount: aggregate.overview.unresolvedTargetCount,
    visibilityLowerBoundPct: aggregate.overview.visibilityLowerBoundPct,
    visibilityUpperBoundPct: aggregate.overview.visibilityUpperBoundPct,
    confirmedTop3Count: aggregate.overview.confirmedTop3Count,
    top3UncertainCount: aggregate.overview.top3UncertainCount,
    top3LowerBoundPct: aggregate.overview.top3LowerBoundPct,
    top3UpperBoundPct: aggregate.overview.top3UpperBoundPct,
    sourcePartialMeasurementCount:
      aggregate.overview.sourcePartialMeasurementCount,
    questionGroups: aggregate.questionGroups,
    questionAreas: aggregate.questionAreas,
    competitors: aggregate.competitors,
    targetSources: aggregate.targetSources,
    qualityFlagCounts: aggregate.qualityFlagCounts,
  };
}

export function validateEntityFactsV2MaterializationDryRun(
  dataset: Phase2CMaterializationDataset,
  options: EntityFactsV2DryRunOptions = {},
): EntityFactsV2DryRunSummary {
  invariant(Array.isArray(dataset.rows), "DRY_RUN_DATASET_ROWS_INVALID");
  invariant(dataset.rows.length > 0, "DRY_RUN_DATASET_EMPTY");

  const runIds = [...new Set(dataset.rows.map((row) => row.runId.toLowerCase()))]
    .sort((a, b) => a.localeCompare(b, "en"));

  const measurementIds = dataset.rows.map((row) =>
    row.measurementId.toLowerCase()
  );
  const uniqueMeasurementIds = new Set(measurementIds);
  invariant(
    uniqueMeasurementIds.size === measurementIds.length,
    "DRY_RUN_DUPLICATE_MEASUREMENT_ID",
  );

  if (options.expectedRunCount !== undefined) {
    invariant(
      runIds.length === options.expectedRunCount,
      `DRY_RUN_EXPECTED_RUN_COUNT_MISMATCH:${runIds.length}:${options.expectedRunCount}`,
    );
  }
  if (options.expectedMeasurementCount !== undefined) {
    invariant(
      dataset.rows.length === options.expectedMeasurementCount,
      `DRY_RUN_EXPECTED_MEASUREMENT_COUNT_MISMATCH:${dataset.rows.length}:${options.expectedMeasurementCount}`,
    );
  }

  const materializationIds = Object.fromEntries(
    runIds.map((runId) => [runId, deterministicMaterializationId(runId)]),
  );

  const bundle = buildEntityFactsV2Materialization(dataset, {
    engineVersion: ENTITY_FACTS_V2_DRY_RUN_ENGINE_VERSION,
    materializationIds,
  });
  const replay = replayPhase2CDataset(dataset);

  invariant(
    bundle.measurementRows.length === dataset.rows.length,
    "DRY_RUN_MEASUREMENT_ROW_COUNT_MISMATCH",
  );
  invariant(
    bundle.aggregateRows.length === runIds.length,
    "DRY_RUN_AGGREGATE_ROW_COUNT_MISMATCH",
  );
  invariant(
    replay.summary.measurementCount === dataset.rows.length,
    "DRY_RUN_REPLAY_MEASUREMENT_COUNT_MISMATCH",
  );
  invariant(
    replay.summary.runCount === runIds.length,
    "DRY_RUN_REPLAY_RUN_COUNT_MISMATCH",
  );

  invariant(
    bundle.measurementRows.every(
      (row) =>
        row.fact_version === MEASUREMENT_ENTITY_FACTS_VERSION &&
        row.facts.version === MEASUREMENT_ENTITY_FACTS_VERSION,
    ),
    "DRY_RUN_FACT_VERSION_MISMATCH",
  );
  invariant(
    bundle.aggregateRows.every(
      (row) =>
        row.fact_version === MEASUREMENT_ENTITY_FACTS_VERSION &&
        row.aggregate_version === RUN_ENTITY_FACTS_AGGREGATE_VERSION &&
        row.aggregate.version === RUN_ENTITY_FACTS_AGGREGATE_VERSION &&
        row.aggregate.factsVersion === MEASUREMENT_ENTITY_FACTS_VERSION,
    ),
    "DRY_RUN_AGGREGATE_VERSION_MISMATCH",
  );

  invariant(
    bundle.measurementRows.every(
      (row) =>
        SHA256_RE.test(row.input_fingerprint) &&
        SHA256_RE.test(row.facts_hash),
    ) &&
      bundle.aggregateRows.every(
        (row) =>
          SHA256_RE.test(row.input_fingerprint) &&
          SHA256_RE.test(row.aggregate_hash),
      ),
    "DRY_RUN_HASH_INVALID",
  );

  const sourceRowsByRun = new Map<string, typeof dataset.rows>();
  for (const row of dataset.rows) {
    const runId = row.runId.toLowerCase();
    const rows = sourceRowsByRun.get(runId) ?? [];
    rows.push(row);
    sourceRowsByRun.set(runId, rows);
  }

  const factsByRun = new Map<string, typeof bundle.measurementRows>();
  for (const row of bundle.measurementRows) {
    const rows = factsByRun.get(row.source_run_id) ?? [];
    rows.push(row);
    factsByRun.set(row.source_run_id, rows);
  }

  for (const aggregateRow of bundle.aggregateRows) {
    const sourceRows = sourceRowsByRun.get(aggregateRow.source_run_id) ?? [];
    const factRows = factsByRun.get(aggregateRow.source_run_id) ?? [];

    invariant(sourceRows.length > 0, "DRY_RUN_SCOPE_SOURCE_RUN_MISSING");
    invariant(
      sourceRows.length === factRows.length,
      `DRY_RUN_SCOPE_FACT_COUNT_MISMATCH:${aggregateRow.source_run_id}`,
    );
    invariant(
      aggregateRow.measurement_count === factRows.length,
      `DRY_RUN_SCOPE_AGGREGATE_COUNT_MISMATCH:${aggregateRow.source_run_id}`,
    );

    const orgIds = new Set(sourceRows.map((row) => row.orgId.toLowerCase()));
    const businessIds = new Set(
      sourceRows.map((row) => row.businessId.toLowerCase()),
    );
    invariant(
      orgIds.size === 1 &&
        orgIds.has(aggregateRow.org_id) &&
        factRows.every((row) => row.org_id === aggregateRow.org_id),
      `DRY_RUN_ORG_SCOPE_MISMATCH:${aggregateRow.source_run_id}`,
    );
    invariant(
      businessIds.size === 1 &&
        businessIds.has(aggregateRow.business_id) &&
        factRows.every((row) => row.business_id === aggregateRow.business_id),
      `DRY_RUN_BUSINESS_SCOPE_MISMATCH:${aggregateRow.source_run_id}`,
    );
    invariant(
      factRows.every(
        (row) => row.materialization_id === aggregateRow.materialization_id,
      ),
      `DRY_RUN_MATERIALIZATION_SCOPE_MISMATCH:${aggregateRow.source_run_id}`,
    );
    invariant(
      aggregateRow.contract_ok === true &&
        aggregateRow.aggregate.contractOk === true &&
        aggregateRow.aggregate.contractIssues.length === 0,
      `DRY_RUN_AGGREGATE_CONTRACT_FAILED:${aggregateRow.source_run_id}`,
    );
  }

  const replayByRun = new Map(replay.runs.map((run) => [run.runId, run]));
  for (const aggregateRow of bundle.aggregateRows) {
    const replayRun = replayByRun.get(aggregateRow.source_run_id);
    invariant(
      replayRun,
      `DRY_RUN_REPLAY_RUN_MISSING:${aggregateRow.source_run_id}`,
    );
    invariant(
      stableJson(
        aggregateSemantics(aggregateRow.business_id, aggregateRow.aggregate),
      ) === stableJson(replaySemantics(replayRun)),
      `DRY_RUN_SEMANTIC_MISMATCH:${aggregateRow.source_run_id}`,
    );
  }

  const unresolvedRunCount = bundle.aggregateRows.filter(
    (row) => row.aggregate.overview.unresolvedTargetCount > 0,
  ).length;
  const sourcePartialRunCount = bundle.aggregateRows.filter(
    (row) => row.aggregate.overview.sourcePartialMeasurementCount > 0,
  ).length;

  invariant(
    unresolvedRunCount === replay.summary.unresolvedRunCount,
    "DRY_RUN_UNRESOLVED_RUN_COUNT_MISMATCH",
  );
  invariant(
    sourcePartialRunCount === replay.summary.sourcePartialRunCount,
    "DRY_RUN_SOURCE_PARTIAL_RUN_COUNT_MISMATCH",
  );

  let regressionRun:
    | EntityFactsV2DryRunSummary["regressionRun"]
    | undefined;
  if (options.regressionRun) {
    const expected = options.regressionRun;
    const aggregateRow = bundle.aggregateRows.find(
      (row) => row.source_run_id === expected.runId.toLowerCase(),
    );
    invariant(
      aggregateRow,
      `DRY_RUN_REGRESSION_RUN_NOT_FOUND:${expected.runId}`,
    );
    invariant(
      aggregateRow.aggregate.overview.visibilityLowerBoundPct ===
        expected.expectedVisibilityLowerPct &&
        aggregateRow.aggregate.overview.visibilityUpperBoundPct ===
          expected.expectedVisibilityUpperPct,
      `DRY_RUN_REGRESSION_BOUNDS_MISMATCH:${expected.runId}`,
    );
    regressionRun = {
      runId: aggregateRow.source_run_id,
      visibilityLowerBoundPct:
        aggregateRow.aggregate.overview.visibilityLowerBoundPct,
      visibilityUpperBoundPct:
        aggregateRow.aggregate.overview.visibilityUpperBoundPct,
      matched: true,
    };
  }

  return {
    version: ENTITY_FACTS_V2_DRY_RUN_VERSION,
    engineVersion: ENTITY_FACTS_V2_DRY_RUN_ENGINE_VERSION,
    datasetVersion: dataset.version,
    runCount: runIds.length,
    measurementCount: dataset.rows.length,
    validMeasurementCount: dataset.rows.filter((row) => row.valid).length,
    measurementRowCount: bundle.measurementRows.length,
    aggregateRowCount: bundle.aggregateRows.length,
    factVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
    aggregateVersion: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    contractOk: true,
    semanticMatch: true,
    unresolvedRunCount,
    sourcePartialRunCount,
    observedSourceRunCount: replay.summary.observedSourceRunCount,
    observedCompetitorSourceRunCount:
      replay.summary.observedCompetitorSourceRunCount,
    observedSourceDomainCount: replay.summary.observedSourceDomainCount,
    observedTargetSourceDomainCount:
      replay.summary.observedTargetSourceDomainCount,
    observedCompetitorSourceDomainCount:
      replay.summary.observedCompetitorSourceDomainCount,
    sourceLinkedCompetitorCount: replay.summary.sourceLinkedCompetitorCount,
    hashChecksOk: true,
    scopeChecksOk: true,
    duplicateMeasurementIds: 0,
    ...(regressionRun ? { regressionRun } : {}),
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

function integerArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(
    prefix.length,
  );
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  invariant(
    Number.isInteger(parsed) && parsed >= 0,
    `DRY_RUN_ARGUMENT_INVALID:${name}`,
  );
  return parsed;
}

function numberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(
    prefix.length,
  );
  if (value === undefined) return undefined;
  const parsed = Number(value);
  invariant(Number.isFinite(parsed), `DRY_RUN_ARGUMENT_INVALID:${name}`);
  return parsed;
}

function stringArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(
    prefix.length,
  );
}

if (isDirectExecution()) {
  const inputPath = process.argv[2];
  if (!inputPath || inputPath.startsWith("--")) {
    console.error(
      "Usage: bun scripts/entity-facts-v2-materialize-dry-run.ts <dataset.json> [--expected-runs=N] [--expected-measurements=N] [--regression-run=UUID --expected-lower=N --expected-upper=N]",
    );
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(
      readFileSync(resolve(inputPath), "utf8"),
    ) as Phase2CMaterializationDataset;

    const regressionRunId = stringArg("regression-run");
    const expectedLower = numberArg("expected-lower");
    const expectedUpper = numberArg("expected-upper");
    invariant(
      !regressionRunId ||
        (expectedLower !== undefined && expectedUpper !== undefined),
      "DRY_RUN_REGRESSION_EXPECTATIONS_REQUIRED",
    );

    const summary = validateEntityFactsV2MaterializationDryRun(dataset, {
      expectedRunCount: integerArg("expected-runs"),
      expectedMeasurementCount: integerArg("expected-measurements"),
      ...(regressionRunId
        ? {
            regressionRun: {
              runId: regressionRunId,
              expectedVisibilityLowerPct: expectedLower!,
              expectedVisibilityUpperPct: expectedUpper!,
            },
          }
        : {}),
    });

    console.log(JSON.stringify(summary, null, 2));
  }
}
