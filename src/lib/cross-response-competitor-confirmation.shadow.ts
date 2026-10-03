/**
 * Cross-response competitor confirmation shadow v0.1.
 *
 * Shadow-only policy evaluator for unregistered competitor candidates that the
 * per-response Entity Facts v2 identity gate left unresolved.
 *
 * IMPORTANT:
 * - This module is NOT wired into runtime materialization or customer reads.
 * - It never changes targetSeen, targetBestPosition, visibility, Top3, or any
 *   other target metric.
 * - It only evaluates whether an already-canonicalized unregistered competitor
 *   has enough cross-response evidence to become a promotion candidate, or
 *   should be held for merge review.
 * - No business-specific names, domains, ids, or exceptions belong here.
 */

export const CROSS_RESPONSE_COMPETITOR_CONFIRMATION_SHADOW_VERSION = "0.1" as const;

export type CrossResponseCompetitorShadowDecision =
  | "promote_candidate"
  | "merge_review"
  | "already_confirmed"
  | "reject";

export type CrossResponseCompetitorShadowReason =
  | "NOT_UNREGISTERED_AUTO_ENTITY"
  | "VERIFIER_NOT_CONFIRMED"
  | "INSUFFICIENT_DISTINCT_RESPONSES"
  | "CORROBORATING_DOMAIN_MISSING"
  | "SHARED_OR_AGGREGATOR_DOMAIN"
  | "INSUFFICIENT_REPEAT_DOMAIN_SUPPORT"
  | "DIRECT_ATTRIBUTION_MISSING"
  | "ALREADY_IN_V2"
  | "POSSIBLE_SAME_BUSINESS_COLLISION"
  | "CROSS_RESPONSE_EVIDENCE_GATE_PASS";

export interface CrossResponseCompetitorShadowCandidate {
  canonicalKey: string;
  displayName: string;
  /** Existing verifier must already say this is a business. */
  verifierConfirmedBusiness: boolean;
  /** Distinct AI responses in the same run where this candidate was observed. */
  distinctResponseCount: number;
  /**
   * One corroborating domain selected upstream from stored attribution evidence.
   * The shadow evaluator does not infer ownership from a hostname.
   */
  corroboratingDomain: string | null;
  /** Distinct responses in the same run where the candidate was linked to that domain. */
  corroboratingDomainResponseCount: number;
  /** Number of stored direct attributions from the candidate to that domain. */
  directAttributionCount: number;
  /**
   * True when upstream classifies the domain as a shared platform, directory,
   * aggregator, or otherwise unsuitable as strong identity corroboration.
   */
  corroboratingDomainIsSharedOrAggregator: boolean;
}

export interface ExistingV2CompetitorShadowEvidence {
  canonicalKey: string;
  displayName: string;
  corroboratingDomains: string[];
}

export interface CrossResponseCompetitorShadowInput {
  candidate: CrossResponseCompetitorShadowCandidate;
  existingV2Competitors: ExistingV2CompetitorShadowEvidence[];
}

export interface CrossResponseCompetitorShadowResult {
  version: typeof CROSS_RESPONSE_COMPETITOR_CONFIRMATION_SHADOW_VERSION;
  decision: CrossResponseCompetitorShadowDecision;
  reasons: CrossResponseCompetitorShadowReason[];
  collisionCanonicalKeys: string[];
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^www\./u, "");
}

function compactName(value: string): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

/**
 * This is intentionally narrower than general fuzzy matching.
 * A same-domain collision is held for review only when the normalized names
 * are equal or one is a clear prefix/contained form of the other.
 */
export function crossResponseCompetitorNamesPotentiallySameBusiness(
  left: string,
  right: string,
): boolean {
  const a = compactName(left);
  const b = compactName(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 3) return false;

  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

function result(
  decision: CrossResponseCompetitorShadowDecision,
  reasons: CrossResponseCompetitorShadowReason[],
  collisionCanonicalKeys: string[] = [],
): CrossResponseCompetitorShadowResult {
  return {
    version: CROSS_RESPONSE_COMPETITOR_CONFIRMATION_SHADOW_VERSION,
    decision,
    reasons,
    collisionCanonicalKeys: [...new Set(collisionCanonicalKeys)].sort(),
  };
}

export function evaluateCrossResponseCompetitorConfirmationShadow(
  input: CrossResponseCompetitorShadowInput,
): CrossResponseCompetitorShadowResult {
  const { candidate } = input;
  const key = candidate.canonicalKey.trim();
  if (!key.startsWith("auto:")) {
    return result("reject", ["NOT_UNREGISTERED_AUTO_ENTITY"]);
  }

  if (!candidate.verifierConfirmedBusiness) {
    return result("reject", ["VERIFIER_NOT_CONFIRMED"]);
  }

  if (candidate.distinctResponseCount < 2) {
    return result("reject", ["INSUFFICIENT_DISTINCT_RESPONSES"]);
  }

  const domain = normalizeDomain(candidate.corroboratingDomain);
  if (!domain) {
    return result("reject", ["CORROBORATING_DOMAIN_MISSING"]);
  }

  if (candidate.corroboratingDomainIsSharedOrAggregator) {
    return result("reject", ["SHARED_OR_AGGREGATOR_DOMAIN"]);
  }

  if (candidate.corroboratingDomainResponseCount < 2) {
    return result("reject", ["INSUFFICIENT_REPEAT_DOMAIN_SUPPORT"]);
  }

  if (candidate.directAttributionCount < 1) {
    return result("reject", ["DIRECT_ATTRIBUTION_MISSING"]);
  }

  const exactExisting = input.existingV2Competitors.find(
    (item) => item.canonicalKey.trim() === key,
  );
  if (exactExisting) {
    return result("already_confirmed", ["ALREADY_IN_V2"]);
  }

  const collisions = input.existingV2Competitors.filter((item) => {
    if (
      !crossResponseCompetitorNamesPotentiallySameBusiness(
        candidate.displayName,
        item.displayName,
      )
    ) {
      return false;
    }

    return item.corroboratingDomains.some(
      (candidateDomain) => normalizeDomain(candidateDomain) === domain,
    );
  });

  if (collisions.length > 0) {
    return result(
      "merge_review",
      ["POSSIBLE_SAME_BUSINESS_COLLISION"],
      collisions.map((item) => item.canonicalKey),
    );
  }

  return result("promote_candidate", ["CROSS_RESPONSE_EVIDENCE_GATE_PASS"]);
}
