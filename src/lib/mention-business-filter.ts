/**
 * Conservative business-mention aggregation helpers (v0.1, pure).
 *
 * SECURITY: deterministic in-memory logic only. No Supabase, no secrets,
 * no response_text, no aliases, no registry internals.
 *
 * Purpose: the legacy `run_business_share` view sums every parsed mention, so
 * headings and question sentences leak into the competitor comparison card.
 * These helpers keep only confirmed specific businesses (plus the target
 * business, which is always allowed).
 */

export interface MentionFact {
  measurement_id: string;
  matched_business_id: string | null;
  display_name: string;
  entity_kind?: string | null;
  specificity?: string | null;
  count_as_confirmed_business?: boolean | null;
}

export interface BusinessShareRow {
  key: string;
  matched_business_id: string | null;
  display_name: string;
  mention_count: number;
  response_count: number;
  answer_share_pct: number | null;
}

/** Generic section headings that the parser sometimes captures as entities. */
const GENERIC_HEADINGS = [
  "우선 고려할 곳",
  "추천 기준",
  "확인할 사항",
  "선택 기준",
  "주의 사항",
  "주의사항",
  "참고 사항",
  "참고사항",
  "정리하면",
  "결론",
  "요약",
];

/** Sentence/question markers; only applied to longer strings. */
const QUESTION_MARKERS = [
  "나요",
  "까요",
  "습니까",
  "인가요",
  "있나요",
  "없나요",
  "어떻게",
  "무엇",
  "왜 ",
  "?",
];

const LONG_TEXT_MIN_LENGTH = 12;

/**
 * Generic brand-network / service-network expressions. These describe a brand's
 * dealer or repair network, not an individual competitor shop, so they are
 * excluded from the auto-discovered competitor candidate layer.
 * Matched only at the END of the name, so branch names like
 * "르노코리아 서비스센터 진접정비" or "진접정비센터" stay.
 */
const GENERIC_NETWORK_SUFFIXES = [
  "공식서비스네트워크",
  "서비스네트워크",
  "공식네트워크",
  "공식서비스망",
  "서비스망",
  "정비네트워크",
  "정비망",
  "협력망",
  "지정정비망",
  "공식정비네트워크",
  "딜러네트워크",
  "네트워크",
];

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** True when the name is a generic brand service-network expression. */
export function isGenericNetworkPhrase(displayName: string): boolean {
  const compact = normalize(displayName).replace(/\s+/g, "");
  if (compact.length === 0) return false;
  for (const suffix of GENERIC_NETWORK_SUFFIXES) {
    if (compact === suffix) return true;
    if (compact.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * True when the display name is obviously not a business name.
 * Callers must skip this filter when the mention is matched to a real DB business.
 */
export function isObviousNonBusinessPhrase(displayName: string): boolean {
  const text = normalize(displayName);
  if (text.length === 0) return true;

  const compact = text.replace(/\s+/g, "");
  for (const heading of GENERIC_HEADINGS) {
    if (compact === heading.replace(/\s+/g, "")) return true;
  }

  if (isGenericNetworkPhrase(text)) return true;

  if (text.length >= LONG_TEXT_MIN_LENGTH) {
    for (const marker of QUESTION_MARKERS) {
      if (text.includes(marker)) return true;
    }
  }
  return false;
}


/**
 * Is this mention allowed to appear as a business in the comparison card?
 * - the target business is always allowed
 * - otherwise entity resolution metadata must confirm a specific business
 * - matched DB businesses bypass the text filter only
 */
export function isConfirmedBusinessMention(
  mention: MentionFact,
  targetBusinessId: string | null,
): boolean {
  if (targetBusinessId && mention.matched_business_id === targetBusinessId) return true;

  const confirmed =
    mention.entity_kind === "specific_business" &&
    mention.specificity === "confirmed" &&
    mention.count_as_confirmed_business === true;
  if (!confirmed) return false;

  // Registered businesses are trusted even if their name looks unusual.
  if (mention.matched_business_id) return true;

  return !isObviousNonBusinessPhrase(mention.display_name);
}

/**
 * Aggregate confirmed mentions into per-business share rows.
 * `answer_share_pct` uses the total number of valid measurements in the run.
 */
export function aggregateBusinessShare(args: {
  mentions: readonly MentionFact[];
  targetBusinessId: string | null;
  validMeasurementCount: number;
}): BusinessShareRow[] {
  const { mentions, targetBusinessId, validMeasurementCount } = args;

  const buckets = new Map<
    string,
    {
      matched_business_id: string | null;
      display_name: string;
      mention_count: number;
      measurementIds: Set<string>;
    }
  >();

  for (const m of mentions) {
    if (!isConfirmedBusinessMention(m, targetBusinessId)) continue;
    const key = m.matched_business_id ?? `name:${normalize(m.display_name).toLowerCase()}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.mention_count += 1;
      existing.measurementIds.add(m.measurement_id);
    } else {
      buckets.set(key, {
        matched_business_id: m.matched_business_id ?? null,
        display_name: normalize(m.display_name),
        mention_count: 1,
        measurementIds: new Set([m.measurement_id]),
      });
    }
  }

  const rows: BusinessShareRow[] = [];
  for (const [key, b] of buckets) {
    const response_count = b.measurementIds.size;
    rows.push({
      key,
      matched_business_id: b.matched_business_id,
      display_name: b.display_name,
      mention_count: b.mention_count,
      response_count,
      answer_share_pct:
        validMeasurementCount > 0 ? (response_count / validMeasurementCount) * 100 : null,
    });
  }

  rows.sort(
    (a, b) =>
      b.response_count - a.response_count ||
      b.mention_count - a.mention_count ||
      a.display_name.localeCompare(b.display_name),
  );
  return rows;
}
