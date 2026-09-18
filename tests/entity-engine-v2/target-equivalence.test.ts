import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IdentityDecisionV2 } from "../../supabase/functions/_shared/entity-engine-v2/identity-gate";
import {
  evaluateTargetEquivalenceV2,
  type PublicBusinessIdentityV2,
  type TargetBusinessIdentityV2,
  type TargetEquivalenceDecision,
  type TargetEquivalenceEvidenceKind,
} from "../../supabase/functions/_shared/entity-engine-v2/target-equivalence";

type FixtureCase = {
  id: string;
  observedIdentityDecision: IdentityDecisionV2;
  observed: PublicBusinessIdentityV2;
  expectedDecision: TargetEquivalenceDecision;
  expectedEvidence?: TargetEquivalenceEvidenceKind;
};

type Fixture = {
  version: string;
  target: TargetBusinessIdentityV2;
  positives: FixtureCase[];
  negatives: FixtureCase[];
};

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/target-equivalence-phase2a.json", import.meta.url),
    ),
    "utf8",
  ),
) as Fixture;

function evaluate(item: FixtureCase) {
  return evaluateTargetEquivalenceV2({
    target: fixture.target,
    observed: item.observed,
    observedIdentityDecision: item.observedIdentityDecision,
  });
}

describe("Entity Engine v2 Target Equivalence", () => {
  it("loads the Phase 2A fixture contract", () => {
    expect(fixture.version).toBe("0.3");
    expect(fixture.positives).toHaveLength(5);
    expect(fixture.negatives).toHaveLength(21);
  });

  for (const item of fixture.positives) {
    it(`${item.id}: projects equivalent entities only to the current target id`, () => {
      const result = evaluate(item);

      expect(result.decision).toBe(item.expectedDecision);
      expect(result.decision).toBe("equivalent");
      expect(result.projectedCanonicalKey).toBe(
        `business:${fixture.target.businessId}`,
      );

      if (item.expectedEvidence) {
        expect(result.evidenceKinds).toContain(item.expectedEvidence);
      }

      if (
        item.observed.businessId &&
        item.observed.businessId !== fixture.target.businessId
      ) {
        expect(result.projectedCanonicalKey).not.toBe(
          `business:${item.observed.businessId}`,
        );
      }
    });
  }

  for (const item of fixture.negatives) {
    it(`${item.id}: never auto-merges adversarial evidence`, () => {
      const result = evaluate(item);

      expect(result.decision).toBe(item.expectedDecision);
      expect(result.decision).not.toBe("equivalent");
      expect(result.projectedCanonicalKey).toBeNull();
    });
  }

  it("is deterministic and does not mutate its inputs", () => {
    const item = fixture.positives[1]!;
    const input = {
      target: structuredClone(fixture.target),
      observed: structuredClone(item.observed),
      observedIdentityDecision: item.observedIdentityDecision,
    };
    const before = JSON.stringify(input);

    const first = evaluateTargetEquivalenceV2(input);
    const second = evaluateTargetEquivalenceV2(input);

    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("fails closed for every non-confirmed identity decision in the real union", () => {
    const nonConfirmed: IdentityDecisionV2[] = [
      "brand_network",
      "platform",
      "non_business",
      "unresolved",
    ];

    for (const observedIdentityDecision of nonConfirmed) {
      const result = evaluateTargetEquivalenceV2({
        target: fixture.target,
        observed: {
          name: fixture.target.name,
          canonicalNaverPlaceId: fixture.target.canonicalNaverPlaceId,
        },
        observedIdentityDecision,
      });

      expect(result.decision).toBe("unresolved");
      expect(result.projectedCanonicalKey).toBeNull();
      expect(result.reasons).toContain("OBSERVED_ENTITY_NOT_CONFIRMED_BUSINESS");
    }
  });

  it("treats a conflicting canonical Naver Place ID as distinct even when names are similar", () => {
    const result = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        name: fixture.target.name,
        canonicalNaverPlaceId: "7777777777",
      },
      observedIdentityDecision: "confirmed_business",
    });

    expect(result.decision).toBe("distinct");
    expect(result.projectedCanonicalKey).toBeNull();
    expect(result.reasons).toContain("CANONICAL_NAVER_PLACE_ID_CONFLICT");
  });

  it("does not treat a corporate root domain as a concrete official URL", () => {
    const result = evaluateTargetEquivalenceV2({
      target: {
        ...fixture.target,
        verifiedConcreteOfficialUrls: ["https://example.com"],
      },
      observed: {
        name: "카스페이스 다른 지점",
        verifiedConcreteOfficialUrls: ["https://example.com/"],
        branchIdentityKey: fixture.target.branchIdentityKey,
      },
      observedIdentityDecision: "confirmed_business",
    });

    expect(result.decision).toBe("unresolved");
    expect(result.projectedCanonicalKey).toBeNull();
  });

  it("accepts only supported Naver Place hosts and known place-page URL shapes", () => {
    const same = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        name: "카스페이스 구로 본점",
        canonicalNaverPlaceId:
          "https://m.place.naver.com/restaurant/1069740203/home",
      },
      observedIdentityDecision: "confirmed_business",
    });
    expect(same.decision).toBe("equivalent");

    const spoofed = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        name: "카스페이스 구로 본점",
        canonicalNaverPlaceId:
          "https://evil.example/place/1069740203",
      },
      observedIdentityDecision: "confirmed_business",
    });
    expect(spoofed.decision).toBe("unresolved");
  });

  it("preserves URL ports and rejects root pages even when they have query parameters", () => {
    const portMismatch = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        name: "카스페이스 구로 본점",
        verifiedConcreteOfficialUrls: [
          "https://example.com:9443/stores/guro",
        ],
        branchIdentityKey: fixture.target.branchIdentityKey,
      },
      observedIdentityDecision: "confirmed_business",
    });
    expect(portMismatch.decision).toBe("unresolved");

    const rootQuery = evaluateTargetEquivalenceV2({
      target: {
        ...fixture.target,
        verifiedConcreteOfficialUrls: ["https://example.com/?lang=ko"],
      },
      observed: {
        name: "카스페이스 구로 본점",
        verifiedConcreteOfficialUrls: ["https://example.com/?lang=ko"],
        branchIdentityKey: fixture.target.branchIdentityKey,
      },
      observedIdentityDecision: "confirmed_business",
    });
    expect(rootQuery.decision).toBe("unresolved");
  });

  it("compares branchIdentityKey as an opaque exact key", () => {
    const result = evaluateTargetEquivalenceV2({
      target: {
        ...fixture.target,
        verifiedConcreteOfficialUrls: ["https://example.com/store/x"],
        branchIdentityKey: "brand:a-b",
      },
      observed: {
        name: "별도 지점",
        verifiedConcreteOfficialUrls: ["https://example.com/store/x"],
        branchIdentityKey: "brand:ab",
      },
      observedIdentityDecision: "confirmed_business",
    });

    expect(result.decision).toBe("unresolved");
  });

  it("never treats a generic target-owned alias as standalone equivalence evidence", () => {
    const result = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: { name: "공식점" },
      observedIdentityDecision: "confirmed_business",
    });

    expect(result.decision).toBe("unresolved");
    expect(result.projectedCanonicalKey).toBeNull();
  });

  it("lets conflicting or malformed Place evidence outrank an internal current-id match", () => {
    const conflict = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        businessId: fixture.target.businessId,
        name: fixture.target.name,
        canonicalNaverPlaceId: "9999999999",
      },
      observedIdentityDecision: "confirmed_business",
    });

    expect(conflict.decision).toBe("distinct");
    expect(conflict.projectedCanonicalKey).toBeNull();

    const malformed = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        businessId: fixture.target.businessId,
        name: fixture.target.name,
        canonicalNaverPlaceId: "https://evil.example/place/1069740203",
      },
      observedIdentityDecision: "confirmed_business",
    });

    expect(malformed.decision).toBe("unresolved");
    expect(malformed.projectedCanonicalKey).toBeNull();
  });

  it("keeps http and https concrete URLs as different origins", () => {
    const result = evaluateTargetEquivalenceV2({
      target: {
        ...fixture.target,
        verifiedConcreteOfficialUrls: ["https://example.com/store/x"],
        branchIdentityKey: "branch-x",
      },
      observed: {
        name: "같은 표면형",
        verifiedConcreteOfficialUrls: ["http://example.com/store/x"],
        branchIdentityKey: "branch-x",
      },
      observedIdentityDecision: "confirmed_business",
    });

    expect(result.decision).toBe("unresolved");
    expect(result.projectedCanonicalKey).toBeNull();
  });

  it("rejects unsupported and query-only Naver Place URL shapes", () => {
    for (const canonicalNaverPlaceId of [
      "https://m.place.naver.com/anything/1069740203/home",
      "https://m.place.naver.com/?placeId=1069740203",
    ]) {
      const result = evaluateTargetEquivalenceV2({
        target: fixture.target,
        observed: {
          name: fixture.target.name,
          canonicalNaverPlaceId,
        },
        observedIdentityDecision: "confirmed_business",
      });

      expect(result.decision).toBe("unresolved");
      expect(result.projectedCanonicalKey).toBeNull();
    }
  });

});
