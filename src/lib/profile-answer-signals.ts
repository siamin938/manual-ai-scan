export const answerSignalLabels = {
  reviews: "후기 수", rating: "평점", regulars: "단골 수",
  price: "가격", included: "포함 항목", duration: "작업 시간",
} as const;
export type SignalKind = keyof typeof answerSignalLabels;
export type ProfileAnswerEvidence = {
  counts: Partial<Record<SignalKind, number>>;
  example: { questionId: string; measurementId: string; phrases: string[] };
};
type Answer = { questionId: string; text: string; confirmedKeys: readonly string[] };
export type CitationSpan = {
  measurement_id: string | null; canonical_key: string | null; canonical_display_name: string | null;
  citation_url: string | null; entity_start_index: number | null; entity_end_index: number | null;
  citation_start_index: number | null; citation_end_index: number | null;
};

const patterns: Record<SignalKind, RegExp> = {
  reviews: /(?:후기|리뷰)\s*(?:약\s*)?[\d,]+\s*(?:개|건)/u,
  rating: /(?:평점\s*[0-5](?:\.\d{1,2})?(?:\s*점)?|(?<![\d.])[0-5]\.\d{1,2}\s*점)/u,
  regulars: /단골\s*(?:약\s*)?[\d,]+\s*명/u,
  price: /(?:\d{1,3}(?:,\d{3})+|\d{2,7}|\d+(?:\.\d+)?만)\s*원/u,
  included: /(?:공임|필터|부품|부가세)[^\n.!?]{0,25}?(?:포함|별도)/u,
  duration: /(?:작업|교환|소요)\s*(?:시간)?[^\n.!?]{0,12}?\d+\s*(?:분|시간)/u,
};

export function citationPageKey(name: string, url: string) {
  return JSON.stringify([name, url]);
}
function normalize(s: string) { return s.normalize("NFKC").toLowerCase().replace(/\s+/gu, ""); }
function signalPhrases(text: string) {
  const result: Partial<Record<SignalKind, string>> = {};
  for (const kind of Object.keys(patterns) as SignalKind[]) {
    const found = text.match(patterns[kind])?.[0];
    if (found) result[kind] = kind === "price" || kind === "included" || kind === "duration" ? answerSignalLabels[kind] : found;
  }
  return result;
}

// Read only the stored passage between a verified entity mention and its exact citation.
// If offsets or identity no longer line up with the saved answer, leave it unclassified.
export function collectAnswerSignals(rows: readonly CitationSpan[], answers: ReadonlyMap<string, Answer>,
  businessNames: readonly string[], missingQuestionIds: ReadonlySet<string>) {
  type Entry = { ids: Map<SignalKind, Set<string>>; example: ProfileAnswerEvidence["example"]; missing: boolean };
  const entries = new Map<string, Entry>();
  for (const row of rows) {
    const { measurement_id: id, canonical_display_name: name, citation_url: url, canonical_key: key,
      entity_start_index: start, entity_end_index: end, citation_start_index: cite, citation_end_index: stop } = row;
    if (!id || !key || !name || !url || start == null || end == null || cite == null || stop == null) continue;
    const answer = answers.get(id);
    if (!answer?.confirmedKeys.includes(key) || start < 0 || end <= start || cite < end || stop <= cite ||
        stop > answer.text.length || cite - end > 1500) continue;
    if (normalize(answer.text.slice(start, end)) !== normalize(name)) continue;
    const links = answer.text.slice(cite, stop).match(/https?:\/\/[^\s)\]>]+/gu) ?? [];
    if (links.length !== 1 || links[0] !== url) continue;
    const passage = answer.text.slice(end, cite).replace(/\*\*/gu, "");
    if (/https?:\/\/|\n\s*(?:#{1,6}\s|\d+[.)]\s)|\n\s*\|/u.test(passage) ||
        businessNames.some(other => other !== name && other.length >= 2 && normalize(passage).includes(normalize(other)))) continue;
    const phrases = signalPhrases(passage);
    const kinds = Object.keys(phrases) as SignalKind[];
    if (!kinds.length) continue;
    // The original citation must match the stored text above. Use the same
    // browser URL representation as the displayed page only for the lookup.
    let displayedUrl: string;
    try {
      displayedUrl = new URL(url).href;
    } catch {
      continue;
    }
    const pageKey = citationPageKey(name.trim(), displayedUrl);
    const example = { questionId: answer.questionId, measurementId: id, phrases: Object.values(phrases) };
    const missing = missingQuestionIds.has(answer.questionId);
    const entry = entries.get(pageKey) ?? { ids: new Map(), example, missing };
    for (const kind of kinds) {
      const ids = entry.ids.get(kind) ?? new Set<string>();
      ids.add(id);
      entry.ids.set(kind, ids);
    }
    if ((missing && !entry.missing) || (missing === entry.missing &&
        (example.phrases.length > entry.example.phrases.length ||
        (example.phrases.length === entry.example.phrases.length && id < entry.example.measurementId)))) {
      entry.example = example;
      entry.missing = missing;
    }
    entries.set(pageKey, entry);
  }
  return new Map(Array.from(entries, ([key, entry]) => [key, {
    counts: Object.fromEntries(Array.from(entry.ids, ([kind, ids]) => [kind, ids.size])),
    example: entry.example,
  } satisfies ProfileAnswerEvidence]));
}
