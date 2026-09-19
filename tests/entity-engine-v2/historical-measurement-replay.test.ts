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

  it("allows a clearly unrelated confirmed branch to support confident target absence without calling it a competitor", () => {
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
    expect(result.facts.confirmedOtherEntityKeys).toEqual([]);
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

  it("marks source replay as explicitly not evaluated at this stage", () => {
    const result = replayHistoricalMeasurementV2(baseInput());
    expect(result.sourceReplayStatus).toBe("not_evaluated");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SOURCE_REPLAY_NOT_EVALUATED" }),
    );
  });
});
