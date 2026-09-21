import {
  pickEntityFactsV2AutoCompetitorDisplayName,
  type EntityFactsV2CompetitorDisplayEvidence,
  type EntityFactsV2ReadBusinessDTO,
  type EntityFactsV2ReadObservedSourceDTO,
  type EntityFactsV2ReadObservedSourceEntityDTO,
} from "./entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_OBSERVED_SOURCES_VERSION = "0.1" as const;
export const ENTITY_FACTS_V2_OBSERVED_SOURCES_SOURCE_REPLAY_VERSION =
  "0.1" as const;
export const ENTITY_FACTS_V2_OBSERVED_SOURCES_ENGINE_VERSION =
  "observed-sources-v2:src0.1:obs0.1:store0.1" as const;

export type ParsedObservedSourceEntityV2 = {
  canonicalKey: string;
  side: "target" | "other";
  responseCount: number;
  attributionCount: number;
  directResponseCount: number;
  nearSectionResponseCount: number;
};

export type ParsedObservedSourceV2 = {
  domain: string;
  responseCount: number;
  targetResponseCount: number;
  otherResponseCount: number;
  attributionCount: number;
  entities: ParsedObservedSourceEntityV2[];
};

type Obj = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function parseEntity(value: unknown): ParsedObservedSourceEntityV2 | null {
  if (!isObj(value)) return null;
  const canonicalKey = nonEmptyString(value["canonicalKey"]);
  const side = value["side"];
  const responseCount = positiveInt(value["responseCount"]);
  const attributionCount = positiveInt(value["attributionCount"]);
  const directResponseCount = nonNegativeInt(value["directResponseCount"]);
  const nearSectionResponseCount = nonNegativeInt(
    value["nearSectionResponseCount"],
  );

  if (
    !canonicalKey ||
    (side !== "target" && side !== "other") ||
    responseCount === null ||
    attributionCount === null ||
    directResponseCount === null ||
    nearSectionResponseCount === null ||
    directResponseCount > responseCount ||
    nearSectionResponseCount > responseCount
  ) {
    return null;
  }

  return {
    canonicalKey,
    side,
    responseCount,
    attributionCount,
    directResponseCount,
    nearSectionResponseCount,
  };
}

export function parseObservedSourcesV2(
  value: unknown,
): ParsedObservedSourceV2[] | null {
  if (!Array.isArray(value)) return null;

  const out: ParsedObservedSourceV2[] = [];
  const domains = new Set<string>();

  for (const item of value) {
    if (!isObj(item)) return null;
    const rawDomain = nonEmptyString(item["domain"]);
    const responseCount = positiveInt(item["responseCount"]);
    const targetResponseCount = nonNegativeInt(item["targetResponseCount"]);
    const otherResponseCount = nonNegativeInt(item["otherResponseCount"]);
    const attributionCount = positiveInt(item["attributionCount"]);
    const rawEntities = item["entities"];

    if (
      !rawDomain ||
      responseCount === null ||
      targetResponseCount === null ||
      otherResponseCount === null ||
      attributionCount === null ||
      !Array.isArray(rawEntities) ||
      rawEntities.length === 0 ||
      responseCount < Math.max(targetResponseCount, otherResponseCount) ||
      responseCount > targetResponseCount + otherResponseCount
    ) {
      return null;
    }

    const domain = rawDomain.toLowerCase().replace(/^www\./u, "");
    if (!domain || domains.has(domain)) return null;
    domains.add(domain);

    const entities: ParsedObservedSourceEntityV2[] = [];
    const entityKeys = new Set<string>();
    for (const rawEntity of rawEntities) {
      const entity = parseEntity(rawEntity);
      if (!entity || entityKeys.has(entity.canonicalKey)) return null;
      entityKeys.add(entity.canonicalKey);
      if (entity.responseCount > responseCount) return null;
      if (
        entity.side === "target" &&
        entity.responseCount > targetResponseCount
      ) {
        return null;
      }
      if (
        entity.side === "other" &&
        entity.responseCount > otherResponseCount
      ) {
        return null;
      }
      entities.push(entity);
    }

    const hasTarget = entities.some((entity) => entity.side === "target");
    const hasOther = entities.some((entity) => entity.side === "other");
    if (
      (targetResponseCount > 0) !== hasTarget ||
      (otherResponseCount > 0) !== hasOther ||
      entities.reduce((sum, entity) => sum + entity.attributionCount, 0) !==
        attributionCount
    ) {
      return null;
    }

    out.push({
      domain,
      responseCount,
      targetResponseCount,
      otherResponseCount,
      attributionCount,
      entities,
    });
  }

  return out;
}

function businessIdFromCanonicalKey(value: string): string | null {
  if (!value.startsWith("business:")) return null;
  const id = value.slice("business:".length).trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

export function buildObservedSourcesCustomerDTO(args: {
  business: EntityFactsV2ReadBusinessDTO;
  observedSources: ParsedObservedSourceV2[];
  competitorCanonicalKeys: ReadonlySet<string>;
  targetSourceResponseCountByDomain: ReadonlyMap<string, number>;
  registeredCompetitorNames: Record<string, string>;
  autoCompetitorEvidence: Record<
    string,
    EntityFactsV2CompetitorDisplayEvidence[]
  >;
}): EntityFactsV2ReadObservedSourceDTO[] | null {
  const targetBusinessId = args.business.id.trim().toLowerCase();
  if (!UUID_RE.test(targetBusinessId)) return null;

  const targetKey = `business:${targetBusinessId}`;
  const observedTargetDomains = new Map<string, number>();

  const result: EntityFactsV2ReadObservedSourceDTO[] = [];

  for (const source of args.observedSources) {
    if (source.targetResponseCount > 0) {
      observedTargetDomains.set(source.domain, source.targetResponseCount);
    }

    const linkedEntities: EntityFactsV2ReadObservedSourceEntityDTO[] = [];

    for (const entity of source.entities) {
      const isTarget = entity.side === "target";
      let name: string | null = null;

      if (isTarget) {
        if (entity.canonicalKey !== targetKey) return null;
        name = args.business.name.trim() || null;
      } else {
        if (!args.competitorCanonicalKeys.has(entity.canonicalKey)) return null;

        const competitorBusinessId = businessIdFromCanonicalKey(
          entity.canonicalKey,
        );
        if (competitorBusinessId) {
          if (competitorBusinessId === targetBusinessId) return null;
          const candidate =
            args.registeredCompetitorNames[competitorBusinessId];
          name =
            typeof candidate === "string" && candidate.trim()
              ? candidate.trim()
              : null;
        } else {
          name = pickEntityFactsV2AutoCompetitorDisplayName(
            entity.canonicalKey,
            args.autoCompetitorEvidence[entity.canonicalKey] ?? [],
          );
        }
      }

      if (!name) return null;

      linkedEntities.push({
        name,
        isTarget,
        responseCount: entity.responseCount,
      });
    }

    linkedEntities.sort(
      (a, b) =>
        Number(b.isTarget) - Number(a.isTarget) ||
        b.responseCount - a.responseCount ||
        a.name.localeCompare(b.name, "ko"),
    );

    result.push({
      domain: source.domain,
      responseCount: source.responseCount,
      targetResponseCount: source.targetResponseCount,
      competitorResponseCount: source.otherResponseCount,
      linkedEntities,
    });
  }

  if (
    observedTargetDomains.size !== args.targetSourceResponseCountByDomain.size
  ) {
    return null;
  }
  for (const [domain, responseCount] of args.targetSourceResponseCountByDomain) {
    if (observedTargetDomains.get(domain) !== responseCount) return null;
  }

  result.sort(
    (a, b) =>
      b.responseCount - a.responseCount ||
      a.domain.localeCompare(b.domain, "en"),
  );

  return result;
}
