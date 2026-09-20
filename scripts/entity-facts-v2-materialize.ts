import { createHash } from "node:crypto";
import {
  replayHistoricalMeasurementV2,
  HISTORICAL_MEASUREMENT_REPLAY_VERSION,
} from "../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";
import {
  MEASUREMENT_ENTITY_FACTS_VERSION,
  type MeasurementEntityFactsV2,
} from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";
import {
  aggregateRunEntityFactsV2,
  RUN_ENTITY_FACTS_AGGREGATE_VERSION,
  type RunEntityFactsAggregateV2,
  type RunMeasurementFactRecordV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import {
  replayRunSourcesV2,
  RUN_SOURCE_REPLAY_VERSION,
} from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";
import type {
  Phase2CReplayDataset,
  Phase2CReplayDatasetRow,
} from "./entity-facts-phase2c-replay";

export const ENTITY_FACTS_V2_MATERIALIZER_VERSION = "0.1" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;

export interface Phase2CMaterializationDatasetRow
  extends Phase2CReplayDatasetRow {
  orgId: string;
}

export interface Phase2CMaterializationDataset
  extends Omit<Phase2CReplayDataset, "rows"> {
  rows: Phase2CMaterializationDatasetRow[];
}

export interface MeasurementEntityFactMaterializationRowV2 {
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

export interface RunEntityFactAggregateMaterializationRowV2 {
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

export interface EntityFactsV2MaterializationBundle {
  version: typeof ENTITY_FACTS_V2_MATERIALIZER_VERSION;
  engineVersion: string;
  measurementRows: MeasurementEntityFactMaterializationRowV2[];
  aggregateRows: RunEntityFactAggregateMaterializationRowV2[];
}

export interface EntityFactsV2MaterializationOptions {
  engineVersion: string;
  materializationIds: Record<string, string>;
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

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function sortedSemanticArray<T>(values: T[]): T[] {
  return [...values].sort((a, b) =>
    stableJson(a).localeCompare(stableJson(b), "en")
  );
}

function normalizedInputRow(row: Phase2CMaterializationDatasetRow) {
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

function validateRunScope(
  runId: string,
  rows: Phase2CMaterializationDatasetRow[],
): {
  orgId: string;
  businessId: string;
} {
  if (rows.length === 0) {
    throw new Error(`MATERIALIZATION_RUN_EMPTY:${runId}`);
  }

  const orgIds = new Set(rows.map((row) => row.orgId.trim()).filter(Boolean));
  const businessIds = new Set(
    rows.map((row) => row.businessId.trim()).filter(Boolean),
  );

  if (orgIds.size !== 1) {
    throw new Error(`MATERIALIZATION_ORG_SCOPE_INVALID:${runId}`);
  }
  if (businessIds.size !== 1) {
    throw new Error(`MATERIALIZATION_BUSINESS_SCOPE_INVALID:${runId}`);
  }

  const orgId = [...orgIds][0]!;
  const businessId = [...businessIds][0]!;
  if (!UUID_RE.test(orgId)) {
    throw new Error(`MATERIALIZATION_ORG_ID_INVALID:${runId}`);
  }
  if (!UUID_RE.test(businessId)) {
    throw new Error(`MATERIALIZATION_BUSINESS_ID_INVALID:${runId}`);
  }

  return { orgId: orgId.toLowerCase(), businessId: businessId.toLowerCase() };
}

function validateMaterializationId(runId: string, value: string | undefined) {
  const id = (value ?? "").trim();
  if (!UUID_RE.test(id)) {
    throw new Error(`MATERIALIZATION_ID_INVALID:${runId}`);
  }
  return id.toLowerCase();
}

export function buildEntityFactsV2Materialization(
  dataset: Phase2CMaterializationDataset,
  options: EntityFactsV2MaterializationOptions,
): EntityFactsV2MaterializationBundle {
  const engineVersion = options.engineVersion.trim();
  if (!engineVersion) throw new Error("MATERIALIZATION_ENGINE_VERSION_REQUIRED");

  const byRun = new Map<string, Phase2CMaterializationDatasetRow[]>();
  for (const row of dataset.rows) {
    const runId = row.runId.trim();
    if (!UUID_RE.test(runId)) {
      throw new Error(`MATERIALIZATION_RUN_ID_INVALID:${row.runId}`);
    }
    if (!UUID_RE.test(row.measurementId.trim())) {
      throw new Error(
        `MATERIALIZATION_MEASUREMENT_ID_INVALID:${row.measurementId}`,
      );
    }
    const current = byRun.get(runId.toLowerCase()) ?? [];
    current.push(row);
    byRun.set(runId.toLowerCase(), current);
  }

  const measurementRows: MeasurementEntityFactMaterializationRowV2[] = [];
  const aggregateRows: RunEntityFactAggregateMaterializationRowV2[] = [];

  for (const [runId, unsortedRows] of [...byRun.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "en")
  )) {
    const rows = [...unsortedRows].sort((a, b) =>
      a.measurementId.localeCompare(b.measurementId, "en")
    );
    const { orgId, businessId } = validateRunScope(runId, rows);
    const materializationId = validateMaterializationId(
      runId,
      options.materializationIds[runId],
    );

    const normalizedRunInput = {
      materializerVersion: ENTITY_FACTS_V2_MATERIALIZER_VERSION,
      engineVersion,
      measurementFactsVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
      historicalReplayVersion: HISTORICAL_MEASUREMENT_REPLAY_VERSION,
      sourceReplayVersion: RUN_SOURCE_REPLAY_VERSION,
      aggregateVersion: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
      publicIdentities: sortedSemanticArray([...dataset.publicIdentities]),
      rows: rows.map(normalizedInputRow),
    };
    const runInputFingerprint = sha256(normalizedRunInput);
    if (!SHA256_RE.test(runInputFingerprint)) {
      throw new Error(`MATERIALIZATION_INPUT_FINGERPRINT_INVALID:${runId}`);
    }

    const preliminary = rows.map((row) => ({
      row,
      replay: replayHistoricalMeasurementV2({
        measurementId: row.measurementId,
        valid: row.valid,
        responseText: row.responseText,
        rawParser: row.rawParser,
        target: row.target,
        registeredBusinesses: row.registeredBusinesses,
        publicIdentities: dataset.publicIdentities,
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
        attributions: row.attributions ?? [],
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

    for (const { row, replay } of preliminary) {
      const facts =
        sourceFactsByMeasurement.get(row.measurementId) ?? replay.facts;
      const factsHash = sha256(facts);
      if (!SHA256_RE.test(factsHash)) {
        throw new Error(
          `MATERIALIZATION_FACTS_HASH_INVALID:${row.measurementId}`,
        );
      }

      measurementRows.push({
        materialization_id: materializationId,
        org_id: orgId,
        business_id: businessId,
        source_run_id: runId,
        measurement_id: row.measurementId.toLowerCase(),
        fact_version: facts.version,
        engine_version: engineVersion,
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
    if (!aggregate.contractOk || aggregate.contractIssues.length > 0) {
      throw new Error(
        `MATERIALIZATION_AGGREGATE_CONTRACT_FAILED:${runId}:${aggregate.contractIssues
          .map((issue) => issue.code)
          .join("|")}`,
      );
    }

    const aggregateHash = sha256(aggregate);
    const aggregateInputFingerprint = sha256({
      engineVersion,
      factVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
      aggregateVersion: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
      runId,
      orgId,
      businessId,
      facts: factHashes.sort((a, b) =>
        a.measurementId.localeCompare(b.measurementId, "en")
      ),
    });

    aggregateRows.push({
      materialization_id: materializationId,
      org_id: orgId,
      business_id: businessId,
      source_run_id: runId,
      fact_version: MEASUREMENT_ENTITY_FACTS_VERSION,
      aggregate_version: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
      engine_version: engineVersion,
      input_fingerprint: aggregateInputFingerprint,
      measurement_count: aggregate.overview.measurementCount,
      valid_measurement_count: aggregate.overview.validCount,
      contract_ok: true,
      aggregate,
      aggregate_hash: aggregateHash,
    });
  }

  measurementRows.sort(
    (a, b) =>
      a.source_run_id.localeCompare(b.source_run_id, "en") ||
      a.measurement_id.localeCompare(b.measurement_id, "en"),
  );
  aggregateRows.sort((a, b) =>
    a.source_run_id.localeCompare(b.source_run_id, "en")
  );

  return {
    version: ENTITY_FACTS_V2_MATERIALIZER_VERSION,
    engineVersion,
    measurementRows,
    aggregateRows,
  };
}
