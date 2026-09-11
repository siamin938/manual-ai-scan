import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractEntityCandidatesV2,
  type CandidateBusinessRef,
} from "../../supabase/functions/_shared/entity-engine-v2/candidate-extractor";
import {
  evaluateIdentityCandidatesV2,
  type IdentityDecisionV2,
} from "../../supabase/functions/_shared/entity-engine-v2/identity-gate";
import { parseResponseStructure } from "../../supabase/functions/_shared/entity-engine-v2/response-structure";

type RequiredEntity = {
  surface: string;
  decision: IdentityDecisionV2;
  evidenceScope: string;
};

type GoldenCase = {
  id: string;
  fixtureText: string;
  forbiddenConfirmedSurfaces: string[];
  requiredEntities: RequiredEntity[];
};

type GoldenCorpus = {
  version: string;
  cases: GoldenCase[];
};

const fixtureUrl = new URL(
  "../fixtures/entity-golden-corpus-v0.1.json",
  import.meta.url,
);

const corpus = JSON.parse(
  readFileSync(fileURLToPath(fixtureUrl), "utf8"),
) as GoldenCorpus;

const businessesByCase: Record<string, CandidateBusinessRef[]> = {
  "registered-business-inside-section-title": [
    {
      id: "8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
      name: "카스페이스 구로 본점",
      aliases: ["카스페이스 구로본점"],
    },
  ],
  "region-label-plus-registered-business": [
    {
      id: "483022a4-30c9-4f6d-9cf4-19a30c2f58d2",
      name: "타이어프로 봉일천점",
      aliases: [],
    },
  ],
  "purpose-label-plus-registered-business": [
    {
      id: "a0d95431-fe9f-4bea-a02b-02fd3ea9f2a2",
      name: "현대엑스티어 판교",
      aliases: [],
    },
  ],
};

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function exactSurface(actual: string, expected: string): boolean {
  return compact(actual) === compact(expected);
}

function requiredSurface(actual: string, expected: string): boolean {
  const a = compact(actual);
  const e = compact(expected);

  // Prefer the exact identity. A one-way suffix allowance supports response
  // headings such as "3M 공식 썬팅 시공점 — 일산동구 풍동" without ever
  // treating a shorter registered subspan as equal to a forbidden larger phrase.
  return a === e || a.startsWith(e);
}

function evaluateCase(item: GoldenCase) {
  const businesses = businessesByCase[item.id] ?? [];
  const nodes = parseResponseStructure(item.fixtureText);
  const candidates = extractEntityCandidatesV2(nodes, businesses);
  const results = evaluateIdentityCandidatesV2(candidates, nodes, businesses);
  return { nodes, candidates, results };
}

describe("Entity Engine v2 golden corpus identity decisions", () => {
  for (const item of corpus.cases) {
    it(`${item.id}: never confirms forbidden surfaces`, () => {
      const { results } = evaluateCase(item);

      for (const forbidden of item.forbiddenConfirmedSurfaces) {
        const collisions = results.filter(
          (result) =>
            result.decision === "confirmed_business" &&
            exactSurface(result.identitySurface, forbidden),
        );

        expect(collisions, forbidden).toEqual([]);
      }
    });

    it(`${item.id}: recovers required semantic entities`, () => {
      const { results } = evaluateCase(item);

      for (const required of item.requiredEntities) {
        const exact = results.find((candidate) =>
          exactSurface(candidate.identitySurface, required.surface),
        );
        const result =
          exact ??
          results.find((candidate) =>
            requiredSurface(candidate.identitySurface, required.surface),
          );

        expect(result, required.surface).toBeDefined();
        expect(result?.decision, required.surface).toBe(required.decision);
      }
    });
  }
});
