import type { IdentityDecisionV2 } from "./identity-gate.ts";

export type TargetEquivalenceDecision = "equivalent" | "distinct" | "unresolved";

export type TargetEquivalenceEvidenceKind =
  | "exact_current_business_id"
  | "exact_naver_place_id"
  | "exact_verified_concrete_official_url_with_branch_identity"
  | "exact_full_address_plus_verified_phone";

export interface PublicBusinessIdentityV2 {
  businessId?: string | null;
  name: string;
  aliases?: string[];
  /**
   * Canonical numeric Naver Place ID, or a supported Naver Place URL.
   * Unsupported/malformed non-empty values fail closed.
   */
  canonicalNaverPlaceId?: string | null;
  fullAddress?: string | null;
  verifiedPhone?: string | null;
  /**
   * URLs must already be verified upstream as official business URLs.
   * This engine still rejects root-only URLs and preserves full origins.
   */
  verifiedConcreteOfficialUrls?: string[];
  /**
   * Opaque, pre-verified branch/business identity key.
   * This engine does not derive or fuzzily normalize this key.
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

const NAVER_PLACE_HOSTS = new Set([
  "place.naver.com",
  "m.place.naver.com",
  "map.naver.com",
]);

const NAVER_PLACE_CATEGORY_SEGMENTS = new Set([
  "place",
  "restaurant",
  "cafe",
  "hairshop",
  "hospital",
  "accommodation",
  "attraction",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function hasProvidedValue(value: string | null | undefined): boolean {
  return normalizeText(value).length > 0;
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
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (!NAVER_PLACE_HOSTS.has(host)) return null;

    if (host === "map.naver.com") {
      return (
        url.pathname.match(/\/p\/entry\/place\/(\d{5,})(?:\/|$)/u)?.[1] ??
        url.pathname.match(/\/entry\/place\/(\d{5,})(?:\/|$)/u)?.[1] ??
        url.pathname.match(/\/place\/(\d{5,})(?:\/|$)/u)?.[1] ??
        null
      );
    }

    if (host === "place.naver.com" || host === "m.place.naver.com") {
      const match = url.pathname.match(
        /^\/([a-z][a-z0-9_-]*)\/(\d{5,})(?:\/|$)/iu,
      );
      if (!match) return null;

      const category = match[1]!.toLowerCase();
      return NAVER_PLACE_CATEGORY_SEGMENTS.has(category) ? match[2]! : null;
    }
  } catch {
    // Fail closed below.
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

    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    const originHost = url.port ? `${hostname}:${url.port}` : hostname;
    const origin = `${url.protocol}//${originHost}`;
    const path = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "");

    // A root page remains a corporate/root URL even when it has language,
    // campaign, or redirect query parameters. It is never branch-concrete.
    if (!path) return null;

    const query = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, val]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
      )
      .join("&");

    return `${origin}${path}${query ? `?${query}` : ""}`;
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

function opaqueBranchKey(value: string | null | undefined): string | null {
  const key = value?.trim() ?? "";
  return key.length > 0 ? key : null;
}

function hasCompatibleBranchIdentity(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): boolean {
  const targetKey = opaqueBranchKey(target.branchIdentityKey);
  const observedKey = opaqueBranchKey(observed.branchIdentityKey);
  return !!targetKey && !!observedKey && targetKey === observedKey;
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

function normalizedNaverPlacePair(
  target: TargetBusinessIdentityV2,
  observed: PublicBusinessIdentityV2,
): {
  targetId: string | null;
  observedId: string | null;
  hasInvalidProvidedValue: boolean;
} {
  const targetId = normalizeCanonicalNaverPlaceId(target.canonicalNaverPlaceId);
  const observedId = normalizeCanonicalNaverPlaceId(observed.canonicalNaverPlaceId);

  const targetInvalid =
    hasProvidedValue(target.canonicalNaverPlaceId) && targetId === null;
  const observedInvalid =
    hasProvidedValue(observed.canonicalNaverPlaceId) && observedId === null;

  return {
    targetId,
    observedId,
    hasInvalidProvidedValue: targetInvalid || observedInvalid,
  };
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

  const place = normalizedNaverPlacePair(target, observed);

  // Public identity conflicts/malformed identity outrank an internal row-id
  // match. A stale or wrongly attached businessId must never hide stronger
  // contradictory public evidence.
  if (place.hasInvalidProvidedValue) {
    return unresolved("NAVER_PLACE_ID_INVALID_OR_UNSUPPORTED");
  }

  if (place.targetId && place.observedId && place.targetId !== place.observedId) {
    return distinct("CANONICAL_NAVER_PLACE_ID_CONFLICT");
  }

  if (observed.businessId && observed.businessId === target.businessId) {
    return equivalent(
      target,
      ["exact_current_business_id"],
      ["CURRENT_BUSINESS_ID_MATCH"],
    );
  }

  if (place.targetId && place.observedId && place.targetId === place.observedId) {
    return equivalent(
      target,
      ["exact_naver_place_id"],
      ["CANONICAL_NAVER_PLACE_ID_MATCH"],
    );
  }

  const sharedConcreteUrl = sharesConcreteOfficialUrl(
    target.verifiedConcreteOfficialUrls,
    observed.verifiedConcreteOfficialUrls,
  );

  if (sharedConcreteUrl && hasCompatibleBranchIdentity(target, observed)) {
    return equivalent(
      target,
      ["exact_verified_concrete_official_url_with_branch_identity"],
      ["VERIFIED_CONCRETE_URL_AND_EXACT_BRANCH_IDENTITY_MATCH"],
    );
  }

  if (
    sameNormalizedAddress(target, observed) &&
    sameVerifiedPhone(target, observed)
  ) {
    return equivalent(
      target,
      ["exact_full_address_plus_verified_phone"],
      ["FULL_ADDRESS_AND_VERIFIED_PHONE_MATCH"],
    );
  }

  return unresolved("INSUFFICIENT_STRONG_TARGET_EQUIVALENCE_EVIDENCE");
}
