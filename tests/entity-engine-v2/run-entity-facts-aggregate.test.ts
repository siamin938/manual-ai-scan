import { describe, expect, it } from "vitest";
import {
  aggregateRunEntityFactsV2,
  type RunMeasurementFactRecordV2,
} from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import {
  MEASUREMENT_ENTITY_FACTS_VERSION,
  type MeasurementEntityFactsV2,
} from "../../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const TARGET_KEY = `business:${TARGET}`;

function fact(
  overrides: Partial<MeasurementEntityFactsV2> = {},
): MeasurementEntityFactsV2 {
  return {
    version: MEASUREMENT_ENTITY_FACTS_VERSION,
    measurementId: "m1",
    valid: true,
    targetSeen: false,
    targetBestPosition: null,
    confirmedOtherEntityKeys: [],
    confirmedOtherEntities: [],
    entityRelations: [],
    targetCitationDomains: [],
    targetAttributionLinks: [],
    sourceFactsStatus: "complete",
    unresolvedIdentityCount: 0,
    unresolvedTargetCandidateCount: 0,
    dataQualityFlags: [],
    ...overrides,
  };
}

function record(
  index: number,
  factOverrides: Partial<MeasurementEntityFactsV2> = {},
  overrides: Partial<RunMeasurementFactRecordV2> = {},
): RunMeasurementFactRecordV2 {
  return {
    fact: fact({
      measurementId: `m${index}`,
      ...factOverrides,
    }),
    questionId: `q${index}`,
    questionText: `질문 ${index}`,
    intentType: "local",
    ...overrides,
  };
}

describe("Phase 2C Run Entity Facts Aggregate v0.1", () => {
  it("represents unresolved target identity as visibility bounds instead of a false negative", () => {
    const records = Array.from({ length: 24 }, (_, index) => {
      if (index === 0) {
        return record(index + 1, {
          targetSeen: true,
          targetBestPosition: 1,
        });
      }
      if (index >= 1 && index <= 5) {
        return record(index + 1, {
          targetSeen: null,
          dataQualityFlags: ["target_identity_unresolved"],
          unresolvedIdentityCount: 1,
          unresolvedTargetCandidateCount: 1,
        });
      }
      return record(index + 1);
    });

    const result = aggregateRunEntityFactsV2(TARGET, records);

    expect(result.contractOk).toBe(true);
    expect(result.overview.validCount).toBe(24);
    expect(result.overview.confirmedMentionCount).toBe(1);
    expect(result.overview.unresolvedTargetCount).toBe(5);
    expect(result.overview.visibilityLowerBoundPct).toBe(4.17);
    expect(result.overview.visibilityUpperBoundPct).toBe(25);
    expect(result.overview.confirmedTop3Count).toBe(1);
    expect(result.overview.top3LowerBoundPct).toBe(4.17);
    expect(result.overview.top3UpperBoundPct).toBe(25);
    expect(result.qualityFlagCounts).toEqual({
      target_identity_unresolved: 5,
    });
  });

  it("keeps question-group truth aligned with the same measurement facts", () => {
    const result = aggregateRunEntityFactsV2(TARGET, [
      record(1, { targetSeen: true, targetBestPosition: 2 }, {
        questionId: "q-local",
        questionText: "지역 추천",
        intentType: "local",
      }),
      record(2, { targetSeen: null }, {
        questionId: "q-review",
        questionText: "후기 확인",
        intentType: "review_quality",
      }),
      record(3, { targetSeen: false }, {
        questionId: "q-price",
        questionText: "가격 비교",
        intentType: "price_value",
      }),
    ]);

    expect(result.questionAreas.map((area) => [area.questionId, area.status])).toEqual([
      ["q-review", "unresolved"],
      ["q-price", "missing"],
      ["q-local", "covered"],
    ]);
    expect(
      Object.fromEntries(
        result.questionGroups.map((group) => [
          group.intentType,
          {
            confirmed: group.confirmedMentionCount,
            unresolved: group.unresolvedTargetCount,
          },
        ]),
      ),
    ).toEqual({
      local: { confirmed: 1, unresolved: 0 },
      price_value: { confirmed: 0, unresolved: 0 },
      review_quality: { confirmed: 0, unresolved: 1 },
    });
  });

  it("aggregates competitors without ever passing through the current target key", () => {
    const result = aggregateRunEntityFactsV2(TARGET, [
      record(1, {
        confirmedOtherEntityKeys: ["auto:other"],
        confirmedOtherEntities: [
          { canonicalKey: "auto:other", bestPosition: 1 },
        ],
      }),
      record(2, {
        confirmedOtherEntityKeys: ["auto:other"],
        confirmedOtherEntities: [
          { canonicalKey: "auto:other", bestPosition: 4 },
        ],
      }),
    ]);

    expect(result.contractOk).toBe(true);
    expect(result.competitors).toEqual([
      {
        canonicalKey: "auto:other",
        responseCount: 2,
        questionCount: 2,
        intentCount: 1,
        top3ResponseCount: 1,
      },
    ]);
  });

  it("blocks a leaked self competitor even when UUID casing differs", () => {
    const result = aggregateRunEntityFactsV2(TARGET, [
      record(1, {
        confirmedOtherEntityKeys: [
          "business:11111111-1111-4111-8111-111111111111",
        ],
        confirmedOtherEntities: [
          {
            canonicalKey:
              "business:11111111-1111-4111-8111-111111111111",
            bestPosition: 1,
          },
        ],
      }),
    ]);

    expect(result.contractOk).toBe(false);
    expect(result.competitors).toEqual([]);
    expect(result.contractIssues).toEqual([
      {
        code: "SELF_COMPETITOR_LEAK",
        measurementId: "m1",
        canonicalKey: TARGET_KEY,
      },
    ]);
  });

  it("keeps complete and partial target source evidence distinguishable", () => {
    const result = aggregateRunEntityFactsV2(TARGET, [
      record(1, {
        targetCitationDomains: ["www.example.com"],
        sourceFactsStatus: "complete",
      }),
      record(2, {
        targetCitationDomains: ["example.com"],
        sourceFactsStatus: "partial",
      }),
      record(3, {
        targetCitationDomains: ["other.example"],
        sourceFactsStatus: "partial",
      }),
    ]);

    expect(result.overview.sourcePartialMeasurementCount).toBe(2);
    expect(result.targetSources).toEqual([
      {
        domain: "example.com",
        responseCount: 2,
        completeResponseCount: 1,
        partialResponseCount: 1,
      },
      {
        domain: "other.example",
        responseCount: 1,
        completeResponseCount: 0,
        partialResponseCount: 1,
      },
    ]);
  });

  it("excludes invalid measurements from metric denominators", () => {
    const result = aggregateRunEntityFactsV2(TARGET, [
      record(1, { targetSeen: true, targetBestPosition: 1 }),
      record(2, {
        valid: false,
        targetSeen: null,
        dataQualityFlags: ["invalid_measurement"],
      }),
    ]);

    expect(result.overview.measurementCount).toBe(2);
    expect(result.overview.validCount).toBe(1);
    expect(result.overview.invalidCount).toBe(1);
    expect(result.overview.visibilityLowerBoundPct).toBe(100);
    expect(result.overview.visibilityUpperBoundPct).toBe(100);
  });

  it("fails the aggregate contract for an invalid target business id", () => {
    const result = aggregateRunEntityFactsV2("not-a-uuid", [record(1)]);
    expect(result.contractOk).toBe(false);
    expect(result.contractIssues).toEqual([
      { code: "INVALID_TARGET_BUSINESS_ID" },
    ]);
  });

  it("is stable under record permutation for aggregate outputs", () => {
    const records = [
      record(1, {
        targetSeen: true,
        targetBestPosition: 2,
        targetCitationDomains: ["b.example"],
      }),
      record(2, {
        targetSeen: null,
        targetCitationDomains: ["a.example"],
        sourceFactsStatus: "partial",
      }),
      record(3, {
        confirmedOtherEntityKeys: ["auto:z"],
        confirmedOtherEntities: [
          { canonicalKey: "auto:z", bestPosition: 3 },
        ],
      }),
    ];

    const first = aggregateRunEntityFactsV2(TARGET, records);
    const second = aggregateRunEntityFactsV2(TARGET, [...records].reverse());

    expect(second).toEqual(first);
  });
});
