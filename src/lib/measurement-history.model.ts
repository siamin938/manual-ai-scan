import type { EntityFactsV2ReadGatewayDTO, EntityFactsV2ReadGatewayResponse } from "./entity-facts-v2-read-gateway.types";
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
  | { ok: true; data: { orgId: string; businessId: string; page: number; snapshotStatus: "ready" | "temporarily_unavailable"; hasNextPage: boolean; runs: MeasurementHistoryRunItem[] } }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" | "INTERNAL_ERROR" };

export type MeasurementHistoryDetailResponse =
  | { ok: true; data: { orgId: string; businessId: string; runId: string; report: EntityFactsV2ReadGatewayDTO } }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" | "INTERNAL_ERROR" };

/**
 * Never render cached catalog rows from a different organization, business,
 * or page. The user ID remains part of the React Query cache key.
 */
export function isMatchingHistoryCatalog(args: {
  orgId: string | null;
  businessId: string | null;
  page: number;
  response: MeasurementHistoryCatalogResponse | undefined;
}): boolean {
  const { orgId, businessId, page, response } = args;
  return !!orgId && !!businessId && response?.ok === true &&
    response.data.orgId === orgId &&
    response.data.businessId === businessId &&
    response.data.page === page;
}

/**
 * 'Latest' is the exact representative Run resolved by the SAME authenticated
 * v2 read gateway as the current dashboard, not the first date in a catalog.
 * If verification is unavailable, leave every row as a historical detail link.
 *
 * The gateway request is independently authenticated for this org/business;
 * the org, business, page and listed Run IDs are checked again before UI use.
 */
export function resolveCurrentHistoryRunId(args: {
  orgId: string | null;
  businessId: string | null;
  page: number;
  catalog: MeasurementHistoryCatalogResponse | undefined;
  gateway: EntityFactsV2ReadGatewayResponse | undefined;
}): string | null {
  const { orgId, businessId, page, catalog, gateway } = args;
  if (!isMatchingHistoryCatalog({ orgId, businessId, page, response: catalog }) ||
      catalog?.ok !== true || gateway?.ok !== true ||
      gateway.data.business.id !== businessId) {
    return null;
  }
  const currentRunId = gateway.data.scope.runId;
  return currentRunId && catalog.data.runs.some((row) => row.runId === currentRunId)
    ? currentRunId
    : null;
}

/**
 * The browser's authenticated-RLS index is authoritative for which historical
 * Run IDs may appear. Server-only v2 facts may enrich the same records, but a
 * failed/stale/mismatched server function must never block the date list or
 * supply records for another page, business or organization.
 */
export function enrichMemberHistoryCatalog(
  member: MeasurementHistoryCatalogResponse | undefined,
  facts: MeasurementHistoryCatalogResponse | undefined,
): MeasurementHistoryCatalogResponse | undefined {
  if (!member?.ok || !facts?.ok) return member;
  const a = member.data;
  const b = facts.data;
  if (a.orgId !== b.orgId || a.businessId !== b.businessId ||
    a.page !== b.page || a.hasNextPage !== b.hasNextPage ||
    a.runs.length !== b.runs.length ||
    !a.runs.every((row, i) =>
      row.runId === b.runs[i]?.runId &&
      row.measuredAt === b.runs[i]?.measuredAt
    )
  ) {
    return member;
  }
  return facts;
}

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
