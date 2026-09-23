import {
  ENTITY_V2_SHADOW_ADAPTER_VERSION,
  runEntityV2ShadowAdapter,
  type EntityV2ShadowAdapterResult,
} from "./shadow-adapter.ts";
import type { CandidateBusinessRef } from "./candidate-extractor.ts";

export const ENTITY_V2_RUNTIME_SHADOW_VERSION = "0.1" as const;

export interface EntityV2RuntimeShadowBusiness extends CandidateBusinessRef {}

export interface EntityV1ResolutionForShadow {
  displayName: string;
  matchedBusinessId?: string | null;
  countAsConfirmedBusiness: boolean;
}

export interface EntityV2RuntimeShadowInput {
  responseText: string;
  businesses: EntityV2RuntimeShadowBusiness[];
  v1Resolutions: EntityV1ResolutionForShadow[];
}

export interface EntityV2RuntimeShadowSideDiff {
  v1Confirmed: string[];
  v2Confirmed: string[];
  v1Only: string[];
  v2Only: string[];
}

export interface EntityV2RuntimeShadowComparison {
  version: typeof ENTITY_V2_RUNTIME_SHADOW_VERSION;
  adapterVersion: typeof ENTITY_V2_SHADOW_ADAPTER_VERSION;
  match: boolean;
  mismatchCount: number;
  structureNodeCount: number;
  candidateCount: number;
  decisionCounts: EntityV2ShadowAdapterResult["decisionCounts"];
  registeredBusinesses: EntityV2RuntimeShadowSideDiff;
  unregisteredBusinesses: EntityV2RuntimeShadowSideDiff;
}

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function makeDiff(v1Values: string[], v2Values: string[]): EntityV2RuntimeShadowSideDiff {
  const v1Confirmed = uniqueSorted(v1Values);
  const v2Confirmed = uniqueSorted(v2Values);
  return {
    v1Confirmed,
    v2Confirmed,
    v1Only: difference(v1Confirmed, v2Confirmed),
    v2Only: difference(v2Confirmed, v1Confirmed),
  };
}

function unregisteredNameMap(values: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of values) {
    const display = raw.trim();
    const key = compact(display);
    if (!display || key.length < 2 || out.has(key)) continue;
    out.set(key, display);
  }
  return out;
}

export function runEntityV2RuntimeShadowComparison(
  input: EntityV2RuntimeShadowInput,
): EntityV2RuntimeShadowComparison {
  const shadow = runEntityV2ShadowAdapter({
    responseText: input.responseText ?? "",
    businesses: input.businesses ?? [],
  });

  const v1Confirmed = input.v1Resolutions.filter((item) => item.countAsConfirmedBusiness);
  const registeredBusinesses = makeDiff(
    v1Confirmed.flatMap((item) => item.matchedBusinessId ? [item.matchedBusinessId] : []),
    shadow.decisions.flatMap((item) =>
      item.decision === "confirmed_business" && item.canonicalBusinessId
        ? [item.canonicalBusinessId]
        : []
    ),
  );

  const v1UnregisteredByKey = unregisteredNameMap(
    v1Confirmed.flatMap((item) => !item.matchedBusinessId ? [item.displayName] : []),
  );
  const v2UnregisteredByKey = unregisteredNameMap(
    shadow.decisions.flatMap((item) =>
      item.decision === "confirmed_business" && !item.canonicalBusinessId
        ? [item.canonicalDisplayName ?? item.identitySurface]
        : []
    ),
  );

  const unregisteredKeyDiff = makeDiff(
    [...v1UnregisteredByKey.keys()],
    [...v2UnregisteredByKey.keys()],
  );
  const unregisteredBusinesses: EntityV2RuntimeShadowSideDiff = {
    v1Confirmed: unregisteredKeyDiff.v1Confirmed.map((key) => v1UnregisteredByKey.get(key) ?? key),
    v2Confirmed: unregisteredKeyDiff.v2Confirmed.map((key) => v2UnregisteredByKey.get(key) ?? key),
    v1Only: unregisteredKeyDiff.v1Only.map((key) => v1UnregisteredByKey.get(key) ?? key),
    v2Only: unregisteredKeyDiff.v2Only.map((key) => v2UnregisteredByKey.get(key) ?? key),
  };

  const mismatchCount =
    registeredBusinesses.v1Only.length +
    registeredBusinesses.v2Only.length +
    unregisteredBusinesses.v1Only.length +
    unregisteredBusinesses.v2Only.length;

  return {
    version: ENTITY_V2_RUNTIME_SHADOW_VERSION,
    adapterVersion: shadow.version,
    match: mismatchCount === 0,
    mismatchCount,
    structureNodeCount: shadow.structureNodeCount,
    candidateCount: shadow.candidateCount,
    decisionCounts: shadow.decisionCounts,
    registeredBusinesses,
    unregisteredBusinesses,
  };
}
