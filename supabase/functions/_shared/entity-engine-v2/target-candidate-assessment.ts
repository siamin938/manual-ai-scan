import {
  normalizeCanonicalNaverPlaceId,
  normalizeFullAddress,
  normalizeIdentitySurface,
  normalizeVerifiedConcreteUrl,
  type PublicBusinessIdentityV2,
  type TargetBusinessIdentityV2,
} from "./target-equivalence.ts";
import type { TargetCandidateAssessmentV2 } from "./measurement-entity-facts.ts";

export const TARGET_CANDIDATE_ASSESSMENT_VERSION = "0.1" as const;

export interface TargetCandidateAssessmentInputV2 {
  target: TargetBusinessIdentityV2;
  observed: PublicBusinessIdentityV2;
  observedSurface?: string | null;
  inputComplete: boolean;
}

function stable(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
}

function surfaces(identity: PublicBusinessIdentityV2): string[] {
  return stable(
    [identity.name, ...(identity.aliases ?? [])]
      .map((value) => normalizeIdentitySurface(value))
      .filter(Boolean),
  );
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) count += 1;
  return count;
}

function surfaceRelated(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;

  const prefix = commonPrefixLength(left, right);
  const minLength = Math.min(left.length, right.length);
  return prefix >= 4 && prefix / minLength >= 0.55;
}

function sharedSurface(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
  observedSurface: string | null | undefined,
): { exact: boolean; related: boolean; aliasOverlap: boolean } {
  const targetSurfaces = surfaces(target);
  const observedPrimarySurfaces = stable([
    normalizeIdentitySurface(observed.name),
    normalizeIdentitySurface(observedSurface),
  ]);
  const observedAliases = stable(
    (observed.aliases ?? []).map((value) => normalizeIdentitySurface(value)),
  );
  const observedSurfaces = stable([
    ...observedPrimarySurfaces,
    ...observedAliases,
  ]);

  const exact = observedPrimarySurfaces.some((value) =>
    targetSurfaces.includes(value),
  );
  const aliasOverlap = observedAliases.some((value) =>
    targetSurfaces.includes(value),
  );
  const related = observedSurfaces.some((observedValue) =>
    targetSurfaces.some((targetValue) =>
      surfaceRelated(targetValue, observedValue),
    ),
  );

  return { exact, related, aliasOverlap };
}

function sharedConcreteOfficialUrl(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const targetUrls = new Set(
    (target.verifiedConcreteOfficialUrls ?? [])
      .map(normalizeVerifiedConcreteUrl)
      .filter((value): value is string => Boolean(value)),
  );
  return (observed.verifiedConcreteOfficialUrls ?? [])
    .map(normalizeVerifiedConcreteUrl)
    .some((value) => Boolean(value && targetUrls.has(value)));
}

function result(
  decision: TargetCandidateAssessmentV2["decision"],
  reasonCodes: string[],
  evidenceKinds: string[],
  inputComplete: boolean,
): TargetCandidateAssessmentV2 {
  return {
    decision,
    version: TARGET_CANDIDATE_ASSESSMENT_VERSION,
    reasonCodes: stable(reasonCodes),
    evidenceKinds: stable(evidenceKinds),
    inputComplete,
  };
}

export function assessTargetCandidateV2(
  input: TargetCandidateAssessmentInputV2,
): TargetCandidateAssessmentV2 {
  const targetId = input.target.businessId?.trim() ?? "";
  const observedSurface = normalizeIdentitySurface(
    input.observedSurface ?? input.observed.name,
  );

  if (
    !input.inputComplete ||
    !targetId ||
    !normalizeIdentitySurface(input.target.name) ||
    !observedSurface
  ) {
    return result(
      "unknown",
      ["TARGET_CANDIDATE_INPUT_INCOMPLETE"],
      [],
      false,
    );
  }

  const targetPlace = normalizeCanonicalNaverPlaceId(
    input.target.canonicalNaverPlaceId,
  );
  const observedPlace = normalizeCanonicalNaverPlaceId(
    input.observed.canonicalNaverPlaceId,
  );

  if (targetPlace && observedPlace && targetPlace !== observedPlace) {
    return result(
      "not_candidate",
      ["TARGET_CANDIDATE_NAVER_PLACE_CONFLICT"],
      ["canonical_naver_place_conflict"],
      true,
    );
  }

  if (
    input.observed.businessId &&
    input.observed.businessId === input.target.businessId
  ) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_CURRENT_BUSINESS_ID_MATCH"],
      ["exact_current_business_id"],
      true,
    );
  }

  if (targetPlace && observedPlace && targetPlace === observedPlace) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_NAVER_PLACE_MATCH"],
      ["exact_naver_place_id"],
      true,
    );
  }

  const relation = sharedSurface(
    input.target,
    input.observed,
    input.observedSurface,
  );

  if (relation.exact) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_EXACT_SURFACE"],
      ["exact_target_surface"],
      true,
    );
  }

  if (relation.aliasOverlap) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_PUBLIC_ALIAS_OVERLAP"],
      ["public_alias_overlap"],
      true,
    );
  }

  const targetAddress = normalizeFullAddress(input.target.fullAddress);
  const observedAddress = normalizeFullAddress(input.observed.fullAddress);
  if (targetAddress && observedAddress && targetAddress === observedAddress) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_ADDRESS_RECALL_MATCH"],
      ["exact_full_address_recall"],
      true,
    );
  }

  if (sharedConcreteOfficialUrl(input.target, input.observed)) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_CONCRETE_URL_RECALL_MATCH"],
      ["exact_concrete_official_url_recall"],
      true,
    );
  }

  if (relation.related) {
    return result(
      "candidate",
      ["TARGET_CANDIDATE_SURFACE_RELATED"],
      ["surface_recall_relation"],
      true,
    );
  }

  return result(
    "not_candidate",
    ["TARGET_CANDIDATE_NO_RECALL_RELATION"],
    ["surface_recall_negative"],
    true,
  );
}
