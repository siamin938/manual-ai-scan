import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEntityFactsV2ReadGatewayFromSnapshot,
  type EntityFactsV2ReadGatewaySnapshot,
} from "../src/lib/entity-facts-v2-read-gateway.build";

type SmokeCase = {
  name: string;
  snapshot: EntityFactsV2ReadGatewaySnapshot;
  expected: {
    runId: string;
    visibilityLowerBoundPct: number | null;
    visibilityUpperBoundPct: number | null;
    competitorCount: number;
  };
};

type SmokeInput = {
  cases: SmokeCase[];
};

function fail(code: string): never {
  throw new Error(code);
}

const inputPath = process.argv[2];
if (!inputPath) fail("READ_GATEWAY_SMOKE_INPUT_REQUIRED");

const input = JSON.parse(
  readFileSync(resolve(inputPath), "utf8"),
) as SmokeInput;

if (!Array.isArray(input.cases) || input.cases.length === 0) {
  fail("READ_GATEWAY_SMOKE_CASES_REQUIRED");
}

const summaries = input.cases.map((testCase) => {
  const result = buildEntityFactsV2ReadGatewayFromSnapshot(testCase.snapshot);
  if (!result.ok) {
    fail(`READ_GATEWAY_SMOKE_FAILED:${testCase.name}:${result.error}`);
  }

  const data = result.data;
  if (data.scope.runId !== testCase.expected.runId) {
    fail(`READ_GATEWAY_SMOKE_RUN_MISMATCH:${testCase.name}`);
  }
  if (
    data.overview.visibilityLowerBoundPct !==
      testCase.expected.visibilityLowerBoundPct ||
    data.overview.visibilityUpperBoundPct !==
      testCase.expected.visibilityUpperBoundPct
  ) {
    fail(`READ_GATEWAY_SMOKE_BOUNDS_MISMATCH:${testCase.name}`);
  }
  if (data.competitors.length !== testCase.expected.competitorCount) {
    fail(`READ_GATEWAY_SMOKE_COMPETITOR_COUNT_MISMATCH:${testCase.name}`);
  }

  return {
    name: testCase.name,
    businessId: data.business.id,
    runId: data.scope.runId,
    validCount: data.overview.validCount,
    confirmedMentionCount: data.overview.confirmedMentionCount,
    unresolvedTargetCount: data.overview.unresolvedTargetCount,
    visibilityLowerBoundPct: data.overview.visibilityLowerBoundPct,
    visibilityUpperBoundPct: data.overview.visibilityUpperBoundPct,
    competitorCount: data.competitors.length,
    targetSourceCount: data.targetSources.length,
    questionAreaCount: data.questionAreas.length,
  };
});

console.log(
  JSON.stringify(
    {
      ok: true,
      caseCount: summaries.length,
      cases: summaries,
    },
    null,
    2,
  ),
);
