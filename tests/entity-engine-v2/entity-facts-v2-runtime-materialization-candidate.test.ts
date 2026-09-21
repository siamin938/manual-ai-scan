import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEntityFactsV2RuntimeMaterializationCandidate,
  ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
  type EntityFactsV2RuntimeExistingState,
  type EntityFactsV2RuntimeRunState,
} from "../../scripts/entity-facts-v2-runtime-materialization-candidate";
import type {
  Phase2CMaterializationDataset,
  Phase2CMaterializationDatasetRow,
} from "../../scripts/entity-facts-v2-materialize";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "c9cb39d5-9f04-46ec-8018-14156670446d";
const MATERIALIZATION_ID = "77777777-7777-4777-8777-777777777777";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function baseRow(
  index: number,
  overrides: Partial<Phase2CMaterializationDatasetRow> = {},
): Phase2CMaterializationDatasetRow {
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
    currentCompetitors: [],
    currentTargetSources: [],
    ...overrides,
  };
}

function dataset(): Phase2CMaterializationDataset {
  const clueRow = baseRow(3, {
    responseText: "- 모터큐브",
    storedMentions: [
      {
        mentionId: "mention-motorcube-3",
        displayName: "모터큐브",
        position: 1,
        canonicalKey: "auto:모터큐브",
      },
    ],
    attributions: [
      {
        attributionId: "attr-motorcube-3",
        measurementMentionId: "mention-motorcube-3",
        canonicalKey: "auto:모터큐브",
        domain: "motorcube.co.kr",
        url: "https://motorcube.co.kr/",
        title: "모터큐브 20년 수입차 전문",
        attributionLevel: "section",
        evidence: { distance_chars: 90 },
        citationStartIndex: 55,
        entityEndIndex: 12,
      },
    ],
  });

  return {
    version: "entity-facts-phase2c-export-v0.1",
    publicIdentities: [],
    rows: [baseRow(1), baseRow(2), clueRow],
  };
}

function runState(
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

const emptyExisting: EntityFactsV2RuntimeExistingState = {
  measurementFactCount: 0,
  aggregateRowCount: 0,
  observedSourceRowCount: 0,
  competitorSourceClueRowCount: 0,
};

describe("Entity Facts v2 runtime materialization candidate", () => {
  it("builds all four v2 layers for one newly completed standalone audit", () => {
    const result = buildEntityFactsV2RuntimeMaterializationCandidate({
      dataset: dataset(),
      run: runState(),
      existing: emptyExisting,
      materializationId: MATERIALIZATION_ID,
    });

    expect(result.kind).toBe("commit");
    if (result.kind !== "commit") return;

    expect(result.engineVersion).toBe(
      "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
    );
    expect(result.engineVersion).toBe(ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION);
    expect(result.requiresSingleTransaction).toBe(true);
    expect(result.insertOrder).toEqual([
      "measurement_entity_facts_v2",
      "run_entity_fact_aggregates_v2",
      "run_observed_source_aggregates_v2",
      "run_competitor_source_clue_aggregates_v2",
    ]);

    expect(result.bundle.measurementRows).toHaveLength(3);
    expect(result.bundle.aggregateRows).toHaveLength(1);
    expect(result.bundle.aggregateRows[0]?.contract_ok).toBe(true);

    expect(result.observedSupplement.observed_sources).toEqual([
      expect.objectContaining({
        domain: "hunnytip.kr",
        responseCount: 2,
        targetResponseCount: 0,
        otherResponseCount: 2,
      }),
    ]);

    expect(result.clueSupplement.source_clues).toEqual([
      {
        domain: "motorcube.co.kr",
        canonicalKey: "auto:모터큐브",
        responseCount: 1,
        attributionCount: 1,
        evidenceTier: "near_section_title_match",
      },
    ]);

    expect(result.observedSupplement.input_fingerprint).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(result.observedSupplement.observed_sources_hash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(result.clueSupplement.input_fingerprint).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(result.clueSupplement.source_clues_hash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it("is idempotent when the exact four-layer materialization already exists", () => {
    const result = buildEntityFactsV2RuntimeMaterializationCandidate({
      dataset: dataset(),
      run: runState(),
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
  });

  it("fails closed on a partial prior commit so retries cannot mix materializations", () => {
    expect(() =>
      buildEntityFactsV2RuntimeMaterializationCandidate({
        dataset: dataset(),
        run: runState(),
        existing: {
          measurementFactCount: 2,
          aggregateRowCount: 0,
          observedSourceRowCount: 0,
          competitorSourceClueRowCount: 0,
        },
        materializationId: MATERIALIZATION_ID,
      }),
    ).toThrow("RUNTIME_V2_PARTIAL_EXISTING_STATE");
  });

  it("waits for postprocess and citation attribution before source materialization", () => {
    expect(() =>
      buildEntityFactsV2RuntimeMaterializationCandidate({
        dataset: dataset(),
        run: runState({ postprocessCompleted: false }),
        existing: emptyExisting,
        materializationId: MATERIALIZATION_ID,
      }),
    ).toThrow("RUNTIME_V2_POSTPROCESS_NOT_READY");

    expect(() =>
      buildEntityFactsV2RuntimeMaterializationCandidate({
        dataset: dataset(),
        run: runState({ citationAttributionCompleted: false }),
        existing: emptyExisting,
        materializationId: MATERIALIZATION_ID,
      }),
    ).toThrow("RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY");
  });

  it("rejects experiment, partial and non-standalone runs", () => {
    for (const run of [
      runState({ status: "partial" }),
      runState({ runType: "experiment", experimentId: uuid(9001) }),
      runState({ phase: "followup" }),
    ]) {
      expect(() =>
        buildEntityFactsV2RuntimeMaterializationCandidate({
          dataset: dataset(),
          run,
          existing: emptyExisting,
          materializationId: MATERIALIZATION_ID,
        }),
      ).toThrow("RUNTIME_V2_RUN_NOT_ELIGIBLE");
    }
  });

  it("contains no database client, provider call or mutation path", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "scripts/entity-facts-v2-runtime-materialization-candidate.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("@supabase/supabase-js");
    expect(source).not.toMatch(/createClient\s*\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\.insert\s*\(/u);
    expect(source).not.toMatch(/\.upsert\s*\(/u);
    expect(source).not.toMatch(/\.from\s*\(/u);
    expect(source).not.toMatch(/\.delete\s*\(/u);
  });
});
