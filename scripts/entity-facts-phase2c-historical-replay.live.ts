import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  replayPhase2CDataset,
  type Phase2CReplayDataset,
} from "./entity-facts-phase2c-replay";

const databaseUrl =
  process.env.ENTITY_V2_REPLAY_DATABASE_URL?.trim() ?? "";
const outputPath =
  process.env.ENTITY_FACTS_PHASE2C_REPLAY_OUTPUT?.trim() ||
  "/tmp/entity-facts-phase2c-historical-replay.json";

function firstColumnValue(
  row: Record<string, unknown> | undefined,
): unknown {
  if (!row) return undefined;
  return Object.values(row)[0];
}

if (!databaseUrl) {
  console.error(
    "ENTITY_FACTS_PHASE2C_REPLAY_ABORTED=READ_ONLY_DATABASE_CREDENTIAL_MISSING",
  );
  process.exitCode = 2;
} else {
  const exportSql = await readFile(
    resolve("scripts/sql/export-entity-facts-phase2c-replay.sql"),
    "utf8",
  );

  const db = postgres(databaseUrl, {
    ssl: "require",
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    max_lifetime: 120,
    connection: {
      application_name: "entity-facts-phase2c-historical-replay-readonly",
    },
  });

  let dataset: Phase2CReplayDataset;
  try {
    const rows = await db.begin(async (tx) => {
      await tx.unsafe("set transaction read only");
      await tx.unsafe("set local statement_timeout = '120s'");
      await tx.unsafe("set local lock_timeout = '5s'");
      return tx.unsafe(exportSql);
    });

    const raw = firstColumnValue(
      rows[0] as Record<string, unknown> | undefined,
    );
    if (typeof raw !== "string") {
      throw new Error(
        "Phase 2C historical replay export did not return wrapped JSON text.",
      );
    }
    dataset = JSON.parse(raw) as Phase2CReplayDataset;
  } finally {
    await db.end({ timeout: 5 });
  }

  if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) {
    throw new Error("Phase 2C historical replay export returned no rows.");
  }

  const report = replayPhase2CDataset(dataset);

  const reviewArtifact = {
    version: "entity-facts-phase2c-historical-review-v0.1",
    generatedAt: report.generatedAt,
    datasetVersion: report.datasetVersion,
    summary: report.summary,
    runs: report.runs,
  };

  await writeFile(
    outputPath,
    JSON.stringify(reviewArtifact, null, 2),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );

  const logSummary = {
    ...report.summary,
    runs: report.runs.map((run) => ({
      runId: run.runId,
      businessId: run.businessId,
      businessName: run.businessName,
      currentVisibilityPct: run.current.visibilityRatePct,
      proposedVisibilityLowerPct:
        run.proposed.visibilityLowerBoundPct,
      proposedVisibilityUpperPct:
        run.proposed.visibilityUpperBoundPct,
      currentTop3Pct: run.current.top3RatePct,
      proposedTop3UncertainCount: run.proposed.top3UncertainCount,
      proposedTop3LowerPct: run.proposed.top3LowerBoundPct,
      proposedTop3UpperPct: run.proposed.top3UpperBoundPct,
      confirmedMentionCount: run.proposed.confirmedMentionCount,
      unresolvedTargetCount: run.proposed.unresolvedTargetCount,
      competitorCount: run.proposed.competitorCount,
      sourceReplayStatus: run.proposed.sourceReplayStatus,
      sourceDomainCount: run.proposed.sourceDomainCount,
      sourcePartialMeasurementCount:
        run.proposed.sourcePartialMeasurementCount,
      acceptedAttributionCount:
        run.proposed.acceptedAttributionCount,
      sourceDiagnosticCount: run.proposed.sourceDiagnosticCount,
      visibilityInsideBounds:
        run.currentVisibilityInsideProposedBounds,
      top3InsideBounds: run.currentTop3InsideProposedBounds,
      contractOk: run.contractOk,
      qualityFlagCounts: run.qualityFlagCounts,
      replayDiagnostics: run.replayDiagnostics,
    })),
  };

  console.log(
    `ENTITY_FACTS_PHASE2C_HISTORICAL_REPLAY_SUMMARY=${JSON.stringify(logSummary)}`,
  );

  if (report.summary.contractIssueRunCount > 0) {
    console.error(
      `ENTITY_FACTS_PHASE2C_CONTRACT_BLOCK=${report.summary.contractIssueRunCount}`,
    );
    process.exitCode = 1;
  }
}
