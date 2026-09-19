import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildMeasurementEntityFactsV2,
  type MeasurementEntityFactsInputV2,
  type MeasurementEntityFactQualityFlag,
} from "../../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";

type Expected = {
  targetSeen: boolean | null;
  targetBestPosition: number | null;
  otherKeys: string[];
  domains: string[];
  flags: MeasurementEntityFactQualityFlag[];
  unresolvedIdentityCount: number;
  unresolvedTargetCandidateCount: number;
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

describe("Measurement Entity Facts v0.1", () => {
  it("loads the Phase 2B fixture contract", () => {
    expect(fixture.version).toBe("0.1");
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
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
    });
  }

  it("never lets the raw parser flag force authoritative targetSeen", () => {
    const base: MeasurementEntityFactsInputV2 = {
      measurementId: "raw-authority",
      targetBusinessId: "target-1",
      valid: true,
      rawParser: { wasClientMentioned: false, clientPosition: null },
      entities: [
        {
          entityRef: "other",
          identityDecision: "confirmed_business",
          equivalenceDecision: "distinct",
          isTargetCandidate: false,
          canonicalKey: "auto:other",
          position: 1,
        },
      ],
    };

    const rawFalse = buildMeasurementEntityFactsV2(base);
    const rawTrue = buildMeasurementEntityFactsV2({
      ...base,
      rawParser: { wasClientMentioned: true, clientPosition: 1 },
    });

    expect(rawFalse.targetSeen).toBe(false);
    expect(rawTrue.targetSeen).toBe(false);
    expect(rawTrue.dataQualityFlags).toContain("parser_false_positive");
  });

  it("recovers authoritative target presence even when raw parser missed it", () => {
    const result = buildMeasurementEntityFactsV2({
      measurementId: "false-negative",
      targetBusinessId: "target-1",
      valid: true,
      rawParser: { wasClientMentioned: false, clientPosition: null },
      entities: [
        {
          entityRef: "target",
          identityDecision: "confirmed_business",
          equivalenceDecision: "equivalent",
          isTargetCandidate: true,
          projectedCanonicalKey: "business:target-1",
          position: 3,
        },
      ],
    });

    expect(result.targetSeen).toBe(true);
    expect(result.targetBestPosition).toBe(3);
    expect(result.dataQualityFlags).toContain("parser_false_negative");
  });

  it("deduplicates other entity keys and target attribution domains", () => {
    const result = buildMeasurementEntityFactsV2({
      measurementId: "dedupe",
      targetBusinessId: "target-1",
      valid: true,
      rawParser: { wasClientMentioned: true, clientPosition: 1 },
      entities: [
        {
          entityRef: "target-a",
          identityDecision: "confirmed_business",
          equivalenceDecision: "equivalent",
          isTargetCandidate: true,
          projectedCanonicalKey: "business:target-1",
          position: 1,
        },
        {
          entityRef: "other-a",
          identityDecision: "confirmed_business",
          equivalenceDecision: "distinct",
          isTargetCandidate: false,
          canonicalKey: "auto:other",
          position: 2,
        },
        {
          entityRef: "other-b",
          identityDecision: "confirmed_business",
          equivalenceDecision: "distinct",
          isTargetCandidate: false,
          canonicalKey: "auto:other",
          position: 3,
        },
      ],
      attributions: [
        {
          attributionId: "a",
          entityRef: "target-a",
          domain: "www.example.com",
          url: "https://example.com/a",
        },
        {
          attributionId: "b",
          entityRef: "target-a",
          domain: "example.com",
          url: "https://example.com/b",
        },
      ],
    });

    expect(result.confirmedOtherEntityKeys).toEqual(["auto:other"]);
    expect(result.confirmedOtherEntities).toEqual([
      { canonicalKey: "auto:other", bestPosition: 2 },
    ]);
    expect(result.targetCitationDomains).toEqual(["example.com"]);
  });

  it("is deterministic and input-immutable", () => {
    const input = structuredClone(fixture.cases[0]!.input);
    const before = JSON.stringify(input);

    const first = buildMeasurementEntityFactsV2(input);
    const second = buildMeasurementEntityFactsV2(input);

    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
  });
});
