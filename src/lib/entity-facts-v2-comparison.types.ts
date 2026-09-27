import type { EntityFactsV2ReadBusinessDTO } from "./entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_COMPARISON_VERSION = "0.1" as const;

export type EntityFactsV2ComparisonStatus =
  | "verified"
  | "single"
  | "unverified"
  | "unavailable";

export type EntityFactsV2ComparisonReason =
  | "VERIFIED"
  | "NO_COMPATIBLE_PRIOR_RUN"
  | "CURRENT_REQUEST_CONTRACT_UNAVAILABLE"
  | "NO_CURRENT_CUSTOMER_RUN"
  | "CURRENT_V2_UNAVAILABLE";

export type EntityFactsV2ComparisonMetricSnapshot = {
  validCount: number;
  confirmedCount: number;
  unresolvedCount: number;
  confirmedPct: number | null;
  maxPct: number | null;
};

export type EntityFactsV2ComparisonMetricDTO = {
  current: EntityFactsV2ComparisonMetricSnapshot;
  previous: EntityFactsV2ComparisonMetricSnapshot | null;
  confirmedDeltaPctPoints: number | null;
};

export type EntityFactsV2ComparisonRunPointDTO = {
  runId: string;
  measuredAt: string;
  visibility: EntityFactsV2ComparisonMetricSnapshot;
  top3: EntityFactsV2ComparisonMetricSnapshot;
};

export type EntityFactsV2ComparisonSearchScopeDTO = {
  custom: EntityFactsV2ComparisonMetricDTO;
  core: EntityFactsV2ComparisonMetricDTO;
  newlyConfirmedQuestionCount: number;
  noLongerConfirmedQuestionCount: number;
};

export type EntityFactsV2ComparisonDTO = {
  version: typeof ENTITY_FACTS_V2_COMPARISON_VERSION;
  generatedAt: string;
  business: EntityFactsV2ReadBusinessDTO;
  status: EntityFactsV2ComparisonStatus;
  reason: EntityFactsV2ComparisonReason;
  comparisonBasis: "durable_request_fingerprint";
  compatibleRunCount: number;
  trendEligible: boolean;
  currentRun: EntityFactsV2ComparisonRunPointDTO | null;
  previousRun: EntityFactsV2ComparisonRunPointDTO | null;
  series: EntityFactsV2ComparisonRunPointDTO[];
  visibility: EntityFactsV2ComparisonMetricDTO | null;
  top3: EntityFactsV2ComparisonMetricDTO | null;
  /** Optional additive detail for unified 24-question comparisons only. */
  searchScope?: EntityFactsV2ComparisonSearchScopeDTO | null;
};

export type EntityFactsV2ComparisonError =
  | "FORBIDDEN"
  | "BUSINESS_NOT_AVAILABLE"
  | "INVALID_V2_DATA"
  | "INTERNAL_ERROR";

export type EntityFactsV2ComparisonResponse =
  | { ok: true; data: EntityFactsV2ComparisonDTO }
  | { ok: false; error: EntityFactsV2ComparisonError };

function roundPctPoints(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildEntityFactsV2MetricComparison(
  current: EntityFactsV2ComparisonMetricSnapshot,
  previous: EntityFactsV2ComparisonMetricSnapshot | null,
): EntityFactsV2ComparisonMetricDTO {
  const confirmedDeltaPctPoints =
    previous !== null &&
    current.confirmedPct !== null &&
    previous.confirmedPct !== null
      ? roundPctPoints(current.confirmedPct - previous.confirmedPct)
      : null;

  return {
    current,
    previous,
    confirmedDeltaPctPoints,
  };
}

export function isEntityFactsV2TrendEligible(
  compatibleRunCount: number,
): boolean {
  return Number.isInteger(compatibleRunCount) && compatibleRunCount >= 3;
}
