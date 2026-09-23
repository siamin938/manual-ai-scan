import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Decision =
  | "confirmed_business"
  | "non_business"
  | "unresolved"
  | "platform"
  | "brand_network";

type RequiredEntity = {
  surface: string;
  decision: Decision;
  evidenceScope: string;
};

type GoldenCase = {
  id: string;
  sourceMeasurementId: string;
  sourceRunId: string;
  prompt: string;
  fixtureText: string;
  forbiddenConfirmedSurfaces: string[];
  requiredEntities: RequiredEntity[];
  regressionReason: string;
};

type GoldenShard = {
  version: string;
  source: string;
  cases: GoldenCase[];
  contract?: {
    decisions: Decision[];
    principles: string[];
  };
};

function readShard(relative: string): GoldenShard {
  const url = new URL(relative, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as GoldenShard;
}

const shards = [
  readShard("../fixtures/entity-golden-corpus-v0.1.json"),
  readShard("../fixtures/entity-golden-corpus-expansion-v0.2-a.json"),
  readShard("../fixtures/entity-golden-corpus-expansion-v0.2-b1.json"),
  readShard("../fixtures/entity-golden-corpus-expansion-v0.2-b2.json"),
  readShard("../fixtures/entity-golden-corpus-expansion-v0.2-c.json"),
];

const cases = shards.flatMap((shard) => shard.cases);
const baseContract = shards[0]!.contract!;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_DECISIONS = new Set<Decision>([
  "confirmed_business",
  "non_business",
  "unresolved",
  "platform",
  "brand_network",
]);

describe("Entity Engine v2 golden corpus contract", () => {
  it("keeps an expanded real-response corpus without mutating the v0.1 base", () => {
    expect(shards[0]?.version).toBe("0.1");
    expect(shards.slice(1).every((shard) => shard.version === "0.2")).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(baseContract.principles.length).toBeGreaterThanOrEqual(5);
    expect(shards.every((shard) => shard.source.trim().length > 0)).toBe(true);
  });

  it("uses unique traceable case ids and real measurement/run ids", () => {
    const ids = cases.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const item of cases) {
      expect(item.id.trim()).not.toBe("");
      expect(UUID_RE.test(item.sourceMeasurementId)).toBe(true);
      expect(UUID_RE.test(item.sourceRunId)).toBe(true);
      expect(item.prompt.trim()).not.toBe("");
      expect(item.fixtureText.trim()).not.toBe("");
      expect(item.regressionReason.trim()).not.toBe("");
    }
  });

  it("contains substantial negative and positive controls", () => {
    const forbiddenCount = cases.reduce(
      (sum, item) => sum + item.forbiddenConfirmedSurfaces.length,
      0,
    );
    const confirmedRequiredCount = cases.reduce(
      (sum, item) =>
        sum +
        item.requiredEntities.filter(
          (entity) => entity.decision === "confirmed_business",
        ).length,
      0,
    );

    expect(forbiddenCount).toBeGreaterThanOrEqual(14);
    expect(confirmedRequiredCount).toBeGreaterThanOrEqual(16);
  });

  it("requires explicit evidence provenance for every expected entity", () => {
    for (const item of cases) {
      for (const entity of item.requiredEntities) {
        expect(ALLOWED_DECISIONS.has(entity.decision)).toBe(true);
        expect(entity.surface.trim()).not.toBe("");
        expect(entity.evidenceScope.trim()).not.toBe("");
      }
    }
  });

  it("never asks the exact same surface to be both forbidden and confirmed", () => {
    for (const item of cases) {
      const forbidden = new Set(item.forbiddenConfirmedSurfaces);
      const exactConflicts = item.requiredEntities.filter(
        (entity) =>
          entity.decision === "confirmed_business" &&
          forbidden.has(entity.surface),
      );

      expect(exactConflicts).toEqual([]);
    }
  });
});
