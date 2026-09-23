import {
  HISTORICAL_MEASUREMENT_REPLAY_VERSION,
  TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION,
  replayHistoricalMeasurementV2,
  type ReplayBusinessIdentityV2,
  type ReplayPublicIdentityV2,
  type ReplayStoredMentionV2,
} from "./historical-measurement-replay.ts";
import {
  MEASUREMENT_ENTITY_FACTS_VERSION,
  type MeasurementEntityFactsV2,
  type RawParserTargetSignalV2,
} from "./measurement-entity-facts.ts";
import {
  RUN_ENTITY_FACTS_AGGREGATE_VERSION,
  aggregateRunEntityFactsV2,
  type RunEntityFactsAggregateV2,
  type RunMeasurementFactRecordV2,
} from "./run-entity-facts-aggregate.ts";
import {
  RUN_COMPETITOR_SOURCE_CLUE_VERSION,
  RUN_SOURCE_REPLAY_VERSION,
  replayRunSourcesV2,
  type ReplayCompetitorSourceClueV2,
  type ReplayRawAttributionV2,
} from "./run-source-replay.ts";
import {
  RUN_OBSERVED_SOURCES_VERSION,
  buildRunObservedSourcesV2,
  type RunObservedSourceFactV2,
} from "./run-observed-sources.ts";

export const ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION = "0.1" as const;
export const ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION =
  `entity-facts-v2:mef${MEASUREMENT_ENTITY_FACTS_VERSION}:hist${HISTORICAL_MEASUREMENT_REPLAY_VERSION}:te${TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION}:src${RUN_SOURCE_REPLAY_VERSION}:agg${RUN_ENTITY_FACTS_AGGREGATE_VERSION}:mat${ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION}` as const;
export const ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION =
  "observed-sources-v2:src0.1:obs0.1:store0.1" as const;
export const ENTITY_FACTS_V2_RUNTIME_CLUE_ENGINE_VERSION =
  "competitor-source-clues-v2:src0.1:clue0.1:store0.1" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;

export interface EntityFactsV2RuntimeMeasurementInput {
  measurementId: string;
  runId: string;
  orgId: string;
  businessId: string;
  questionId: string;
  questionText: string;
  intentType: string;
  valid: boolean;
  responseText: string;
  rawParser: RawParserTargetSignalV2;
  target: ReplayBusinessIdentityV2;
  registeredBusinesses: ReplayBusinessIdentityV2[];
  storedMentions: ReplayStoredMentionV2[];
  attributions: ReplayRawAttributionV2[];
}

export interface EntityFactsV2RuntimeDataset {
  version: string;
  publicIdentities: ReplayPublicIdentityV2[];
  rows: EntityFactsV2RuntimeMeasurementInput[];
}

export interface EntityFactsV2RuntimeRunState {
  runId: string;
  orgId: string;
  businessId: string;
  status: string;
  runType: string;
  phase: string;
  experimentId: string | null;
  postprocessCompleted: boolean;
  citationAttributionCompleted: boolean;
}

export interface EntityFactsV2RuntimeExistingState {
  measurementFactCount: number;
  aggregateRowCount: number;
  observedSourceRowCount: number;
  competitorSourceClueRowCount: number;
}

export interface RuntimeMeasurementFactInsertV2 {
  materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  measurement_id: string;
  fact_version: string;
  engine_version: string;
  input_fingerprint: string;
  facts: MeasurementEntityFactsV2;
  facts_hash: string;
}

export interface RuntimeAggregateInsertV2 {
  materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  fact_version: string;
  aggregate_version: string;
  engine_version: string;
  input_fingerprint: string;
  measurement_count: number;
  valid_measurement_count: number;
  contract_ok: true;
  aggregate: RunEntityFactsAggregateV2;
  aggregate_hash: string;
}

export interface RuntimeObservedSupplementV2 {
  observed_sources_version: typeof RUN_OBSERVED_SOURCES_VERSION;
  source_replay_version: typeof RUN_SOURCE_REPLAY_VERSION;
  engine_version: typeof ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION;
  input_fingerprint: string;
  observed_sources: RunObservedSourceFactV2[];
  observed_sources_hash: string;
}

export interface RuntimeClueSupplementV2 {
  clue_version: typeof RUN_COMPETITOR_SOURCE_CLUE_VERSION;
  source_replay_version: typeof RUN_SOURCE_REPLAY_VERSION;
  engine_version: typeof ENTITY_FACTS_V2_RUNTIME_CLUE_ENGINE_VERSION;
  input_fingerprint: string;
  source_clues: ReplayCompetitorSourceClueV2[];
  source_clues_hash: string;
}

export type EntityFactsV2RuntimeCommitBundle = {
  kind: "commit";
  version: typeof ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION;
  runId: string;
  orgId: string;
  businessId: string;
  materializationId: string;
  engineVersion: typeof ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION;
  requiresSingleTransaction: true;
  measurementRows: RuntimeMeasurementFactInsertV2[];
  aggregateRow: RuntimeAggregateInsertV2;
  observedSupplement: RuntimeObservedSupplementV2;
  clueSupplement: RuntimeClueSupplementV2;
};

export type EntityFactsV2RuntimeAlreadyMaterialized = {
  kind: "already_materialized";
  version: typeof ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION;
  runId: string;
};

export type EntityFactsV2RuntimeMaterializationResult =
  | EntityFactsV2RuntimeCommitBundle
  | EntityFactsV2RuntimeAlreadyMaterialized;

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

async function sha256(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sortedSemanticArray<T>(values: T[]): T[] {
  return [...values].sort((a, b) =>
    stableJson(a).localeCompare(stableJson(b), "en")
  );
}

function normalizedInputRow(row: EntityFactsV2RuntimeMeasurementInput) {
  return {
    measurementId: row.measurementId,
    runId: row.runId,
    orgId: row.orgId,
    businessId: row.businessId,
    questionId: row.questionId,
    questionText: row.questionText,
    intentType: row.intentType,
    valid: row.valid,
    responseText: row.responseText,
    rawParser: row.rawParser,
    target: {
      ...row.target,
      aliases: sortedSemanticArray([...(row.target.aliases ?? [])]),
      verifiedConcreteOfficialUrls: sortedSemanticArray([
        ...(row.target.verifiedConcreteOfficialUrls ?? []),
      ]),
    },
    registeredBusinesses: sortedSemanticArray(
      row.registeredBusinesses.map((item) => ({
        ...item,
        aliases: sortedSemanticArray([...(item.aliases ?? [])]),
        verifiedConcreteOfficialUrls: sortedSemanticArray([
          ...(item.verifiedConcreteOfficialUrls ?? []),
        ]),
      })),
    ),
    storedMentions: sortedSemanticArray([...row.storedMentions]),
    attributions: sortedSemanticArray([...row.attributions]),
  };
}

function normalizeUuid(value: string, code: string): string {
  const out = value.trim().toLowerCase();
  invariant(UUID_RE.test(out), code);
  return out;
}

function fullyMaterialized(
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

function anyMaterialized(existing: EntityFactsV2RuntimeExistingState): boolean {
  return Object.values(existing).some((value) => value > 0);
}

export async function buildEntityFactsV2RuntimeMaterialization(args: {
  dataset: EntityFactsV2RuntimeDataset;
  run: EntityFactsV2RuntimeRunState;
  existing: EntityFactsV2RuntimeExistingState;
  materializationId: string;
}): Promise<EntityFactsV2RuntimeMaterializationResult> {
  invariant(args.dataset.rows.length > 0, "RUNTIME_V2_DATASET_EMPTY");

  const runId = normalizeUuid(args.run.runId, "RUNTIME_V2_RUN_ID_INVALID");
  const orgId = normalizeUuid(args.run.orgId, "RUNTIME_V2_ORG_ID_INVALID");
  const businessId = normalizeUuid(
    args.run.businessId,
    "RUNTIME_V2_BUSINESS_ID_INVALID",
  );

  invariant(
    args.run.status === "completed" &&
      args.run.runType === "audit" &&
      args.run.phase === "standalone" &&
      args.run.experimentId === null,
    "RUNTIME_V2_RUN_NOT_ELIGIBLE",
  );

  const runIds = new Set(args.dataset.rows.map((row) => row.runId.toLowerCase()));
  const orgIds = new Set(args.dataset.rows.map((row) => row.orgId.toLowerCase()));
  const businessIds = new Set(
    args.dataset.rows.map((row) => row.businessId.toLowerCase()),
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

  if (fullyMaterialized(args.existing, args.dataset.rows.length)) {
    return {
      kind: "already_materialized",
      version: ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION,
      runId,
    };
  }

  invariant(!anyMaterialized(args.existing), "RUNTIME_V2_PARTIAL_EXISTING_STATE");
  invariant(args.run.postprocessCompleted, "RUNTIME_V2_POSTPROCESS_NOT_READY");
  invariant(
    args.run.citationAttributionCompleted,
    "RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY",
  );

  const materializationId = normalizeUuid(
    args.materializationId,
    "RUNTIME_V2_MATERIALIZATION_ID_INVALID",
  );

  const rows = [...args.dataset.rows].sort((a, b) =>
    a.measurementId.localeCompare(b.measurementId, "en")
  );
  const runInputFingerprint = await sha256({
    materializerVersion: ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION,
    engineVersion: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
    measurementFactsVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
    historicalReplayVersion: HISTORICAL_MEASUREMENT_REPLAY_VERSION,
    sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
    aggregateVersion: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    publicIdentities: sortedSemanticArray([...args.dataset.publicIdentities]),
    rows: rows.map(normalizedInputRow),
  });
  invariant(SHA256_RE.test(runInputFingerprint), "RUNTIME_V2_INPUT_HASH_INVALID");

  const preliminary = rows.map((row) => ({
    row,
    replay: replayHistoricalMeasurementV2({
      measurementId: row.measurementId,
      valid: row.valid,
      responseText: row.responseText,
      rawParser: row.rawParser,
      target: row.target,
      registeredBusinesses: row.registeredBusinesses,
      publicIdentities: args.dataset.publicIdentities,
      storedMentions: row.storedMentions,
    }),
  }));

  const sourceReplay = replayRunSourcesV2(
    preliminary.map(({ row, replay }) => ({
      measurementId: row.measurementId,
      responseText: row.responseText,
      targetBusinessId: row.businessId,
      valid: row.valid,
      rawParser: row.rawParser,
      observations: replay.observations,
      preliminaryFacts: replay.facts,
      entityMentionLinks: replay.entityMentionLinks,
      attributions: row.attributions,
    })),
  );
  const sourceFactsByMeasurement = new Map(
    sourceReplay.factsByMeasurement.map((item) => [
      item.measurementId,
      item.facts,
    ]),
  );

  const factsRecords: RunMeasurementFactRecordV2[] = [];
  const factHashes: Array<{
    measurementId: string;
    factsHash: string;
    questionId: string;
    questionText: string;
    intentType: string;
  }> = [];
  const measurementRows: RuntimeMeasurementFactInsertV2[] = [];

  for (const { row, replay } of preliminary) {
    const facts =
      sourceFactsByMeasurement.get(row.measurementId) ?? replay.facts;
    const factsHash = await sha256(facts);
    invariant(SHA256_RE.test(factsHash), "RUNTIME_V2_FACT_HASH_INVALID");

    measurementRows.push({
      materialization_id: materializationId,
      org_id: orgId,
      business_id: businessId,
      source_run_id: runId,
      measurement_id: normalizeUuid(
        row.measurementId,
        "RUNTIME_V2_MEASUREMENT_ID_INVALID",
      ),
      fact_version: MEASUREMENT_ENTITY_FACTS_VERSION,
      engine_version: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
      input_fingerprint: runInputFingerprint,
      facts,
      facts_hash: factsHash,
    });
    factsRecords.push({
      fact: facts,
      questionId: row.questionId,
      questionText: row.questionText,
      intentType: row.intentType,
    });
    factHashes.push({
      measurementId: row.measurementId.toLowerCase(),
      factsHash,
      questionId: row.questionId,
      questionText: row.questionText,
      intentType: row.intentType,
    });
  }

  const aggregate = aggregateRunEntityFactsV2(businessId, factsRecords);
  invariant(
    aggregate.contractOk && aggregate.contractIssues.length === 0,
    "RUNTIME_V2_AGGREGATE_CONTRACT_FAILED",
  );

  const aggregateHash = await sha256(aggregate);
  const aggregateInputFingerprint = await sha256({
    engineVersion: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
    factVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
    aggregateVersion: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    runId,
    orgId,
    businessId,
    facts: factHashes.sort((a, b) =>
      a.measurementId.localeCompare(b.measurementId, "en")
    ),
  });

  const aggregateRow: RuntimeAggregateInsertV2 = {
    materialization_id: materializationId,
    org_id: orgId,
    business_id: businessId,
    source_run_id: runId,
    fact_version: MEASUREMENT_ENTITY_FACTS_VERSION,
    aggregate_version: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    engine_version: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
    input_fingerprint: aggregateInputFingerprint,
    measurement_count: aggregate.overview.measurementCount,
    valid_measurement_count: aggregate.overview.validCount,
    contract_ok: true,
    aggregate,
    aggregate_hash: aggregateHash,
  };

  const observedSources = buildRunObservedSourcesV2(
    sourceReplay.acceptedAttributions,
  );
  const aggregateTargetDomains = aggregate.targetSources
    .map((item) => item.domain.toLowerCase().replace(/^www\./u, ""))
    .sort((a, b) => a.localeCompare(b, "en"));
  const observedTargetDomains = observedSources
    .filter((item) => item.targetResponseCount > 0)
    .map((item) => item.domain)
    .sort((a, b) => a.localeCompare(b, "en"));
  invariant(
    stableJson(aggregateTargetDomains) === stableJson(observedTargetDomains),
    "RUNTIME_V2_TARGET_SOURCE_PARITY_MISMATCH",
  );

  const observedSourcesHash = await sha256(observedSources);
  const observedInputFingerprint = await sha256({
    baseMaterializationId: materializationId,
    baseAggregateHash: aggregateHash,
    runId,
    orgId,
    businessId,
    observedSourcesVersion: RUN_OBSERVED_SOURCES_VERSION,
    sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
    engineVersion: ENTITY_FACTS_V2_RUNTIME_OBSERVED_ENGINE_VERSION,
    observedSourcesHash,
  });

  const sourceClues = sourceReplay.competitorSourceClues;
  const sourceCluesHash = await sha256(sourceClues);
  const clueInputFingerprint = await sha256({
    baseMaterializationId: materializationId,
    baseAggregateHash: aggregateHash,
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
    version: ENTITY_FACTS_V2_RUNTIME_MATERIALIZER_VERSION,
    runId,
    orgId,
    businessId,
    materializationId,
    engineVersion: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
    requiresSingleTransaction: true,
    measurementRows,
    aggregateRow,
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
