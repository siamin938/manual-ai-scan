import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateEntityFactsV2MaterializationDryRun,
  type EntityFactsV2DryRunSummary,
} from "../../scripts/entity-facts-v2-materialize-dry-run";
import type { Phase2CMaterializationDataset } from "../../scripts/entity-facts-v2-materialize";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const MEASUREMENT_ID = "44444444-4444-4444-8444-444444444444";
const MEASUREMENT_ID_2 = "44444444-4444-4444-8444-444444444445";
const QUESTION_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_ID_2 = "55555555-5555-4555-8555-555555555556";
const MENTION_ID = "66666666-6666-4666-8666-666666666666";
const MENTION_ID_2 = "66666666-6666-4666-8666-666666666667";

function dataset(): Phase2CMaterializationDataset {
  return {
    version: "entity-facts-phase2c-export-v0.1",
    publicIdentities: [],
    rows: [
      {
        measurementId: MEASUREMENT_ID,
        runId: RUN_ID,
        orgId: ORG_ID,
        businessId: TARGET_ID,
        questionId: QUESTION_ID,
        questionText: "테스트 업체 추천",
        intentType: "local",
        valid: true,
        responseText: "- 테스트 업체",
        rawParser: {
          wasClientMentioned: true,
          clientPosition: 1,
        },
        target: {
          id: TARGET_ID,
          name: "테스트 업체",
          aliases: ["테스트업체"],
          fullAddress: "서울 테스트구 테스트로 1",
          canonicalNaverPlaceId:
            "https://map.naver.com/p/entry/place/1234567890",
          verifiedConcreteOfficialUrls: [],
        },
        registeredBusinesses: [
          {
            id: TARGET_ID,
            name: "테스트 업체",
            aliases: ["테스트업체"],
            fullAddress: "서울 테스트구 테스트로 1",
            canonicalNaverPlaceId:
              "https://map.naver.com/p/entry/place/1234567890",
            verifiedConcreteOfficialUrls: [],
          },
        ],
        storedMentions: [
          {
            mentionId: MENTION_ID,
            displayName: "테스트 업체",
            matchedAlias: "테스트업체",
            matchedBusinessId: TARGET_ID,
            position: 1,
            canonicalKey: `business:${TARGET_ID}`,
          },
        ],
        attributions: [],
        currentCompetitors: [],
        currentTargetSources: [],
      },
    ],
  };
}

describe("Entity Facts v2 materializer dry-run validator", () => {
  it("validates counts, versions, hashes, scopes and replay semantics without persistence", () => {
    const summary: EntityFactsV2DryRunSummary =
      validateEntityFactsV2MaterializationDryRun(dataset(), {
        expectedRunCount: 1,
        expectedMeasurementCount: 1,
        regressionRun: {
          runId: RUN_ID,
          expectedVisibilityLowerPct: 100,
          expectedVisibilityUpperPct: 100,
        },
      });

    expect(summary.runCount).toBe(1);
    expect(summary.measurementCount).toBe(1);
    expect(summary.measurementRowCount).toBe(1);
    expect(summary.aggregateRowCount).toBe(1);
    expect(summary.factVersion).toBe("0.3");
    expect(summary.aggregateVersion).toBe("0.1");
    expect(summary.contractOk).toBe(true);
    expect(summary.semanticMatch).toBe(true);
    expect(summary.hashChecksOk).toBe(true);
    expect(summary.scopeChecksOk).toBe(true);
    expect(summary.duplicateMeasurementIds).toBe(0);
    expect(summary.observedSourceRunCount).toBe(0);
    expect(summary.observedCompetitorSourceRunCount).toBe(0);
    expect(summary.observedSourceDomainCount).toBe(0);
    expect(summary.observedTargetSourceDomainCount).toBe(0);
    expect(summary.observedCompetitorSourceDomainCount).toBe(0);
    expect(summary.sourceLinkedCompetitorCount).toBe(0);
    expect(summary.regressionRun?.matched).toBe(true);
  });

  it("surfaces competitor-linked observed source counts without changing persisted aggregate semantics", () => {
    const input = dataset();
    const base = input.rows[0]!;
    input.rows = [
      {
        ...base,
        measurementId: MEASUREMENT_ID,
        questionId: QUESTION_ID,
        responseText: "- 레이노 개봉점",
        rawParser: {
          wasClientMentioned: false,
          clientPosition: null,
        },
        storedMentions: [
          {
            mentionId: MENTION_ID,
            displayName: "레이노 개봉점",
            position: 1,
            canonicalKey: "auto:레이노개봉점",
          },
        ],
        attributions: [
          {
            attributionId: "source-1",
            measurementMentionId: MENTION_ID,
            canonicalKey: "auto:레이노개봉점",
            domain: "hunnytip.kr",
            url: "https://hunnytip.kr/one",
            attributionLevel: "section",
            evidence: { distance_chars: 120 },
            citationStartIndex: 40,
            entityEndIndex: 10,
          },
        ],
      },
      {
        ...base,
        measurementId: MEASUREMENT_ID_2,
        questionId: QUESTION_ID_2,
        responseText: "- 레이노 개봉점",
        rawParser: {
          wasClientMentioned: false,
          clientPosition: null,
        },
        storedMentions: [
          {
            mentionId: MENTION_ID_2,
            displayName: "레이노 개봉점",
            position: 1,
            canonicalKey: "auto:레이노개봉점",
          },
        ],
        attributions: [
          {
            attributionId: "source-2",
            measurementMentionId: MENTION_ID_2,
            canonicalKey: "auto:레이노개봉점",
            domain: "hunnytip.kr",
            url: "https://hunnytip.kr/two",
            attributionLevel: "section",
            evidence: { distance_chars: 140 },
            citationStartIndex: 42,
            entityEndIndex: 10,
          },
        ],
      },
    ];

    const summary = validateEntityFactsV2MaterializationDryRun(input, {
      expectedRunCount: 1,
      expectedMeasurementCount: 2,
    });

    expect(summary.semanticMatch).toBe(true);
    expect(summary.observedSourceRunCount).toBe(1);
    expect(summary.observedCompetitorSourceRunCount).toBe(1);
    expect(summary.observedSourceDomainCount).toBe(1);
    expect(summary.observedTargetSourceDomainCount).toBe(0);
    expect(summary.observedCompetitorSourceDomainCount).toBe(1);
    expect(summary.sourceLinkedCompetitorCount).toBe(1);
  });

  it("fails closed on an unexpected historical corpus size", () => {
    expect(() =>
      validateEntityFactsV2MaterializationDryRun(dataset(), {
        expectedRunCount: 23,
        expectedMeasurementCount: 428,
      })
    ).toThrow("DRY_RUN_EXPECTED_RUN_COUNT_MISMATCH");
  });

  it("fails closed on duplicate measurement ids before materialization", () => {
    const input = dataset();
    input.rows.push({ ...input.rows[0]! });

    expect(() =>
      validateEntityFactsV2MaterializationDryRun(input)
    ).toThrow("DRY_RUN_DUPLICATE_MEASUREMENT_ID");
  });

  it("contains no database client, provider call, or mutation path", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "scripts/entity-facts-v2-materialize-dry-run.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("@supabase/supabase-js");
    expect(source).not.toMatch(/\bpostgres\s*\(/u);
    expect(source).not.toMatch(/createClient\s*\(/u);
    expect(source).not.toMatch(/\.from\s*\(/u);
    expect(source).not.toMatch(/\.rpc\s*\(/u);
    expect(source).not.toMatch(/\.insert\s*\(/u);
    expect(source).not.toMatch(/\.upsert\s*\(/u);
    expect(source).not.toMatch(
      /\.from\s*\([^)]*\)[\s\S]{0,200}\.(?:insert|upsert|update|delete)\s*\(/u,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/openai|anthropic|gemini|provider/iu);
  });
});
