import { createHash } from "node:crypto";
import {
  HISTORICAL_MEASUREMENT_REPLAY_VERSION,
  TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION,
} from "../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";
import { MEASUREMENT_ENTITY_FACTS_VERSION } from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";
import { RUN_ENTITY_FACTS_AGGREGATE_VERSION } from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import {
  RUN_COMPETITOR_SOURCE_CLUE_VERSION,
  RUN_SOURCE_REPLAY_VERSION,
  type ReplayCompetitorSourceClueV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";
import {
  RUN_OBSERVED_SOURCES_VERSION,
  type RunObservedSourceFactV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-observed-sources";
import {
  replayPhase2CDataset,
} from "./entity-facts-phase2c-replay";
import {
  buildEntityFactsV2Materialization,
  ENTITY_FACTS_V2_MATERIALIZER_VERSION,
  type EntityFactsV2MaterializationBundle,
  type Phase2CMaterializationDataset,
} from "./entity-facts-v2-materialize";

export const ENTITY_FACTS_V2_RUNTIME_CANDIDATE_VERSION = "0.1" as const;

export const ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION =
  `entity-facts-v2:mef${MEASUREMENT_ENTITY_FACTS_VERSION}:hist${HISTORICAL_MEASUREMENT_REPLAY_VERSION}:te${TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION}:src${RUN_SOURCE_REPLAY_VERSION}:agg${RUN_ENTITY_FACTS_AGGREGATE_VERSION}:mat${ENTITY_FACTS_V2_MATERIALIZER_VERSION}` as const;

export const ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION =
  "observed-sources-v2:src0.1:obs0.1:store0.1" as const;

export const ENTITY_FACTS_V2_RUNTIME_CLUE_ENGINE_VERSION =
  "competitor-source-clues-v2:src0.1:clue0.1:store0.1" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type EntityFactsV2RuntimeRunState = {
  runId: string;
  orgId: string;
  businessId: string;
  status: string;
  runType: string;
  phase: string;
  experimentId: string | null;
  postprocessCompleted: boolean;
  citationAttributionCompleted: boolean;
};

export type EntityFactsV2RuntimeExistingState = {
  measurementFactCount: number;
  aggregateRowCount: number;
  observedSourceRowCount: number;
  competitorSourceClueRowCount: number;
};

export type EntityFactsV2RuntimeObservedSupplement = {
  observed_sources_version: typeof RUN_OBSERVED_SOURCES_VERSION;
  source_replay_version: typeof RUN_SOURCE_REPLAY_VERSION;
  engine_version: typeof ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION;
  input_fingerprint: string;
  observed_sources: RunObservedSourceFactV2[];
  observed_sources_hash: string;
};

export type EntityFactsV2RuntimeClueSupplement = {
  clue_version: typeof RUN_COMPETITOR_SOURCE_CLUE_VERSION;
  source_replay_version: typeof RUN_SOURCE_REPLAY_VERSION;
  engine_version: typeof ENTITY_FACTS_V2_RUNTIME_CLUE_ENGINE_VERSION;
  input_fingerprint: string;
  source_clues: ReplayCompetitorSourceClueV2[];
  source_clues_hash: string;
};

export type EntityFactsV2RuntimeCommitCandidate = {
  kind: "commit";
  version: typeof ENTITY_FACTS_V2_RUNTIME_CANDIDATE_VERSION;
  runId: string;
  orgId: string;
  businessId: string;
  materializationId: string;
  engineVersion: typeof ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION;
  requiresSingleTransaction: true;
  insertOrder: readonly [
    "measurement_entity_facts_v2",
    "run_entity_fact_aggregates_v2",
    "run_observed_source_aggregates_v2",
    "run_competitor_source_clue_aggregates_v2",
  ];
  bundle: EntityFactsV2MaterializationBundle;
  observedSupplement: EntityFactsV2RuntimeObservedSupplement;
  clueSupplement: EntityFactsV2RuntimeClueSupplement;
};

export type EntityFactsV2RuntimeIdempotentCandidate = {
  kind: "already_materialized";
  version: typeof ENTITY_FACTS_V2_RUNTIME_CANDIDATE_VERSION;
  runId: string;
};

export type EntityFactsV2RuntimeCandidate =
  | EntityFactsV2RuntimeCommitCandidate
  | EntityFactsV2RuntimeIdempotentCandidate;

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

function normalizeUuid(value: string, code: string): string {
  const out = value.trim().toLowerCase();
  invariant(UUID_RE.test(out), code);
  return out;
}

function validateRunScope(
  dataset: Phase2CMaterializationDataset,
  state: EntityFactsV2RuntimeRunState,
): {
  runId: string;
  orgId: string;
  businessId: string;
} {
  invariant(dataset.rows.length > 0, "RUNTIME_V2_DATASET_EMPTY");

  const runId = normalizeUuid(state.runId, "RUNTIME_V2_RUN_ID_INVALID");
  const orgId = normalizeUuid(state.orgId, "RUNTIME_V2_ORG_ID_INVALID");
  const businessId = normalizeUuid(
    state.businessId,
    "RUNTIME_V2_BUSINESS_ID_INVALID",
  );

  const runIds = new Set(dataset.rows.map((row) => row.runId.toLowerCase()));
  const orgIds = new Set(dataset.rows.map((row) => row.orgId.toLowerCase()));
  const businessIds = new Set(
    dataset.rows.map((row) => row.businessId.toLowerCase()),
  );

  invariant(
    runIds.size === 1 && runIds.has(runId),
    "RUNTIME_V2_DATASET_RUN_SCOPE_MISMATCH",
  );
  invariant(
    orgIds.size === 1 && orgIds.has(orgId),
    "RUNTIME_V2_DATASET_ORG_SCOPE_MISMATCH",
  );
  invariant(
    businessIds.size === 1 && businessIds.has(businessId),
    "RUNTIME_V2_DATASET_BUSINESS_SCOPE_MISMATCH",
  );

  return { runId, orgId, businessId };
}

function isFullyMaterialized(
  existing: EntityFactsV2RuntimeExistingState,
  measurementCount: number,
): boolean {
  return (
    existing.measurementFactCount === measurementCount &&
    existing.aggregateRowCount === 1 &&
    existing.observedSourceRowCount === 1 &&
    existing.competitorSourceClueRowCount === 1
  );
}

function hasAnyExisting(
  existing: EntityFactsV2RuntimeExistingState,
): boolean {
  return (
    existing.measurementFactCount > 0 ||
    existing.aggregateRowCount > 0 ||
    existing.observedSourceRowCount > 0 ||
    existing.competitorSourceClueRowCount > 0
  );
}

export function buildEntityFactsV2RuntimeMaterializationCandidate(args: {
  dataset: Phase2CMaterializationDataset;
  run: EntityFactsV2RuntimeRunState;
  existing: EntityFactsV2RuntimeExistingState;
  materializationId: string;
}): EntityFactsV2RuntimeCandidate {
  const { runId, orgId, businessId } = validateRunScope(
    args.dataset,
    args.run,
  );

  invariant(
    args.run.status === "completed" &&
      args.run.runType === "audit" &&
      args.run.phase === "standalone" &&
      args.run.experimentId === null,
    "RUNTIME_V2_RUN_NOT_ELIGIBLE",
  );

  if (isFullyMaterialized(args.existing, args.dataset.rows.length)) {
    return {
      kind: "already_materialized",
      version: ENTITY_FACTS_V2_RUNTIME_CANDIDATE_VERSION,
      runId,
    };
  }

  invariant(
    !hasAnyExisting(args.existing),
    "RUNTIME_V2_PARTIAL_EXISTING_STATE",
  );

  invariant(
    args.run.postprocessCompleted,
    "RUNTIME_V2_POSTPROCESS_NOT_READY",
  );
  invariant(
    args.run.citationAttributionCompleted,
    "RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY",
  );

  const materializationId = normalizeUuid(
    args.materializationId,
    "RUNTIME_V2_MATERIALIZATION_ID_INVALID",
  );

  const bundle = buildEntityFactsV2Materialization(args.dataset, {
    engineVersion: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
    materializationIds: {
      [runId]: materializationId,
    },
  });

  invariant(
    bundle.aggregateRows.length === 1 &&
      bundle.measurementRows.length === args.dataset.rows.length,
    "RUNTIME_V2_BASE_MATERIALIZATION_INCOMPLETE",
  );

  const replay = replayPhase2CDataset(args.dataset);
  invariant(
    replay.runs.length === 1 && replay.runs[0]?.runId === runId,
    "RUNTIME_V2_REPLAY_SCOPE_MISMATCH",
  );

  const replayRun = replay.runs[0]!;
  invariant(
    replayRun.contractOk && replayRun.contractIssues.length === 0,
    "RUNTIME_V2_REPLAY_CONTRACT_FAILED",
  );

  const aggregateRow = bundle.aggregateRows[0]!;
  invariant(
    aggregateRow.org_id === orgId &&
      aggregateRow.business_id === businessId &&
      aggregateRow.source_run_id === runId,
    "RUNTIME_V2_BASE_OUTPUT_SCOPE_MISMATCH",
  );

  invariant(
    stableJson(aggregateRow.aggregate.targetSources) ===
      stableJson(replayRun.proposed.targetSources),
    "RUNTIME_V2_TARGET_SOURCE_PARITY_MISMATCH",
  );

  const observedSources = replayRun.proposed.observedSources;
  const observedSourcesHash = sha256(observedSources);
  const observedInputFingerprint = sha256({
    baseMaterializationId: materializationId,
    baseAggregateHash: aggregateRow.aggregate_hash,
    runId,
    orgId,
    businessId,
    observedSourcesVersion: RUN_OBSERVED_SOURCES_VERSION,
    sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
    engineVersion: ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION,
    observedSourcesHash,
  });

  const sourceClues = replayRun.proposed.competitorSourceClues;
  const sourceCluesHash = sha256(sourceClues);
  const clueInputFingerprint = sha256({
    baseMaterializationId: materializationId,
    baseAggregateHash: aggregateRow.aggregate_hash,
    observedSourcesHash,
    runId,
    orgId,
    businessId,
    clueVersion: RUN_COMPETITOR_SOURCE_CLUE_VERSION,
    sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
    engineVersion: ENTITY_FACTS_V2_RUNTIME_CLUE_ENGINE_VERSION,
    sourceCluesHash,
  });

  return {
    kind: "commit",
    version: ENTITY_FACTS_V2_RUNTIME_CANDIDATE_VERSION,
    runId,
    orgId,
    businessId,
    materializationId,
    engineVersion: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
    requiresSingleTransaction: true,
    insertOrder: [
      "measurement_entity_facts_v2",
      "run_entity_fact_aggregates_v2",
      "run_observed_source_aggregates_v2",
      "run_competitor_source_clue_aggregates_v2",
    ],
    bundle,
    observedSupplement: {
      observed_sources_version: RUN_OBSERVED_SOURCES_VERSION,
      source_replay_version: RUN_SOURCE_REPLAY_VERSION,
      engine_version: ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION,
      input_fingerprint: observedInputFingerprint,
      observed_sources: observedSources,
      observed_sources_hash: observedSourcesHash,
    },
    clueSupplement: {
      clue_version: RUN_COMPETITOR_SOURCE_CLUE_VERSION,
      source_replay_version: RUN_SOURCE_REPLAY_VERSION,
      engine_version: ENTITY_FACTS_V2_RUNTIME_CLUE_ENGINE_VERSION,
      input_fingerprint: clueInputFingerprint,
      source_clues: sourceClues,
      source_clues_hash: sourceCluesHash,
    },
  };
}
