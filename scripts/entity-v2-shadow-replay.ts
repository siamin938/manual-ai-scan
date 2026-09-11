import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractEntityCandidatesV2,
  type CandidateBusinessRef,
} from "../supabase/functions/_shared/entity-engine-v2/candidate-extractor";
import {
  evaluateIdentityCandidatesV2,
  type IdentityDecisionV2,
  type IdentityGateResultV2,
} from "../supabase/functions/_shared/entity-engine-v2/identity-gate";
import { parseResponseStructure } from "../supabase/functions/_shared/entity-engine-v2/response-structure";

export type V1VerificationStatus =
  | "confirmed_business"
  | "needs_review"
  | "rejected_non_business";

export interface V1EntitySnapshot {
  displayName: string;
  verificationStatus: V1VerificationStatus;
  verifiedEntityKind?: string | null;
  matchedBusinessId?: string | null;
  canonicalKey?: string | null;
  canonicalDisplayName?: string | null;
  reasonCodes?: string[];
}

export interface ShadowReplayRow {
  measurementId: string;
  runId: string;
  clientBusinessId?: string | null;
  responseText: string;
  businesses: CandidateBusinessRef[];
  v1Entities: V1EntitySnapshot[];
}

export interface ShadowReplayDataset {
  version: string;
  source?: string;
  rows: ShadowReplayRow[];
}

export type ShadowDiffCategory =
  | "unchanged_confirmed"
  | "canonical_surface_normalized"
  | "v1_confirmed_to_v2_dropped"
  | "v1_needs_review_to_v2_confirmed"
  | "unchanged_needs_review"
  | "v1_rejected_to_v2_confirmed"
  | "unchanged_rejected"
  | "v2_new_confirmed";

export interface ShadowDiff {
  category: ShadowDiffCategory;
  measurementId: string;
  runId: string;
  v1DisplayName?: string;
  v1VerificationStatus?: V1VerificationStatus;
  v1CanonicalKey?: string | null;
  v2IdentitySurface?: string;
  v2Decision?: IdentityDecisionV2;
  v2CanonicalKey?: string | null;
  canonicalKeyChanged?: boolean;
  v2Reasons?: string[];
}

export interface ShadowReplayReport {
  version: "0.1";
  datasetVersion: string;
  generatedAt: string;
  summary: {
    measurementCount: number;
    v1EntityCount: number;
    v2ConfirmedCount: number;
    diffCounts: Record<string, number>;
  };
  releaseSignals: {
    blockingRejectedPromotions: number;
    reviewConfirmedDrops: number;
    reviewNeedsReviewPromotions: number;
    reviewNewConfirmed: number;
    reviewSurfaceNormalizations: number;
    shadowHasBlockingPromotion: boolean;
  };
  diffs: ShadowDiff[];
}

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function businessIdFromV1(entity: V1EntitySnapshot): string | null {
  if (entity.matchedBusinessId) return entity.matchedBusinessId;
  if (entity.canonicalKey?.startsWith("business:")) {
    return entity.canonicalKey.slice("business:".length) || null;
  }
  return null;
}

function v2CanonicalKey(result: IdentityGateResultV2): string | null {
  if (result.decision !== "confirmed_business") return null;
  if (result.canonicalBusinessId) return `business:${result.canonicalBusinessId}`;
  const key = compact(result.canonicalDisplayName ?? result.identitySurface);
  return key ? `name:${key}` : null;
}

function exactSurfaceMatch(entity: V1EntitySnapshot, result: IdentityGateResultV2): boolean {
  const expected = compact(entity.canonicalDisplayName ?? entity.displayName);
  if (!expected) return false;
  return [result.identitySurface, result.canonicalDisplayName ?? ""]
    .map(compact)
    .some((value) => value === expected);
}

function identityMatch(entity: V1EntitySnapshot, result: IdentityGateResultV2): boolean {
  const businessId = businessIdFromV1(entity);
  if (businessId) return result.canonicalBusinessId === businessId;
  return exactSurfaceMatch(entity, result);
}

function findConfirmedMatch(
  entity: V1EntitySnapshot,
  results: IdentityGateResultV2[],
): IdentityGateResultV2 | undefined {
  return results.find(
    (result) => result.decision === "confirmed_business" && identityMatch(entity, result),
  );
}

function findAnyExactMatch(
  entity: V1EntitySnapshot,
  results: IdentityGateResultV2[],
): IdentityGateResultV2 | undefined {
  return results.find((result) => exactSurfaceMatch(entity, result));
}

function evaluateV2(row: ShadowReplayRow): IdentityGateResultV2[] {
  const nodes = parseResponseStructure(row.responseText);
  const candidates = extractEntityCandidatesV2(nodes, row.businesses ?? []);
  return evaluateIdentityCandidatesV2(candidates, nodes, row.businesses ?? []);
}

export function replayDataset(dataset: ShadowReplayDataset): ShadowReplayReport {
  const diffs: ShadowDiff[] = [];
  let v2ConfirmedCount = 0;

  for (const row of dataset.rows) {
    const results = evaluateV2(row);
    const confirmed = results.filter((result) => result.decision === "confirmed_business");
    v2ConfirmedCount += confirmed.length;
    const usedConfirmedIds = new Set<string>();

    for (const entity of row.v1Entities) {
      const confirmedMatch = findConfirmedMatch(entity, results);
      if (confirmedMatch) usedConfirmedIds.add(confirmedMatch.candidateId);
      const anyExact = confirmedMatch ?? findAnyExactMatch(entity, results);
      const v2Key = confirmedMatch ? v2CanonicalKey(confirmedMatch) : null;
      const v1Key = entity.canonicalKey ?? null;
      const base = {
        measurementId: row.measurementId,
        runId: row.runId,
        v1DisplayName: entity.displayName,
        v1VerificationStatus: entity.verificationStatus,
        v1CanonicalKey: v1Key,
        v2IdentitySurface: anyExact?.identitySurface,
        v2Decision: anyExact?.decision,
        v2CanonicalKey: v2Key,
        canonicalKeyChanged: Boolean(v1Key && v2Key && v1Key !== v2Key),
        v2Reasons: anyExact?.reasons,
      };

      if (entity.verificationStatus === "confirmed_business") {
        if (!confirmedMatch) {
          diffs.push({ category: "v1_confirmed_to_v2_dropped", ...base });
          continue;
        }

        const surfaceChanged = compact(entity.displayName) !== compact(confirmedMatch.identitySurface);
        diffs.push({
          category: surfaceChanged
            ? "canonical_surface_normalized"
            : "unchanged_confirmed",
          ...base,
          v2IdentitySurface: confirmedMatch.identitySurface,
          v2Decision: confirmedMatch.decision,
          v2Reasons: confirmedMatch.reasons,
        });
        continue;
      }

      if (entity.verificationStatus === "needs_review") {
        diffs.push({
          category: confirmedMatch
            ? "v1_needs_review_to_v2_confirmed"
            : "unchanged_needs_review",
          ...base,
          ...(confirmedMatch
            ? {
                v2IdentitySurface: confirmedMatch.identitySurface,
                v2Decision: confirmedMatch.decision,
                v2Reasons: confirmedMatch.reasons,
              }
            : {}),
        });
        continue;
      }

      diffs.push({
        category: confirmedMatch
          ? "v1_rejected_to_v2_confirmed"
          : "unchanged_rejected",
        ...base,
        ...(confirmedMatch
          ? {
              v2IdentitySurface: confirmedMatch.identitySurface,
              v2Decision: confirmedMatch.decision,
              v2Reasons: confirmedMatch.reasons,
            }
          : {}),
      });
    }

    for (const result of confirmed) {
      if (usedConfirmedIds.has(result.candidateId)) continue;
      diffs.push({
        category: "v2_new_confirmed",
        measurementId: row.measurementId,
        runId: row.runId,
        v2IdentitySurface: result.identitySurface,
        v2Decision: result.decision,
        v2CanonicalKey: v2CanonicalKey(result),
        v2Reasons: result.reasons,
      });
    }
  }

  const diffCounts = diffs.reduce<Record<string, number>>((acc, diff) => {
    acc[diff.category] = (acc[diff.category] ?? 0) + 1;
    return acc;
  }, {});

  const count = (category: ShadowDiffCategory) => diffCounts[category] ?? 0;

  return {
    version: "0.1",
    datasetVersion: dataset.version,
    generatedAt: new Date().toISOString(),
    summary: {
      measurementCount: dataset.rows.length,
      v1EntityCount: dataset.rows.reduce((sum, row) => sum + row.v1Entities.length, 0),
      v2ConfirmedCount,
      diffCounts,
    },
    releaseSignals: {
      blockingRejectedPromotions: count("v1_rejected_to_v2_confirmed"),
      reviewConfirmedDrops: count("v1_confirmed_to_v2_dropped"),
      reviewNeedsReviewPromotions: count("v1_needs_review_to_v2_confirmed"),
      reviewNewConfirmed: count("v2_new_confirmed"),
      reviewSurfaceNormalizations: count("canonical_surface_normalized"),
      shadowHasBlockingPromotion: count("v1_rejected_to_v2_confirmed") > 0,
    },
    diffs,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: bun scripts/entity-v2-shadow-replay.ts <dataset.json>");
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as ShadowReplayDataset;
    console.log(JSON.stringify(replayDataset(dataset), null, 2));
  }
}
