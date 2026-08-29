/**
 * Entity Verification v0.1.3 rule engine (server-only, pure).
 *
 * CORE ENGINE ISOLATION
 * - `*.server.ts` is blocked from client bundles: these rules never reach the browser.
 * - Pure functions only: no Supabase, no secrets, no network, no provider calls.
 * - Inputs are limited to mention metadata + run-scoped repetition counts.
 *   response_text, resolution_evidence, aliases and insight weights are NEVER inputs.
 * - reasonCodes are internal only and must not be surfaced to the browser.
 *
 * v0.1.2 CHANGES (generic — never business-specific)
 * - `PROBABLE_ONLY` is no longer an absolute downgrade. It is only a
 *   needs_review reason when neither strong nor repeated evidence exists.
 * - Strong intrinsic evidence (BRANCH_MARKER / STRONG_BUSINESS_DESCRIPTOR /
 *   REGISTERED_BUSINESS_MATCH) on a short proper-name phrase confirms.
 * - Parser-side `specific_business` candidates without a strong signal confirm
 *   when the same normalized candidate repeats across >= 2 distinct
 *   measurements of the same scope (`REPEATED_ACROSS_RESPONSES`).
 * - Only `specific_business` can be auto-confirmed. Repetition never promotes
 *   ambiguous / generic / service / list / non-business candidates, and low
 *   confidence candidates are never confirmed by repetition alone.
 */

export const ENTITY_VERIFIER_ENGINE_VERSION = "0.1.4";

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

const NETWORK_SUFFIXES = ["네트워크", "서비스망", "정비망", "협력망", "지정정비망", "딜러망"];

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

const BRANCH_SUFFIXES = ["본점", "지점", "직영점", "분점", "협력점", "대리점"];

const SENTENCE_ENDING_RE =
  /(나요|가요|까요|습니까|습니다|입니다|합니다|됩니다|는지|은지|는가|은가|인가|이라면|라면)[\s.?!*)\]:_"'`~-]*$/;

const ENUMERATION_SEPARATOR_RE = /[·ㆍ・,、/]/;
const ENUMERATION_CONJUNCTION_RE = /(^|\s)(및|또는|등)(\s|$)/;
const LABEL_CONSTRUCT_RE = /[:：]|→|=>/;
const QUANTIFIED_PLACES_RE = /(\d+\s*[~\-–]\s*\d+\s*곳|\d+\s*곳|(몇|여러|두세|서너)\s*곳)/;

const CLAUSE_PARTICLES = [
  "에서",
  "에게",
  "으로",
  "에는",
  "까지",
  "부터",
  "와",
  "과",
  "을",
  "를",
  "이나",
  "거나",
];

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

/** Run-level repetition key. Conservative: whitespace/case normalization only. */
export function candidateRepeatKey(displayName: string): string {
  return compact(displayName);
}

function tokenCount(displayName: string): number {
  const text = normalize(displayName);
  return text.length === 0 ? 0 : text.split(" ").length;
}

export function isSentenceLike(displayName: string): boolean {
  const text = normalize(displayName);
  if (text.includes("?")) return true;
  if (SENTENCE_ENDING_RE.test(text)) return true;
  if (text.length < SENTENCE_MIN_LENGTH) return false;
  return SENTENCE_MARKERS.some((marker) => text.includes(marker));
}

const CATEGORY_STORE_SUFFIXES = ["전문점", "취급점", "판매점", "대행점"];

export function hasBranchMarker(displayName: string): boolean {
  const c = compact(displayName);
  if (CATEGORY_STORE_SUFFIXES.some((s) => c.endsWith(s))) return false;
  if (BRANCH_SUFFIXES.some((s) => c.endsWith(s))) return true;
  if (c.includes("서비스센터") && tokenCount(displayName) >= 3) return true;
  if (/[가-힣a-z0-9]{2,}점$/.test(c) && !c.endsWith("지점없음")) return true;
  return false;
}

export function hasStrongDescriptor(displayName: string): boolean {
  const c = compact(displayName);
  return STRONG_DESCRIPTORS.some((d) => c.includes(d));
}

export function isHeadingLike(displayName: string): boolean {
  const c = compact(displayName);
  if (c.length === 0) return true;
  if (hasStrongDescriptor(displayName)) return false;
  return HEADING_SUFFIXES.some((suffix) => c === suffix || c.endsWith(suffix));
}

export function isGenericNetworkName(displayName: string): boolean {
  const c = compact(displayName);
  if (c.length === 0) return false;
  if (!NETWORK_SUFFIXES.some((s) => c.endsWith(s))) return false;
  return !hasBranchMarker(displayName);
}

export function isDescriptiveCriteriaLike(displayName: string): boolean {
  const text = normalize(displayName);
  const c = compact(text);
  if (c.length === 0) return false;

  if (LABEL_CONSTRUCT_RE.test(text)) return true;
  if (QUANTIFIED_PLACES_RE.test(text)) return true;

  if (c.endsWith("경우") || c.endsWith("할때") || c.endsWith("일때")) return true;
  if (c.includes("할때") || c.includes("인경우") || c.includes("는경우")) return true;
  if (c.includes("계열") || c.includes("위주") || c.includes("종류별") || c.includes("유형별"))
    return true;

  const tokens = text.split(" ");
  if (tokens.length >= 3) {
    const hasParticleToken = tokens.some((token, index) => {
      if (index === tokens.length - 1) return false;
      const t = token.replace(/[*_"'`~()[\]]/g, "");
      return t.length >= 3 && CLAUSE_PARTICLES.some((p) => t.endsWith(p));
    });
    if (hasParticleToken) return true;
  }
  return false;
}

export function isServiceOrCriteriaEnumeration(displayName: string): boolean {
  const text = normalize(displayName);
  if (text.length === 0) return false;
  if (ENUMERATION_SEPARATOR_RE.test(text)) return true;
  if (ENUMERATION_CONJUNCTION_RE.test(text)) return true;
  return false;
}

export function isGenericOfficialServiceCategory(displayName: string): boolean {
  const c = compact(displayName);
  if (c.length === 0) return false;
  if (!OFFICIAL_MARKERS.some((m) => c.includes(m))) return false;
  if (!SERVICE_CATEGORY_WORDS.some((w) => c.includes(w))) return false;
  return !hasBranchMarker(displayName);
}

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

export type VerificationContext = {
  /** distinct measurement count of this normalized candidate inside the scope */
  repeatCount?: number;
  /**
   * distinct measurement count restricted to rows the parser classified as
   * `ambiguous` + `probable` (v0.1.4).
   */
  probableRepeatCount?: number;
};

const MIN_REPEAT_FOR_CONFIRM = 2;

export function verifyEntityMention(
  input: EntityVerificationInput,
  context: VerificationContext = {},
): EntityVerificationResult {
  const name = normalize(input.displayName);
  const originalKind = input.entityKind ?? null;
  const originalSpecificity = input.specificity ?? null;
  const originalConfirmed =
    originalKind === "specific_business" &&
    originalSpecificity === "confirmed" &&
    input.countAsConfirmedBusiness === true;
  const repeatCount =
    typeof context.repeatCount === "number" && Number.isFinite(context.repeatCount)
      ? context.repeatCount
      : 1;
  const probableRepeatCount =
    typeof context.probableRepeatCount === "number" && Number.isFinite(context.probableRepeatCount)
      ? context.probableRepeatCount
      : 1;

  // A. exact linkage to a registered business wins
  if (input.matchedBusinessId && originalConfirmed) {
    return result("confirmed_business", "specific_business", true, "high", [
      "REGISTERED_BUSINESS_MATCH",
    ]);
  }

  // B. respect original non-business classifications
  if (originalKind && NON_BUSINESS_ORIGINAL_KINDS.has(originalKind)) {
    const kind = originalKind as VerifiedEntityKind;
    return result("rejected_non_business", kind, false, "high", ["ORIGINAL_NON_BUSINESS_KIND"]);
  }

  if (name.length === 0) {
    return result("rejected_non_business", "ambiguous", false, "high", ["SENTENCE_LIKE"]);
  }

  // C. candidate-intrinsic non-business structure (unchanged from v0.1.1)
  if (isSentenceLike(name)) {
    return result("rejected_non_business", "advice", false, "high", ["SENTENCE_LIKE"]);
  }
  if (isGenericNetworkName(name)) {
    return result("rejected_non_business", "brand_network", false, "high", ["GENERIC_NETWORK"]);
  }
  if (isServiceOrCriteriaEnumeration(name)) {
    return result("rejected_non_business", "generic_category", false, "high", [
      "SERVICE_ENUMERATION",
    ]);
  }
  if (isDescriptiveCriteriaLike(name)) {
    return result("rejected_non_business", "generic_category", false, "high", [
      "DESCRIPTIVE_CRITERIA",
    ]);
  }
  if (isGenericOfficialServiceCategory(name)) {
    return result("rejected_non_business", "generic_category", false, "high", [
      "GENERIC_OFFICIAL_CATEGORY",
    ]);
  }
  if (isHeadingLike(name)) {
    return result("rejected_non_business", "generic_category", false, "high", [
      "HEADING_CRITERIA_PHRASE",
    ]);
  }

  // D. positive intrinsic evidence
  const reasonCodes: string[] = [];
  const matched = Boolean(input.matchedBusinessId);
  const descriptor = hasStrongDescriptor(name);
  const branch = hasBranchMarker(name);
  const shortName = isShortProperNamePhrase(name);
  if (matched) reasonCodes.push("REGISTERED_BUSINESS_MATCH");
  if (descriptor) reasonCodes.push("STRONG_BUSINESS_DESCRIPTOR");
  if (branch) reasonCodes.push("BRANCH_MARKER");

  const strongSignal = (matched || descriptor || branch) && shortName;
  const parserSpecific = originalKind === "specific_business";
  const repeated = repeatCount >= MIN_REPEAT_FOR_CONFIRM;

  // Auto-confirm via strong intrinsic evidence is limited to parser-side
  // specific_business candidates. Ambiguous candidates are never confirmed
  // by a strong signal alone.
  if (originalConfirmed && strongSignal) {
    return result("confirmed_business", "specific_business", true, "high", reasonCodes);
  }
  if (strongSignal && parserSpecific) {
    return result("confirmed_business", "specific_business", true, "medium", reasonCodes);
  }

  if (shortName) {
    if (repeated) reasonCodes.push("REPEATED_ACROSS_RESPONSES");
    if (parserSpecific && repeated) {
      return result("confirmed_business", "specific_business", true, "medium", reasonCodes);
    }
    // New in v0.1.3: ambiguous candidates confirm ONLY via the combination of
    // a short proper-name shape, a branch marker, and repetition across
    // distinct measurements. Descriptor-only or repetition-only ambiguous
    // candidates stay in review.
    if (originalKind === "ambiguous" && branch && repeated) {
      reasonCodes.push("AMBIGUOUS_BRANCH_REPEATED");
      return result("confirmed_business", "specific_business", true, "medium", reasonCodes);
    }
    // New in v0.1.4: an ambiguous + probable candidate confirms when the same
    // candidate repeats as ambiguous + probable across >= 2 distinct
    // measurements. General name repetition is not enough.
    if (
      originalKind === "ambiguous" &&
      originalSpecificity === "probable" &&
      probableRepeatCount >= MIN_REPEAT_FOR_CONFIRM
    ) {
      reasonCodes.push("REPEATED_PROBABLE_ACROSS_RESPONSES", "AMBIGUOUS_PROBABLE_REPEATED");
      return result("confirmed_business", "specific_business", true, "medium", reasonCodes);
    }
    reasonCodes.push("PROBABLE_ONLY");
    if (parserSpecific) {
      return result("needs_review", "specific_business", false, "medium", reasonCodes);
    }
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

/** Distinct-measurement repetition counts per normalized candidate (scope level). */
export function buildRepeatCounts(
  mentions: readonly EntityVerificationInput[],
): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const mention of mentions) {
    const key = candidateRepeatKey(mention.displayName);
    if (key.length === 0) continue;
    const bucket = seen.get(key) ?? new Set<string>();
    bucket.add(mention.measurementId);
    seen.set(key, bucket);
  }
  const counts = new Map<string, number>();
  for (const [key, ids] of seen) counts.set(key, ids.size);
  return counts;
}

/** Deterministic + idempotent: mentions already verified at this version are skipped. */
export function buildEntityVerificationRows(args: {
  orgId: string;
  businessId: string;
  mentions: readonly EntityVerificationInput[];
  existingMentionIds: ReadonlySet<string>;
  repeatCounts?: ReadonlyMap<string, number>;
}): { rows: EntityVerificationRow[]; skippedCount: number } {
  const rows: EntityVerificationRow[] = [];
  let skippedCount = 0;
  for (const mention of args.mentions) {
    if (args.existingMentionIds.has(mention.mentionId)) {
      skippedCount += 1;
      continue;
    }
    const repeatCount = args.repeatCounts?.get(candidateRepeatKey(mention.displayName)) ?? 1;
    const verdict = verifyEntityMention(mention, { repeatCount });
    rows.push({
      org_id: args.orgId,
      business_id: args.businessId,
      measurement_id: mention.measurementId,
      measurement_mention_id: mention.mentionId,
      verifier_version: ENTITY_VERIFIER_ENGINE_VERSION,
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
}): {
  verifierVersion: string;
  mentionCount: number;
  insertedCount: number;
  skippedCount: number;
  confirmedBusinessCount: number;
  rejectedCount: number;
  needsReviewCount: number;
} {
  let confirmedBusinessCount = 0;
  let rejectedCount = 0;
  let needsReviewCount = 0;
  for (const row of args.insertedRows) {
    if (row.verification_status === "confirmed_business") confirmedBusinessCount += 1;
    else if (row.verification_status === "rejected_non_business") rejectedCount += 1;
    else needsReviewCount += 1;
  }
  return {
    verifierVersion: ENTITY_VERIFIER_ENGINE_VERSION,
    mentionCount: args.mentionCount,
    insertedCount: args.insertedRows.length,
    skippedCount: args.skippedCount,
    confirmedBusinessCount,
    rejectedCount,
    needsReviewCount,
  };
}
