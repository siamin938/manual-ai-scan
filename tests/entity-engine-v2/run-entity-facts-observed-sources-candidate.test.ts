import { describe, expect, it } from "vitest";
import {
  buildRunEntityFactsObservedSourcesAggregateCandidateV2,
} from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-observed-sources.candidate";
import type { RunEntityFactsAggregateV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import type { RunObservedSourceFactV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-observed-sources";

const TARGET = "c9cb39d5-9f04-46ec-8018-14156670446d";

function aggregate(
  overrides: Partial<RunEntityFactsAggregateV2> = {},
): RunEntityFactsAggregateV2 {
  return {
    version: "0.1",
    factsVersion: "0.3",
    contractOk: true,
    contractIssues: [],
    overview: {
      validCount: 24,
      confirmedMentionCount: 1,
      unresolvedTargetCount: 6,
      visibilityLowerBoundPct: 4.17,
      visibilityUpperBoundPct: 29.17,
      confirmedTop3Count: 1,
      top3UncertainCount: 6,
      top3LowerBoundPct: 4.17,
      top3UpperBoundPct: 29.17,
      measurementCount: 24,
      invalidCount: 0,
      questionCount: 24,
      coveredQuestionCount: 1,
      unresolvedQuestionCount: 6,
      missingQuestionCount: 17,
      sourcePartialMeasurementCount: 6,
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
      {
        canonicalKey: "auto:루마썬팅오류점",
        responseCount: 1,
        questionCount: 1,
        intentCount: 1,
        top3ResponseCount: 1,
      },
    ],
    targetSources: [],
    qualityFlagCounts: {},
    ...overrides,
  };
}

function hunnytip(): RunObservedSourceFactV2[] {
  return [
    {
      domain: "hunnytip.kr",
      responseCount: 2,
      targetResponseCount: 0,
      otherResponseCount: 2,
      attributionCount: 3,
      entities: [
        {
          canonicalKey: "auto:레이노개봉점",
          side: "other",
          responseCount: 2,
          attributionCount: 2,
          directResponseCount: 0,
          nearSectionResponseCount: 2,
        },
        {
          canonicalKey: "auto:루마썬팅오류점",
          side: "other",
          responseCount: 1,
          attributionCount: 1,
          directResponseCount: 0,
          nearSectionResponseCount: 1,
        },
      ],
    },
  ];
}

describe("Observed sources aggregate candidate v0.1", () => {
  it("accepts the Carspace competitor-source shape while keeping targetSources empty", () => {
    const result =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        TARGET,
        aggregate(),
        hunnytip(),
      );

    expect(result.candidateContractOk).toBe(true);
    expect(result.candidateContractIssues).toEqual([]);
    expect(result.targetSources).toEqual([]);
    expect(result.observedSources).toEqual(hunnytip());
  });

  it("fails closed if observed target domains diverge from authoritative targetSources", () => {
    const observed: RunObservedSourceFactV2[] = [
      {
        domain: "target.example",
        responseCount: 1,
        targetResponseCount: 1,
        otherResponseCount: 0,
        attributionCount: 1,
        entities: [
          {
            canonicalKey: `business:${TARGET}`,
            side: "target",
            responseCount: 1,
            attributionCount: 1,
            directResponseCount: 1,
            nearSectionResponseCount: 0,
          },
        ],
      },
    ];

    const result =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        TARGET,
        aggregate(),
        observed,
      );

    expect(result.candidateContractOk).toBe(false);
    expect(result.candidateContractIssues).toContainEqual({
      code: "TARGET_SOURCE_DOMAIN_PARITY_MISMATCH",
    });
  });

  it("fails closed if an observed competitor is not in the authoritative competitor set", () => {
    const observed = hunnytip();
    observed[0]!.entities[0] = {
      ...observed[0]!.entities[0]!,
      canonicalKey: "auto:unknowncompetitor",
    };

    const result =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        TARGET,
        aggregate(),
        observed,
      );

    expect(result.candidateContractOk).toBe(false);
    expect(result.candidateContractIssues).toContainEqual({
      code: "OTHER_ENTITY_NOT_IN_COMPETITORS",
      domain: "hunnytip.kr",
      canonicalKey: "auto:unknowncompetitor",
    });
  });
});
