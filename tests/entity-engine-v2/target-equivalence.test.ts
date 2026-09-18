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
    expect(fixture.version).toBe("0.1");
    expect(fixture.positives).toHaveLength(5);
    expect(fixture.negatives).toHaveLength(8);
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

  it("fails closed for non-confirmed identity decisions", () => {
    const result = evaluateTargetEquivalenceV2({
      target: fixture.target,
      observed: {
        name: fixture.target.name,
        canonicalNaverPlaceId: fixture.target.canonicalNaverPlaceId,
      },
      observedIdentityDecision: "needs_review" as IdentityDecisionV2,
    });

    expect(result.decision).toBe("unresolved");
    expect(result.projectedCanonicalKey).toBeNull();
    expect(result.reasons).toContain("OBSERVED_ENTITY_NOT_CONFIRMED_BUSINESS");
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
});
