import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { expect, test } from "vitest";
import {
  evaluateShadowReleaseGate,
  replayDataset,
  type ShadowDiff,
  type ShadowReplayDataset,
  type ShadowReleaseReviewRegistry,
} from "./entity-v2-shadow-replay";

const replayDatabaseUrl = process.env.ENTITY_V2_REPLAY_DATABASE_URL?.trim() ?? "";
const reviewOutputPath =
  process.env.ENTITY_V2_REPLAY_REVIEW_OUTPUT?.trim() ||
  "/tmp/entity-v2-historical-replay-review.json";

const runHistoricalReplay = replayDatabaseUrl ? test : test.skip;

function firstColumnValue(row: Record<string, unknown> | undefined): unknown {
  if (!row) return undefined;
  return Object.values(row)[0];
}

function requiresHumanReview(diff: ShadowDiff): boolean {
  if (
    diff.category === "v1_rejected_to_v2_confirmed" ||
    diff.category === "v1_confirmed_to_v2_dropped" ||
    diff.category === "v1_needs_review_to_v2_confirmed" ||
    diff.category === "v2_new_confirmed"
  ) {
    return true;
  }

  return Boolean(
    diff.v1MatchedBusinessId &&
      diff.v2CanonicalBusinessId &&
      diff.v1MatchedBusinessId !== diff.v2CanonicalBusinessId,
  );
}

runHistoricalReplay(
  "runs the production historical dataset through Entity Engine v2 without mutating production",
  async () => {
    const exportSql = await readFile(
      resolve("scripts/sql/export-entity-v2-replay.sql"),
      "utf8",
    );

    const db = postgres(replayDatabaseUrl, {
      ssl: "require",
      max: 1,
      prepare: false,
      connect_timeout: 15,
      idle_timeout: 5,
      max_lifetime: 120,
      connection: {
        application_name: "entity-v2-historical-replay-readonly",
      },
    });

    let dataset: ShadowReplayDataset;
    try {
      const rows = await db.begin(async (tx) => {
        await tx.unsafe("set transaction read only");
        await tx.unsafe("set local statement_timeout = '120s'");
        await tx.unsafe("set local lock_timeout = '5s'");
        return tx.unsafe(exportSql);
      });

      const raw = firstColumnValue(rows[0] as Record<string, unknown> | undefined);
      if (typeof raw !== "string") {
        throw new Error("Historical replay export did not return the expected wrapped JSON text.");
      }

      dataset = JSON.parse(raw) as ShadowReplayDataset;
    } finally {
      await db.end({ timeout: 5 });
    }

    if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) {
      throw new Error("Historical replay export returned no eligible measurements.");
    }

    const report = replayDataset(dataset);
    const emptyReviewRegistry: ShadowReleaseReviewRegistry = {
      version: "0.1",
      approvedConfirmedDrops: [],
      approvedNewConfirmed: [],
      approvedNeedsReviewPromotions: [],
    };
    const releaseGate = evaluateShadowReleaseGate(report, emptyReviewRegistry);

    const reviewArtifact = {
      version: "entity-v2-historical-release-review-0.1",
      generatedAt: report.generatedAt,
      datasetVersion: report.datasetVersion,
      summary: report.summary,
      releaseSignals: report.releaseSignals,
      releaseGate,
      reviewDiffs: report.diffs.filter(requiresHumanReview),
    };

    await writeFile(reviewOutputPath, JSON.stringify(reviewArtifact, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });

    const logSummary = {
      measurementCount: report.summary.measurementCount,
      v1EntityCount: report.summary.v1EntityCount,
      v2ConfirmedCount: report.summary.v2ConfirmedCount,
      diffCounts: report.summary.diffCounts,
      releaseSignals: report.releaseSignals,
      releaseGateOk: releaseGate.ok,
      blockingIssueCount: releaseGate.blockingIssueCount,
      releaseGateChecks: releaseGate.checks,
      reviewDiffCount: reviewArtifact.reviewDiffs.length,
    };

    console.log(`ENTITY_V2_HISTORICAL_REPLAY_SUMMARY=${JSON.stringify(logSummary)}`);

    expect(
      releaseGate.ok,
      `Entity v2 release gate blocked: ${JSON.stringify(releaseGate.checks)}`,
    ).toBe(true);
  },
  180_000,
);
