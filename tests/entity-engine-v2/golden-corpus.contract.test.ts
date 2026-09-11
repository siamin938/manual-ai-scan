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

type GoldenCorpus = {
  version: string;
  source: string;
  contract: {
    decisions: Decision[];
    principles: string[];
  };
  cases: GoldenCase[];
};

const fixtureUrl = new URL(
  "../fixtures/entity-golden-corpus-v0.1.json",
  import.meta.url,
);

const corpus = JSON.parse(
  readFileSync(fileURLToPath(fixtureUrl), "utf8"),
) as GoldenCorpus;

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
  it("keeps a non-trivial real-response corpus", () => {
    expect(corpus.version).toBe("0.1");
    expect(corpus.cases.length).toBeGreaterThanOrEqual(10);
    expect(corpus.contract.principles.length).toBeGreaterThanOrEqual(5);
  });

  it("uses unique traceable case ids and real measurement/run ids", () => {
    const ids = corpus.cases.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const item of corpus.cases) {
      expect(item.id.trim()).not.toBe("");
      expect(UUID_RE.test(item.sourceMeasurementId)).toBe(true);
      expect(UUID_RE.test(item.sourceRunId)).toBe(true);
      expect(item.prompt.trim()).not.toBe("");
      expect(item.fixtureText.trim()).not.toBe("");
      expect(item.regressionReason.trim()).not.toBe("");
    }
  });

  it("contains both negative and positive controls", () => {
    const forbiddenCount = corpus.cases.reduce(
      (sum, item) => sum + item.forbiddenConfirmedSurfaces.length,
      0,
    );
    const confirmedRequiredCount = corpus.cases.reduce(
      (sum, item) =>
        sum +
        item.requiredEntities.filter(
          (entity) => entity.decision === "confirmed_business",
        ).length,
      0,
    );

    expect(forbiddenCount).toBeGreaterThanOrEqual(6);
    expect(confirmedRequiredCount).toBeGreaterThanOrEqual(6);
  });

  it("requires explicit evidence provenance for every expected entity", () => {
    for (const item of corpus.cases) {
      for (const entity of item.requiredEntities) {
        expect(ALLOWED_DECISIONS.has(entity.decision)).toBe(true);
        expect(entity.surface.trim()).not.toBe("");
        expect(entity.evidenceScope.trim()).not.toBe("");
      }
    }
  });

  it("never asks the exact same surface to be both forbidden and confirmed", () => {
    for (const item of corpus.cases) {
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
