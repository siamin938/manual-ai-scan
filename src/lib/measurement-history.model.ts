import type { EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
} from "./entity-facts-v2-read-gateway.types";

export const MEASUREMENT_HISTORY_PAGE_SIZE = 20;

export type MeasurementHistoryRunItem = {
  runId: string;
  runName: string;
  measuredAt: string;
  status: "available" | "not_available";
  validCount: number | null;
  confirmedCount: number | null;
  top3Count: number | null;
};

export type MeasurementHistoryCatalogResponse =
  | { ok: true; data: { orgId: string; businessId: string; page: number; hasNextPage: boolean; runs: MeasurementHistoryRunItem[] } }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" | "INTERNAL_ERROR" };

export type MeasurementHistoryDetailResponse =
  | { ok: true; data: { orgId: string; businessId: string; runId: string; report: EntityFactsV2ReadGatewayDTO } }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" | "INTERNAL_ERROR" };

export function isValidHistoryAggregate(args: {
  requestedRunId: string;
  sourceRunId: string;
  factVersion: string;
  aggregateVersion: string;
  engineVersion: string;
  measurementCount: number;
  validMeasurementCount: number;
  contractOk: boolean;
  aggregate: unknown;
}): boolean {
  if (
    args.requestedRunId !== args.sourceRunId ||
    args.factVersion !== ENTITY_FACTS_V2_READ_FACT_VERSION ||
    args.aggregateVersion !== ENTITY_FACTS_V2_READ_AGGREGATE_VERSION ||
    args.engineVersion !== ENTITY_FACTS_V2_READ_ENGINE_VERSION ||
    !args.contractOk
  ) return false;
  const parsed = parseEntityFactsV2AggregateForReadGateway(args.aggregate);
  return parsed !== null &&
    parsed.overview.measurementCount === args.measurementCount &&
    parsed.overview.validCount === args.validMeasurementCount;
}

export function canDisplayHistoryDetail(args: {
  orgId: string | null;
  businessId: string | null;
  runId: string | null;
  response: MeasurementHistoryDetailResponse | undefined;
}): args is typeof args & { orgId: string; businessId: string; runId: string; response: Extract<MeasurementHistoryDetailResponse, { ok: true }> } {
  const { orgId, businessId, runId, response } = args;
  return !!orgId && !!businessId && !!runId &&
    response?.ok === true &&
    response.data.orgId === orgId &&
    response.data.businessId === businessId &&
    response.data.runId === runId &&
    response.data.report.business.id === businessId &&
    response.data.report.scope.runId === runId;
}

/** Optional archived 8+16 context; never relabel an older or incomplete set. */
export function getHistorySearchScopes(report: EntityFactsV2ReadGatewayDTO): {
  core: { valid: number; confirmed: number };
  custom: { valid: number; confirmed: number };
} | null {
  if (!report.questionLocations || report.questionLocations.length !== report.questionAreas.length) {
    return null;
  }
  const cities = new Map(report.questionLocations.map((row) => [row.questionId, row.city]));
  if (cities.size !== report.questionAreas.length) return null;
  const core = { valid: 0, confirmed: 0 };
  const custom = { valid: 0, confirmed: 0 };
  for (const area of report.questionAreas) {
    if (!cities.has(area.questionId)) return null;
    const bucket = cities.get(area.questionId) === null ? core : custom;
    bucket.valid += area.validCount;
    bucket.confirmed += area.confirmedMentionCount;
  }
  if (core.valid !== 8 || custom.valid !== 16) return null;
  return { core, custom };
}
