import { describe, expect, it } from "vitest";
import { buildBroadSearchObservation } from "../../src/lib/broad-search-observation.server";

describe("broad search observation v0.2", () => {
  it("summarizes repeated Core competitors without changing target truth", () => {
    const questionIds = Array.from({ length: 8 }, (_, i) => `q${i + 1}`);
    const measurementIds = Array.from({ length: 8 }, (_, i) => `m${i + 1}`);
    const intents = [
      "comparison",
      "discovery",
      "local",
      "price_value",
      "recommendation",
      "review_quality",
      "service",
      "trust",
    ];

    const questions = questionIds.map((id, i) => ({
      id,
      intent_type: intents[i]!,
    }));
    const measurements = measurementIds.map((id, i) => ({
      id,
      question_id: questionIds[i]!,
    }));
    const confirmedOtherByMeasurement: Record<string, string[]> = {
      m1: ["auto:모터큐브", "auto:퀀텀팩토리서초점"],
      m2: ["auto:퀀텀팩토리서초점"],
      m4: ["auto:퀀텀팩토리서초점"],
      m5: ["auto:퀀텀팩토리서초점"],
      m6: ["auto:퀀텀팩토리서초점"],
    };
    const facts = measurementIds.map((measurement_id) => ({
      measurement_id,
      facts: {
        valid: true,
        targetSeen: false,
        targetBestPosition: null,
        confirmedOtherEntityKeys: confirmedOtherByMeasurement[measurement_id] ?? [],
      },
    }));

    const mentionDefs = [
      ["quantum", "auto:퀀텀팩토리서초점", [1, 2, 4, 5, 6], [3, 4, 1, 3, 1]],
      ["kugs", "auto:국스월드", [1, 2, 5, 8], [4, 5, 4, 6]],
      ["moment", "auto:모먼트", [1, 7], [1, 3]],
      ["motorcube", "auto:모터큐브", [1, 2], [2, 2]],
      ["tstyle", "auto:t스타일랩", [7], [1]],
    ] as const;

    const mentions: Array<{
      id: string;
      measurement_id: string;
      matched_business_id: string | null;
      position: number | null;
    }> = [];
    const verifications: Array<{
      measurement_mention_id: string;
      verification_status: string;
      verified_count_as_business: boolean;
    }> = [];
    const canonicalizations: Array<{
      measurement_id: string;
      measurement_mention_id: string;
      canonical_key: string;
    }> = [];

    for (const [prefix, canonicalKey, indexes, positions] of mentionDefs) {
      indexes.forEach((questionIndex, i) => {
        const mentionId = `${prefix}-${i}`;
        const measurementId = measurementIds[questionIndex - 1]!;
        mentions.push({
          id: mentionId,
          measurement_id: measurementId,
          matched_business_id: null,
          position: positions[i] ?? null,
        });
        verifications.push({
          measurement_mention_id: mentionId,
          verification_status: "confirmed_business",
          verified_count_as_business: true,
        });
        canonicalizations.push({
          measurement_id: measurementId,
          measurement_mention_id: mentionId,
          canonical_key: canonicalKey,
        });
      });
    }

    const attributions = [
      ...[1, 2, 4, 5, 6].map((i, index) => ({
        measurement_id: measurementIds[i - 1]!,
        canonical_key: "auto:퀀텀팩토리서초점",
        domain: "carcarescenter.com",
        attribution_level: index === 0 ? "direct" : "section",
      })),
      ...[1, 2, 5, 8].map((i, index) => ({
        measurement_id: measurementIds[i - 1]!,
        canonical_key: "auto:국스월드",
        domain: "kugs.net",
        attribution_level: index === 0 ? "direct" : "section",
      })),
      ...[1, 7].map((i, index) => ({
        measurement_id: measurementIds[i - 1]!,
        canonical_key: "auto:모먼트",
        domain: "momentcarcare.co.kr",
        attribution_level: index === 0 ? "direct" : "section",
      })),
      ...[1, 2].map((i, index) => ({
        measurement_id: measurementIds[i - 1]!,
        canonical_key: "auto:모터큐브",
        domain: "motorcube.co.kr",
        attribution_level: index === 0 ? "direct" : "section",
      })),
      {
        measurement_id: measurementIds[6]!,
        canonical_key: "auto:t스타일랩",
        domain: "tstylelab.com",
        attribution_level: "direct",
      },
    ];

    const result = buildBroadSearchObservation({
      businessId: "ebeb09e9-5fcc-467d-ac48-68cb197727ac",
      questions,
      measurements,
      mentions,
      verifications,
      canonicalizations,
      attributions,
      facts,
      finalCompetitorNamesByCanonicalKey: {
        "auto:퀀텀팩토리서초점": "퀀텀팩토리 서초점",
        "auto:국스월드": "국스월드",
        "auto:모먼트카케어": "모먼트 카케어",
        "auto:모터큐브": "모터큐브",
        "auto:t스타일랩": "T 스타일 랩",
      },
      baseV2CompetitorCanonicalKeys: [
        "auto:퀀텀팩토리서초점",
        "auto:모먼트카케어",
        "auto:모터큐브",
      ],
      promotedCompetitorCanonicalKeys: ["auto:국스월드", "auto:t스타일랩"],
      mergeCanonicalAliases: {},
    });

    expect(result).toMatchObject({
      version: "0.2",
      validCount: 8,
      targetConfirmedCount: 0,
      targetTop3Count: 0,
      targetIndependentSourceResponseCount: 0,
    });
    expect(result.repeatedCompetitors).toEqual([
      expect.objectContaining({
        name: "퀀텀팩토리 서초점",
        responseCount: 5,
        questionCount: 5,
        top3ResponseCount: 4,
        strongestIndependentSource: {
          domain: "carcarescenter.com",
          responseCount: 5,
          directAttributionCount: 1,
        },
      }),
      expect.objectContaining({
        name: "국스월드",
        responseCount: 4,
        questionCount: 4,
        top3ResponseCount: 0,
        strongestIndependentSource: {
          domain: "kugs.net",
          responseCount: 4,
          directAttributionCount: 1,
        },
      }),
    ]);
    expect(result.repeatedCompetitors.some((row) => row.name === "모터큐브")).toBe(false);
    expect(result.repeatedCompetitors.some((row) => row.name === "T 스타일 랩")).toBe(false);
    expect(result.repeatedCompetitors.some((row) => row.name.includes("모먼트"))).toBe(false);

    expect(result.singleObservationCompetitors).toEqual([
      expect.objectContaining({
        name: "모터큐브",
        responseCount: 1,
        top3ResponseCount: 1,
        strongestIndependentSource: {
          domain: "motorcube.co.kr",
          responseCount: 1,
          directAttributionCount: 1,
        },
      }),
      expect.objectContaining({
        name: "T 스타일 랩",
        responseCount: 1,
        top3ResponseCount: 1,
        strongestIndependentSource: {
          domain: "tstylelab.com",
          responseCount: 1,
          directAttributionCount: 1,
        },
      }),
    ]);
    expect(result.observedCompetitorCount).toBe(4);
    expect(result.independentWebLinkedCompetitorCount).toBe(4);
    expect(result.repeatedIndependentWebLinkedCompetitorCount).toBe(2);
    expect(result.sourcePatterns).toContainEqual({
      key: "independent_web",
      label: "독립 웹",
      competitorCount: 4,
    });
  });

  it("counts target independent web evidence separately from visibility", () => {
    const result = buildBroadSearchObservation({
      businessId: "11111111-1111-4111-8111-111111111111",
      questions: [{ id: "q1", intent_type: "service" }, { id: "q2", intent_type: "trust" }],
      measurements: [
        { id: "m1", question_id: "q1" },
        { id: "m2", question_id: "q2" },
      ],
      mentions: [],
      verifications: [],
      canonicalizations: [],
      attributions: [
        {
          measurement_id: "m1",
          canonical_key: "business:11111111-1111-4111-8111-111111111111",
          domain: "example-business.co.kr",
          attribution_level: "direct",
        },
        {
          measurement_id: "m2",
          canonical_key: "business:11111111-1111-4111-8111-111111111111",
          domain: "pf.kakao.com",
          attribution_level: "direct",
        },
      ],
      facts: [
        {
          measurement_id: "m1",
          facts: { valid: true, targetSeen: true, targetBestPosition: 2 },
        },
        {
          measurement_id: "m2",
          facts: { valid: true, targetSeen: false, targetBestPosition: null },
        },
      ],
      finalCompetitorNamesByCanonicalKey: {},
      baseV2CompetitorCanonicalKeys: [],
      promotedCompetitorCanonicalKeys: [],
      mergeCanonicalAliases: {},
    });

    expect(result.targetConfirmedCount).toBe(1);
    expect(result.targetTop3Count).toBe(1);
    expect(result.targetIndependentSourceResponseCount).toBe(1);
    expect(result.targetIndependentSources).toEqual([
      {
        domain: "example-business.co.kr",
        responseCount: 1,
        directAttributionCount: 1,
      },
    ]);
  });
});

it("counts the materialized per-answer business even when legacy mention extraction missed it", () => {
  const key = "auto:테스트정비";
  const result = buildBroadSearchObservation({
    businessId: "target", questions: [{id:"q",intent_type:"local"}],
    measurements: [{id:"m",question_id:"q"}], mentions: [], verifications: [], canonicalizations: [],
    attributions: [], facts: [{ measurement_id: "m", facts: {valid:true,targetSeen:false,
      confirmedOtherEntityKeys:[key],confirmedOtherEntities:[{canonicalKey:key,bestPosition:2}]}}],
    finalCompetitorNamesByCanonicalKey:{[key]:"테스트 정비"},baseV2CompetitorCanonicalKeys:[key],
    promotedCompetitorCanonicalKeys:[],mergeCanonicalAliases:{},
  });
  expect(result.singleObservationCompetitors).toMatchObject([{name:"테스트 정비",responseCount:1,top3ResponseCount:1}]);
  expect(result.targetConfirmedCount).toBe(0);
});
