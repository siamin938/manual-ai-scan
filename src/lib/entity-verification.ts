/**
 * Entity Verification v0.1 (pure, deterministic).
 *
 * PURPOSE
 * Parser v1.2.3 attributes recommendation-slot context (address / URL / region)
 * to the candidate itself, so headings, question sentences and brand service
 * networks can be promoted to `specific_business / confirmed`. This layer runs
 * AFTER the parser and never mutates parser columns: it only decides whether a
 * candidate has enough INTRINSIC evidence to be counted as a business.
 *
 * SECURITY / SAFETY CONTRACT
 * - Pure functions. No Supabase, no secrets, no network, no provider calls.
 * - Inputs are limited to mention metadata; response_text, resolution_evidence,
 *   aliases, registry internals and insight weights are NEVER inputs.
 * - reasonCodes are internal only and must not be surfaced to the browser.
 */

export const ENTITY_VERIFIER_VERSION = "0.1.0";

export type VerificationStatus =
  | "confirmed_business"
  | "rejected_non_business"
  | "needs_review";

export type VerifiedEntityKind =
  | "specific_business"
  | "brand_network"
  | "generic_category"
  | "platform"
  | "advice"
  | "ambiguous";

export type VerificationConfidence = "high" | "medium" | "low";

export type EntityVerificationInput = {
  mentionId: string;
  measurementId: string;
  matchedBusinessId: string | null;
  displayName: string;
  entityKind?: string | null;
  specificity?: string | null;
  countAsConfirmedBusiness?: boolean | null;
  resolutionConfidence?: string | null;
};

export type EntityVerificationResult = {
  verificationStatus: VerificationStatus;
  verifiedEntityKind: VerifiedEntityKind;
  verifiedCountAsBusiness: boolean;
  confidence: VerificationConfidence;
  reasonCodes: string[];
};

/* ------------------------------------------------------------------ */
/* structural patterns (grammar-level, not brand blacklists)           */
/* ------------------------------------------------------------------ */

const SENTENCE_MIN_LENGTH = 12;

/** Predicate / interrogative endings that mark a sentence, not a shop name. */
const SENTENCE_MARKERS = [
  "?",
  "나요",
  "까요",
  "습니까",
  "인가요",
  "있나요",
  "없나요",
  "어떻게",
  "무엇",
  "왜 ",
  "여부",
  "가능한지",
  "하는지",
  "되는지",
  "인지",
  "습니다",
  "합니다",
  "됩니다",
];

/** Heading / criteria grammar: noun phrase without any proper-shop identity. */
const HEADING_SUFFIXES = [
  "기준",
  "사항",
  "유형별",
  "유형별추천",
  "위주",
  "고려할곳",
  "고려할것",
  "추천순위",
  "추천",
  "순위",
  "정리",
  "요약",
  "결론",
  "비교",
  "체크리스트",
];

/** Generic brand / dealer network expressions. */
const NETWORK_SUFFIXES = [
  "네트워크",
  "서비스망",
  "정비망",
  "협력망",
  "지정정비망",
  "딜러망",
];

/**
 * Strong proper-shop descriptors (intrinsic business evidence).
 * v0.1.1: generic service words (튜닝) and non-identity qualifiers (전문점)
 * removed — they describe a service, not a proper shop identity.
 */
const STRONG_DESCRIPTORS = [
  "모터스",
  "모터",
  "개러지",
  "거라지",
  "garage",
  "팩토리",
  "factory",
  "정비센터",
  "정비소",
  "정비공장",
  "공업사",
  "카센터",
  "카센타",
  "카케어",
  "오토",
  "auto",
  "바디샵",
  "공임나라",
  "협력점",
  "상사",
];

/** Branch / store markers (v0.1.1: 전문점 is not a branch marker). */
const BRANCH_SUFFIXES = ["본점", "지점", "직영점", "분점", "협력점", "대리점"];

/** Predicate / interrogative sentence endings (grammar, not vocabulary). */
const SENTENCE_ENDING_RE =
  /(나요|가요|까요|습니까|습니다|입니다|합니다|됩니다|는지|은지|는가|은가|인가|이라면|라면)[\s.?!*)\]:_"'`~-]*$/;

/** Enumeration separators for service / attribute / checklist listings. */
const ENUMERATION_SEPARATOR_RE = /[·ㆍ・,、/]/;
const ENUMERATION_CONJUNCTION_RE = /(^|\s)(및|또는|등)(\s|$)/;

/** Label / arrow style explanatory constructs. */
const LABEL_CONSTRUCT_RE = /[:：]|→|=>/;

/** Quantified plural shop expressions: 2~3곳, 몇 곳, 여러 곳 ... */
const QUANTIFIED_PLACES_RE = /(\d+\s*[~\-–]\s*\d+\s*곳|\d+\s*곳|(몇|여러|두세|서너)\s*곳)/;

/** Clause particles that mark a descriptive sentence fragment. */
const CLAUSE_PARTICLES = ["에서", "에게", "으로", "에는", "까지", "부터", "와", "과", "을", "를", "이나", "거나"];

const OFFICIAL_MARKERS = ["공식", "지정", "인증"];
const SERVICE_CATEGORY_WORDS = [
  "정비사업소",
  "사업소",
  "정비소",
  "정비센터",
  "서비스센터",
  "서비스",
  "정비",
  "협력업체",
];


const NON_BUSINESS_ORIGINAL_KINDS = new Set([
  "advice",
  "platform",
  "generic_category",
  "brand_network",
]);

function normalize(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function compact(text: string): string {
  return normalize(text).replace(/\s+/g, "").toLowerCase();
}

export function isSentenceLike(displayName: string): boolean {
  const text = normalize(displayName);
  if (text.includes("?")) return true;
  if (SENTENCE_ENDING_RE.test(text)) return true;
  if (text.length < SENTENCE_MIN_LENGTH) return false;
  return SENTENCE_MARKERS.some((marker) => text.includes(marker));
}


export function isHeadingLike(displayName: string): boolean {
  const c = compact(displayName);
  if (c.length === 0) return true;
  if (hasStrongDescriptor(displayName)) return false;
  return HEADING_SUFFIXES.some((suffix) => c === suffix || c.endsWith(suffix));
}

export function hasBranchMarker(displayName: string): boolean {
  const c = compact(displayName);
  if (BRANCH_SUFFIXES.some((s) => c.endsWith(s))) return true;
  // "서비스센터 + 고유 지점명" (brand service center with a branch identifier)
  if (c.includes("서비스센터") && tokenCount(displayName) >= 3) return true;
  // generic "XX점" store marker, but not a single-syllable artifact
  if (/[가-힣a-z0-9]{2,}점$/.test(c) && !c.endsWith("지점없음")) return true;
  return false;
}

export function hasStrongDescriptor(displayName: string): boolean {
  const c = compact(displayName);
  return STRONG_DESCRIPTORS.some((d) => c.includes(d));
}

export function isGenericNetworkName(displayName: string): boolean {
  const c = compact(displayName);
  if (c.length === 0) return false;
  if (!NETWORK_SUFFIXES.some((s) => c.endsWith(s))) return false;
  // a network expression carrying a concrete branch/store identifier is not generic
  return !hasBranchMarker(displayName);
}

function tokenCount(displayName: string): number {
  const text = normalize(displayName);
  return text.length === 0 ? 0 : text.split(" ").length;
}

/** Short, name-like noun phrase (no sentence grammar). */
export function isShortProperNamePhrase(displayName: string): boolean {
  const tokens = tokenCount(displayName);
  if (tokens < 1 || tokens > 8) return false;
  if (isSentenceLike(displayName)) return false;
  return normalize(displayName).length <= 40;
}

/* ------------------------------------------------------------------ */
/* verifier                                                            */
/* ------------------------------------------------------------------ */

function result(
  verificationStatus: VerificationStatus,
  verifiedEntityKind: VerifiedEntityKind,
  verifiedCountAsBusiness: boolean,
  confidence: VerificationConfidence,
  reasonCodes: string[],
): EntityVerificationResult {
  return {
    verificationStatus,
    verifiedEntityKind,
    verifiedCountAsBusiness,
    confidence,
    reasonCodes,
  };
}

export function verifyEntityMention(input: EntityVerificationInput): EntityVerificationResult {
  const name = normalize(input.displayName);
  const originalKind = input.entityKind ?? null;
  const originalSpecificity = input.specificity ?? null;
  const originalConfirmed =
    originalKind === "specific_business" &&
    originalSpecificity === "confirmed" &&
    input.countAsConfirmedBusiness === true;

  // A. exact linkage to a registered business wins
  if (input.matchedBusinessId && originalConfirmed) {
    return result("confirmed_business", "specific_business", true, "high", [
      "REGISTERED_BUSINESS_MATCH",
    ]);
  }
  if (input.matchedBusinessId) {
    return result("needs_review", "specific_business", false, "low", [
      "REGISTERED_BUSINESS_MATCH",
      "PROBABLE_ONLY",
    ]);
  }

  // E. respect original non-business classifications
  if (originalKind && NON_BUSINESS_ORIGINAL_KINDS.has(originalKind)) {
    const kind = originalKind as VerifiedEntityKind;
    return result("rejected_non_business", kind, false, "high", ["ORIGINAL_NON_BUSINESS_KIND"]);
  }

  if (name.length === 0) {
    return result("rejected_non_business", "ambiguous", false, "high", ["SENTENCE_LIKE"]);
  }

  // C. candidate-intrinsic non-business structure
  if (isSentenceLike(name)) {
    return result("rejected_non_business", "advice", false, "high", ["SENTENCE_LIKE"]);
  }
  if (isGenericNetworkName(name)) {
    return result("rejected_non_business", "brand_network", false, "high", ["GENERIC_NETWORK"]);
  }
  if (isHeadingLike(name)) {
    return result("rejected_non_business", "generic_category", false, "high", [
      "HEADING_CRITERIA_PHRASE",
    ]);
  }

  // D. positive intrinsic evidence
  const reasonCodes: string[] = [];
  const descriptor = hasStrongDescriptor(name);
  const branch = hasBranchMarker(name);
  if (descriptor) reasonCodes.push("STRONG_BUSINESS_DESCRIPTOR");
  if (branch) reasonCodes.push("BRANCH_MARKER");
  const strongIntrinsic = (descriptor || branch) && isShortProperNamePhrase(name);

  // F. probable / ambiguous originals never get promoted in v0.1
  const probableOnly = !originalConfirmed;
  if (probableOnly) {
    reasonCodes.push("PROBABLE_ONLY");
    if (strongIntrinsic) {
      return result("needs_review", "specific_business", false, "medium", reasonCodes);
    }
    return result("needs_review", "ambiguous", false, "low", reasonCodes);
  }

  if (strongIntrinsic) {
    return result("confirmed_business", "specific_business", true, "high", reasonCodes);
  }

  if (isShortProperNamePhrase(name)) {
    reasonCodes.push("INTRINSIC_PROPER_NAME");
    return result("needs_review", "ambiguous", false, "low", reasonCodes);
  }

  return result("rejected_non_business", "ambiguous", false, "medium", ["SENTENCE_LIKE"]);
}

/* ------------------------------------------------------------------ */
/* persistence mapping helpers (pure)                                  */
/* ------------------------------------------------------------------ */

export type EntityVerificationRow = {
  org_id: string;
  business_id: string;
  measurement_id: string;
  measurement_mention_id: string;
  verifier_version: string;
  verification_status: VerificationStatus;
  verified_entity_kind: VerifiedEntityKind;
  verified_count_as_business: boolean;
  confidence: VerificationConfidence;
  reason_codes: string[];
};

export type EntityVerificationSummary = {
  verifierVersion: string;
  mentionCount: number;
  insertedCount: number;
  skippedCount: number;
  confirmedBusinessCount: number;
  rejectedCount: number;
  needsReviewCount: number;
};

/** Deterministic + idempotent: mentions already verified at this version are skipped. */
export function buildEntityVerificationRows(args: {
  orgId: string;
  businessId: string;
  mentions: readonly EntityVerificationInput[];
  existingMentionIds: ReadonlySet<string>;
}): { rows: EntityVerificationRow[]; skippedCount: number } {
  const rows: EntityVerificationRow[] = [];
  let skippedCount = 0;
  for (const mention of args.mentions) {
    if (args.existingMentionIds.has(mention.mentionId)) {
      skippedCount += 1;
      continue;
    }
    const verdict = verifyEntityMention(mention);
    rows.push({
      org_id: args.orgId,
      business_id: args.businessId,
      measurement_id: mention.measurementId,
      measurement_mention_id: mention.mentionId,
      verifier_version: ENTITY_VERIFIER_VERSION,
      verification_status: verdict.verificationStatus,
      verified_entity_kind: verdict.verifiedEntityKind,
      verified_count_as_business: verdict.verifiedCountAsBusiness,
      confidence: verdict.confidence,
      reason_codes: verdict.reasonCodes,
    });
  }
  return { rows, skippedCount };
}

export function summarizeEntityVerificationRows(args: {
  mentionCount: number;
  insertedRows: readonly EntityVerificationRow[];
  skippedCount: number;
}): EntityVerificationSummary {
  let confirmedBusinessCount = 0;
  let rejectedCount = 0;
  let needsReviewCount = 0;
  for (const row of args.insertedRows) {
    if (row.verification_status === "confirmed_business") confirmedBusinessCount += 1;
    else if (row.verification_status === "rejected_non_business") rejectedCount += 1;
    else needsReviewCount += 1;
  }
  return {
    verifierVersion: ENTITY_VERIFIER_VERSION,
    mentionCount: args.mentionCount,
    insertedCount: args.insertedRows.length,
    skippedCount: args.skippedCount,
    confirmedBusinessCount,
    rejectedCount,
    needsReviewCount,
  };
}

/** UI gate: is this mention allowed to appear as an auto-discovered business? */
export function isVerifiedBusinessMention(
  verification: {
    verifier_version?: string | null;
    verification_status?: string | null;
    verified_count_as_business?: boolean | null;
  } | null
    | undefined,
): boolean {
  if (!verification) return false;
  return (
    verification.verifier_version === ENTITY_VERIFIER_VERSION &&
    verification.verification_status === "confirmed_business" &&
    verification.verified_count_as_business === true
  );
}
