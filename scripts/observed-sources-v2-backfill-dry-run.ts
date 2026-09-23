import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  replayPhase2CDataset,
  type Phase2CReplayDataset,
} from "./entity-facts-phase2c-replay";
import {
  RUN_SOURCE_REPLAY_VERSION,
} from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";
import {
  RUN_OBSERVED_SOURCES_VERSION,
  type RunObservedSourceFactV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-observed-sources";
import {
  buildRunEntityFactsObservedSourcesAggregateCandidateV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-observed-sources.candidate";
import type {
  RunEntityFactsAggregateV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";

export const OBSERVED_SOURCES_V2_BACKFILL_DRY_RUN_VERSION = "0.1" as const;
export const OBSERVED_SOURCES_V2_STORAGE_ENGINE_VERSION =
  "observed-sources-v2:src0.1:obs0.1:store0.1" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;

export type ObservedSourcesV2BackfillBaseRow = {
  baseAggregateId: string;
  baseMaterializationId: string;
  orgId: string;
  businessId: string;
  sourceRunId: string;
  factVersion: string;
  aggregateVersion: string;
  engineVersion: string;
  aggregateHash: string;
  aggregate: RunEntityFactsAggregateV2;
};

export type ObservedSourcesV2BackfillBaseExport = {
  version: "observed-source-v2-backfill-base-v0.1";
  rows: ObservedSourcesV2BackfillBaseRow[];
};

export type ObservedSourcesV2SupplementRow = {
  base_aggregate_id: string;
  base_materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  observed_sources_version: typeof RUN_OBSERVED_SOURCES_VERSION;
  source_replay_version: typeof RUN_SOURCE_REPLAY_VERSION;
  engine_version: typeof OBSERVED_SOURCES_V2_STORAGE_ENGINE_VERSION;
  input_fingerprint: string;
  observed_sources: RunObservedSourceFactV2[];
  observed_sources_hash: string;
};

export type ObservedSourcesV2BackfillDryRunSummary = {
  version: typeof OBSERVED_SOURCES_V2_BACKFILL_DRY_RUN_VERSION;
  runCount: number;
  supplementRowCount: number;
  runsWithObservedSources: number;
  observedSourceDomainCount: number;
  observedTargetSourceDomainCount: number;
  observedCompetitorSourceDomainCount: number;
  sourceLinkedCompetitorCount: number;
  allCandidateContractsOk: true;
  allHashesOk: true;
};

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function lowerUuid(value: string, code: string): string {
  const out = value.trim().toLowerCase();
  invariant(UUID_RE.test(out), code);
  return out;
}

export function buildObservedSourcesV2BackfillDryRun(
  dataset: Phase2CReplayDataset,
  baseExport: ObservedSourcesV2BackfillBaseExport,
  options: {
    expectedRunCount?: number;
    expectedMeasurementCount?: number;
  } = {},
): {
  rows: ObservedSourcesV2SupplementRow[];
  summary: ObservedSourcesV2BackfillDryRunSummary;
} {
  invariant(
    baseExport.version === "observed-source-v2-backfill-base-v0.1",
    "OBSERVED_BACKFILL_BASE_VERSION_INVALID",
  );
  invariant(Array.isArray(baseExport.rows), "OBSERVED_BACKFILL_BASE_ROWS_INVALID");
  invariant(Array.isArray(dataset.rows), "OBSERVED_BACKFILL_DATASET_ROWS_INVALID");

  if (options.expectedMeasurementCount !== undefined) {
    invariant(
      dataset.rows.length === options.expectedMeasurementCount,
      `OBSERVED_BACKFILL_MEASUREMENT_COUNT_MISMATCH:${dataset.rows.length}:${options.expectedMeasurementCount}`,
    );
  }

  const replay = replayPhase2CDataset(dataset);
  if (options.expectedRunCount !== undefined) {
    invariant(
      replay.runs.length === options.expectedRunCount,
      `OBSERVED_BACKFILL_RUN_COUNT_MISMATCH:${replay.runs.length}:${options.expectedRunCount}`,
    );
  }

  invariant(
    baseExport.rows.length === replay.runs.length,
    "OBSERVED_BACKFILL_BASE_RUN_COUNT_MISMATCH",
  );

  const baseByRun = new Map<string, ObservedSourcesV2BackfillBaseRow>();
  const baseIds = new Set<string>();
  for (const base of baseExport.rows) {
    const runId = lowerUuid(base.sourceRunId, "OBSERVED_BACKFILL_BASE_RUN_ID_INVALID");
    const baseId = lowerUuid(
      base.baseAggregateId,
      "OBSERVED_BACKFILL_BASE_AGGREGATE_ID_INVALID",
    );
    lowerUuid(
      base.baseMaterializationId,
      "OBSERVED_BACKFILL_BASE_MATERIALIZATION_ID_INVALID",
    );
    lowerUuid(base.orgId, "OBSERVED_BACKFILL_BASE_ORG_ID_INVALID");
    lowerUuid(base.businessId, "OBSERVED_BACKFILL_BASE_BUSINESS_ID_INVALID");
    invariant(SHA256_RE.test(base.aggregateHash), "OBSERVED_BACKFILL_BASE_HASH_INVALID");
    invariant(!baseByRun.has(runId), "OBSERVED_BACKFILL_DUPLICATE_BASE_RUN");
    invariant(!baseIds.has(baseId), "OBSERVED_BACKFILL_DUPLICATE_BASE_AGGREGATE");
    baseByRun.set(runId, base);
    baseIds.add(baseId);
  }

  const rows: ObservedSourcesV2SupplementRow[] = [];
  for (const run of replay.runs) {
    const runId = lowerUuid(run.runId, "OBSERVED_BACKFILL_REPLAY_RUN_ID_INVALID");
    const base = baseByRun.get(runId);
    invariant(base, `OBSERVED_BACKFILL_BASE_MISSING:${runId}`);

    const businessId = lowerUuid(
      run.businessId,
      "OBSERVED_BACKFILL_REPLAY_BUSINESS_ID_INVALID",
    );
    invariant(
      businessId === base.businessId.toLowerCase(),
      `OBSERVED_BACKFILL_BUSINESS_SCOPE_MISMATCH:${runId}`,
    );

    const candidate =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        businessId,
        base.aggregate,
        run.proposed.observedSources,
      );
    invariant(
      candidate.candidateContractOk &&
        candidate.candidateContractIssues.length === 0,
      `OBSERVED_BACKFILL_CANDIDATE_CONTRACT_FAILED:${runId}`,
    );

    const observedSourcesHash = sha256(run.proposed.observedSources);
    const inputFingerprint = sha256({
      baseAggregateId: base.baseAggregateId.toLowerCase(),
      baseMaterializationId: base.baseMaterializationId.toLowerCase(),
      baseAggregateHash: base.aggregateHash,
      sourceRunId: runId,
      businessId,
      observedSourcesVersion: RUN_OBSERVED_SOURCES_VERSION,
      sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
      engineVersion: OBSERVED_SOURCES_V2_STORAGE_ENGINE_VERSION,
      observedSourcesHash,
    });

    invariant(
      SHA256_RE.test(observedSourcesHash) && SHA256_RE.test(inputFingerprint),
      `OBSERVED_BACKFILL_HASH_INVALID:${runId}`,
    );

    rows.push({
      base_aggregate_id: base.baseAggregateId.toLowerCase(),
      base_materialization_id: base.baseMaterializationId.toLowerCase(),
      org_id: base.orgId.toLowerCase(),
      business_id: businessId,
      source_run_id: runId,
      observed_sources_version: RUN_OBSERVED_SOURCES_VERSION,
      source_replay_version: RUN_SOURCE_REPLAY_VERSION,
      engine_version: OBSERVED_SOURCES_V2_STORAGE_ENGINE_VERSION,
      input_fingerprint: inputFingerprint,
      observed_sources: run.proposed.observedSources,
      observed_sources_hash: observedSourcesHash,
    });
  }

  rows.sort((a, b) => a.source_run_id.localeCompare(b.source_run_id, "en"));

  return {
    rows,
    summary: {
      version: OBSERVED_SOURCES_V2_BACKFILL_DRY_RUN_VERSION,
      runCount: replay.runs.length,
      supplementRowCount: rows.length,
      runsWithObservedSources: rows.filter(
        (row) => row.observed_sources.length > 0,
      ).length,
      observedSourceDomainCount: rows.reduce(
        (sum, row) => sum + row.observed_sources.length,
        0,
      ),
      observedTargetSourceDomainCount: rows.reduce(
        (sum, row) =>
          sum +
          row.observed_sources.filter((source) => source.targetResponseCount > 0)
            .length,
        0,
      ),
      observedCompetitorSourceDomainCount: rows.reduce(
        (sum, row) =>
          sum +
          row.observed_sources.filter((source) => source.otherResponseCount > 0)
            .length,
        0,
      ),
      sourceLinkedCompetitorCount: rows.reduce(
        (sum, row) =>
          sum +
          new Set(
            row.observed_sources.flatMap((source) =>
              source.entities
                .filter((entity) => entity.side === "other")
                .map((entity) => entity.canonicalKey),
            ),
          ).size,
        0,
      ),
      allCandidateContractsOk: true,
      allHashesOk: true,
    },
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && resolve(entry) === fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const datasetPath = process.argv[2];
  const basePath = process.argv[3];
  invariant(datasetPath && basePath, "OBSERVED_BACKFILL_USAGE_INVALID");

  const dataset = JSON.parse(
    readFileSync(resolve(datasetPath), "utf8"),
  ) as Phase2CReplayDataset;
  const baseExport = JSON.parse(
    readFileSync(resolve(basePath), "utf8"),
  ) as ObservedSourcesV2BackfillBaseExport;

  const result = buildObservedSourcesV2BackfillDryRun(dataset, baseExport, {
    expectedRunCount: 23,
    expectedMeasurementCount: 428,
  });
  console.log(JSON.stringify(result.summary, null, 2));
}
