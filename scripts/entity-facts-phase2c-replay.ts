import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateRunEntityFactsV2,
  type RunMeasurementFactRecordV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import {
  replayHistoricalMeasurementV2,
  type ReplayBusinessIdentityV2,
  type ReplayPublicIdentityV2,
  type ReplayStoredMentionV2,
} from "../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";
import type { RawParserTargetSignalV2 } from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";

export interface Phase2CReplayDatasetRow {
  measurementId: string;
  runId: string;
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
}

export interface Phase2CReplayDataset {
  version: string;
  source?: string;
  publicIdentities: ReplayPublicIdentityV2[];
  rows: Phase2CReplayDatasetRow[];
}

export interface CurrentRunMetricsV2 {
  validCount: number;
  mentionCount: number;
  top3Count: number;
  visibilityRatePct: number | null;
  top3RatePct: number | null;
}

export interface Phase2CRunDiff {
  runId: string;
  businessId: string;
  businessName: string;
  current: CurrentRunMetricsV2;
  proposed: {
    confirmedMentionCount: number;
    unresolvedTargetCount: number;
    visibilityLowerBoundPct: number | null;
    visibilityUpperBoundPct: number | null;
    confirmedTop3Count: number;
    top3LowerBoundPct: number | null;
    top3UpperBoundPct: number | null;
    competitorCount: number;
    sourceReplayStatus: "not_evaluated";
  };
  currentVisibilityInsideProposedBounds: boolean | null;
  currentTop3InsideProposedBounds: boolean | null;
  contractOk: boolean;
  contractIssues: ReturnType<typeof aggregateRunEntityFactsV2>["contractIssues"];
  qualityFlagCounts: Record<string, number>;
  replayDiagnostics: Record<string, number>;
}

export interface Phase2CReplayReport {
  version: "0.1";
  datasetVersion: string;
  generatedAt: string;
  summary: {
    runCount: number;
    measurementCount: number;
    validMeasurementCount: number;
    invalidMeasurementCount: number;
    contractIssueRunCount: number;
    visibilityOutsideBoundsRunCount: number;
    top3OutsideBoundsRunCount: number;
    unresolvedRunCount: number;
    sourceReplayStatus: "not_evaluated";
  };
  runs: Phase2CRunDiff[];
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function currentMetrics(rows: Phase2CReplayDatasetRow[]): CurrentRunMetricsV2 {
  const valid = rows.filter((row) => row.valid);
  const mentionCount = valid.filter(
    (row) => row.rawParser.wasClientMentioned,
  ).length;
  const top3Count = valid.filter(
    (row) =>
      row.rawParser.wasClientMentioned &&
      typeof row.rawParser.clientPosition === "number" &&
      Number.isInteger(row.rawParser.clientPosition) &&
      row.rawParser.clientPosition >= 1 &&
      row.rawParser.clientPosition <= 3,
  ).length;
  return {
    validCount: valid.length,
    mentionCount,
    top3Count,
    visibilityRatePct: pct(mentionCount, valid.length),
    top3RatePct: pct(top3Count, valid.length),
  };
}

function inside(
  value: number | null,
  lower: number | null,
  upper: number | null,
): boolean | null {
  if (value === null || lower === null || upper === null) return null;
  return value >= lower - 0.005 && value <= upper + 0.005;
}

function countDiagnostics(
  values: string[],
): Record<string, number> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

export function replayPhase2CDataset(
  dataset: Phase2CReplayDataset,
): Phase2CReplayReport {
  const byRun = new Map<string, Phase2CReplayDatasetRow[]>();
  for (const row of dataset.rows) {
    const current = byRun.get(row.runId) ?? [];
    current.push(row);
    byRun.set(row.runId, current);
  }

  const runs: Phase2CRunDiff[] = [];

  for (const [runId, rows] of [...byRun.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const first = rows[0]!;
    const factsRecords: RunMeasurementFactRecordV2[] = [];
    const diagnosticCodes: string[] = [];

    for (const row of rows) {
      const replay = replayHistoricalMeasurementV2({
        measurementId: row.measurementId,
        valid: row.valid,
        responseText: row.responseText,
        rawParser: row.rawParser,
        target: row.target,
        registeredBusinesses: row.registeredBusinesses,
        publicIdentities: dataset.publicIdentities,
        storedMentions: row.storedMentions,
      });

      diagnosticCodes.push(...replay.diagnostics.map((item) => item.code));
      factsRecords.push({
        fact: replay.facts,
        questionId: row.questionId,
        questionText: row.questionText,
        intentType: row.intentType,
      });
    }

    const aggregate = aggregateRunEntityFactsV2(
      first.businessId,
      factsRecords,
    );
    const current = currentMetrics(rows);
    const proposed = {
      confirmedMentionCount: aggregate.overview.confirmedMentionCount,
      unresolvedTargetCount: aggregate.overview.unresolvedTargetCount,
      visibilityLowerBoundPct: aggregate.overview.visibilityLowerBoundPct,
      visibilityUpperBoundPct: aggregate.overview.visibilityUpperBoundPct,
      confirmedTop3Count: aggregate.overview.confirmedTop3Count,
      top3LowerBoundPct: aggregate.overview.top3LowerBoundPct,
      top3UpperBoundPct: aggregate.overview.top3UpperBoundPct,
      competitorCount: aggregate.competitors.length,
      sourceReplayStatus: "not_evaluated" as const,
    };

    runs.push({
      runId,
      businessId: first.businessId,
      businessName: first.target.name,
      current,
      proposed,
      currentVisibilityInsideProposedBounds: inside(
        current.visibilityRatePct,
        proposed.visibilityLowerBoundPct,
        proposed.visibilityUpperBoundPct,
      ),
      currentTop3InsideProposedBounds: inside(
        current.top3RatePct,
        proposed.top3LowerBoundPct,
        proposed.top3UpperBoundPct,
      ),
      contractOk: aggregate.contractOk,
      contractIssues: aggregate.contractIssues,
      qualityFlagCounts: aggregate.qualityFlagCounts,
      replayDiagnostics: countDiagnostics(diagnosticCodes),
    });
  }

  return {
    version: "0.1",
    datasetVersion: dataset.version,
    generatedAt: new Date().toISOString(),
    summary: {
      runCount: runs.length,
      measurementCount: dataset.rows.length,
      validMeasurementCount: dataset.rows.filter((row) => row.valid).length,
      invalidMeasurementCount: dataset.rows.filter((row) => !row.valid).length,
      contractIssueRunCount: runs.filter((run) => !run.contractOk).length,
      visibilityOutsideBoundsRunCount: runs.filter(
        (run) => run.currentVisibilityInsideProposedBounds === false,
      ).length,
      top3OutsideBoundsRunCount: runs.filter(
        (run) => run.currentTop3InsideProposedBounds === false,
      ).length,
      unresolvedRunCount: runs.filter(
        (run) => run.proposed.unresolvedTargetCount > 0,
      ).length,
      sourceReplayStatus: "not_evaluated",
    },
    runs,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "Usage: bun scripts/entity-facts-phase2c-replay.ts <dataset.json>",
    );
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(
      readFileSync(resolve(inputPath), "utf8"),
    ) as Phase2CReplayDataset;
    console.log(JSON.stringify(replayPhase2CDataset(dataset), null, 2));
  }
}
