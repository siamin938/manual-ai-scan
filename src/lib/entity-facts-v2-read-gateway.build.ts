import {
  buildObservedSourcesCustomerDTO,
  ENTITY_FACTS_V2_OBSERVED_SOURCES_ENGINE_VERSION,
  ENTITY_FACTS_V2_OBSERVED_SOURCES_SOURCE_REPLAY_VERSION,
  ENTITY_FACTS_V2_OBSERVED_SOURCES_VERSION,
  parseObservedSourcesV2,
} from "./entity-facts-v2-read-gateway.observed-sources";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
  pickEntityFactsV2AutoCompetitorDisplayName,
  type EntityFactsV2CompetitorDisplayEvidence,
  type EntityFactsV2ReadBusinessDTO,
  type EntityFactsV2ReadCompetitorDTO,
  type EntityFactsV2ReadGatewayResponse,
  type EntityFactsV2ReadScopeDTO,
} from "./entity-facts-v2-read-gateway.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type EntityFactsV2ReadGatewayStorageSnapshot = {
  aggregateId: string;
  materializationId: string;
  sourceRunId: string;
  factVersion: string;
  aggregateVersion: string;
  engineVersion: string;
  measurementCount: number;
  validMeasurementCount: number;
  contractOk: boolean;
  aggregate: unknown;
};

export type EntityFactsV2ObservedSourcesStorageSnapshot = {
  baseAggregateId: string;
  baseMaterializationId: string;
  sourceRunId: string;
  observedSourcesVersion: string;
  sourceReplayVersion: string;
  engineVersion: string;
  observedSources: unknown;
};


export type EntityFactsV2ReadGatewaySnapshot = {
  generatedAt: string;
  business: EntityFactsV2ReadBusinessDTO;
  scope: EntityFactsV2ReadScopeDTO;
  storage: EntityFactsV2ReadGatewayStorageSnapshot;
  observedSourcesStorage: EntityFactsV2ObservedSourcesStorageSnapshot | null;
  registeredCompetitorNames: Record<string, string>;
  autoCompetitorEvidence: Record<
    string,
    EntityFactsV2CompetitorDisplayEvidence[]
  >;
};

function businessIdFromCanonicalKey(value: string): string | null {
  if (!value.startsWith("business:")) return null;
  const id = value.slice("business:".length).trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

/**
 * Pure customer-safe assembly/validation path.
 * Production server reads are converted into this snapshot before any DTO is
 * returned. Read-only smoke tests can exercise the exact same contract without
 * needing a Production credential inside CI.
 */
export function buildEntityFactsV2ReadGatewayFromSnapshot(
  input: EntityFactsV2ReadGatewaySnapshot,
): EntityFactsV2ReadGatewayResponse {
  const { business, scope, storage } = input;
  const targetBusinessId = business.id.trim().toLowerCase();

  if (
    !UUID_RE.test(targetBusinessId) ||
    !UUID_RE.test(scope.runId) ||
    !UUID_RE.test(storage.aggregateId) ||
    !UUID_RE.test(storage.materializationId) ||
    storage.sourceRunId !== scope.runId ||
    storage.factVersion !== ENTITY_FACTS_V2_READ_FACT_VERSION ||
    storage.aggregateVersion !== ENTITY_FACTS_V2_READ_AGGREGATE_VERSION ||
    storage.engineVersion !== ENTITY_FACTS_V2_READ_ENGINE_VERSION ||
    storage.contractOk !== true
  ) {
    return {
      ok: false,
      error: "INVALID_V2_DATA",
      business,
      runId: scope.runId,
    };
  }

  const aggregate = parseEntityFactsV2AggregateForReadGateway(
    storage.aggregate,
  );

  if (
    !aggregate ||
    aggregate.overview.measurementCount !== storage.measurementCount ||
    aggregate.overview.validCount !== storage.validMeasurementCount
  ) {
    return {
      ok: false,
      error: "INVALID_V2_DATA",
      business,
      runId: scope.runId,
    };
  }

  const competitors: EntityFactsV2ReadCompetitorDTO[] = [];
  for (const item of aggregate.competitors) {
    const key = item.canonicalKey.trim();
    const competitorBusinessId = businessIdFromCanonicalKey(key);

    let name: string | null = null;
    if (competitorBusinessId) {
      if (competitorBusinessId === targetBusinessId) continue;
      const candidate = input.registeredCompetitorNames[competitorBusinessId];
      name = typeof candidate === "string" && candidate.trim()
        ? candidate.trim()
        : null;
    } else {
      name = pickEntityFactsV2AutoCompetitorDisplayName(
        key,
        input.autoCompetitorEvidence[key] ?? [],
      );
    }

    if (!name) continue;

    competitors.push({
      name,
      responseCount: item.responseCount,
      questionCount: item.questionCount,
      intentCount: item.intentCount,
      top3ResponseCount: item.top3ResponseCount,
    });
  }

  let observedSourcesStatus: "available" | "not_materialized" =
    "not_materialized";
  let observedSources = [];

  if (input.observedSourcesStorage) {
    const observedStorage = input.observedSourcesStorage;
    if (
      observedStorage.baseAggregateId !== storage.aggregateId ||
      observedStorage.baseMaterializationId !== storage.materializationId ||
      observedStorage.sourceRunId !== scope.runId ||
      observedStorage.observedSourcesVersion !==
        ENTITY_FACTS_V2_OBSERVED_SOURCES_VERSION ||
      observedStorage.sourceReplayVersion !==
        ENTITY_FACTS_V2_OBSERVED_SOURCES_SOURCE_REPLAY_VERSION ||
      observedStorage.engineVersion !==
        ENTITY_FACTS_V2_OBSERVED_SOURCES_ENGINE_VERSION
    ) {
      return {
        ok: false,
        error: "INVALID_V2_DATA",
        business,
        runId: scope.runId,
      };
    }

    const parsedObservedSources = parseObservedSourcesV2(
      observedStorage.observedSources,
    );
    if (!parsedObservedSources) {
      return {
        ok: false,
        error: "INVALID_V2_DATA",
        business,
        runId: scope.runId,
      };
    }

    const customerObservedSources = buildObservedSourcesCustomerDTO({
      business,
      observedSources: parsedObservedSources,
      competitorCanonicalKeys: new Set(
        aggregate.competitors.map((item) => item.canonicalKey),
      ),
      targetSourceResponseCountByDomain: new Map(
        aggregate.targetSources.map((item) => [
          item.domain.toLowerCase().replace(/^www\./u, ""),
          item.responseCount,
        ]),
      ),
      registeredCompetitorNames: input.registeredCompetitorNames,
      autoCompetitorEvidence: input.autoCompetitorEvidence,
    });

    if (!customerObservedSources) {
      return {
        ok: false,
        error: "INVALID_V2_DATA",
        business,
        runId: scope.runId,
      };
    }

    observedSourcesStatus = "available";
    observedSources = customerObservedSources;
  }

  return {
    ok: true,
    data: {
      gatewayVersion: ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
      generatedAt: input.generatedAt,
      business,
      scope,
      overview: aggregate.overview,
      questionGroups: aggregate.questionGroups,
      questionAreas: aggregate.questionAreas,
      competitors,
      targetSources: aggregate.targetSources,
      observedSourcesStatus,
      observedSources,
    },
  };
}
