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
  type IdentityEvidenceV2,
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

export interface ShadowEvidenceSnapshot {
  type: IdentityEvidenceV2["type"];
  provenance: IdentityEvidenceV2["provenance"];
}

export interface ShadowDiff {
  category: ShadowDiffCategory;
  measurementId: string;
  runId: string;
  v1DisplayName?: string;
  v1VerificationStatus?: V1VerificationStatus;
  v1CanonicalKey?: string | null;
  v1MatchedBusinessId?: string | null;
  v2IdentitySurface?: string;
  v2Decision?: IdentityDecisionV2;
  v2CanonicalKey?: string | null;
  v2CanonicalBusinessId?: string | null;
  canonicalKeyChanged?: boolean;
  v2Reasons?: string[];
  v2Evidence?: ShadowEvidenceSnapshot[];
}

export interface ShadowReplayReport {
  version: "0.2";
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

export interface ShadowReviewApproval {
  measurementId: string;
  surface: string;
  rationale: string;
}

export interface ShadowReleaseReviewRegistry {
  version: string;
  approvedConfirmedDrops: ShadowReviewApproval[];
  approvedNewConfirmed: ShadowReviewApproval[];
  approvedNeedsReviewPromotions?: ShadowReviewApproval[];
}

export type ShadowReleaseGateIssueCode =
  | "REJECTED_PROMOTED_TO_CONFIRMED"
  | "REGISTERED_CANONICAL_ID_CHANGED"
  | "UNREVIEWED_CONFIRMED_DROP"
  | "UNQUALIFIED_NEEDS_REVIEW_PROMOTION"
  | "UNREVIEWED_NEW_CONFIRMED";

export interface ShadowReleaseGateIssue {
  code: ShadowReleaseGateIssueCode;
  measurementId: string;
  surface: string;
  detail: string;
}

export interface ShadowReleaseGateReport {
  version: "0.1";
  ok: boolean;
  blockingIssueCount: number;
  issues: ShadowReleaseGateIssue[];
  checks: {
    rejectedPromotions: number;
    registeredCanonicalIdChanges: number;
    unreviewedConfirmedDrops: number;
    unqualifiedNeedsReviewPromotions: number;
    unreviewedNewConfirmed: number;
  };
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

function evidenceSnapshot(result: IdentityGateResultV2 | undefined): ShadowEvidenceSnapshot[] {
  if (!result) return [];
  return result.evidence.map((item) => ({
    type: item.type,
    provenance: item.provenance,
  }));
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
      const observedConfirmed =
        confirmedMatch ?? (anyExact?.decision === "confirmed_business" ? anyExact : undefined);
      const v2Key = observedConfirmed ? v2CanonicalKey(observedConfirmed) : null;
      const v1Key = entity.canonicalKey ?? null;
      const v1BusinessId = businessIdFromV1(entity);
      const base = {
        measurementId: row.measurementId,
        runId: row.runId,
        v1DisplayName: entity.displayName,
        v1VerificationStatus: entity.verificationStatus,
        v1CanonicalKey: v1Key,
        v1MatchedBusinessId: v1BusinessId,
        v2IdentitySurface: anyExact?.identitySurface,
        v2Decision: anyExact?.decision,
        v2CanonicalKey: v2Key,
        v2CanonicalBusinessId: observedConfirmed?.canonicalBusinessId ?? null,
        canonicalKeyChanged: Boolean(v1Key && v2Key && v1Key !== v2Key),
        v2Reasons: anyExact?.reasons,
        v2Evidence: evidenceSnapshot(anyExact),
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
          v2CanonicalKey: v2CanonicalKey(confirmedMatch),
          v2CanonicalBusinessId: confirmedMatch.canonicalBusinessId ?? null,
          v2Reasons: confirmedMatch.reasons,
          v2Evidence: evidenceSnapshot(confirmedMatch),
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
                v2CanonicalKey: v2CanonicalKey(confirmedMatch),
                v2CanonicalBusinessId: confirmedMatch.canonicalBusinessId ?? null,
                v2Reasons: confirmedMatch.reasons,
                v2Evidence: evidenceSnapshot(confirmedMatch),
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
              v2CanonicalKey: v2CanonicalKey(confirmedMatch),
              v2CanonicalBusinessId: confirmedMatch.canonicalBusinessId ?? null,
              v2Reasons: confirmedMatch.reasons,
              v2Evidence: evidenceSnapshot(confirmedMatch),
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
        v2CanonicalBusinessId: result.canonicalBusinessId ?? null,
        v2Reasons: result.reasons,
        v2Evidence: evidenceSnapshot(result),
      });
    }
  }

  const diffCounts = diffs.reduce<Record<string, number>>((acc, diff) => {
    acc[diff.category] = (acc[diff.category] ?? 0) + 1;
    return acc;
  }, {});

  const count = (category: ShadowDiffCategory) => diffCounts[category] ?? 0;

  return {
    version: "0.2",
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

function approvalKey(measurementId: string, surface: string): string {
  return `${measurementId}:${compact(surface)}`;
}

function approvalSet(approvals: ShadowReviewApproval[] | undefined): Set<string> {
  return new Set(
    (approvals ?? []).map((item) => approvalKey(item.measurementId, item.surface)),
  );
}

function hasStrongScopedPromotionEvidence(diff: ShadowDiff): boolean {
  return (diff.v2Evidence ?? []).some((evidence) => {
    if (
      evidence.type === "registered" &&
      evidence.provenance === "registered_exact_subspan"
    ) {
      return true;
    }

    return (
      (evidence.type === "address" ||
        evidence.type === "phone" ||
        evidence.type === "url") &&
      (evidence.provenance === "same_table_row" ||
        evidence.provenance === "same_list_item" ||
        evidence.provenance === "heading_detail_child")
    );
  });
}

function issueSurface(diff: ShadowDiff): string {
  return diff.v2IdentitySurface ?? diff.v1DisplayName ?? "(unknown)";
}

export function evaluateShadowReleaseGate(
  report: ShadowReplayReport,
  registry: ShadowReleaseReviewRegistry,
): ShadowReleaseGateReport {
  const issues: ShadowReleaseGateIssue[] = [];
  const approvedDrops = approvalSet(registry.approvedConfirmedDrops);
  const approvedNew = approvalSet(registry.approvedNewConfirmed);
  const approvedNeedsReview = approvalSet(registry.approvedNeedsReviewPromotions);

  for (const diff of report.diffs) {
    const surface = issueSurface(diff);

    if (diff.category === "v1_rejected_to_v2_confirmed") {
      issues.push({
        code: "REJECTED_PROMOTED_TO_CONFIRMED",
        measurementId: diff.measurementId,
        surface,
        detail: "A v1 rejected/non-business entity became a v2 confirmed local business.",
      });
      continue;
    }

    if (
      diff.v1MatchedBusinessId &&
      diff.v2CanonicalBusinessId &&
      diff.v1MatchedBusinessId !== diff.v2CanonicalBusinessId
    ) {
      issues.push({
        code: "REGISTERED_CANONICAL_ID_CHANGED",
        measurementId: diff.measurementId,
        surface,
        detail: `Registered business id changed from ${diff.v1MatchedBusinessId} to ${diff.v2CanonicalBusinessId}.`,
      });
    }

    if (diff.category === "v1_confirmed_to_v2_dropped") {
      const key = approvalKey(diff.measurementId, diff.v1DisplayName ?? surface);
      if (!approvedDrops.has(key)) {
        issues.push({
          code: "UNREVIEWED_CONFIRMED_DROP",
          measurementId: diff.measurementId,
          surface: diff.v1DisplayName ?? surface,
          detail: "A previously confirmed entity was dropped without an explicit false-positive review approval.",
        });
      }
      continue;
    }

    if (diff.category === "v1_needs_review_to_v2_confirmed") {
      const key = approvalKey(diff.measurementId, surface);
      if (!hasStrongScopedPromotionEvidence(diff) && !approvedNeedsReview.has(key)) {
        issues.push({
          code: "UNQUALIFIED_NEEDS_REVIEW_PROMOTION",
          measurementId: diff.measurementId,
          surface,
          detail: "A needs-review entity was promoted without registered or tightly-scoped address/phone/url evidence and without manual approval.",
        });
      }
      continue;
    }

    if (diff.category === "v2_new_confirmed") {
      const key = approvalKey(diff.measurementId, surface);
      if (!approvedNew.has(key)) {
        issues.push({
          code: "UNREVIEWED_NEW_CONFIRMED",
          measurementId: diff.measurementId,
          surface,
          detail: "A newly discovered confirmed entity has no v1 counterpart and requires explicit review approval.",
        });
      }
    }
  }

  const count = (code: ShadowReleaseGateIssueCode) =>
    issues.filter((issue) => issue.code === code).length;

  return {
    version: "0.1",
    ok: issues.length === 0,
    blockingIssueCount: issues.length,
    issues,
    checks: {
      rejectedPromotions: count("REJECTED_PROMOTED_TO_CONFIRMED"),
      registeredCanonicalIdChanges: count("REGISTERED_CANONICAL_ID_CHANGED"),
      unreviewedConfirmedDrops: count("UNREVIEWED_CONFIRMED_DROP"),
      unqualifiedNeedsReviewPromotions: count("UNQUALIFIED_NEEDS_REVIEW_PROMOTION"),
      unreviewedNewConfirmed: count("UNREVIEWED_NEW_CONFIRMED"),
    },
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const inputPath = process.argv[2];
  const registryPath = process.argv[3];
  if (!inputPath) {
    console.error(
      "Usage: bun scripts/entity-v2-shadow-replay.ts <dataset.json> [review-registry.json]",
    );
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as ShadowReplayDataset;
    const report = replayDataset(dataset);

    if (!registryPath) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const registry = JSON.parse(
        readFileSync(resolve(registryPath), "utf8"),
      ) as ShadowReleaseReviewRegistry;
      const releaseGate = evaluateShadowReleaseGate(report, registry);
      console.log(JSON.stringify({ ...report, releaseGate }, null, 2));
      if (!releaseGate.ok) process.exitCode = 1;
    }
  }
}
