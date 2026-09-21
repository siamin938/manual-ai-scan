import { describe, expect, it } from "vitest";
import {
  buildRunEntityFactsObservedSourcesAggregateCandidateV2,
} from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-observed-sources.candidate";
import type { RunEntityFactsAggregateV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import type { RunObservedSourceFactV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-observed-sources";
import {
  buildEntityFactsV2ObservedSourcesReadCandidate,
} from "../../src/lib/entity-facts-v2-read-gateway.observed-sources-candidate";

const TARGET = "c9cb39d5-9f04-46ec-8018-14156670446d";

function baseAggregate(): RunEntityFactsAggregateV2 {
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
  };
}

function observedSources(): RunObservedSourceFactV2[] {
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

describe("Observed sources Read Gateway candidate", () => {
  it("projects the Carspace hunnytip evidence into customer-safe source rows", () => {
    const aggregateCandidate =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        TARGET,
        baseAggregate(),
        observedSources(),
      );

    const result = buildEntityFactsV2ObservedSourcesReadCandidate({
      business: {
        id: TARGET,
        name: "카스페이스 구로점",
        category: "썬팅/신차패키지",
        region: "서울특별시",
        city: "구로구",
      },
      aggregateCandidate,
      registeredCompetitorNames: {},
      autoCompetitorEvidence: {
        "auto:레이노개봉점": [
          { label: "레이노 개봉점", priority: 1 },
        ],
        "auto:루마썬팅오류점": [
          { label: "루마썬팅 오류점", priority: 1 },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      version: "0.1",
      observedSources: [
        {
          domain: "hunnytip.kr",
          responseCount: 2,
          targetResponseCount: 0,
          competitorResponseCount: 2,
          attributionCount: 3,
          linkedEntities: [
            {
              name: "레이노 개봉점",
              isTarget: false,
              responseCount: 2,
              attributionCount: 2,
              directResponseCount: 0,
              nearSectionResponseCount: 2,
            },
            {
              name: "루마썬팅 오류점",
              isTarget: false,
              responseCount: 1,
              attributionCount: 1,
              directResponseCount: 0,
              nearSectionResponseCount: 1,
            },
          ],
        },
      ],
    });

    expect(JSON.stringify(result)).not.toContain("canonicalKey");
    expect(JSON.stringify(result)).not.toContain("auto:");
  });

  it("keeps target and competitor labels distinct on a shared source", () => {
    const competitorId = "22222222-2222-4222-8222-222222222222";
    const aggregate = baseAggregate();
    aggregate.competitors = [
      {
        canonicalKey: `business:${competitorId}`,
        responseCount: 1,
        questionCount: 1,
        intentCount: 1,
        top3ResponseCount: 1,
      },
    ];
    aggregate.targetSources = [
      {
        domain: "shared.example",
        responseCount: 1,
        completeResponseCount: 1,
        partialResponseCount: 0,
      },
    ];

    const candidate =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        TARGET,
        aggregate,
        [
          {
            domain: "shared.example",
            responseCount: 2,
            targetResponseCount: 1,
            otherResponseCount: 1,
            attributionCount: 2,
            entities: [
              {
                canonicalKey: `business:${TARGET}`,
                side: "target",
                responseCount: 1,
                attributionCount: 1,
                directResponseCount: 1,
                nearSectionResponseCount: 0,
              },
              {
                canonicalKey: `business:${competitorId}`,
                side: "other",
                responseCount: 1,
                attributionCount: 1,
                directResponseCount: 1,
                nearSectionResponseCount: 0,
              },
            ],
          },
        ],
      );

    const result = buildEntityFactsV2ObservedSourcesReadCandidate({
      business: {
        id: TARGET,
        name: "카스페이스 구로점",
        category: null,
        region: null,
        city: null,
      },
      aggregateCandidate: candidate,
      registeredCompetitorNames: {
        [competitorId]: "경쟁업체 A",
      },
      autoCompetitorEvidence: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observedSources[0]?.linkedEntities).toEqual([
      expect.objectContaining({
        name: "카스페이스 구로점",
        isTarget: true,
      }),
      expect.objectContaining({
        name: "경쟁업체 A",
        isTarget: false,
      }),
    ]);
  });

  it("fails closed instead of exposing an auto key when display evidence is missing", () => {
    const aggregateCandidate =
      buildRunEntityFactsObservedSourcesAggregateCandidateV2(
        TARGET,
        baseAggregate(),
        observedSources(),
      );

    const result = buildEntityFactsV2ObservedSourcesReadCandidate({
      business: {
        id: TARGET,
        name: "카스페이스 구로점",
        category: null,
        region: null,
        city: null,
      },
      aggregateCandidate,
      registeredCompetitorNames: {},
      autoCompetitorEvidence: {},
    });

    expect(result).toEqual({
      ok: false,
      error: "UNRESOLVED_DISPLAY_EVIDENCE",
      canonicalKey: "auto:레이노개봉점",
    });
  });
});
