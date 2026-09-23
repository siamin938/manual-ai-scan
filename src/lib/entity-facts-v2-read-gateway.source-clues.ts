import {
  pickEntityFactsV2AutoCompetitorDisplayName,
  type EntityFactsV2CompetitorDisplayEvidence,
  type EntityFactsV2ReadObservedSourceDTO,
  type EntityFactsV2ReadObservedSourceEntityDTO,
} from "./entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_VERSION = "0.1" as const;
export const ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_SOURCE_REPLAY_VERSION =
  "0.1" as const;
export const ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_ENGINE_VERSION =
  "competitor-source-clues-v2:src0.1:clue0.1:store0.1" as const;

export type ParsedCompetitorSourceClueV2 = {
  domain: string;
  canonicalKey: string;
  responseCount: number;
  attributionCount: number;
  evidenceTier: "near_section_title_match";
};

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out ? out : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null;
}

export function parseCompetitorSourceCluesV2(
  value: unknown,
): ParsedCompetitorSourceClueV2[] | null {
  if (!Array.isArray(value)) return null;

  const out: ParsedCompetitorSourceClueV2[] = [];
  const pairs = new Set<string>();

  for (const raw of value) {
    if (!isObj(raw)) return null;
    const rawDomain = nonEmptyString(raw["domain"]);
    const canonicalKey = nonEmptyString(raw["canonicalKey"]);
    const responseCount = positiveInt(raw["responseCount"]);
    const attributionCount = positiveInt(raw["attributionCount"]);
    const evidenceTier = raw["evidenceTier"];

    if (
      !rawDomain ||
      !canonicalKey ||
      !canonicalKey.startsWith("auto:") ||
      responseCount !== 1 ||
      attributionCount === null ||
      evidenceTier !== "near_section_title_match"
    ) {
      return null;
    }

    const domain = rawDomain.toLowerCase().replace(/^www\./u, "");
    if (!domain) return null;

    const pair = `${domain}\u0000${canonicalKey}`;
    if (pairs.has(pair)) return null;
    pairs.add(pair);

    out.push({
      domain,
      canonicalKey,
      responseCount,
      attributionCount,
      evidenceTier,
    });
  }

  return out;
}

function evidenceRank(
  evidence: EntityFactsV2ReadObservedSourceDTO["evidence"],
): number {
  if (evidence === "confirmed") return 0;
  if (evidence === "mixed") return 1;
  return 2;
}

export function mergeObservedSourcesWithCompetitorClues(args: {
  observedSources: EntityFactsV2ReadObservedSourceDTO[];
  sourceClues: ParsedCompetitorSourceClueV2[];
  competitorCanonicalKeys: ReadonlySet<string>;
  autoCompetitorEvidence: Record<
    string,
    EntityFactsV2CompetitorDisplayEvidence[]
  >;
}): EntityFactsV2ReadObservedSourceDTO[] | null {
  const byDomain = new Map<string, EntityFactsV2ReadObservedSourceDTO>();

  for (const source of args.observedSources) {
    byDomain.set(source.domain, {
      ...source,
      linkedEntities: source.linkedEntities.map((entity) => ({ ...entity })),
    });
  }

  for (const clue of args.sourceClues) {
    if (!args.competitorCanonicalKeys.has(clue.canonicalKey)) return null;

    const name = pickEntityFactsV2AutoCompetitorDisplayName(
      clue.canonicalKey,
      args.autoCompetitorEvidence[clue.canonicalKey] ?? [],
    );
    if (!name) return null;

    const current = byDomain.get(clue.domain);
    const clueEntity: EntityFactsV2ReadObservedSourceEntityDTO = {
      name,
      isTarget: false,
      responseCount: clue.responseCount,
      evidence: "clue",
    };

    if (!current) {
      byDomain.set(clue.domain, {
        domain: clue.domain,
        responseCount: clue.responseCount,
        targetResponseCount: 0,
        competitorResponseCount: 0,
        clueResponseCount: clue.responseCount,
        evidence: "clue",
        linkedEntities: [clueEntity],
      });
      continue;
    }

    const duplicate = current.linkedEntities.some(
      (entity) => entity.name === name && entity.evidence === "confirmed",
    );
    if (duplicate) return null;

    const existingClue = current.linkedEntities.find(
      (entity) => entity.name === name && entity.evidence === "clue",
    );
    if (existingClue) return null;

    current.linkedEntities.push(clueEntity);
    current.clueResponseCount = Math.max(
      current.clueResponseCount,
      clue.responseCount,
    );
    current.responseCount = Math.max(
      current.responseCount,
      clue.responseCount,
    );
    current.evidence =
      current.evidence === "confirmed" ? "mixed" : current.evidence;
  }

  const result = [...byDomain.values()];
  for (const source of result) {
    source.linkedEntities.sort(
      (a, b) =>
        Number(b.isTarget) - Number(a.isTarget) ||
        (a.evidence === b.evidence
          ? 0
          : a.evidence === "confirmed"
            ? -1
            : 1) ||
        b.responseCount - a.responseCount ||
        a.name.localeCompare(b.name, "ko"),
    );
  }

  result.sort(
    (a, b) =>
      evidenceRank(a.evidence) - evidenceRank(b.evidence) ||
      b.responseCount - a.responseCount ||
      a.domain.localeCompare(b.domain, "en"),
  );

  return result;
}
