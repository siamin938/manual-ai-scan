/**
 * Citation attribution engine v0.1.0 (pure, server-only).
 *
 * CORE ENGINE ISOLATION
 * - No Supabase, no secrets, no network, no business-specific names or ids.
 * - Deterministic string/structure rules only. No fuzzy matching, no LLM.
 * - Conservative by design: when the link between an entity and a citation is
 *   ambiguous, NO attribution row is produced (the answer-level co-occurrence
 *   in `measurement_citations` remains the only signal).
 */

export const CITATION_ATTRIBUTION_VERSION = "0.1.0";

/** Max characters allowed between the end of an entity mention and the citation. */
export const DIRECT_MAX_DISTANCE_CHARS = 450;

export type AttributionCitationInput = {
  url: string;
  title: string | null;
  startIndex: number;
  endIndex: number;
};

export type AttributionEntityInput = {
  canonicalKey: string;
  canonicalDisplayName: string;
  mentionId: string | null;
  /** Exact strings to look for (name, aliases, display names). */
  matchTexts: string[];
};

export type AttributionMeasurementInput = {
  measurementId: string;
  responseText: string;
  citations: AttributionCitationInput[];
  entities: AttributionEntityInput[];
};

export type AttributionRelation = "same_line" | "same_sentence" | "same_row" | "same_section";

export type AttributionRow = {
  measurementId: string;
  measurementMentionId: string | null;
  canonicalKey: string;
  canonicalDisplayName: string;
  citationUrl: string;
  title: string | null;
  citationStartIndex: number;
  citationEndIndex: number;
  entityStartIndex: number | null;
  entityEndIndex: number | null;
  attributionLevel: "direct" | "section";
  evidence: {
    distance_chars: number;
    relation: AttributionRelation;
    entity_match_text: string;
  };
};

/* ------------------------------------------------------------------ */
/* normalization                                                       */
/* ------------------------------------------------------------------ */

/** Characters dropped before matching (markdown decoration + whitespace). */
const IGNORED_CHARS = new Set([
  "*",
  "_",
  "`",
  "~",
  "#",
  " ",
  "\t",
  "\u00a0",
  "\u200b",
  "·",
  "•",
]);

type NormalizedText = {
  /** normalized (lowercased, decoration-free) text */
  text: string;
  /** normalized index -> original index */
  map: number[];
};

function normalize(input: string): NormalizedText {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (IGNORED_CHARS.has(ch)) continue;
    text += ch.toLowerCase();
    map.push(i);
  }
  return { text, map };
}

function normalizeNeedle(input: string): string {
  let out = "";
  for (const ch of input) {
    if (IGNORED_CHARS.has(ch)) continue;
    out += ch.toLowerCase();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* occurrences                                                         */
/* ------------------------------------------------------------------ */

export type EntityOccurrence = {
  canonicalKey: string;
  start: number;
  end: number;
  matchText: string;
};

const MIN_NEEDLE_LENGTH = 2;

export function findEntityOccurrences(
  responseText: string,
  entities: AttributionEntityInput[],
): EntityOccurrence[] {
  const haystack = normalize(responseText);
  const out: EntityOccurrence[] = [];
  for (const entity of entities) {
    const seen = new Set<string>();
    for (const raw of entity.matchTexts) {
      const needle = normalizeNeedle(raw ?? "");
      if (needle.length < MIN_NEEDLE_LENGTH) continue;
      if (seen.has(needle)) continue;
      seen.add(needle);
      let from = 0;
      for (;;) {
        const idx = haystack.text.indexOf(needle, from);
        if (idx < 0) break;
        const start = haystack.map[idx]!;
        const end = haystack.map[idx + needle.length - 1]! + 1;
        out.push({ canonicalKey: entity.canonicalKey, start, end, matchText: raw });
        from = idx + needle.length;
      }
    }
  }
  // Keep the longest match when two needles of the same entity overlap.
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: EntityOccurrence[] = [];
  for (const occ of out) {
    const prev = kept[kept.length - 1];
    if (prev && prev.canonicalKey === occ.canonicalKey && occ.start < prev.end) continue;
    kept.push(occ);
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* structure                                                           */
/* ------------------------------------------------------------------ */

type Line = { start: number; end: number; text: string };

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

function lineAt(lines: Line[], index: number): Line | null {
  for (const line of lines) {
    if (index >= line.start && index <= line.end) return line;
  }
  return null;
}

const STRUCTURAL_LINE_RE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)/;

function isTableRow(line: Line): boolean {
  return /^\s*\|/.test(line.text);
}

export type EntitySection = { canonicalKey: string; start: number; end: number };

/**
 * A section starts on a structural line (heading / bullet / numbered item /
 * table row) whose first entity occurrence belongs to that entity, and runs
 * until the next section start of a different entity.
 */
export function buildEntitySections(
  responseText: string,
  occurrences: EntityOccurrence[],
): EntitySection[] {
  const lines = splitLines(responseText);
  const starts: { canonicalKey: string; start: number }[] = [];
  for (const line of lines) {
    if (!STRUCTURAL_LINE_RE.test(line.text)) continue;
    const inLine = occurrences
      .filter((o) => o.start >= line.start && o.end <= line.end)
      .sort((a, b) => a.start - b.start);
    if (inLine.length === 0) continue;
    const owner = inLine[0]!.canonicalKey;
    // A structural line naming several distinct entities never opens a section.
    if (inLine.some((o) => o.canonicalKey !== owner)) continue;
    const prev = starts[starts.length - 1];
    if (prev && prev.canonicalKey === owner) continue;
    starts.push({ canonicalKey: owner, start: line.start });
  }
  // Any later heading or top-level numbered item closes the current section,
  // even when no entity was recognized inside it. This keeps a section from
  // swallowing the next business block when its name could not be matched.
  const hardBoundaries = lines
    .filter((l) => /^\s*(#{1,6}\s|\d+[.)]\s)/.test(l.text))
    .map((l) => l.start);

  const sections: EntitySection[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const cur = starts[i]!;
    const next = starts[i + 1];
    const boundary = hardBoundaries.find((b) => b > cur.start);
    const ends = [next ? next.start : responseText.length];
    if (boundary !== undefined) ends.push(boundary);
    sections.push({
      canonicalKey: cur.canonicalKey,
      start: cur.start,
      end: Math.min(...ends),
    });
  }
  return sections;
}


const SENTENCE_END_RE = /[.!?。！？\n]/;

function sameSentence(responseText: string, from: number, to: number): boolean {
  const between = responseText.slice(from, to);
  // Inline markdown links contain dots (domains); ignore link segments.
  const cleaned = between.replace(/\([^()]*\)/g, "").replace(/\[[^\]]*\]/g, "");
  return !SENTENCE_END_RE.test(cleaned);
}

/* ------------------------------------------------------------------ */
/* attribution                                                         */
/* ------------------------------------------------------------------ */

export function buildAttributionRows(input: AttributionMeasurementInput): AttributionRow[] {
  const { responseText, citations, entities } = input;
  if (!responseText || citations.length === 0 || entities.length === 0) return [];

  const occurrences = findEntityOccurrences(responseText, entities);
  if (occurrences.length === 0) return [];

  const lines = splitLines(responseText);
  const sections = buildEntitySections(responseText, occurrences);
  const byKey = new Map(entities.map((e) => [e.canonicalKey, e]));

  const rows: AttributionRow[] = [];
  const seen = new Set<string>();

  const push = (
    entity: AttributionEntityInput,
    citation: AttributionCitationInput,
    level: "direct" | "section",
    occ: EntityOccurrence | null,
    relation: AttributionRelation,
    distance: number,
  ) => {
    const key = `${entity.canonicalKey}|${citation.url}|${citation.startIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      measurementId: input.measurementId,
      measurementMentionId: entity.mentionId,
      canonicalKey: entity.canonicalKey,
      canonicalDisplayName: entity.canonicalDisplayName,
      citationUrl: citation.url,
      title: citation.title ?? null,
      citationStartIndex: citation.startIndex,
      citationEndIndex: citation.endIndex,
      entityStartIndex: occ ? occ.start : null,
      entityEndIndex: occ ? occ.end : null,
      attributionLevel: level,
      evidence: {
        distance_chars: distance,
        relation,
        entity_match_text: occ ? occ.matchText : entity.canonicalDisplayName,
      },
    });
  };

  for (const citation of citations) {
    const line = lineAt(lines, citation.startIndex);
    let directDone = false;

    if (line) {
      const candidates = occurrences
        .filter(
          (o) =>
            o.start >= line.start &&
            o.end <= citation.startIndex &&
            citation.startIndex - o.end <= DIRECT_MAX_DISTANCE_CHARS,
        )
        .sort((a, b) => citation.startIndex - a.end - (citation.startIndex - b.end));

      if (candidates.length > 0) {
        const nearest = candidates[0]!;
        const rowLike = isTableRow(line);
        const accepted: EntityOccurrence[] = [nearest];
        // Extra entities are only accepted when they truly share the same
        // sentence / table row with the citation.
        for (const cand of candidates.slice(1)) {
          if (cand.canonicalKey === nearest.canonicalKey) continue;
          if (accepted.some((a) => a.canonicalKey === cand.canonicalKey)) continue;
          if (rowLike || sameSentence(responseText, cand.end, citation.startIndex)) {
            accepted.push(cand);
          }
        }
        for (const occ of accepted) {
          const entity = byKey.get(occ.canonicalKey);
          if (!entity) continue;
          const distance = citation.startIndex - occ.end;
          const relation: AttributionRelation = rowLike
            ? "same_row"
            : sameSentence(responseText, occ.end, citation.startIndex)
              ? "same_sentence"
              : "same_line";
          push(entity, citation, "direct", occ, relation, distance);
          directDone = true;
        }
      }
    }

    if (directDone) continue;

    const section = sections.find(
      (s) => citation.startIndex >= s.start && citation.startIndex < s.end,
    );
    if (!section) continue;
    const entity = byKey.get(section.canonicalKey);
    if (!entity) continue;
    const owner = occurrences
      .filter((o) => o.canonicalKey === section.canonicalKey && o.start >= section.start)
      .sort((a, b) => a.start - b.start)[0];
    if (!owner) continue;
    push(
      entity,
      citation,
      "section",
      owner,
      "same_section",
      Math.max(0, citation.startIndex - owner.end),
    );
  }

  return rows;
}

/** Dedupe raw provider annotations by measurement + url + start_index. */
export function dedupeCitations(
  citations: AttributionCitationInput[],
): AttributionCitationInput[] {
  const seen = new Set<string>();
  const out: AttributionCitationInput[] = [];
  for (const c of citations) {
    if (!c?.url || typeof c.startIndex !== "number") continue;
    const key = `${c.url}|${c.startIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  out.sort((a, b) => a.startIndex - b.startIndex);
  return out;
}

/** Extract `url_citation` annotations from an OpenAI-style response payload. */
export function extractUrlCitations(payload: unknown): AttributionCitationInput[] {
  const found: AttributionCitationInput[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (
      obj["type"] === "url_citation" &&
      typeof obj["url"] === "string" &&
      typeof obj["start_index"] === "number" &&
      typeof obj["end_index"] === "number"
    ) {
      found.push({
        url: obj["url"],
        title: typeof obj["title"] === "string" ? obj["title"] : null,
        startIndex: obj["start_index"],
        endIndex: obj["end_index"],
      });
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(payload);
  return dedupeCitations(found);
}

export function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
