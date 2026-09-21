import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEntityFactsV2RuntimeMaterialization,
  ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
  type EntityFactsV2RuntimeDataset,
  type EntityFactsV2RuntimeExistingState,
  type EntityFactsV2RuntimeMeasurementInput,
  type EntityFactsV2RuntimeRunState,
} from "../../supabase/functions/_shared/entity-engine-v2/runtime-materialization";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "c9cb39d5-9f04-46ec-8018-14156670446d";
const MATERIALIZATION_ID = "77777777-7777-4777-8777-777777777777";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function row(
  index: number,
  overrides: Partial<EntityFactsV2RuntimeMeasurementInput> = {},
): EntityFactsV2RuntimeMeasurementInput {
  return {
    measurementId: uuid(index),
    runId: RUN_ID,
    orgId: ORG_ID,
    businessId: TARGET_ID,
    questionId: uuid(1000 + index),
    questionText: `구로구 신차패키지 추천 ${index}`,
    intentType: "recommendation",
    valid: true,
    responseText: "- 레이노 개봉점",
    rawParser: {
      wasClientMentioned: false,
      clientPosition: null,
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
        mentionId: `mention-rayno-${index}`,
        displayName: "레이노 개봉점",
        position: 1,
        canonicalKey: "auto:레이노개봉점",
      },
    ],
    attributions: [
      {
        attributionId: `attr-rayno-${index}`,
        measurementMentionId: `mention-rayno-${index}`,
        canonicalKey: "auto:레이노개봉점",
        domain: "hunnytip.kr",
        url: `https://hunnytip.kr/${index}`,
        title: "레이노 개봉점",
        attributionLevel: "section",
        evidence: { distance_chars: 110 },
        citationStartIndex: 60,
        entityEndIndex: 20,
      },
    ],
    ...overrides,
  };
}

function dataset(): EntityFactsV2RuntimeDataset {
  return {
    version: "entity-facts-v2-runtime-input-v0.1",
    publicIdentities: [],
    rows: [
      row(1),
      row(2),
      row(3, {
        attributions: [
          {
            attributionId: "attr-rayno-clue-3",
            measurementMentionId: "mention-rayno-3",
            canonicalKey: "auto:레이노개봉점",
            domain: "oh-car.kr",
            url: "https://oh-car.kr/rayno-gaebong",
            title: "레이노 개봉점",
            attributionLevel: "section",
            evidence: { distance_chars: 90 },
            citationStartIndex: 55,
            entityEndIndex: 12,
          },
        ],
      }),
    ],
  };
}

function run(
  overrides: Partial<EntityFactsV2RuntimeRunState> = {},
): EntityFactsV2RuntimeRunState {
  return {
    runId: RUN_ID,
    orgId: ORG_ID,
    businessId: TARGET_ID,
    status: "completed",
    runType: "audit",
    phase: "standalone",
    experimentId: null,
    postprocessCompleted: true,
    citationAttributionCompleted: true,
    ...overrides,
  };
}

const empty: EntityFactsV2RuntimeExistingState = {
  measurementFactCount: 0,
  aggregateRowCount: 0,
  observedSourceRowCount: 0,
  competitorSourceClueRowCount: 0,
};

describe("Entity Facts v2 runtime Edge candidate contract", () => {
  it("builds the exact four immutable layers from one ready run", async () => {
    const result = await buildEntityFactsV2RuntimeMaterialization({
      dataset: dataset(),
      run: run(),
      existing: empty,
      materializationId: MATERIALIZATION_ID,
    });

    expect(result.kind).toBe("commit");
    if (result.kind !== "commit") return;

    expect(result.engineVersion).toBe(
      "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
    );
    expect(result.engineVersion).toBe(ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION);
    expect(result.requiresSingleTransaction).toBe(true);
    expect(result.measurementRows).toHaveLength(3);
    expect(result.aggregateRow.contract_ok).toBe(true);
    expect(result.observedSupplement.observed_sources).toEqual([
      expect.objectContaining({
        domain: "hunnytip.kr",
        responseCount: 2,
        otherResponseCount: 2,
      }),
    ]);
    expect(result.clueSupplement.source_clues).toEqual([
      {
        domain: "oh-car.kr",
        canonicalKey: "auto:레이노개봉점",
        responseCount: 1,
        attributionCount: 1,
        evidenceTier: "near_section_title_match",
      },
    ]);
  });

  it("is idempotent only when all four current-version layers already exist", async () => {
    const result = await buildEntityFactsV2RuntimeMaterialization({
      dataset: dataset(),
      run: run(),
      existing: {
        measurementFactCount: 3,
        aggregateRowCount: 1,
        observedSourceRowCount: 1,
        competitorSourceClueRowCount: 1,
      },
      materializationId: MATERIALIZATION_ID,
    });

    expect(result).toEqual({
      kind: "already_materialized",
      version: "0.1",
      runId: RUN_ID,
    });

    await expect(
      buildEntityFactsV2RuntimeMaterialization({
        dataset: dataset(),
        run: run(),
        existing: {
          measurementFactCount: 3,
          aggregateRowCount: 1,
          observedSourceRowCount: 0,
          competitorSourceClueRowCount: 0,
        },
        materializationId: MATERIALIZATION_ID,
      }),
    ).rejects.toThrow("RUNTIME_V2_PARTIAL_EXISTING_STATE");
  });

  it("requires completed standalone audit plus both postprocess prerequisites", async () => {
    await expect(
      buildEntityFactsV2RuntimeMaterialization({
        dataset: dataset(),
        run: run({ status: "partial" }),
        existing: empty,
        materializationId: MATERIALIZATION_ID,
      }),
    ).rejects.toThrow("RUNTIME_V2_RUN_NOT_ELIGIBLE");

    await expect(
      buildEntityFactsV2RuntimeMaterialization({
        dataset: dataset(),
        run: run({ postprocessCompleted: false }),
        existing: empty,
        materializationId: MATERIALIZATION_ID,
      }),
    ).rejects.toThrow("RUNTIME_V2_POSTPROCESS_NOT_READY");

    await expect(
      buildEntityFactsV2RuntimeMaterialization({
        dataset: dataset(),
        run: run({ citationAttributionCompleted: false }),
        existing: empty,
        materializationId: MATERIALIZATION_ID,
      }),
    ).rejects.toThrow("RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY");
  });

  it("keeps the Edge worker internal and commits through one atomic RPC", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "supabase/functions/entity-facts-v2-materialize-run/index.ts",
      ),
      "utf8",
    );

    expect(source).toContain("x-visibility-postprocess-token");
    expect(source).toContain(
      '"get_entity_facts_v2_runtime_context_v01"',
    );
    expect(source).toContain(
      '"commit_entity_facts_v2_runtime_materialization_v01"',
    );
    expect(source).toContain("buildEntityFactsV2RuntimeMaterialization");
    expect(source).not.toMatch(
      /\.from\("(?:measurement_entity_facts_v2|run_entity_fact_aggregates_v2|run_observed_source_aggregates_v2|run_competitor_source_clue_aggregates_v2)"\)\.insert/gu,
    );
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("GEMINI_API_KEY");
    expect(source).not.toContain("PERPLEXITY_API_KEY");
  });

  it("pins the atomic DB commit and trigger/watchdog orchestration contracts", () => {
    const rpcSql = readFileSync(
      resolve(
        process.cwd(),
        "scripts/sql/entity-facts-v2-runtime-rpc-candidate.sql",
      ),
      "utf8",
    );
    const orchestrationSql = readFileSync(
      resolve(
        process.cwd(),
        "scripts/sql/entity-facts-v2-runtime-orchestration-candidate.sql",
      ),
      "utf8",
    );
    const config = readFileSync(
      resolve(process.cwd(), "supabase/config.toml"),
      "utf8",
    );

    expect(rpcSql).toContain("pg_advisory_xact_lock");
    expect(rpcSql).toContain("RUNTIME_V2_PARTIAL_EXISTING_STATE");
    expect(rpcSql).toContain("RUNTIME_V2_POSTPROCESS_NOT_READY");
    expect(rpcSql).toContain("RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY");

    const measurementInsert = rpcSql.indexOf(
      "INSERT INTO public.measurement_entity_facts_v2",
    );
    const aggregateInsert = rpcSql.indexOf(
      "INSERT INTO public.run_entity_fact_aggregates_v2",
    );
    const observedInsert = rpcSql.indexOf(
      "INSERT INTO public.run_observed_source_aggregates_v2",
    );
    const clueInsert = rpcSql.indexOf(
      "INSERT INTO public.run_competitor_source_clue_aggregates_v2",
    );
    expect(measurementInsert).toBeGreaterThan(0);
    expect(aggregateInsert).toBeGreaterThan(measurementInsert);
    expect(observedInsert).toBeGreaterThan(aggregateInsert);
    expect(clueInsert).toBeGreaterThan(observedInsert);

    expect(orchestrationSql).toContain(
      "visibility_citation_attribution_completed",
    );
    expect(orchestrationSql).toContain(
      "entity-facts-v2-materialize-run",
    );
    expect(orchestrationSql).toContain(
      "system_events_entity_facts_v2_materialization_trigger",
    );
    expect(orchestrationSql).toContain(
      "entity-facts-v2-materialization-watchdog-v01",
    );
    expect(orchestrationSql).toContain("'*/2 * * * *'");
    expect(orchestrationSql).toContain(
      "entity_facts_v2_materialization_completed",
    );
    expect(orchestrationSql).toContain(
      "r.status='completed'::public.run_status",
    );

    expect(config).toContain(
      "[functions.entity-facts-v2-materialize-run]",
    );
    expect(config).toMatch(
      /\[functions\.entity-facts-v2-materialize-run\]\s*\nverify_jwt = false/u,
    );
  });
});
