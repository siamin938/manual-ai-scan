/**
 * Business share descriptive statistics (pure).
 *
 * CORE ENGINE ISOLATION
 * - business 여부 판정은 Supabase Edge Function `entity-verification` +
 *   `entity-canonical-resolver`가 전담한다. 이 helper는 **이미 승인된**
 *   (canonicalization row가 존재하는) mention DTO만 입력으로 받는다.
 * - display_name / entity_kind / specificity 등 문장 패턴으로 business 여부를
 *   판정하지 않는다. 단순 카운트와 표시 정렬만 수행한다.
 */

export interface ApprovedMentionFact {
  measurement_id: string;
  /** Canonical identity from the resolver row. */
  canonical_key: string;
  /** Canonical display name from the resolver row. */
  canonical_display_name: string;
  /** Badge metadata only (target / registered competitor). */
  matched_business_id: string | null;
}

export interface BusinessShareRow {
  key: string;
  matched_business_id: string | null;
  display_name: string;
  mention_count: number;
  response_count: number;
  answer_share_pct: number | null;
}

/**
 * Count approved mentions per canonical key.
 * `answer_share_pct = response_count / validMeasurementCount * 100`
 */
export function aggregateBusinessShare(args: {
  mentions: readonly ApprovedMentionFact[];
  validMeasurementCount: number;
}): BusinessShareRow[] {
  const { mentions, validMeasurementCount } = args;

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
    const key = m.canonical_key;
    if (!key) continue;
    const existing = buckets.get(key);
    if (existing) {
      existing.mention_count += 1;
      existing.measurementIds.add(m.measurement_id);
      if (!existing.matched_business_id && m.matched_business_id) {
        existing.matched_business_id = m.matched_business_id;
      }
    } else {
      buckets.set(key, {
        matched_business_id: m.matched_business_id ?? null,
        display_name: m.canonical_display_name,
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
