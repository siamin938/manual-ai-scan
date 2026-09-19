import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildMeasurementEntityFactsV2,
  type MeasurementEntityFactsInputV2,
  type MeasurementEntityFactQualityFlag,
  type MeasurementEntityObservationV2,
} from "../../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const TARGET_KEY = `business:${TARGET}`;

type Expected = {
  targetSeen: boolean | null;
  targetBestPosition: number | null;
  otherKeys: string[];
  domains: string[];
  flags: MeasurementEntityFactQualityFlag[];
  unresolvedIdentityCount: number;
  unresolvedTargetCandidateCount: number;
  sourceStatus: "complete" | "partial";
};

type FixtureCase = {
  id: string;
  input: MeasurementEntityFactsInputV2;
  expected: Expected;
};

type Fixture = {
  version: string;
  cases: FixtureCase[];
};

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/measurement-entity-facts-phase2b.json", import.meta.url),
    ),
    "utf8",
  ),
) as Fixture;

function sorted<T extends string>(values: T[]): T[] {
  return [...values].sort((a, b) => a.localeCompare(b, "en"));
}

function candidateAssessment(
  decision: "candidate" | "not_candidate" | "unknown",
  complete = true,
) {
  return {
    decision,
    version: complete ? "candidate-v1" : "",
    reasonCodes: complete ? [`FIXTURE_${decision.toUpperCase()}`] : [],
    evidenceKinds: [],
    inputComplete: complete,
  };
}

function entity(
  overrides: Partial<MeasurementEntityObservationV2> = {},
): MeasurementEntityObservationV2 {
  return {
    entityRef: "entity-1",
    identityDecision: "confirmed_business",
    equivalenceDecision: "unresolved",
    equivalenceVersion: "0.3",
    equivalenceReasons: ["FIXTURE"],
    equivalenceEvidenceKinds: [],
    targetCandidate: candidateAssessment("not_candidate"),
    canonicalKey: null,
    projectedCanonicalKey: null,
    position: null,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<MeasurementEntityFactsInputV2> = {},
): MeasurementEntityFactsInputV2 {
  return {
    measurementId: "measurement-1",
    targetBusinessId: TARGET,
    valid: true,
    rawParser: { wasClientMentioned: false, clientPosition: null },
    entities: [],
    attributions: [],
    ...overrides,
  };
}

describe("Measurement Entity Facts v0.2", () => {
  it("loads the Phase 2B fixture contract", () => {
    expect(fixture.version).toBe("0.2");
    expect(fixture.cases.length).toBeGreaterThanOrEqual(14);
  });

  for (const item of fixture.cases) {
    it(item.id, () => {
      const result = buildMeasurementEntityFactsV2(item.input);

      expect(result.measurementId).toBe(item.input.measurementId);
      expect(result.valid).toBe(item.input.valid);
      expect(result.targetSeen).toBe(item.expected.targetSeen);
      expect(result.targetBestPosition).toBe(item.expected.targetBestPosition);
      expect(result.confirmedOtherEntityKeys).toEqual(item.expected.otherKeys);
      expect(result.targetCitationDomains).toEqual(item.expected.domains);
      expect(sorted(result.dataQualityFlags)).toEqual(sorted(item.expected.flags));
      expect(result.unresolvedIdentityCount).toBe(
        item.expected.unresolvedIdentityCount,
      );
      expect(result.unresolvedTargetCandidateCount).toBe(
        item.expected.unresolvedTargetCandidateCount,
      );
      expect(result.sourceFactsStatus).toBe(item.expected.sourceStatus);
    });
  }

  it("never lets raw parser mention or position become customer authority", () => {
    const rawPositive = buildMeasurementEntityFactsV2(
      baseInput({
        rawParser: { wasClientMentioned: true, clientPosition: 1 },
        entities: [
          entity({
            entityRef: "other",
            equivalenceDecision: "distinct",
            canonicalKey: "auto:other",
            position: 4,
          }),
        ],
      }),
    );

    expect(rawPositive.targetSeen).toBe(false);
    expect(rawPositive.targetBestPosition).toBeNull();
    expect(rawPositive.dataQualityFlags).toContain("parser_false_positive");

    const authoritative = buildMeasurementEntityFactsV2(
      baseInput({
        rawParser: { wasClientMentioned: true, clientPosition: 1 },
        entities: [
          entity({
            entityRef: "target",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: 4,
          }),
        ],
      }),
    );

    expect(authoritative.targetSeen).toBe(true);
    expect(authoritative.targetBestPosition).toBe(4);
    expect(authoritative.dataQualityFlags).toContain("parser_position_mismatch");
  });

  it("fails closed and order-independently on conflicting duplicate entityRef", () => {
    const equivalent = entity({
      entityRef: "same-ref",
      equivalenceDecision: "equivalent",
      projectedCanonicalKey: TARGET_KEY,
      targetCandidate: candidateAssessment("candidate"),
      position: 5,
    });
    const distinct = entity({
      entityRef: "same-ref",
      equivalenceDecision: "distinct",
      canonicalKey: "auto:other",
      targetCandidate: candidateAssessment("not_candidate"),
      position: 1,
    });

    const first = buildMeasurementEntityFactsV2(
      baseInput({ entities: [equivalent, distinct] }),
    );
    const second = buildMeasurementEntityFactsV2(
      baseInput({ entities: [distinct, equivalent] }),
    );

    expect(first).toEqual(second);
    expect(first.targetSeen).toBeNull();
    expect(first.confirmedOtherEntityKeys).toEqual([]);
    expect(first.dataQualityFlags).toContain("entity_ref_conflict");
    expect(first.entityRelations).toEqual([
      expect.objectContaining({
        entityRef: "same-ref",
        side: "conflict",
        canonicalKey: null,
      }),
    ]);
  });

  it("silently dedupes only semantically identical duplicate entityRef rows", () => {
    const row = entity({
      entityRef: "same-ref",
      equivalenceDecision: "distinct",
      canonicalKey: "auto:other",
      position: 2,
    });
    const result = buildMeasurementEntityFactsV2(
      baseInput({ entities: [structuredClone(row), structuredClone(row)] }),
    );

    expect(result.targetSeen).toBe(false);
    expect(result.confirmedOtherEntities).toEqual([
      { canonicalKey: "auto:other", bestPosition: 2 },
    ]);
    expect(result.dataQualityFlags).not.toContain("entity_ref_conflict");
  });

  it("treats distinct + current target key as an identity conflict, never confident false", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "bad-self",
            equivalenceDecision: "distinct",
            canonicalKey: TARGET_KEY,
            position: 1,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBeNull();
    expect(result.confirmedOtherEntityKeys).toEqual([]);
    expect(result.dataQualityFlags).toContain("self_key_leakage_blocked");
    expect(result.entityRelations[0]?.side).toBe("conflict");
  });

  it("treats any equivalent projection mismatch as a measurement identity conflict", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "good-target",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: 2,
          }),
          entity({
            entityRef: "bad-target",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey:
              "business:22222222-2222-4222-8222-222222222222",
            targetCandidate: candidateAssessment("candidate"),
            position: 1,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBeNull();
    expect(result.targetBestPosition).toBeNull();
    expect(result.dataQualityFlags).toContain("equivalent_projection_mismatch");
  });

  it("requires versioned complete target-candidate provenance before confident false", () => {
    const unknown = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "maybe-target",
            equivalenceDecision: "unresolved",
            targetCandidate: candidateAssessment("unknown", false),
          }),
        ],
      }),
    );

    expect(unknown.targetSeen).toBeNull();
    expect(unknown.dataQualityFlags).toContain(
      "target_candidate_provenance_incomplete",
    );
    expect(unknown.dataQualityFlags).toContain("target_identity_unresolved");

    const trustedOther = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "known-other",
            equivalenceDecision: "unresolved",
            targetCandidate: candidateAssessment("not_candidate"),
          }),
        ],
      }),
    );

    expect(trustedOther.targetSeen).toBe(false);
  });

  it("returns an authoritative entityRef-to-side projection for downstream consumers", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "target",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: 2,
          }),
          entity({
            entityRef: "other",
            equivalenceDecision: "distinct",
            canonicalKey: "auto:other",
            position: 1,
          }),
          entity({
            entityRef: "maybe",
            equivalenceDecision: "unresolved",
            targetCandidate: candidateAssessment("candidate"),
            position: 3,
          }),
          entity({
            entityRef: "network",
            identityDecision: "brand_network",
            equivalenceDecision: "unresolved",
          }),
        ],
      }),
    );

    expect(result.entityRelations).toEqual([
      expect.objectContaining({ entityRef: "maybe", side: "unresolved" }),
      expect.objectContaining({ entityRef: "network", side: "excluded" }),
      expect.objectContaining({
        entityRef: "other",
        side: "other",
        canonicalKey: "auto:other",
      }),
      expect.objectContaining({
        entityRef: "target",
        side: "target",
        canonicalKey: TARGET_KEY,
      }),
    ]);
  });

  it("fails closed on invalid targetBusinessId", () => {
    for (const targetBusinessId of ["", "   ", "not-a-uuid"]) {
      const result = buildMeasurementEntityFactsV2(
        baseInput({ targetBusinessId }),
      );
      expect(result.targetSeen).toBeNull();
      expect(result.dataQualityFlags).toEqual(["invalid_target_business_id"]);
      expect(result.entityRelations).toEqual([]);
    }
  });

  it("canonicalizes uppercase target business UUID projection without mismatch", () => {
    const upperTarget = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        targetBusinessId: upperTarget,
        entities: [
          entity({
            entityRef: "upper-target",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: `business:${upperTarget}`,
            targetCandidate: candidateAssessment("candidate"),
            position: 1,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBe(true);
    expect(result.entityRelations[0]?.canonicalKey).toBe(
      "business:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(result.dataQualityFlags).not.toContain(
      "equivalent_projection_mismatch",
    );
  });

  it("accepts mixed-case equivalent projection for the lowercase current target", () => {
    const target = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        targetBusinessId: target,
        entities: [
          entity({
            entityRef: "mixed-target",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey:
              "business:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            targetCandidate: candidateAssessment("candidate"),
            position: 2,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBe(true);
    expect(result.targetBestPosition).toBe(2);
    expect(result.dataQualityFlags).not.toContain(
      "equivalent_projection_mismatch",
    );
  });

  it("blocks mixed-case current target business UUID from competitor output", () => {
    const target = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        targetBusinessId: target,
        entities: [
          entity({
            entityRef: "mixed-self",
            equivalenceDecision: "distinct",
            canonicalKey:
              "business:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            targetCandidate: candidateAssessment("not_candidate"),
            position: 1,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBeNull();
    expect(result.confirmedOtherEntityKeys).toEqual([]);
    expect(result.confirmedOtherEntities).toEqual([]);
    expect(result.dataQualityFlags).toContain("self_key_leakage_blocked");
    expect(result.entityRelations[0]?.side).toBe("conflict");
  });

  it("deduplicates other business UUID canonical keys across casing", () => {
    const foreignLower =
      "business:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const foreignUpper =
      "business:BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";

    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "foreign-a",
            equivalenceDecision: "distinct",
            canonicalKey: foreignUpper,
            position: 5,
          }),
          entity({
            entityRef: "foreign-b",
            equivalenceDecision: "distinct",
            canonicalKey: foreignLower,
            position: 2,
          }),
        ],
      }),
    );

    expect(result.confirmedOtherEntityKeys).toEqual([foreignLower]);
    expect(result.confirmedOtherEntities).toEqual([
      { canonicalKey: foreignLower, bestPosition: 2 },
    ]);
  });

  it("treats duplicate entityRef business UUID keys differing only by case as identical", () => {
    const lower =
      "business:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const upper =
      "business:BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";

    const first = entity({
      entityRef: "same-business-ref",
      equivalenceDecision: "distinct",
      canonicalKey: lower,
      position: 2,
    });
    const second = {
      ...structuredClone(first),
      canonicalKey: upper,
    };

    const result = buildMeasurementEntityFactsV2(
      baseInput({ entities: [first, second] }),
    );

    expect(result.targetSeen).toBe(false);
    expect(result.confirmedOtherEntityKeys).toEqual([lower]);
    expect(result.dataQualityFlags).not.toContain("entity_ref_conflict");
  });

  it("does not canonicalize malformed business keys into the current target", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "malformed-business-key",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: "business:not-a-uuid",
            targetCandidate: candidateAssessment("candidate"),
            position: 1,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBeNull();
    expect(result.dataQualityFlags).toContain("equivalent_projection_mismatch");
  });

  it("fails closed and order-independently on conflicting duplicate attributionId", () => {
    const target = entity({
      entityRef: "target",
      equivalenceDecision: "equivalent",
      projectedCanonicalKey: TARGET_KEY,
      targetCandidate: candidateAssessment("candidate"),
      position: 1,
    });
    const a = {
      attributionId: "same-attribution",
      entityRef: "target",
      domain: "a.example",
      url: "https://a.example/page",
      urlValidation: "validated_http_https" as const,
    };
    const b = {
      attributionId: "same-attribution",
      entityRef: "target",
      domain: "b.example",
      url: "https://b.example/page",
      urlValidation: "validated_http_https" as const,
    };

    const first = buildMeasurementEntityFactsV2(
      baseInput({ entities: [target], attributions: [a, b] }),
    );
    const second = buildMeasurementEntityFactsV2(
      baseInput({ entities: [target], attributions: [b, a] }),
    );

    expect(first).toEqual(second);
    expect(first.targetSeen).toBe(true);
    expect(first.targetAttributionLinks).toEqual([]);
    expect(first.targetCitationDomains).toEqual([]);
    expect(first.sourceFactsStatus).toBe("partial");
    expect(first.dataQualityFlags).toContain("attribution_id_conflict");
  });

  it("accepts only validated stored http(s) attribution URLs with matching domain", () => {
    const target = entity({
      entityRef: "target",
      equivalenceDecision: "equivalent",
      projectedCanonicalKey: TARGET_KEY,
      targetCandidate: candidateAssessment("candidate"),
      position: 1,
    });

    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [target],
        attributions: [
          {
            attributionId: "good",
            entityRef: "target",
            domain: "www.example.com",
            url: "https://example.com/page",
            urlValidation: "validated_http_https",
          },
          {
            attributionId: "unverified",
            entityRef: "target",
            domain: "example.com",
            url: "https://example.com/unverified",
            urlValidation: "unverified",
          },
          {
            attributionId: "bad-scheme",
            entityRef: "target",
            domain: "example.com",
            url: "custom://example.com/page",
            urlValidation: "validated_http_https",
          },
          {
            attributionId: "host-mismatch",
            entityRef: "target",
            domain: "example.com",
            url: "https://other.example/page",
            urlValidation: "validated_http_https",
          },
        ],
      }),
    );

    expect(result.targetAttributionLinks).toEqual([
      {
        attributionId: "good",
        entityRef: "target",
        domain: "example.com",
        url: "https://example.com/page",
      },
    ]);
    expect(result.targetCitationDomains).toEqual(["example.com"]);
    expect(result.sourceFactsStatus).toBe("partial");
    expect(result.dataQualityFlags).toEqual(
      expect.arrayContaining([
        "attribution_url_unvalidated",
        "attribution_url_invalid",
        "attribution_domain_mismatch",
      ]),
    );
  });

  it("deduplicates other canonical entities and keeps minimum authoritative position", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "other-a",
            equivalenceDecision: "distinct",
            canonicalKey: "auto:other",
            position: 5,
          }),
          entity({
            entityRef: "other-b",
            equivalenceDecision: "distinct",
            canonicalKey: "auto:other",
            position: 2,
          }),
          entity({
            entityRef: "other-c",
            equivalenceDecision: "distinct",
            canonicalKey: "auto:other",
            position: null,
          }),
        ],
      }),
    );

    expect(result.confirmedOtherEntities).toEqual([
      { canonicalKey: "auto:other", bestPosition: 2 },
    ]);
  });

  it("rejects invalid positions and flags missing authoritative target position", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "target-a",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: 0,
          }),
          entity({
            entityRef: "target-b",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: -1,
          }),
          entity({
            entityRef: "target-c",
            equivalenceDecision: "equivalent",
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: 1.5,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBe(true);
    expect(result.targetBestPosition).toBeNull();
    expect(result.dataQualityFlags).toContain("target_position_missing");
  });

  it("is deterministic, input-immutable, and permutation-stable for non-conflicting sets", () => {
    const input = baseInput({
      entities: [
        entity({
          entityRef: "target",
          equivalenceDecision: "equivalent",
          projectedCanonicalKey: TARGET_KEY,
          targetCandidate: candidateAssessment("candidate"),
          position: 2,
        }),
        entity({
          entityRef: "other",
          equivalenceDecision: "distinct",
          canonicalKey: "auto:other",
          position: 1,
        }),
      ],
    });
    const before = JSON.stringify(input);
    const first = buildMeasurementEntityFactsV2(input);
    const second = buildMeasurementEntityFactsV2({
      ...structuredClone(input),
      entities: [...input.entities].reverse(),
    });

    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("produces the synthetic 24-run contract result without parser authority", () => {
    const facts = Array.from({ length: 24 }, (_, index) => {
      const target = index < 6;
      return buildMeasurementEntityFactsV2(
        baseInput({
          measurementId: `synthetic-${index + 1}`,
          rawParser: {
            wasClientMentioned: index === 0,
            clientPosition: index === 0 ? 1 : null,
          },
          entities: target
            ? [
                entity({
                  entityRef: `target-${index}`,
                  equivalenceDecision: "equivalent",
                  projectedCanonicalKey: TARGET_KEY,
                  targetCandidate: candidateAssessment("candidate"),
                  position: (index % 3) + 1,
                }),
              ]
            : [
                entity({
                  entityRef: `other-${index}`,
                  equivalenceDecision: "distinct",
                  canonicalKey: `auto:other-${index}`,
                  position: 1,
                }),
              ],
        }),
      );
    });

    const valid = facts.filter((fact) => fact.valid);
    const seen = valid.filter((fact) => fact.targetSeen === true);
    const top3 = valid.filter(
      (fact) =>
        fact.targetSeen === true &&
        fact.targetBestPosition !== null &&
        fact.targetBestPosition <= 3,
    );
    const selfCompetitorCount = valid.filter((fact) =>
      fact.confirmedOtherEntityKeys.includes(TARGET_KEY),
    ).length;

    expect(valid).toHaveLength(24);
    expect(seen).toHaveLength(6);
    expect((seen.length / valid.length) * 100).toBe(25);
    expect(top3).toHaveLength(6);
    expect(selfCompetitorCount).toBe(0);
  });

  it("fails closed when confirmed entity equivalence provenance is incomplete", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        entities: [
          entity({
            entityRef: "missing-provenance",
            equivalenceDecision: "equivalent",
            equivalenceVersion: "",
            equivalenceReasons: [],
            projectedCanonicalKey: TARGET_KEY,
            targetCandidate: candidateAssessment("candidate"),
            position: 1,
          }),
        ],
      }),
    );

    expect(result.targetSeen).toBeNull();
    expect(result.dataQualityFlags).toContain("equivalence_provenance_incomplete");
    expect(result.entityRelations[0]?.side).toBe("conflict");
  });

  it("flags attribution rows whose entityRef has no authoritative relation", () => {
    const result = buildMeasurementEntityFactsV2(
      baseInput({
        attributions: [
          {
            attributionId: "orphan-attribution",
            entityRef: "missing-entity",
            domain: "example.com",
            url: "https://example.com/page",
            urlValidation: "validated_http_https",
          },
        ],
      }),
    );

    expect(result.targetAttributionLinks).toEqual([]);
    expect(result.sourceFactsStatus).toBe("partial");
    expect(result.dataQualityFlags).toContain("attribution_entity_ref_missing");
  });

  it("keeps quality flag serialization stable regardless of entity order", () => {
    const projectionMismatch = entity({
      entityRef: "bad-projection",
      equivalenceDecision: "equivalent",
      projectedCanonicalKey:
        "business:22222222-2222-4222-8222-222222222222",
      targetCandidate: candidateAssessment("candidate"),
      position: 1,
    });
    const missingCanonical = entity({
      entityRef: "missing-canonical",
      equivalenceDecision: "distinct",
      canonicalKey: null,
      targetCandidate: candidateAssessment("not_candidate"),
      position: 2,
    });

    const first = buildMeasurementEntityFactsV2(
      baseInput({ entities: [projectionMismatch, missingCanonical] }),
    );
    const second = buildMeasurementEntityFactsV2(
      baseInput({ entities: [missingCanonical, projectionMismatch] }),
    );

    expect(first.dataQualityFlags).toEqual(second.dataQualityFlags);
    expect(first).toEqual(second);
  });

});
