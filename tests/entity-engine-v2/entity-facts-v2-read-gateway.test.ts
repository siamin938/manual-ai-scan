import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEntityFactsV2ReadGatewayFromSnapshot } from "../../src/lib/entity-facts-v2-read-gateway.build";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
  ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
  pickEntityFactsV2AutoCompetitorDisplayName,
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

describe("Entity Facts v2 Read Gateway", () => {
  it("pins the reviewed versions", () => {
    expect(ENTITY_FACTS_V2_READ_GATEWAY_VERSION).toBe("0.1");
    expect(ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION).toBe("0.1.1");
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

  it("resolves auto competitors only from exact persisted display evidence", () => {
    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:카메오랩분당센터",
        [
          { label: "카메오랩 분당센터", priority: 1 },
          { label: "카메오랩분당센터", priority: 3 },
          { label: "카메오랩 서울센터", priority: 1 },
        ],
      ),
    ).toBe("카메오랩 분당센터");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:솔라가드프리미엄thelx일산동구점",
        [{ label: "솔라가드 프리미엄 THE LX 일산동구점", priority: 3 }],
      ),
    ).toBe("솔라가드 프리미엄 THE LX 일산동구점");
  });

  it("accepts persisted canonical display names that match the stored brand core", () => {
    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:원투랩핑",
        [{ label: "원투 랩핑 PPF", priority: 1 }],
      ),
    ).toBe("원투 랩핑 PPF");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:원투랩핑",
        [{ label: "(주) 원투 랩핑 PPF", priority: 1 }],
      ),
    ).toBe("(주) 원투 랩핑 PPF");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:원투랩핑",
        [{ label: "원투 랩핑 PPF", priority: 3 }],
      ),
    ).toBeNull();

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:원투랩핑",
        [{ label: "다른 업체 PPF", priority: 1 }],
      ),
    ).toBeNull();
  });

  it("allows only standard Korean corporate markers around an exact auto competitor name", () => {
    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:중랑자동차공업",
        [{ label: "중랑자동차공업㈜", priority: 1 }],
      ),
    ).toBe("중랑자동차공업㈜");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:중랑자동차공업",
        [{ label: "(주)중랑자동차공업", priority: 1 }],
      ),
    ).toBe("(주)중랑자동차공업");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:중랑자동차공업",
        [{ label: "주식회사 중랑자동차공업", priority: 1 }],
      ),
    ).toBe("주식회사 중랑자동차공업");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:중랑자동차공업",
        [{ label: "중랑자동차공업 주유소", priority: 1 }],
      ),
    ).toBeNull();
  });

  it("never uses the auto key suffix itself as a customer-visible fallback", () => {
    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:타이어프로파주갈현점",
        [],
      ),
    ).toBeNull();

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName(
        "auto:타이어프로파주갈현점",
        [{ label: "타이어프로 파주 다른점", priority: 1 }],
      ),
    ).toBeNull();

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName("auto:올포랩", [
        { label: "올포랩", priority: 1 },
      ]),
    ).toBe("올포랩");

    expect(
      pickEntityFactsV2AutoCompetitorDisplayName("auto:", [
        { label: "무효", priority: 1 },
      ]),
    ).toBeNull();
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

  it("uses the same pure assembler for server output and smoke validation", () => {
    const result = buildEntityFactsV2ReadGatewayFromSnapshot({
      generatedAt: "2026-09-20T00:00:00.000Z",
      business: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "테스트 업체",
        category: null,
        region: null,
        city: null,
      },
      scope: {
        runId: "33333333-3333-4333-8333-333333333333",
        runName: "최근 측정",
        questionSetId: "44444444-4444-4444-8444-444444444444",
        questionSetName: "AI 진단 질문 · 테스트 업체 · 2026-09-19",
        measuredAt: "2026-09-19T00:00:00.000Z",
        providers: ["openai"],
        repetitions: 1,
        totalJobs: 24,
        completedJobs: 24,
        failedJobs: 0,
      },
      storage: {
        aggregateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        materializationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sourceRunId: "33333333-3333-4333-8333-333333333333",
        factVersion: "0.3",
        aggregateVersion: "0.1",
        engineVersion:
          "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
        measurementCount: 24,
        validMeasurementCount: 24,
        contractOk: true,
        aggregate: {
          ...validAggregate(),
          competitors: [
            {
              canonicalKey: "auto:카메오랩분당센터",
              responseCount: 8,
              questionCount: 7,
              intentCount: 3,
              top3ResponseCount: 4,
            },
          ],
        },
      },
      observedSourcesStorage: null,
      competitorSourceClueStorage: null,
      registeredCompetitorNames: {},
      autoCompetitorEvidence: {
        "auto:카메오랩분당센터": [
          { label: "카메오랩 분당센터", priority: 1 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scope.questionSetId).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(result.data.scope.questionSetName).toBe(
      "AI 진단 질문 · 테스트 업체 · 2026-09-19",
    );
    expect(result.data.overview.visibilityLowerBoundPct).toBe(4.17);
    expect(result.data.overview.visibilityUpperBoundPct).toBe(29.17);
    expect(result.data.competitors).toEqual([
      {
        name: "카메오랩 분당센터",
        responseCount: 8,
        questionCount: 7,
        intentCount: 3,
        top3ResponseCount: 4,
      },
    ]);
    expect(serverSource).toContain(
      "const gatewayResponse = buildEntityFactsV2ReadGatewayFromSnapshot({",
    );
    expect(serverSource).toContain("return gatewayResponse;");
  });

  it("projects observed source supplement into customer-safe rows", () => {
    const aggregate = {
      ...validAggregate(),
      targetSources: [],
      competitors: [
        {
          canonicalKey: "auto:레이노개봉점",
          responseCount: 2,
          questionCount: 2,
          intentCount: 1,
          top3ResponseCount: 2,
        },
        {
          canonicalKey: "auto:루마썬팅오류점",
          responseCount: 1,
          questionCount: 1,
          intentCount: 1,
          top3ResponseCount: 1,
        },
        {
          canonicalKey: "auto:실리스코리아",
          responseCount: 1,
          questionCount: 1,
          intentCount: 1,
          top3ResponseCount: 1,
        },
      ],
    };

    const result = buildEntityFactsV2ReadGatewayFromSnapshot({
      generatedAt: "2026-09-21T00:00:00.000Z",
      business: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "카스페이스 구로점",
        category: null,
        region: null,
        city: null,
      },
      scope: {
        runId: "33333333-3333-4333-8333-333333333333",
        runName: "최근 측정",
        measuredAt: "2026-09-20T00:00:00.000Z",
        providers: ["openai"],
        repetitions: 1,
        totalJobs: 24,
        completedJobs: 24,
        failedJobs: 0,
      },
      storage: {
        aggregateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        materializationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sourceRunId: "33333333-3333-4333-8333-333333333333",
        factVersion: "0.3",
        aggregateVersion: "0.1",
        engineVersion:
          "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1",
        measurementCount: 24,
        validMeasurementCount: 24,
        contractOk: true,
        aggregate,
      },
      observedSourcesStorage: {
        observedSourceAggregateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        baseAggregateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        baseMaterializationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sourceRunId: "33333333-3333-4333-8333-333333333333",
        observedSourcesVersion: "0.1",
        sourceReplayVersion: "0.1",
        engineVersion: "observed-sources-v2:src0.1:obs0.1:store0.1",
        observedSources: [
          {
            domain: "hunnytip.kr",
            responseCount: 2,
            targetResponseCount: 0,
            otherResponseCount: 2,
            attributionCount: 3,
            entities: [
              {
                canonicalKey: "auto:레이노개봉점",
                side: "other",
                responseCount: 2,
                attributionCount: 2,
                directResponseCount: 0,
                nearSectionResponseCount: 2,
              },
              {
                canonicalKey: "auto:루마썬팅오류점",
                side: "other",
                responseCount: 1,
                attributionCount: 1,
                directResponseCount: 0,
                nearSectionResponseCount: 1,
              },
            ],
          },
        ],
      },
      competitorSourceClueStorage: {
        baseObservedSourceAggregateId:
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        baseAggregateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        baseMaterializationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sourceRunId: "33333333-3333-4333-8333-333333333333",
        clueVersion: "0.1",
        sourceReplayVersion: "0.1",
        engineVersion:
          "competitor-source-clues-v2:src0.1:clue0.1:store0.1",
        sourceClues: [
          {
            domain: "silliskorea.com",
            canonicalKey: "auto:실리스코리아",
            responseCount: 1,
            attributionCount: 1,
            evidenceTier: "near_section_title_match",
          },
        ],
      },
      registeredCompetitorNames: {},
      autoCompetitorEvidence: {
        "auto:레이노개봉점": [{ label: "레이노 개봉점", priority: 1 }],
        "auto:루마썬팅오류점": [
          { label: "루마썬팅 오류점", priority: 1 },
        ],
        "auto:실리스코리아": [
          { label: "실리스코리아", priority: 1 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.observedSourcesStatus).toBe("available");
    expect(result.data.observedSources).toEqual([
      {
        domain: "hunnytip.kr",
        responseCount: 2,
        targetResponseCount: 0,
        competitorResponseCount: 2,
        clueResponseCount: 0,
        evidence: "confirmed",
        linkedEntities: [
          {
            name: "레이노 개봉점",
            isTarget: false,
            responseCount: 2,
            evidence: "confirmed",
          },
          {
            name: "루마썬팅 오류점",
            isTarget: false,
            responseCount: 1,
            evidence: "confirmed",
          },
        ],
      },
      {
        domain: "silliskorea.com",
        responseCount: 1,
        targetResponseCount: 0,
        competitorResponseCount: 0,
        clueResponseCount: 1,
        evidence: "clue",
        linkedEntities: [
          {
            name: "실리스코리아",
            isTarget: false,
            responseCount: 1,
            evidence: "clue",
          },
        ],
      },
    ]);
    expect(JSON.stringify(result.data.observedSources)).not.toContain("auto:");
    expect(JSON.stringify(result.data.observedSources)).not.toContain(
      "canonicalKey",
    );
  });

  it("keeps the last representative result until the prepared unified set completes", () => {
    expect(serverSource).toContain('.from("measurement_runs")');
    expect(serverSource).toContain("question_set_id");
    expect(serverSource).toContain('.from("question_sets")');
    expect(serverSource).toContain("UNIFIED_DIAGNOSTIC_SET_PREFIX");
    expect(serverSource).toContain("baseRunQuery");
    expect(serverSource).toContain("currentUnifiedSet");
    expect(serverSource).toContain('.eq("question_set_id", currentUnifiedSet.id)');
    expect(serverSource).toContain("previousRepresentativeRun");
    expect(serverSource).toContain(
      "A newly created unified set does not erase the last representative result.",
    );
    expect(serverSource).toContain('.eq("run_type", "audit")');
    expect(serverSource).toContain('.eq("phase", "standalone")');
    expect(serverSource).toContain('.eq("status", "completed")');
    expect(serverSource).toContain('.is("experiment_id", null)');
    expect(serverSource).toContain(
      '.order("completed_at", { ascending: false })',
    );

    expect(serverSource).toContain('.from("run_entity_fact_aggregates_v2")');
    expect(serverSource).toContain('.from("run_observed_source_aggregates_v2")');
    expect(serverSource).toContain(
      '.from("run_competitor_source_clue_aggregates_v2")',
    );
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
  });

  it("keeps supplemental final-answer citation summary non-blocking and run-scoped", () => {
    expect(serverSource).toContain("Supplemental final-answer citation summary");
    expect(serverSource).toContain('.from("measurement_citations")');
    expect(serverSource).toContain('measurements!inner(run_id)');
    expect(serverSource).toContain('.eq("measurements.run_id", run.id)');
    expect(serverSource).toContain("citationError");
    expect(serverSource).toContain("gatewayResponse.data.citationSources");
  });

  it("keeps target-exposure citation co-observation non-blocking and grounded in v2 targetSeen truth", () => {
    expect(serverSource).toContain(
      "Supplemental citation co-observation for v2-confirmed target exposure measurements",
    );
    expect(serverSource).toContain('.from("measurement_entity_facts_v2")');
    expect(serverSource).toContain('.eq("materialization_id", storage.materialization_id)');
    expect(serverSource).toContain('jsonObject(row.facts)?.["targetSeen"] === true');
    expect(serverSource).toContain("targetMeasurementIds.size ===");
    expect(serverSource).toContain(
      "gatewayResponse.data.overview.confirmedMentionCount",
    );
    expect(serverSource).toContain("targetExposureFactError");
    expect(serverSource).toContain(
      "gatewayResponse.data.targetExposureCitationSources",
    );
    expect(serverSource).toContain(
      "never be presented as a cause of visibility or a direct business-source link",
    );
  });

  it("keeps page-level target relevance verification non-blocking and separate from answer attribution", () => {
    expect(serverSource).toContain(
      "Page-level relevance verification for citations from currently confirmed",
    );
    expect(serverSource).toContain(
      '.from("citation_page_entity_verifications")',
    );
    expect(serverSource).toContain(
      '.eq("verification_status", "confirmed")',
    );
    expect(serverSource).toContain(
      "ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION",
    );
    expect(serverSource).toContain(
      "verifiedTargetMeasurementIds.has(row.measurement_id)",
    );
    expect(serverSource).toContain(
      "gatewayResponse.data.verifiedTargetCitationPages",
    );
    expect(serverSource).toContain("verifiedPageError");
    expect(serverSource).toContain("verifiedTargetPageBasisLabel");
    expect(serverSource).toContain("verifiedPageCompletedEvent");
    expect(serverSource).toContain(
      '"metadata->>materialization_id"',
    );
    expect(serverSource).toContain(
      '"metadata->>verifier_version"',
    );
  });

  it("keeps advisory target source clues non-blocking and separate from confirmed target sources", () => {
    expect(serverSource).toContain("Advisory target-link clues");
    expect(serverSource).toContain('.from("measurement_citation_attributions")');
    expect(serverSource).toContain('.eq("source_run_id", run.id)');
    expect(serverSource).toContain('.eq("canonical_key", targetCanonicalKey)');
    expect(serverSource).toContain('.eq("attribution_level", "section")');
    expect(serverSource).toContain("distance > 250");
    expect(serverSource).toContain("confirmedTargetDomains.has(domain)");
    expect(serverSource).toContain("targetReferenceError");
    expect(serverSource).toContain("gatewayResponse.data.targetReferenceSources");
  });

  it("keeps supplemental question location metadata non-blocking", () => {
    expect(serverSource).toContain("Supplemental question-location metadata");
    expect(serverSource).toContain('.from("questions")');
    expect(serverSource).toContain('.select("id, city")');
    expect(serverSource).toContain("questionLocationError");
    expect(serverSource).toContain("gatewayResponse.data.questionLocations");
    expect(serverSource).toContain("return gatewayResponse;");
  });

  it("never reads legacy raw measurement truth in the v2 gateway", () => {
    expect(serverSource).not.toContain('.from("measurements")');
    expect(serverSource).not.toContain("was_client_mentioned");
    expect(serverSource).not.toContain("client_position");
    expect(serverSource).toContain('.from("measurement_entity_facts_v2")');
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
    expect(serverSource).toContain("registeredCompetitorNames");
    expect(serverSource).toContain("autoCompetitorEvidence");
    expect(serverSource).toContain(
      "const gatewayResponse = buildEntityFactsV2ReadGatewayFromSnapshot({",
    );
    expect(serverSource).toContain("return gatewayResponse;");
    expect(serverSource).toContain(
      '.from("measurement_entity_canonicalizations")',
    );
    expect(serverSource).toContain('.from("measurement_mentions")');
    expect(serverSource).toContain('.eq("source_run_id", run.id)');
    expect(serverSource).not.toContain("count_as_confirmed_business");
  });

  it("is the live dashboard read path without legacy current-run truth", () => {
    const dashboardSource = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );

    expect(dashboardSource).toContain("getEntityFactsV2ReadGateway");
    expect(dashboardSource).toContain(
      "buildEntityFactsV2DashboardCutoverModel",
    );
    expect(dashboardSource).not.toContain("getVisibilityDiagnostic");
    expect(dashboardSource).not.toContain("getVisibilityRepeatAggregate");
    expect(dashboardSource).not.toContain("getVisibilityRepeatContext");
    expect(dashboardSource).not.toContain("CompetitorDetailDialog");
    expect(dashboardSource).not.toContain("was_client_mentioned");
    expect(dashboardSource).not.toContain("visibilityRatePct");
  });
});
