import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateRunEntityFactsV2,
  type RunCompetitorFactV2,
  type RunMeasurementFactRecordV2,
  type RunQuestionAreaV2,
  type RunQuestionGroupV2,
  type RunTargetSourceFactV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import {
  replayHistoricalMeasurementV2,
  type ReplayBusinessIdentityV2,
  type ReplayPublicIdentityV2,
  type ReplayStoredMentionV2,
} from "../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";
import type { RawParserTargetSignalV2 } from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";
import {
  replayRunSourcesV2,
  type ReplayRawAttributionV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";

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
  attributions: ReplayRawAttributionV2[];
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
    top3UncertainCount: number;
    top3LowerBoundPct: number | null;
    top3UpperBoundPct: number | null;
    competitorCount: number;
    questionGroups: RunQuestionGroupV2[];
    questionAreas: RunQuestionAreaV2[];
    competitors: RunCompetitorFactV2[];
    targetSources: RunTargetSourceFactV2[];
    sourceReplayStatus: "evaluated";
    sourceDomainCount: number;
    sourcePartialMeasurementCount: number;
    acceptedAttributionCount: number;
    sourceDiagnosticCount: number;
  };
  currentVisibilityInsideProposedBounds: boolean | null;
  currentTop3InsideProposedBounds: boolean | null;
  contractOk: boolean;
  contractIssues: ReturnType<typeof aggregateRunEntityFactsV2>["contractIssues"];
  qualityFlagCounts: Record<string, number>;
  replayDiagnostics: Record<string, number>;
}

export type Phase2CReplayGateIssueCode =
  | "RUN_CONTRACT_ISSUE"
  | "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS"
  | "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS";

export interface Phase2CReplayGateIssue {
  code: Phase2CReplayGateIssueCode;
  runId: string;
  detail: string;
}

export interface Phase2CReplayReleaseGate {
  version: "0.1";
  ok: boolean;
  blockingIssueCount: number;
  issues: Phase2CReplayGateIssue[];
  checks: {
    contractIssueRuns: number;
    visibilityOutsideBoundsRuns: number;
    top3OutsideBoundsRuns: number;
  };
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
    sourceReplayStatus: "evaluated";
    sourcePartialRunCount: number;
    acceptedAttributionCount: number;
    sourceDiagnosticCount: number;
  };
  runs: Phase2CRunDiff[];
  releaseGate: Phase2CReplayReleaseGate;
}

function buildReleaseGate(
  runs: Phase2CRunDiff[],
): Phase2CReplayReleaseGate {
  const issues: Phase2CReplayGateIssue[] = [];

  for (const run of runs) {
    if (!run.contractOk) {
      issues.push({
        code: "RUN_CONTRACT_ISSUE",
        runId: run.runId,
        detail: run.contractIssues.map((item) => item.code).join(",") ||
          "Run aggregate contract failed.",
      });
    }
    if (run.currentVisibilityInsideProposedBounds === false) {
      issues.push({
        code: "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS",
        runId: run.runId,
        detail:
          `Current visibility ${run.current.visibilityRatePct} is outside proposed bounds ${run.proposed.visibilityLowerBoundPct}-${run.proposed.visibilityUpperBoundPct}.`,
      });
    }
    if (run.currentTop3InsideProposedBounds === false) {
      issues.push({
        code: "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS",
        runId: run.runId,
        detail:
          `Current Top3 ${run.current.top3RatePct} is outside proposed bounds ${run.proposed.top3LowerBoundPct}-${run.proposed.top3UpperBoundPct}.`,
      });
    }
  }

  issues.sort(
    (a, b) =>
      a.runId.localeCompare(b.runId, "en") ||
      a.code.localeCompare(b.code, "en"),
  );

  const count = (code: Phase2CReplayGateIssueCode) =>
    issues.filter((issue) => issue.code === code).length;

  return {
    version: "0.1",
    ok: issues.length === 0,
    blockingIssueCount: issues.length,
    issues,
    checks: {
      contractIssueRuns: count("RUN_CONTRACT_ISSUE"),
      visibilityOutsideBoundsRuns: count(
        "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS",
      ),
      top3OutsideBoundsRuns: count(
        "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS",
      ),
    },
  };
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
    const diagnosticCodes: string[] = [];

    const preliminary = rows.map((row) => {
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

      diagnosticCodes.push(
        ...replay.diagnostics
          .map((item) => item.code)
          .filter((code) => code !== "SOURCE_REPLAY_NOT_EVALUATED"),
      );

      return { row, replay };
    });

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

    diagnosticCodes.push(
      ...sourceReplay.diagnostics.map((item) => item.code),
    );

    const sourceFactsByMeasurement = new Map(
      sourceReplay.factsByMeasurement.map((item) => [
        item.measurementId,
        item.facts,
      ]),
    );

    const factsRecords: RunMeasurementFactRecordV2[] = preliminary.map(
      ({ row, replay }) => ({
        fact: sourceFactsByMeasurement.get(row.measurementId) ?? replay.facts,
        questionId: row.questionId,
        questionText: row.questionText,
        intentType: row.intentType,
      }),
    );

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
      top3UncertainCount: aggregate.overview.top3UncertainCount,
      top3LowerBoundPct: aggregate.overview.top3LowerBoundPct,
      top3UpperBoundPct: aggregate.overview.top3UpperBoundPct,
      competitorCount: aggregate.competitors.length,
      questionGroups: aggregate.questionGroups,
      questionAreas: aggregate.questionAreas,
      competitors: aggregate.competitors,
      targetSources: aggregate.targetSources,
      sourceReplayStatus: "evaluated" as const,
      sourceDomainCount: aggregate.targetSources.length,
      sourcePartialMeasurementCount:
        aggregate.overview.sourcePartialMeasurementCount,
      acceptedAttributionCount: sourceReplay.acceptedAttributions.length,
      sourceDiagnosticCount: sourceReplay.diagnostics.length,
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

  const releaseGate = buildReleaseGate(runs);

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
      sourceReplayStatus: "evaluated",
      sourcePartialRunCount: runs.filter(
        (run) => run.proposed.sourcePartialMeasurementCount > 0,
      ).length,
      acceptedAttributionCount: runs.reduce(
        (sum, run) => sum + run.proposed.acceptedAttributionCount,
        0,
      ),
      sourceDiagnosticCount: runs.reduce(
        (sum, run) => sum + run.proposed.sourceDiagnosticCount,
        0,
      ),
    },
    runs,
    releaseGate,
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
