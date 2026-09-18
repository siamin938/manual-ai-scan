import type { IdentityDecisionV2 } from "./identity-gate.ts";

export type TargetEquivalenceDecision = "equivalent" | "distinct" | "unresolved";

export type TargetEquivalenceEvidenceKind =
  | "exact_current_business_id"
  | "exact_naver_place_id"
  | "exact_verified_concrete_official_url"
  | "explicit_target_owned_alias"
  | "exact_full_address_plus_verified_phone"
  | "exact_full_address_plus_target_owned_alias"
  | "exact_full_address_plus_naver_place_id"
  | "exact_full_address_plus_verified_concrete_official_url";

export interface PublicBusinessIdentityV2 {
  businessId?: string | null;
  name: string;
  aliases?: string[];
  canonicalNaverPlaceId?: string | null;
  fullAddress?: string | null;
  verifiedPhone?: string | null;
  verifiedConcreteOfficialUrls?: string[];
  /**
   * A pre-verified branch/business identity key supplied by an upstream identity
   * normalizer. This engine intentionally does not derive it from fuzzy names.
   */
  branchIdentityKey?: string | null;
}

export interface TargetBusinessIdentityV2 extends PublicBusinessIdentityV2 {
  businessId: string;
}

export interface TargetEquivalenceInputV2 {
  target: TargetBusinessIdentityV2;
  observed: PublicBusinessIdentityV2;
  observedIdentityDecision: IdentityDecisionV2;
}

export interface TargetEquivalenceResultV2 {
  decision: TargetEquivalenceDecision;
  projectedCanonicalKey: `business:${string}` | null;
  evidenceKinds: TargetEquivalenceEvidenceKind[];
  reasons: string[];
}

const TRACKING_PARAM =
  /^(utm_|ref$|referrer$|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$)/i;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function normalizeIdentitySurface(value: string | null | undefined): string {
  return normalizeText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

export function normalizeCanonicalNaverPlaceId(
  value: string | null | undefined,
): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  const direct = text.match(/^\d{5,}$/u)?.[0];
  if (direct) return direct;

  try {
    const url = new URL(text);
    const entry = url.pathname.match(/\/place\/(\d{5,})/u)?.[1];
    if (entry) return entry;

    const query =
      url.searchParams.get("placeId") ??
      url.searchParams.get("place_id") ??
      url.searchParams.get("id");
    if (query && /^\d{5,}$/u.test(query)) return query;
  } catch {
    // Fail closed: a non-canonical, non-numeric value is not a Place identity.
  }

  return null;
}

export function normalizeFullAddress(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[(),·]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;

  // Preserve unit/building numbers while removing formatting-only separators.
  return normalized.replace(/\s*([/-])\s*/gu, "$1");
}

export function normalizeVerifiedPhone(
  value: string | null | undefined,
): string | null {
  const digits = (value ?? "").replace(/\D/gu, "");
  return digits.length >= 9 ? digits : null;
}

export function normalizeVerifiedConcreteUrl(
  raw: string | null | undefined,
): string | null {
  const value = normalizeText(raw);
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    const path = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "");
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, val]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
      )
      .join("&");

    // A root domain alone is deliberately not a concrete business/branch URL.
    if (!path && !query) return null;

    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function normalizedConcreteUrlSet(values: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of values ?? []) {
    const normalized = normalizeVerifiedConcreteUrl(raw);
    if (normalized) out.add(normalized);
  }
  return out;
}

function sharesConcreteOfficialUrl(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const leftSet = normalizedConcreteUrlSet(left);
  const rightSet = normalizedConcreteUrlSet(right);
  for (const url of leftSet) {
    if (rightSet.has(url)) return true;
  }
  return false;
}

function normalizedBranchKey(value: string | null | undefined): string | null {
  const key = normalizeIdentitySurface(value);
  return key.length >= 2 ? key : null;
}

function hasCompatibleBranchIdentity(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const targetKey = normalizedBranchKey(target.branchIdentityKey);
  const observedKey = normalizedBranchKey(observed.branchIdentityKey);
  return !!targetKey && !!observedKey && targetKey === observedKey;
}

function targetOwnedSurfaces(target: TargetBusinessIdentityV2): Set<string> {
  const values = [target.name, ...(target.aliases ?? [])];
  return new Set(
    values
      .map(normalizeIdentitySurface)
      .filter((value) => value.length >= 2),
  );
}

function observedMatchesTargetOwnedAlias(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const observedSurface = normalizeIdentitySurface(observed.name);
  return (
    observedSurface.length >= 2 &&
    targetOwnedSurfaces(target).has(observedSurface)
  );
}

function sameNormalizedAddress(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const left = normalizeFullAddress(target.fullAddress);
  const right = normalizeFullAddress(observed.fullAddress);
  return !!left && !!right && left === right;
}

function sameVerifiedPhone(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const left = normalizeVerifiedPhone(target.verifiedPhone);
  const right = normalizeVerifiedPhone(observed.verifiedPhone);
  return !!left && !!right && left === right;
}

function sameNaverPlaceId(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const left = normalizeCanonicalNaverPlaceId(target.canonicalNaverPlaceId);
  const right = normalizeCanonicalNaverPlaceId(observed.canonicalNaverPlaceId);
  return !!left && !!right && left === right;
}

function naverPlaceIdConflict(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const left = normalizeCanonicalNaverPlaceId(target.canonicalNaverPlaceId);
  const right = normalizeCanonicalNaverPlaceId(observed.canonicalNaverPlaceId);
  return !!left && !!right && left !== right;
}

function equivalent(
  target: TargetBusinessIdentityV2,
  evidenceKinds: TargetEquivalenceEvidenceKind[],
  reasons: string[],
): TargetEquivalenceResultV2 {
  return {
    decision: "equivalent",
    projectedCanonicalKey: `business:${target.businessId}`,
    evidenceKinds,
    reasons,
  };
}

function distinct(reason: string): TargetEquivalenceResultV2 {
  return {
    decision: "distinct",
    projectedCanonicalKey: null,
    evidenceKinds: [],
    reasons: [reason],
  };
}

function unresolved(reason: string): TargetEquivalenceResultV2 {
  return {
    decision: "unresolved",
    projectedCanonicalKey: null,
    evidenceKinds: [],
    reasons: [reason],
  };
}

export function evaluateTargetEquivalenceV2(
  input: TargetEquivalenceInputV2,
): TargetEquivalenceResultV2 {
  const { target, observed, observedIdentityDecision } = input;

  if (!target.businessId.trim()) {
    return unresolved("TARGET_BUSINESS_ID_MISSING");
  }

  if (observedIdentityDecision !== "confirmed_business") {
    return unresolved("OBSERVED_ENTITY_NOT_CONFIRMED_BUSINESS");
  }

  if (observed.businessId && observed.businessId === target.businessId) {
    return equivalent(
      target,
      ["exact_current_business_id"],
      ["CURRENT_BUSINESS_ID_MATCH"],
    );
  }

  // Conflicting canonical place identities are a strong negative signal and
  // override weaker name/address evidence.
  if (naverPlaceIdConflict(target, observed)) {
    return distinct("CANONICAL_NAVER_PLACE_ID_CONFLICT");
  }

  if (sameNaverPlaceId(target, observed)) {
    return equivalent(
      target,
      ["exact_naver_place_id"],
      ["CANONICAL_NAVER_PLACE_ID_MATCH"],
    );
  }

  const aliasMatch = observedMatchesTargetOwnedAlias(target, observed);
  const sharedConcreteUrl = sharesConcreteOfficialUrl(
    target.verifiedConcreteOfficialUrls,
    observed.verifiedConcreteOfficialUrls,
  );

  if (sharedConcreteUrl && hasCompatibleBranchIdentity(target, observed)) {
    return equivalent(
      target,
      ["exact_verified_concrete_official_url"],
      ["VERIFIED_CONCRETE_URL_AND_BRANCH_IDENTITY_MATCH"],
    );
  }

  if (aliasMatch) {
    return equivalent(
      target,
      ["explicit_target_owned_alias"],
      ["TARGET_OWNED_ALIAS_MATCH"],
    );
  }

  if (sameNormalizedAddress(target, observed)) {
    if (sameVerifiedPhone(target, observed)) {
      return equivalent(
        target,
        ["exact_full_address_plus_verified_phone"],
        ["FULL_ADDRESS_AND_VERIFIED_PHONE_MATCH"],
      );
    }

    if (aliasMatch) {
      return equivalent(
        target,
        ["exact_full_address_plus_target_owned_alias"],
        ["FULL_ADDRESS_AND_TARGET_OWNED_ALIAS_MATCH"],
      );
    }

    if (sameNaverPlaceId(target, observed)) {
      return equivalent(
        target,
        ["exact_full_address_plus_naver_place_id"],
        ["FULL_ADDRESS_AND_NAVER_PLACE_ID_MATCH"],
      );
    }

    if (sharedConcreteUrl) {
      return equivalent(
        target,
        ["exact_full_address_plus_verified_concrete_official_url"],
        ["FULL_ADDRESS_AND_VERIFIED_CONCRETE_URL_MATCH"],
      );
    }
  }

  return unresolved("INSUFFICIENT_STRONG_TARGET_EQUIVALENCE_EVIDENCE");
}
