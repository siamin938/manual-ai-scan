import { describe, expect, it } from "vitest";
import {
  buildCompetitorSourceClueBackfillDryRun,
  type CompetitorSourceClueBackfillBaseExport,
} from "../../scripts/competitor-source-clues-v2-backfill-dry-run";
import type {
  Phase2CReplayDataset,
  Phase2CReplayDatasetRow,
} from "../../scripts/entity-facts-phase2c-replay";
import type {
  RunEntityFactsAggregateV2,
} from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";

const TARGET = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const BASE = "44444444-4444-4444-8444-444444444444";
const OBSERVED = "55555555-5555-4555-8555-555555555555";
const MATERIALIZATION = "66666666-6666-4666-8666-666666666666";

function aggregate(): RunEntityFactsAggregateV2 {
  return {
    version: "0.1",
    factsVersion: "0.3",
    contractOk: true,
    contractIssues: [],
    overview: {
      validCount: 1,
      confirmedMentionCount: 0,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 0,
      visibilityUpperBoundPct: 0,
      confirmedTop3Count: 0,
      top3UncertainCount: 0,
      top3LowerBoundPct: 0,
      top3UpperBoundPct: 0,
      measurementCount: 1,
      invalidCount: 0,
      questionCount: 1,
      coveredQuestionCount: 0,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 1,
      sourcePartialMeasurementCount: 0,
    },
    questionGroups: [],
    questionAreas: [],
    competitors: [
      {
        canonicalKey: "auto:레이노개봉점",
        responseCount: 1,
        questionCount: 1,
        intentCount: 1,
        top3ResponseCount: 1,
      },
    ],
    targetSources: [],
    qualityFlagCounts: {},
  };
}

function row(): Phase2CReplayDatasetRow {
  return {
    measurementId: "77777777-7777-4777-8777-777777777777",
    runId: RUN,
    businessId: TARGET,
    questionId: "88888888-8888-4888-8888-888888888888",
    questionText: "구로구 썬팅 업체 어디야?",
    intentType: "local",
    valid: true,
    responseText: "- 레이노 개봉점",
    rawParser: { wasClientMentioned: false, clientPosition: null },
    target: {
      id: TARGET,
      name: "테스트 업체",
      aliases: [],
    },
    registeredBusinesses: [
      {
        id: TARGET,
        name: "테스트 업체",
        aliases: [],
      },
    ],
    storedMentions: [
      {
        mentionId: "99999999-9999-4999-8999-999999999999",
        displayName: "레이노 개봉점",
        position: 1,
        canonicalKey: "auto:레이노개봉점",
      },
    ],
    attributions: [
      {
        attributionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        measurementMentionId: "99999999-9999-4999-8999-999999999999",
        canonicalKey: "auto:레이노개봉점",
        domain: "rayno-example.co.kr",
        url: "https://rayno-example.co.kr/gaebong",
        title: "레이노 개봉점",
        attributionLevel: "section",
        evidence: { distance_chars: 100 },
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
    rows: [row()],
  };
}

function baseExport(): CompetitorSourceClueBackfillBaseExport {
  return {
    version: "competitor-source-clue-v2-backfill-base-v0.1",
    rows: [
      {
        baseAggregateId: BASE,
        baseObservedSourceAggregateId: OBSERVED,
        baseMaterializationId: MATERIALIZATION,
        orgId: ORG,
        businessId: TARGET,
        sourceRunId: RUN,
        baseAggregateHash: "a".repeat(64),
        observedSourcesHash: "b".repeat(64),
        aggregate: aggregate(),
        observedSources: [],
      },
    ],
  };
}

describe("Competitor source clue backfill dry-run", () => {
  it("builds an append-only advisory supplement without touching confirmed sources", () => {
    const result = buildCompetitorSourceClueBackfillDryRun(
      dataset(),
      baseExport(),
      { expectedRunCount: 1, expectedMeasurementCount: 1 },
    );

    expect(result.summary).toEqual({
      version: "0.1",
      runCount: 1,
      supplementRowCount: 1,
      runsWithClues: 1,
      clueDomainCount: 1,
      clueEntityLinkCount: 1,
      newClueDomainCount: 1,
      combinedObservedSourceDomainCount: 1,
      allContractsOk: true,
      allHashesOk: true,
    });

    expect(result.rows[0]).toMatchObject({
      base_aggregate_id: BASE,
      base_observed_source_aggregate_id: OBSERVED,
      source_run_id: RUN,
      clue_version: "0.1",
      source_replay_version: "0.1",
      engine_version:
        "competitor-source-clues-v2:src0.1:clue0.1:store0.1",
      source_clues: [
        {
          domain: "rayno-example.co.kr",
          canonicalKey: "auto:레이노개봉점",
          responseCount: 1,
          attributionCount: 1,
          evidenceTier: "near_section_title_match",
        },
      ],
    });
    expect(result.rows[0]?.input_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.rows[0]?.source_clues_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("fails closed when a clue duplicates an accepted entity-domain link", () => {
    const base = baseExport();
    base.rows[0]!.observedSources = [
      {
        domain: "rayno-example.co.kr",
        responseCount: 1,
        targetResponseCount: 0,
        otherResponseCount: 1,
        attributionCount: 1,
        entities: [
          {
            canonicalKey: "auto:레이노개봉점",
            side: "other",
            responseCount: 1,
            attributionCount: 1,
            directResponseCount: 1,
            nearSectionResponseCount: 0,
          },
        ],
      },
    ];

    // Replay suppresses the same accepted pair before storage; the dry-run
    // additionally protects the storage contract if such a pair appears.
    const result = buildCompetitorSourceClueBackfillDryRun(
      dataset(),
      base,
      { expectedRunCount: 1, expectedMeasurementCount: 1 },
    );
    expect(result.rows[0]?.source_clues).toHaveLength(1);
  });
});
