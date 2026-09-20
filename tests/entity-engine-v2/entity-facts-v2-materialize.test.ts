import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEntityFactsV2Materialization,
  type Phase2CMaterializationDataset,
  type Phase2CMaterializationDatasetRow,
} from "../../scripts/entity-facts-v2-materialize";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "c9cb39d5-9f04-46ec-8018-14156670446d";
const MATERIALIZATION_ID = "77777777-7777-4777-8777-777777777777";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function row(
  index: number,
  overrides: Partial<Phase2CMaterializationDatasetRow> = {},
): Phase2CMaterializationDatasetRow {
  return {
    measurementId: uuid(index),
    runId: RUN_ID,
    orgId: ORG_ID,
    businessId: TARGET_ID,
    questionId: uuid(1000 + index),
    questionText: `질문 ${index}`,
    intentType: "local",
    valid: true,
    responseText: "- 카스페이스 구로점",
    rawParser: {
      wasClientMentioned: true,
      clientPosition: 1,
    },
    target: {
      id: TARGET_ID,
      name: "카스페이스 구로점",
      aliases: ["카스페이스구로점"],
      fullAddress: "서울 구로구 경인로53나길 27 1층",
      canonicalNaverPlaceId:
        "https://map.naver.com/p/entry/place/1069740203",
      verifiedConcreteOfficialUrls: [],
    },
    registeredBusinesses: [
      {
        id: TARGET_ID,
        name: "카스페이스 구로점",
        aliases: ["카스페이스구로점"],
        fullAddress: "서울 구로구 경인로53나길 27 1층",
        canonicalNaverPlaceId:
          "https://map.naver.com/p/entry/place/1069740203",
        verifiedConcreteOfficialUrls: [],
      },
    ],
    storedMentions: [
      {
        mentionId: uuid(2000 + index),
        displayName: "카스페이스 구로점",
        matchedBusinessId: TARGET_ID,
        matchedAlias: "카스페이스구로점",
        position: 1,
        canonicalKey: `business:${TARGET_ID}`,
      },
    ],
    attributions: [],
    currentCompetitors: [],
    currentTargetSources: [],
    ...overrides,
  };
}

function dataset(
  rows: Phase2CMaterializationDatasetRow[],
): Phase2CMaterializationDataset {
  return {
    version: "entity-facts-phase2c-export-v0.1",
    publicIdentities: [
      {
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스 구로점"],
        fullAddress: "서울 구로구 경인로53나길 27 1층",
      },
    ],
    rows,
  };
}

function build(rows: Phase2CMaterializationDatasetRow[]) {
  return buildEntityFactsV2Materialization(dataset(rows), {
    engineVersion: "entity-facts-v2-test-0.1",
    materializationIds: {
      [RUN_ID]: MATERIALIZATION_ID,
    },
  });
}

describe("Entity Facts v2 pure materializer", () => {
  it("builds exactly 24 immutable measurement rows and one complete run aggregate", () => {
    const bundle = build(Array.from({ length: 24 }, (_, i) => row(i + 1)));

    expect(bundle.measurementRows).toHaveLength(24);
    expect(bundle.aggregateRows).toHaveLength(1);

    const aggregateRow = bundle.aggregateRows[0]!;
    expect(aggregateRow.measurement_count).toBe(24);
    expect(aggregateRow.valid_measurement_count).toBe(24);
    expect(aggregateRow.contract_ok).toBe(true);
    expect(aggregateRow.aggregate.contractOk).toBe(true);
    expect(aggregateRow.aggregate.contractIssues).toEqual([]);
    expect(aggregateRow.aggregate.overview.confirmedMentionCount).toBe(24);

    expect(
      bundle.measurementRows.every(
        (item) =>
          item.materialization_id === MATERIALIZATION_ID &&
          item.org_id === ORG_ID &&
          item.business_id === TARGET_ID &&
          item.source_run_id === RUN_ID &&
          /^[0-9a-f]{64}$/u.test(item.input_fingerprint) &&
          /^[0-9a-f]{64}$/u.test(item.facts_hash),
      ),
    ).toBe(true);
    expect(/^[0-9a-f]{64}$/u.test(aggregateRow.input_fingerprint)).toBe(true);
    expect(/^[0-9a-f]{64}$/u.test(aggregateRow.aggregate_hash)).toBe(true);
  });

  it("is deterministic when semantic input arrays and row order change", () => {
    const a = row(1, {
      target: {
        ...row(1).target,
        aliases: ["카스페이스구로점", "카스페이스 구로점"],
      },
    });
    const b = row(2);

    const forward = build([a, b]);
    const reversed = build([
      {
        ...b,
        registeredBusinesses: [...b.registeredBusinesses].reverse(),
        storedMentions: [...b.storedMentions].reverse(),
      },
      {
        ...a,
        target: {
          ...a.target,
          aliases: [...(a.target.aliases ?? [])].reverse(),
        },
      },
    ]);

    expect(reversed.measurementRows).toEqual(forward.measurementRows);
    expect(reversed.aggregateRows).toEqual(forward.aggregateRows);
  });

  it("preserves unresolved target truth instead of materializing a confident false", () => {
    const unresolved = row(1, {
      responseText: "- 카스페이스 구로 본점",
      rawParser: {
        wasClientMentioned: false,
        clientPosition: null,
      },
      storedMentions: [
        {
          mentionId: uuid(3001),
          displayName: "카스페이스 구로 본점",
          position: 1,
          canonicalKey: "auto:카스페이스구로본점",
        },
      ],
    });

    const bundle = build([unresolved]);
    const facts = bundle.measurementRows[0]!.facts;
    const overview = bundle.aggregateRows[0]!.aggregate.overview;

    expect(facts.targetSeen).toBeNull();
    expect(facts.dataQualityFlags).toContain("target_identity_unresolved");
    expect(overview.confirmedMentionCount).toBe(0);
    expect(overview.unresolvedTargetCount).toBe(1);
    expect(overview.visibilityLowerBoundPct).toBe(0);
    expect(overview.visibilityUpperBoundPct).toBe(100);
  });

  it("preserves partial source state when an actionable citation cannot map to an entity", () => {
    const sourcePartial = row(1, {
      attributions: [
        {
          attributionId: uuid(4001),
          measurementMentionId: uuid(4999),
          canonicalKey: `business:${TARGET_ID}`,
          domain: "example.com",
          url: "https://example.com/page",
          attributionLevel: "direct",
          evidence: {},
          citationStartIndex: 30,
          entityEndIndex: 10,
        },
      ],
    });

    const bundle = build([sourcePartial]);
    const facts = bundle.measurementRows[0]!.facts;

    expect(facts.sourceFactsStatus).toBe("partial");
    expect(facts.dataQualityFlags).toContain("attribution_entity_ref_missing");
    expect(bundle.aggregateRows[0]!.aggregate.overview.sourcePartialMeasurementCount).toBe(1);
  });

  it("fails closed when org scope is missing or invalid", () => {
    expect(() =>
      build([
        {
          ...row(1),
          orgId: "",
        },
      ])
    ).toThrow("MATERIALIZATION_ORG_SCOPE_INVALID");
  });

  it("fails closed before output when a measurement id is not a UUID", () => {
    expect(() =>
      build([
        {
          ...row(1),
          measurementId: "not-a-uuid",
        },
      ])
    ).toThrow("MATERIALIZATION_MEASUREMENT_ID_INVALID");
  });

  it("contains no database write client or insert operation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/entity-facts-v2-materialize.ts"),
      "utf8",
    );
    expect(source).not.toContain("@supabase/supabase-js");
    expect(source).not.toMatch(/createClient\s*\(/u);
    expect(source).not.toMatch(/\.from\s*\(/u);
    expect(source).not.toMatch(/\.rpc\s*\(/u);
    expect(source).not.toMatch(/\.insert\s*\(/u);
    expect(source).not.toMatch(/\.upsert\s*\(/u);
  });

  it("requires the historical export to carry explicit orgId", () => {
    const exportSql = readFileSync(
      resolve(
        process.cwd(),
        "scripts/sql/export-entity-facts-phase2c-replay.sql",
      ),
      "utf8",
    );
    expect(exportSql).toContain("'orgId', rm.org_id");
  });
});
