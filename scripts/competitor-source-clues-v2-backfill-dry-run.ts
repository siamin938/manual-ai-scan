import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  replayPhase2CDataset,
  type Phase2CReplayDataset,
} from "./entity-facts-phase2c-replay";
import {
  RUN_COMPETITOR_SOURCE_CLUE_VERSION,
  RUN_SOURCE_REPLAY_VERSION,
  type ReplayCompetitorSourceClueV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";
import type {
  RunEntityFactsAggregateV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import type {
  RunObservedSourceFactV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-observed-sources";

export const COMPETITOR_SOURCE_CLUE_BACKFILL_DRY_RUN_VERSION = "0.1" as const;
export const COMPETITOR_SOURCE_CLUE_STORAGE_ENGINE_VERSION =
  "competitor-source-clues-v2:src0.1:clue0.1:store0.1" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;

export type CompetitorSourceClueBackfillBaseRow = {
  baseAggregateId: string;
  baseObservedSourceAggregateId: string;
  baseMaterializationId: string;
  orgId: string;
  businessId: string;
  sourceRunId: string;
  baseAggregateHash: string;
  observedSourcesHash: string;
  aggregate: RunEntityFactsAggregateV2;
  observedSources: RunObservedSourceFactV2[];
};

export type CompetitorSourceClueBackfillBaseExport = {
  version: "competitor-source-clue-v2-backfill-base-v0.1";
  rows: CompetitorSourceClueBackfillBaseRow[];
};

export type CompetitorSourceClueSupplementRow = {
  base_aggregate_id: string;
  base_observed_source_aggregate_id: string;
  base_materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  clue_version: typeof RUN_COMPETITOR_SOURCE_CLUE_VERSION;
  source_replay_version: typeof RUN_SOURCE_REPLAY_VERSION;
  engine_version: typeof COMPETITOR_SOURCE_CLUE_STORAGE_ENGINE_VERSION;
  input_fingerprint: string;
  source_clues: ReplayCompetitorSourceClueV2[];
  source_clues_hash: string;
};

export type CompetitorSourceClueBackfillDryRunSummary = {
  version: typeof COMPETITOR_SOURCE_CLUE_BACKFILL_DRY_RUN_VERSION;
  runCount: number;
  supplementRowCount: number;
  runsWithClues: number;
  clueDomainCount: number;
  clueEntityLinkCount: number;
  newClueDomainCount: number;
  combinedObservedSourceDomainCount: number;
  allContractsOk: true;
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

function observedEntityDomainKeys(
  observedSources: RunObservedSourceFactV2[],
): Set<string> {
  return new Set(
    observedSources.flatMap((source) =>
      source.entities.map(
        (entity) => `${source.domain.toLowerCase()}\u0000${entity.canonicalKey}`,
      ),
    ),
  );
}

export function buildCompetitorSourceClueBackfillDryRun(
  dataset: Phase2CReplayDataset,
  baseExport: CompetitorSourceClueBackfillBaseExport,
  options: {
    expectedRunCount?: number;
    expectedMeasurementCount?: number;
  } = {},
): {
  rows: CompetitorSourceClueSupplementRow[];
  summary: CompetitorSourceClueBackfillDryRunSummary;
} {
  invariant(
    baseExport.version === "competitor-source-clue-v2-backfill-base-v0.1",
    "SOURCE_CLUE_BASE_VERSION_INVALID",
  );
  invariant(Array.isArray(baseExport.rows), "SOURCE_CLUE_BASE_ROWS_INVALID");

  if (options.expectedMeasurementCount !== undefined) {
    invariant(
      dataset.rows.length === options.expectedMeasurementCount,
      `SOURCE_CLUE_MEASUREMENT_COUNT_MISMATCH:${dataset.rows.length}:${options.expectedMeasurementCount}`,
    );
  }

  const replay = replayPhase2CDataset(dataset);
  if (options.expectedRunCount !== undefined) {
    invariant(
      replay.runs.length === options.expectedRunCount,
      `SOURCE_CLUE_RUN_COUNT_MISMATCH:${replay.runs.length}:${options.expectedRunCount}`,
    );
  }
  invariant(
    replay.runs.length === baseExport.rows.length,
    "SOURCE_CLUE_BASE_RUN_COUNT_MISMATCH",
  );

  const baseByRun = new Map<string, CompetitorSourceClueBackfillBaseRow>();
  for (const base of baseExport.rows) {
    const runId = lowerUuid(base.sourceRunId, "SOURCE_CLUE_BASE_RUN_ID_INVALID");
    lowerUuid(base.baseAggregateId, "SOURCE_CLUE_BASE_AGGREGATE_ID_INVALID");
    lowerUuid(
      base.baseObservedSourceAggregateId,
      "SOURCE_CLUE_BASE_OBSERVED_ID_INVALID",
    );
    lowerUuid(
      base.baseMaterializationId,
      "SOURCE_CLUE_BASE_MATERIALIZATION_ID_INVALID",
    );
    lowerUuid(base.orgId, "SOURCE_CLUE_BASE_ORG_ID_INVALID");
    lowerUuid(base.businessId, "SOURCE_CLUE_BASE_BUSINESS_ID_INVALID");
    invariant(
      SHA256_RE.test(base.baseAggregateHash) &&
        SHA256_RE.test(base.observedSourcesHash),
      "SOURCE_CLUE_BASE_HASH_INVALID",
    );
    invariant(!baseByRun.has(runId), "SOURCE_CLUE_DUPLICATE_BASE_RUN");
    baseByRun.set(runId, base);
  }

  const rows: CompetitorSourceClueSupplementRow[] = [];

  for (const run of replay.runs) {
    const runId = lowerUuid(run.runId, "SOURCE_CLUE_REPLAY_RUN_ID_INVALID");
    const businessId = lowerUuid(
      run.businessId,
      "SOURCE_CLUE_REPLAY_BUSINESS_ID_INVALID",
    );
    const base = baseByRun.get(runId);
    invariant(base, `SOURCE_CLUE_BASE_MISSING:${runId}`);
    invariant(
      businessId === base.businessId.toLowerCase(),
      `SOURCE_CLUE_BUSINESS_SCOPE_MISMATCH:${runId}`,
    );

    const competitorKeys = new Set(
      base.aggregate.competitors.map((item) => item.canonicalKey),
    );
    const acceptedEntityDomains = observedEntityDomainKeys(
      base.observedSources,
    );

    const storageClues = run.proposed.competitorSourceClues.filter(
      (clue) =>
        !acceptedEntityDomains.has(
          `${clue.domain.toLowerCase()}\u0000${clue.canonicalKey}`,
        ),
    );

    for (const clue of storageClues) {
      invariant(
        clue.evidenceTier === "near_section_title_match" &&
          clue.responseCount === 1 &&
          clue.attributionCount > 0 &&
          clue.canonicalKey.startsWith("auto:"),
        `SOURCE_CLUE_CONTRACT_INVALID:${runId}:${clue.domain}`,
      );
      invariant(
        competitorKeys.has(clue.canonicalKey),
        `SOURCE_CLUE_COMPETITOR_NOT_IN_BASE:${runId}:${clue.canonicalKey}`,
      );
    }

    const pairKeys = storageClues.map(
      (clue) => `${clue.domain.toLowerCase()}\u0000${clue.canonicalKey}`,
    );
    invariant(
      new Set(pairKeys).size === pairKeys.length,
      `SOURCE_CLUE_DUPLICATE_PAIR:${runId}`,
    );

    const sourceCluesHash = sha256(storageClues);
    const inputFingerprint = sha256({
      baseAggregateId: base.baseAggregateId.toLowerCase(),
      baseObservedSourceAggregateId:
        base.baseObservedSourceAggregateId.toLowerCase(),
      baseMaterializationId: base.baseMaterializationId.toLowerCase(),
      baseAggregateHash: base.baseAggregateHash,
      observedSourcesHash: base.observedSourcesHash,
      sourceRunId: runId,
      businessId,
      clueVersion: RUN_COMPETITOR_SOURCE_CLUE_VERSION,
      sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
      engineVersion: COMPETITOR_SOURCE_CLUE_STORAGE_ENGINE_VERSION,
      sourceCluesHash,
    });

    invariant(
      SHA256_RE.test(sourceCluesHash) && SHA256_RE.test(inputFingerprint),
      `SOURCE_CLUE_HASH_INVALID:${runId}`,
    );

    rows.push({
      base_aggregate_id: base.baseAggregateId.toLowerCase(),
      base_observed_source_aggregate_id:
        base.baseObservedSourceAggregateId.toLowerCase(),
      base_materialization_id: base.baseMaterializationId.toLowerCase(),
      org_id: base.orgId.toLowerCase(),
      business_id: businessId,
      source_run_id: runId,
      clue_version: RUN_COMPETITOR_SOURCE_CLUE_VERSION,
      source_replay_version: RUN_SOURCE_REPLAY_VERSION,
      engine_version: COMPETITOR_SOURCE_CLUE_STORAGE_ENGINE_VERSION,
      input_fingerprint: inputFingerprint,
      source_clues: storageClues,
      source_clues_hash: sourceCluesHash,
    });
  }

  rows.sort((a, b) => a.source_run_id.localeCompare(b.source_run_id, "en"));

  const clueDomainsByRun = rows.map((row) =>
    new Set(row.source_clues.map((clue) => clue.domain.toLowerCase())),
  );
  const observedDomainsByRun = rows.map((row) => {
    const base = baseByRun.get(row.source_run_id)!;
    return new Set(base.observedSources.map((source) => source.domain.toLowerCase()));
  });

  const newClueDomainCount = clueDomainsByRun.reduce(
    (sum, clueDomains, index) =>
      sum +
      [...clueDomains].filter(
        (domain) => !observedDomainsByRun[index]!.has(domain),
      ).length,
    0,
  );

  return {
    rows,
    summary: {
      version: COMPETITOR_SOURCE_CLUE_BACKFILL_DRY_RUN_VERSION,
      runCount: rows.length,
      supplementRowCount: rows.length,
      runsWithClues: rows.filter((row) => row.source_clues.length > 0).length,
      clueDomainCount: clueDomainsByRun.reduce(
        (sum, domains) => sum + domains.size,
        0,
      ),
      clueEntityLinkCount: rows.reduce(
        (sum, row) => sum + row.source_clues.length,
        0,
      ),
      newClueDomainCount,
      combinedObservedSourceDomainCount:
        rows.reduce(
          (sum, row) =>
            sum +
            (baseByRun.get(row.source_run_id)?.observedSources.length ?? 0),
          0,
        ) + newClueDomainCount,
      allContractsOk: true,
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
  invariant(datasetPath && basePath, "SOURCE_CLUE_BACKFILL_USAGE_INVALID");

  const dataset = JSON.parse(
    readFileSync(resolve(datasetPath), "utf8"),
  ) as Phase2CReplayDataset;
  const baseExport = JSON.parse(
    readFileSync(resolve(basePath), "utf8"),
  ) as CompetitorSourceClueBackfillBaseExport;

  const result = buildCompetitorSourceClueBackfillDryRun(
    dataset,
    baseExport,
    { expectedRunCount: 23, expectedMeasurementCount: 428 },
  );
  console.log(JSON.stringify(result.summary, null, 2));
}
