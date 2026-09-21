import { describe, expect, it } from "vitest";
import {
  replayRunSourcesV2,
  type ReplayRawAttributionV2,
  type RunSourceReplayMeasurementInputV2,
} from "../../supabase/functions/_shared/entity-engine-v2/run-source-replay";
import {
  buildMeasurementEntityFactsV2,
  type MeasurementEntityObservationV2,
} from "../../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const TARGET_KEY = `business:${TARGET}`;

function candidate(decision: "candidate" | "not_candidate" = "candidate") {
  return {
    decision,
    version: "candidate-v1",
    reasonCodes: ["TEST"],
    evidenceKinds: [],
    inputComplete: true,
  };
}

function targetObservation(
  overrides: Partial<MeasurementEntityObservationV2> = {},
): MeasurementEntityObservationV2 {
  return {
    entityRef: "target-ref",
    identityDecision: "confirmed_business",
    equivalenceDecision: "equivalent",
    equivalenceVersion: "0.3",
    equivalenceReasons: ["TEST_EQ"],
    equivalenceEvidenceKinds: ["exact_current_business_id"],
    targetCandidate: candidate(),
    projectedCanonicalKey: TARGET_KEY,
    canonicalKey: TARGET_KEY,
    position: 1,
    ...overrides,
  };
}

function unresolvedObservation(): MeasurementEntityObservationV2 {
  return {
    entityRef: "maybe-ref",
    identityDecision: "confirmed_business",
    equivalenceDecision: "unresolved",
    equivalenceVersion: "0.3",
    equivalenceReasons: ["TEST_UNRESOLVED"],
    equivalenceEvidenceKinds: [],
    targetCandidate: candidate("candidate"),
    canonicalKey: "auto:maybe-target",
    projectedCanonicalKey: null,
    position: 1,
  };
}

function otherObservation(): MeasurementEntityObservationV2 {
  return {
    entityRef: "other-ref",
    identityDecision: "confirmed_business",
    equivalenceDecision: "distinct",
    equivalenceVersion: "0.3",
    equivalenceReasons: ["TEST_DISTINCT"],
    equivalenceEvidenceKinds: [],
    targetCandidate: candidate("not_candidate"),
    canonicalKey: "auto:other",
    projectedCanonicalKey: null,
    position: 2,
  };
}

function rawAttribution(
  overrides: Partial<ReplayRawAttributionV2> = {},
): ReplayRawAttributionV2 {
  return {
    attributionId: "a1",
    measurementMentionId: null,
    canonicalKey: TARGET_KEY,
    domain: "example.com",
    url: "https://example.com/page",
    attributionLevel: "direct",
    evidence: {},
    citationStartIndex: null,
    entityEndIndex: null,
    ...overrides,
  };
}

function measurement(
  id: string,
  observations: MeasurementEntityObservationV2[],
  attributions: ReplayRawAttributionV2[],
  mentionLinks: Array<{ entityRef: string; mentionIds: string[] }> = [],
): RunSourceReplayMeasurementInputV2 {
  const preliminaryFacts = buildMeasurementEntityFactsV2({
    measurementId: id,
    targetBusinessId: TARGET,
    valid: true,
    rawParser: { wasClientMentioned: false, clientPosition: null },
    entities: observations,
    attributions: [],
  });
  return {
    measurementId: id,
    responseText: "업체 추천",
    targetBusinessId: TARGET,
    valid: true,
    rawParser: { wasClientMentioned: false, clientPosition: null },
    observations,
    preliminaryFacts,
    entityMentionLinks: mentionLinks,
    attributions,
  };
}

describe("Phase 2C Run Source Replay v0.1", () => {
  it("maps a null-mention direct target attribution through the confirmed target canonical relation", () => {
    const result = replayRunSourcesV2([
      measurement("m1", [targetObservation()], [rawAttribution()]),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.acceptedAttributions).toEqual([
      expect.objectContaining({
        measurementId: "m1",
        entityRef: "target-ref",
        side: "target",
        domain: "example.com",
        evidenceTier: "direct",
      }),
    ]);
    expect(result.targetReferenceSources).toEqual([]);
    expect(result.factsByMeasurement[0]?.facts.targetCitationDomains).toEqual([
      "example.com",
    ]);
    expect(result.factsByMeasurement[0]?.facts.sourceFactsStatus).toBe(
      "complete",
    );
  });

  it("keeps an actionable attribution partial when its linked entity remains unresolved", () => {
    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [unresolvedObservation()],
        [
          rawAttribution({
            measurementMentionId: "mention-old",
            canonicalKey: "auto:maybe-target",
          }),
        ],
        [{ entityRef: "maybe-ref", mentionIds: ["mention-old"] }],
      ),
    ]);

    expect(result.acceptedAttributions).toEqual([]);
    expect(result.targetReferenceSources).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "ATTRIBUTION_ENTITY_MAPPING_UNRESOLVED",
      }),
    ]);
    const facts = result.factsByMeasurement[0]!.facts;
    expect(facts.targetCitationDomains).toEqual([]);
    expect(facts.sourceFactsStatus).toBe("partial");
    expect(facts.dataQualityFlags).toContain("attribution_entity_ref_missing");
  });

  it("accepts near-section target evidence only after two-response support", () => {
    const section = (id: string): ReplayRawAttributionV2 =>
      rawAttribution({
        attributionId: id,
        attributionLevel: "section",
        evidence: { distance_chars: 120 },
      });

    const one = replayRunSourcesV2([
      measurement("m1", [targetObservation()], [section("a1")]),
    ]);
    expect(one.acceptedAttributions).toEqual([]);
    expect(one.targetReferenceSources).toEqual([
      {
        domain: "example.com",
        responseCount: 1,
        evidenceTier: "near_section",
      },
    ]);
    expect(one.factsByMeasurement[0]?.facts.targetCitationDomains).toEqual([]);

    const two = replayRunSourcesV2([
      measurement("m1", [targetObservation()], [section("a1")]),
      measurement("m2", [targetObservation()], [section("a2")]),
    ]);
    expect(two.targetReferenceSources).toEqual([]);
    expect(two.factsByMeasurement.map((item) => item.facts.targetCitationDomains)).toEqual([
      ["example.com"],
      ["example.com"],
    ]);
  });

  it("keeps a single confirmed-target near-section source as a reference clue", () => {
    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [targetObservation()],
        [
          rawAttribution({
            attributionId: "hunnytip-target",
            domain: "hunnytip.kr",
            url: "https://www.hunnytip.kr/guro-tinting",
            attributionLevel: "section",
            evidence: { distance_chars: 151 },
          }),
        ],
      ),
    ]);

    expect(
      result.acceptedAttributions.filter((item) => item.side === "target"),
    ).toEqual([]);
    expect(result.targetReferenceSources).toEqual([
      {
        domain: "hunnytip.kr",
        responseCount: 1,
        evidenceTier: "near_section",
      },
    ]);
    expect(result.factsByMeasurement[0]?.facts.targetCitationDomains).toEqual([]);
  });

  it("keeps a single exact-title competitor near-section source as a clue", () => {
    const competitor = {
      ...otherObservation(),
      canonicalKey: "auto:실리스코리아",
    };

    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [competitor],
        [
          rawAttribution({
            attributionId: "clue-1",
            measurementMentionId: "mention-sillis",
            canonicalKey: "auto:실리스코리아",
            domain: "silliskorea.com",
            url: "https://silliskorea.com/",
            title: "실리스코리아",
            attributionLevel: "section",
            evidence: { distance_chars: 97 },
          }),
        ],
        [{ entityRef: "other-ref", mentionIds: ["mention-sillis"] }],
      ),
    ]);

    expect(result.acceptedAttributions).toEqual([]);
    expect(result.competitorSourceClueVersion).toBe("0.1");
    expect(result.competitorSourceClues).toEqual([
      {
        domain: "silliskorea.com",
        canonicalKey: "auto:실리스코리아",
        responseCount: 1,
        attributionCount: 1,
        evidenceTier: "near_section_title_match",
      },
    ]);
    expect(result.targetReferenceSources).toEqual([]);
  });

  it("does not create a competitor clue from a partial or different title surface", () => {
    const competitor = {
      ...otherObservation(),
      canonicalKey: "auto:카페인w남양주점",
    };

    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [competitor],
        [
          rawAttribution({
            attributionId: "clue-noise",
            measurementMentionId: "mention-caffeine",
            canonicalKey: "auto:카페인w남양주점",
            domain: "ppf.co.kr",
            url: "https://ppf.co.kr/namyangju",
            title: "경기 남양주 : 테크닉 남양주점 – PPF",
            attributionLevel: "section",
            evidence: { distance_chars: 100 },
          }),
        ],
        [{ entityRef: "other-ref", mentionIds: ["mention-caffeine"] }],
      ),
    ]);

    expect(result.acceptedAttributions).toEqual([]);
    expect(result.competitorSourceClues).toEqual([]);
  });

  it("does not create a clue from canonical-key fallback without an exact mention link", () => {
    const competitor = {
      ...otherObservation(),
      canonicalKey: "auto:모터큐브",
    };

    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [competitor],
        [
          rawAttribution({
            attributionId: "fallback-only",
            measurementMentionId: null,
            canonicalKey: "auto:모터큐브",
            domain: "motorcube.co.kr",
            url: "https://motorcube.co.kr/",
            title: "모터큐브 20년 수입차 전문",
            attributionLevel: "section",
            evidence: { distance_chars: 100 },
          }),
        ],
      ),
    ]);

    expect(result.acceptedAttributions).toEqual([]);
    expect(result.competitorSourceClues).toEqual([]);
  });

  it("promotes repeated near-section competitor evidence to accepted source instead of clue", () => {
    const competitor = {
      ...otherObservation(),
      canonicalKey: "auto:레이노개봉점",
    };
    const section = (id: string, mentionId: string): ReplayRawAttributionV2 =>
      rawAttribution({
        attributionId: id,
        measurementMentionId: mentionId,
        canonicalKey: "auto:레이노개봉점",
        domain: "hunnytip.kr",
        url: `https://hunnytip.kr/${id}`,
        title: "레이노 개봉점",
        attributionLevel: "section",
        evidence: { distance_chars: 120 },
      });

    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [competitor],
        [section("a1", "mention-1")],
        [{ entityRef: "other-ref", mentionIds: ["mention-1"] }],
      ),
      measurement(
        "m2",
        [competitor],
        [section("a2", "mention-2")],
        [{ entityRef: "other-ref", mentionIds: ["mention-2"] }],
      ),
    ]);

    expect(result.acceptedAttributions).toHaveLength(2);
    expect(result.competitorSourceClues).toEqual([]);
  });

  it("does not turn competitor attribution into a target source", () => {
    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [otherObservation()],
        [
          rawAttribution({
            measurementMentionId: "mention-other",
            canonicalKey: "auto:other",
          }),
        ],
        [{ entityRef: "other-ref", mentionIds: ["mention-other"] }],
      ),
    ]);

    expect(result.acceptedAttributions[0]?.side).toBe("other");
    expect(result.targetReferenceSources).toEqual([]);
    expect(result.factsByMeasurement[0]?.facts.targetCitationDomains).toEqual([]);
  });

  it("excludes infrastructure hosts from actionability", () => {
    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [targetObservation()],
        [
          rawAttribution({
            domain: "bucket.s3.amazonaws.com",
            url: "https://bucket.s3.amazonaws.com/file",
          }),
        ],
      ),
    ]);
    expect(result.acceptedAttributions).toEqual([]);
    expect(result.targetReferenceSources).toEqual([]);
    expect(result.factsByMeasurement[0]?.facts.targetCitationDomains).toEqual([]);
  });

  it("excludes near-section news evidence", () => {
    const result = replayRunSourcesV2([
      measurement(
        "m1",
        [targetObservation()],
        [
          rawAttribution({
            domain: "newsis.com",
            url: "https://newsis.com/article",
            attributionLevel: "section",
            evidence: { distance_chars: 100 },
          }),
        ],
      ),
      measurement(
        "m2",
        [targetObservation()],
        [
          rawAttribution({
            attributionId: "a2",
            domain: "newsis.com",
            url: "https://newsis.com/article2",
            attributionLevel: "section",
            evidence: { distance_chars: 100 },
          }),
        ],
      ),
    ]);
    expect(result.acceptedAttributions).toEqual([]);
    expect(result.targetReferenceSources).toEqual([]);
  });

  it("excludes comparative-target attribution context", () => {
    const result = replayRunSourcesV2([
      {
        ...measurement("m1", [targetObservation()], [
          rawAttribution({
            // "업체A" occupies indices [0, 3); comparative wording begins
            // immediately after that end-exclusive entity boundary.
            entityEndIndex: 3,
            citationStartIndex: 14,
          }),
        ]),
        responseText: "업체A 보다 업체B가 낫다",
      },
    ]);
    expect(result.acceptedAttributions).toEqual([]);
    expect(result.targetReferenceSources).toEqual([]);
  });

  it("is deterministic under measurement and attribution ordering", () => {
    const firstMeasurement = measurement(
      "m1",
      [targetObservation()],
      [
        rawAttribution({ attributionId: "b" }),
        rawAttribution({
          attributionId: "a",
          domain: "other.example",
          url: "https://other.example/page",
        }),
      ],
    );
    const secondMeasurement = measurement(
      "m2",
      [targetObservation()],
      [rawAttribution({ attributionId: "c" })],
    );

    const first = replayRunSourcesV2([
      firstMeasurement,
      secondMeasurement,
    ]);
    const second = replayRunSourcesV2([
      {
        ...secondMeasurement,
        attributions: [...secondMeasurement.attributions].reverse(),
      },
      {
        ...firstMeasurement,
        attributions: [...firstMeasurement.attributions].reverse(),
      },
    ]);

    expect(second).toEqual(first);
  });
});
