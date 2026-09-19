import { describe, expect, it } from "vitest";
import {
  replayHistoricalMeasurementV2,
  type HistoricalMeasurementReplayInputV2,
} from "../../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";

const TARGET_ID = "c9cb39d5-9f04-46ec-8018-14156670446d";

function baseInput(
  overrides: Partial<HistoricalMeasurementReplayInputV2> = {},
): HistoricalMeasurementReplayInputV2 {
  return {
    measurementId: "m1",
    valid: true,
    responseText: "- 카스페이스 구로점",
    rawParser: {
      wasClientMentioned: false,
      clientPosition: null,
    },
    target: {
      id: TARGET_ID,
      name: "카스페이스 구로점",
      aliases: ["카스페이스구로점"],
      fullAddress: "서울 구로구 경인로53나길 27 1층",
      canonicalNaverPlaceId:
        "https://map.naver.com/p/entry/place/1069740203",
      verifiedConcreteOfficialUrls: [],
    },
    registeredBusinesses: [
      {
        id: TARGET_ID,
        name: "카스페이스 구로점",
        aliases: ["카스페이스구로점"],
        fullAddress: "서울 구로구 경인로53나길 27 1층",
        canonicalNaverPlaceId:
          "https://map.naver.com/p/entry/place/1069740203",
        verifiedConcreteOfficialUrls: [],
      },
    ],
    publicIdentities: [],
    storedMentions: [
      {
        mentionId: "mention-target",
        displayName: "카스페이스 구로점",
        matchedAlias: "카스페이스구로점",
        matchedBusinessId: TARGET_ID,
        position: 2,
        canonicalKey: `business:${TARGET_ID}`,
        canonicalDisplayName: "카스페이스 구로점",
      },
    ],
    ...overrides,
  };
}

describe("Historical Measurement Replay Adapter v0.1", () => {
  it("recovers exact registered target truth without raw parser authority", () => {
    const result = replayHistoricalMeasurementV2(baseInput());

    expect(result.facts.targetSeen).toBe(true);
    expect(result.facts.targetBestPosition).toBe(2);
    expect(result.facts.dataQualityFlags).toContain("parser_false_negative");
    expect(
      result.observations.some(
        (observation) =>
          observation.equivalenceDecision === "equivalent" &&
          observation.projectedCanonicalKey === `business:${TARGET_ID}`,
      ),
    ).toBe(true);
  });

  it("recovers an exact registered target mention from prose without raw parser authority", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText:
          "자동차 썬팅 범위 상담이라면 **카스페이스 구로점**부터 문의해보시는 게 괜찮습니다. ([hunnytip.kr](https://www.hunnytip.kr/example))",
        rawParser: {
          wasClientMentioned: false,
          clientPosition: null,
        },
        storedMentions: [],
      }),
    );

    expect(result.facts.targetSeen).toBe(true);
    expect(result.facts.targetBestPosition).toBeNull();
    expect(result.facts.dataQualityFlags).toContain("parser_false_negative");
    expect(result.facts.dataQualityFlags).toContain("target_position_missing");
    expect(
      result.identityDecisions.some(
        (decision) =>
          decision.decision === "confirmed_business" &&
          decision.canonicalBusinessId === TARGET_ID,
      ),
    ).toBe(true);
  });

  it("treats unsupported naver.me storage URLs as unavailable canonical evidence", () => {
    const shortUrl = "https://naver.me/xSBsENP8";
    const result = replayHistoricalMeasurementV2(
      baseInput({
        target: {
          ...baseInput().target,
          canonicalNaverPlaceId: shortUrl,
        },
        registeredBusinesses: [
          {
            ...baseInput().registeredBusinesses[0]!,
            canonicalNaverPlaceId: shortUrl,
          },
        ],
      }),
    );

    expect(result.facts.targetSeen).toBe(true);
    expect(result.facts.dataQualityFlags).not.toContain(
      "equivalent_projection_mismatch",
    );
    const target = result.observations.find(
      (observation) =>
        observation.identityDecision === "confirmed_business" &&
        observation.equivalenceDecision === "equivalent",
    );
    expect(target?.equivalenceReasons).toContain(
      "CURRENT_BUSINESS_ID_MATCH",
    );
  });

  it("keeps the Carspace old public identity unresolved when strong evidence is incomplete", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText: "- 카스페이스 구로 본점",
        storedMentions: [
          {
            mentionId: "mention-old-surface",
            displayName: "카스페이스 구로 본점",
            matchedBusinessId: null,
            position: 1,
            canonicalKey: "auto:카스페이스구로본점",
            canonicalDisplayName: "카스페이스 구로 본점",
          },
        ],
        publicIdentities: [
          {
            name: "카스페이스 구로 본점",
            aliases: ["카스페이스 구로점"],
            fullAddress: "서울 구로구 경인로53나길 27 1층",
            canonicalNaverPlaceId: null,
            verifiedPhone: null,
            verifiedConcreteOfficialUrls: [],
            branchIdentityKey: null,
          },
        ],
      }),
    );

    expect(result.facts.targetSeen).toBeNull();
    expect(result.facts.targetBestPosition).toBeNull();
    expect(result.facts.confirmedOtherEntityKeys).toEqual([]);
    expect(result.facts.dataQualityFlags).toContain("target_identity_unresolved");
    const unresolved = result.observations.find(
      (observation) => observation.identityDecision === "confirmed_business",
    );
    expect(unresolved?.equivalenceDecision).toBe("unresolved");
    expect(unresolved?.targetCandidate.decision).toBe("candidate");
  });

  it("projects a clearly unrelated confirmed branch to the other side without rewriting Phase 2A equivalence", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText: "- 레이노 개봉점",
        storedMentions: [
          {
            mentionId: "mention-rayno",
            displayName: "레이노 개봉점",
            position: 1,
            canonicalKey: "auto:레이노개봉점",
            canonicalDisplayName: "레이노 개봉점",
          },
        ],
      }),
    );

    expect(result.facts.targetSeen).toBe(false);
    expect(result.facts.confirmedOtherEntityKeys).toEqual([
      "auto:레이노개봉점",
    ]);
    expect(result.facts.entityRelations).toEqual([
      expect.objectContaining({
        side: "other",
        canonicalKey: "auto:레이노개봉점",
        equivalenceDecision: "unresolved",
        targetCandidateDecision: "not_candidate",
      }),
    ]);
    const observed = result.observations.find(
      (observation) => observation.identityDecision === "confirmed_business",
    );
    expect(observed?.equivalenceDecision).toBe("unresolved");
    expect(observed?.targetCandidate.decision).toBe("not_candidate");
  });

  it("promotes a public identity with conflicting Naver Place to proven distinct competitor", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText: "- 카스페이스 강남점",
        storedMentions: [
          {
            mentionId: "mention-gangnam",
            displayName: "카스페이스 강남점",
            position: 1,
            canonicalKey: "auto:카스페이스강남점",
            canonicalDisplayName: "카스페이스 강남점",
          },
        ],
        publicIdentities: [
          {
            name: "카스페이스 강남점",
            canonicalNaverPlaceId:
              "https://map.naver.com/p/entry/place/9999999999",
          },
        ],
      }),
    );

    expect(result.facts.targetSeen).toBe(false);
    expect(result.facts.confirmedOtherEntityKeys).toEqual([
      "auto:카스페이스강남점",
    ]);
    const distinct = result.observations.find(
      (observation) => observation.equivalenceDecision === "distinct",
    );
    expect(distinct?.targetCandidate.decision).toBe("not_candidate");
  });

  it("does not choose among conflicting public identity records that share the same surface", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText: "- 카스페이스 구로 본점",
        storedMentions: [
          {
            mentionId: "mention-old-surface",
            displayName: "카스페이스 구로 본점",
            position: 1,
            canonicalKey: "auto:카스페이스구로본점",
          },
        ],
        publicIdentities: [
          {
            name: "카스페이스 구로 본점",
            fullAddress: "서울 구로구 경인로53나길 27 1층",
          },
          {
            name: "카스페이스 구로 본점",
            canonicalNaverPlaceId:
              "https://map.naver.com/p/entry/place/9999999999",
            fullAddress: "서울 다른구 다른로 1",
          },
        ],
      }),
    );

    expect(result.diagnostics.some(
      (item) => item.code === "PUBLIC_IDENTITY_AMBIGUOUS",
    )).toBe(true);
    expect(result.facts.targetSeen).toBeNull();
  });

  it("uses stored mention position rather than raw client_position", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        rawParser: {
          wasClientMentioned: true,
          clientPosition: 5,
        },
      }),
    );

    expect(result.facts.targetBestPosition).toBe(2);
    expect(result.facts.dataQualityFlags).toContain("parser_position_mismatch");
  });

  it("does not invent a canonical competitor key when stored mention mapping has none", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText: "- 카스페이스 강남점",
        storedMentions: [
          {
            mentionId: "mention-gangnam",
            displayName: "카스페이스 강남점",
            position: 1,
            canonicalKey: null,
          },
        ],
        publicIdentities: [
          {
            name: "카스페이스 강남점",
            canonicalNaverPlaceId:
              "https://map.naver.com/p/entry/place/9999999999",
          },
        ],
      }),
    );

    expect(result.facts.targetSeen).toBe(false);
    expect(result.facts.confirmedOtherEntityKeys).toEqual([]);
    expect(result.facts.dataQualityFlags).toContain(
      "distinct_entity_missing_canonical_key",
    );
  });

  it("recovers a registered target subspan from a mixed table primary cell", () => {
    const tireTargetId = "483022a4-30c9-4f6d-9cf4-19a30c2f58d2";
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText:
          "| **타이어프로 봉일천점 / 더타이어샵 봉일천점** | 파주시 조리읍 송비말길 122 | 타이어 판매·장착 |",
        rawParser: {
          wasClientMentioned: true,
          clientPosition: null,
        },
        target: {
          id: tireTargetId,
          name: "타이어프로 봉일천점",
          aliases: ["타이어프로봉일천점"],
        },
        registeredBusinesses: [
          {
            id: tireTargetId,
            name: "타이어프로 봉일천점",
            aliases: ["타이어프로봉일천점"],
          },
        ],
        storedMentions: [],
      }),
    );

    expect(result.facts.targetSeen).toBe(true);
    expect(result.facts.targetBestPosition).toBeNull();
    expect(result.facts.dataQualityFlags).toContain("target_position_missing");
    expect(
      result.identityDecisions.some(
        (decision) =>
          decision.decision === "confirmed_business" &&
          decision.canonicalBusinessId === tireTargetId,
      ),
    ).toBe(true);
  });

  it("recovers a registered target subspan when several businesses share one list item", () => {
    const tireTargetId = "483022a4-30c9-4f6d-9cf4-19a30c2f58d2";
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText:
          "- **금호타이어 운정신도시점·타이어프로 운정점·타이어프로 LG점·타이어프로 봉일천점**은 파주 매장으로 확인됩니다.",
        rawParser: {
          wasClientMentioned: true,
          clientPosition: null,
        },
        target: {
          id: tireTargetId,
          name: "타이어프로 봉일천점",
          aliases: ["타이어프로봉일천점"],
        },
        registeredBusinesses: [
          {
            id: tireTargetId,
            name: "타이어프로 봉일천점",
            aliases: ["타이어프로봉일천점"],
          },
        ],
        storedMentions: [],
      }),
    );

    expect(result.facts.targetSeen).toBe(true);
    expect(
      result.observations.some(
        (observation) =>
          observation.identityDecision === "confirmed_business" &&
          observation.equivalenceDecision === "equivalent",
      ),
    ).toBe(true);
  });

  it("recovers a registered target from a standalone table row without raw rank fallback", () => {
    const tireTargetId = "483022a4-30c9-4f6d-9cf4-19a30c2f58d2";
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText:
          "| **타이어프로 봉일천점** | 파주시 조리읍 송비말길 122 | 브랜드 타이어 교체·점검 |",
        rawParser: {
          wasClientMentioned: true,
          clientPosition: null,
        },
        target: {
          id: tireTargetId,
          name: "타이어프로 봉일천점",
          aliases: ["타이어프로봉일천점"],
        },
        registeredBusinesses: [
          {
            id: tireTargetId,
            name: "타이어프로 봉일천점",
            aliases: ["타이어프로봉일천점"],
          },
        ],
        storedMentions: [],
      }),
    );

    expect(result.facts.targetSeen).toBe(true);
    expect(result.facts.targetBestPosition).toBeNull();
    expect(result.facts.dataQualityFlags).toContain("target_position_missing");
    expect(result.facts.dataQualityFlags).not.toContain("parser_false_positive");
  });

  it("reconnects a persisted auto canonical subspan inside a composite business surface", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText:
          "| **카프랜드 / 성동썬팅멀티샵** | 서울 성동구 용답동 249-1 | 02-2214-4662 |",
        storedMentions: [
          {
            mentionId: "legacy-carpland",
            displayName: "카프랜드",
            position: 2,
            canonicalKey: "auto:카프랜드",
            canonicalDisplayName: "카프랜드",
          },
        ],
        publicIdentities: [],
      }),
    );

    const linked = result.entityMentionLinks.find((item) =>
      item.mentionIds.includes("legacy-carpland"),
    );
    expect(linked).toBeDefined();

    const observation = result.observations.find(
      (item) => item.entityRef === linked?.entityRef,
    );
    expect(observation?.canonicalKey).toBe("auto:카프랜드");
  });

  it("does not use arbitrary stored display-name containment as canonical replay evidence", () => {
    const result = replayHistoricalMeasurementV2(
      baseInput({
        responseText:
          "| **카프랜드 / 성동썬팅멀티샵** | 서울 성동구 용답동 249-1 | 02-2214-4662 |",
        storedMentions: [
          {
            mentionId: "legacy-arbitrary",
            displayName: "카프랜드",
            position: 2,
            canonicalKey: null,
          },
        ],
        publicIdentities: [],
      }),
    );

    expect(
      result.entityMentionLinks.some((item) =>
        item.mentionIds.includes("legacy-arbitrary"),
      ),
    ).toBe(false);
  });

  it("marks source replay as explicitly not evaluated at this stage", () => {
    const result = replayHistoricalMeasurementV2(baseInput());
    expect(result.sourceReplayStatus).toBe("not_evaluated");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SOURCE_REPLAY_NOT_EVALUATED" }),
    );
  });
});
