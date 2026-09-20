import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
} from "../../src/lib/entity-facts-v2-read-gateway.types";

const serverPath = resolve(
  process.cwd(),
  "src/lib/entity-facts-v2-read-gateway.server.ts",
);
const functionsPath = resolve(
  process.cwd(),
  "src/lib/entity-facts-v2-read-gateway.functions.ts",
);
const typesPath = resolve(
  process.cwd(),
  "src/lib/entity-facts-v2-read-gateway.types.ts",
);

const serverSource = readFileSync(serverPath, "utf8");
const functionsSource = readFileSync(functionsPath, "utf8");
const typesSource = readFileSync(typesPath, "utf8");

function validAggregate() {
  return {
    version: "0.1",
    factsVersion: "0.3",
    contractOk: true,
    contractIssues: [],
    overview: {
      validCount: 24,
      confirmedMentionCount: 1,
      unresolvedTargetCount: 6,
      visibilityLowerBoundPct: 4.17,
      visibilityUpperBoundPct: 29.17,
      confirmedTop3Count: 1,
      top3UncertainCount: 6,
      top3LowerBoundPct: 4.17,
      top3UpperBoundPct: 29.17,
      measurementCount: 24,
      invalidCount: 0,
      questionCount: 24,
      coveredQuestionCount: 1,
      unresolvedQuestionCount: 6,
      missingQuestionCount: 17,
      sourcePartialMeasurementCount: 6,
    },
    questionGroups: [
      {
        intentType: "recommendation",
        questionCount: 24,
        validCount: 24,
        confirmedMentionCount: 1,
        unresolvedTargetCount: 6,
        visibilityLowerBoundPct: 4.17,
        visibilityUpperBoundPct: 29.17,
        confirmedTop3Count: 1,
        top3UncertainCount: 6,
        top3LowerBoundPct: 4.17,
        top3UpperBoundPct: 29.17,
      },
    ],
    questionAreas: [
      {
        questionId: "11111111-1111-4111-8111-111111111111",
        questionText: "구로구 신차패키지 추천",
        intentType: "recommendation",
        status: "unresolved",
        validCount: 1,
        confirmedMentionCount: 0,
        unresolvedTargetCount: 1,
        visibilityLowerBoundPct: 0,
        visibilityUpperBoundPct: 100,
        confirmedTop3Count: 0,
        top3UncertainCount: 1,
        top3LowerBoundPct: 0,
        top3UpperBoundPct: 100,
      },
    ],
    competitors: [
      {
        canonicalKey: "business:22222222-2222-4222-8222-222222222222",
        responseCount: 8,
        questionCount: 7,
        intentCount: 3,
        top3ResponseCount: 4,
      },
    ],
    targetSources: [
      {
        domain: "example.com",
        responseCount: 3,
        completeResponseCount: 2,
        partialResponseCount: 1,
      },
    ],
    qualityFlagCounts: {
      target_identity_unresolved: 6,
    },
  };
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

describe("Entity Facts v2 Read Gateway", () => {
  it("pins the reviewed versions", () => {
    expect(ENTITY_FACTS_V2_READ_GATEWAY_VERSION).toBe("0.1");
    expect(ENTITY_FACTS_V2_READ_FACT_VERSION).toBe("0.3");
    expect(ENTITY_FACTS_V2_READ_AGGREGATE_VERSION).toBe("0.1");
    expect(ENTITY_FACTS_V2_READ_ENGINE_VERSION).toBe(
      "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
    );
  });

  it("preserves uncertainty bounds instead of collapsing unresolved to false", () => {
    const parsed = parseEntityFactsV2AggregateForReadGateway(validAggregate());
    expect(parsed).not.toBeNull();
    expect(parsed?.overview.confirmedMentionCount).toBe(1);
    expect(parsed?.overview.unresolvedTargetCount).toBe(6);
    expect(parsed?.overview.visibilityLowerBoundPct).toBe(4.17);
    expect(parsed?.overview.visibilityUpperBoundPct).toBe(29.17);
    expect(parsed?.overview.top3LowerBoundPct).toBe(4.17);
    expect(parsed?.overview.top3UpperBoundPct).toBe(29.17);
  });

  it("fails closed on version, contract or bounds corruption", () => {
    expect(
      parseEntityFactsV2AggregateForReadGateway({
        ...validAggregate(),
        factsVersion: "0.2",
      }),
    ).toBeNull();

    expect(
      parseEntityFactsV2AggregateForReadGateway({
        ...validAggregate(),
        contractIssues: [{ code: "SELF_COMPETITOR_LEAK" }],
      }),
    ).toBeNull();

    const badBounds = validAggregate();
    badBounds.overview.visibilityLowerBoundPct = 90;
    badBounds.overview.visibilityUpperBoundPct = 10;
    expect(parseEntityFactsV2AggregateForReadGateway(badBounds)).toBeNull();
  });

  it("reads only the exact latest standalone audit run aggregate", () => {
    expect(serverSource).toContain('.from("measurement_runs")');
    expect(serverSource).toContain('.eq("run_type", "audit")');
    expect(serverSource).toContain('.eq("phase", "standalone")');
    expect(serverSource).toContain('.eq("status", "completed")');
    expect(serverSource).toContain('.is("experiment_id", null)');
    expect(serverSource).toContain(
      '.order("completed_at", { ascending: false })',
    );

    expect(serverSource).toContain('.from("run_entity_fact_aggregates_v2")');
    expect(serverSource).toContain('.eq("source_run_id", run.id)');
    expect(serverSource).toContain(
      '.eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION)',
    );
    expect(serverSource).toContain(
      '.eq("aggregate_version", ENTITY_FACTS_V2_READ_AGGREGATE_VERSION)',
    );
    expect(serverSource).toContain(
      '.eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION)',
    );
    expect(serverSource).toContain('.eq("contract_ok", true)');
    expect(serverSource).toContain(
      "It never falls back to an older materialized run.",
    );
  });

  it("never reads legacy raw measurement truth in the v2 gateway", () => {
    expect(serverSource).not.toContain('.from("measurements")');
    expect(serverSource).not.toContain("was_client_mentioned");
    expect(serverSource).not.toContain("client_position");
    expect(serverSource).not.toContain("measurement_entity_facts_v2");
    expect(serverSource).not.toContain("response_text");
  });

  it("checks current-user membership before entering the server-only gateway", () => {
    const membershipIndex = functionsSource.indexOf(
      '.from("organization_members")',
    );
    const gatewayIndex = functionsSource.indexOf(
      "return fetchEntityFactsV2ReadGateway",
    );
    expect(membershipIndex).toBeGreaterThan(0);
    expect(gatewayIndex).toBeGreaterThan(membershipIndex);
    expect(functionsSource).toContain('.eq("user_id", context.userId)');
    expect(functionsSource).toContain(
      'if (!membership) return { ok: false, error: "FORBIDDEN" };',
    );
  });

  it("keeps internal competitor canonical keys out of the customer DTO", () => {
    const publicDtoStart = typesSource.indexOf(
      "export type EntityFactsV2ReadCompetitorDTO",
    );
    const publicDtoEnd = typesSource.indexOf(
      "export type EntityFactsV2ReadTargetSourceDTO",
    );
    const dtoBlock = typesSource.slice(publicDtoStart, publicDtoEnd);
    expect(dtoBlock).toContain("name: string");
    expect(dtoBlock).not.toContain("canonicalKey");
    expect(serverSource).toContain("competitorNameById");
  });

  it("is prepared but not wired into any customer route yet", () => {
    const routesDir = resolve(process.cwd(), "src/routes");
    const references = listFiles(routesDir)
      .filter((path) => /\.(?:ts|tsx)$/u.test(path))
      .filter((path) =>
        readFileSync(path, "utf8").includes("getEntityFactsV2ReadGateway"),
      );
    expect(references).toEqual([]);
  });
});
