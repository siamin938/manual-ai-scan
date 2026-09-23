import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildObservedSourcesV2BackfillDryRun,
  type ObservedSourcesV2BackfillBaseExport,
} from "../../scripts/observed-sources-v2-backfill-dry-run";
import type { Phase2CReplayDataset } from "../../scripts/entity-facts-phase2c-replay";
import type { RunEntityFactsAggregateV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";

const TARGET = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const BASE = "44444444-4444-4444-8444-444444444444";
const MATERIALIZATION = "55555555-5555-4555-8555-555555555555";

function row(index: number) {
  const suffix = String(index).padStart(12, "0");
  const mentionId = `66666666-6666-4666-8666-${suffix}`;
  const measurementId = `77777777-7777-4777-8777-${suffix}`;

  return {
    measurementId,
    runId: RUN,
    businessId: TARGET,
    questionId: `88888888-8888-4888-8888-${suffix}`,
    questionText: `질문 ${index}`,
    intentType: "local",
    valid: true,
    responseText: "- 레이노 개봉점",
    rawParser: {
      wasClientMentioned: false,
      clientPosition: null,
    },
    target: {
      id: TARGET,
      name: "테스트 업체",
      aliases: ["테스트업체"],
    },
    registeredBusinesses: [
      {
        id: TARGET,
        name: "테스트 업체",
        aliases: ["테스트업체"],
      },
    ],
    storedMentions: [
      {
        mentionId,
        displayName: "레이노 개봉점",
        position: 1,
        canonicalKey: "auto:레이노개봉점",
      },
    ],
    attributions: [
      {
        attributionId: `99999999-9999-4999-8999-${suffix}`,
        measurementMentionId: mentionId,
        canonicalKey: "auto:레이노개봉점",
        domain: "hunnytip.kr",
        url: `https://hunnytip.kr/${index}`,
        attributionLevel: "section" as const,
        evidence: { distance_chars: 100 + index },
        citationStartIndex: 40,
        entityEndIndex: 10,
      },
    ],
    currentCompetitors: [],
    currentTargetSources: [],
  };
}

function dataset(): Phase2CReplayDataset {
  return {
    version: "entity-facts-phase2c-export-v0.1",
    publicIdentities: [],
    rows: [row(1), row(2)],
  };
}

function aggregate(): RunEntityFactsAggregateV2 {
  return {
    version: "0.1",
    factsVersion: "0.3",
    contractOk: true,
    contractIssues: [],
    overview: {
      validCount: 2,
      confirmedMentionCount: 0,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 0,
      visibilityUpperBoundPct: 0,
      confirmedTop3Count: 0,
      top3UncertainCount: 0,
      top3LowerBoundPct: 0,
      top3UpperBoundPct: 0,
      measurementCount: 2,
      invalidCount: 0,
      questionCount: 2,
      coveredQuestionCount: 0,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 2,
      sourcePartialMeasurementCount: 0,
    },
    questionGroups: [],
    questionAreas: [],
    competitors: [
      {
        canonicalKey: "auto:레이노개봉점",
        responseCount: 2,
        questionCount: 2,
        intentCount: 1,
        top3ResponseCount: 2,
      },
    ],
    targetSources: [],
    qualityFlagCounts: {},
  };
}

function baseExport(): ObservedSourcesV2BackfillBaseExport {
  return {
    version: "observed-source-v2-backfill-base-v0.1",
    rows: [
      {
        baseAggregateId: BASE,
        baseMaterializationId: MATERIALIZATION,
        orgId: ORG,
        businessId: TARGET,
        sourceRunId: RUN,
        factVersion: "0.3",
        aggregateVersion: "0.1",
        engineVersion:
          "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
        aggregateHash: "a".repeat(64),
        aggregate: aggregate(),
      },
    ],
  };
}

describe("Observed Sources v2 backfill dry-run", () => {
  it("builds one append-only supplement row without inserting anything", () => {
    const result = buildObservedSourcesV2BackfillDryRun(
      dataset(),
      baseExport(),
      { expectedRunCount: 1, expectedMeasurementCount: 2 },
    );

    expect(result.summary).toEqual({
      version: "0.1",
      runCount: 1,
      supplementRowCount: 1,
      runsWithObservedSources: 1,
      observedSourceDomainCount: 1,
      observedTargetSourceDomainCount: 0,
      observedCompetitorSourceDomainCount: 1,
      sourceLinkedCompetitorCount: 1,
      allCandidateContractsOk: true,
      allHashesOk: true,
    });

    expect(result.rows[0]).toMatchObject({
      base_aggregate_id: BASE,
      base_materialization_id: MATERIALIZATION,
      org_id: ORG,
      business_id: TARGET,
      source_run_id: RUN,
      observed_sources_version: "0.1",
      source_replay_version: "0.1",
      engine_version: "observed-sources-v2:src0.1:obs0.1:store0.1",
      observed_sources: [
        expect.objectContaining({
          domain: "hunnytip.kr",
          responseCount: 2,
          targetResponseCount: 0,
          otherResponseCount: 2,
        }),
      ],
    });
    expect(result.rows[0]?.input_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.rows[0]?.observed_sources_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("fails closed when a base aggregate is missing", () => {
    const base = baseExport();
    base.rows = [];

    expect(() =>
      buildObservedSourcesV2BackfillDryRun(dataset(), base)
    ).toThrow("OBSERVED_BACKFILL_BASE_RUN_COUNT_MISMATCH");
  });

  it("keeps the dry-run script free of database mutation paths", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/observed-sources-v2-backfill-dry-run.ts"),
      "utf8",
    );

    expect(source).not.toContain("@supabase/supabase-js");
    expect(source).not.toMatch(/\bpostgres\s*\(/u);
    expect(source).not.toMatch(/\.insert\s*\(/u);
    expect(source).not.toMatch(/\.upsert\s*\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });

  it("uses a read-only base export pinned to the reviewed Entity Facts version", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "scripts/sql/export-observed-source-v2-backfill-base.sql",
      ),
      "utf8",
    );
    const executable = sql
      .split(/\r?\n/u)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    expect(executable).not.toMatch(
      /\b(?:insert|update|delete|alter|drop|truncate|create)\b/iu,
    );
    expect(sql).toContain("a.fact_version='0.3'");
    expect(sql).toContain("a.aggregate_version='0.1'");
    expect(sql).toContain(
      "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
    );
  });
});
