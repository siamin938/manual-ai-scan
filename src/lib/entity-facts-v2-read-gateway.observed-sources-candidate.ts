import type {
  RunEntityFactsObservedSourcesAggregateCandidateV2,
} from "../../supabase/functions/_shared/entity-engine-v2/run-entity-facts-observed-sources.candidate";
import {
  pickEntityFactsV2AutoCompetitorDisplayName,
  type EntityFactsV2CompetitorDisplayEvidence,
  type EntityFactsV2ReadBusinessDTO,
} from "./entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_OBSERVED_SOURCES_READ_CANDIDATE_VERSION =
  "0.1" as const;

export type EntityFactsV2ObservedSourceEntityCandidateDTO = {
  name: string;
  isTarget: boolean;
  responseCount: number;
  attributionCount: number;
  directResponseCount: number;
  nearSectionResponseCount: number;
};

export type EntityFactsV2ObservedSourceCandidateDTO = {
  domain: string;
  responseCount: number;
  targetResponseCount: number;
  competitorResponseCount: number;
  attributionCount: number;
  linkedEntities: EntityFactsV2ObservedSourceEntityCandidateDTO[];
};

export type EntityFactsV2ObservedSourcesReadCandidateResponse =
  | {
      ok: true;
      version: typeof ENTITY_FACTS_V2_OBSERVED_SOURCES_READ_CANDIDATE_VERSION;
      observedSources: EntityFactsV2ObservedSourceCandidateDTO[];
    }
  | {
      ok: false;
      error: "INVALID_CANDIDATE" | "UNRESOLVED_DISPLAY_EVIDENCE";
      canonicalKey?: string;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function businessIdFromCanonicalKey(value: string): string | null {
  if (!value.startsWith("business:")) return null;
  const id = value.slice("business:".length).trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

function resolveEntityName(args: {
  canonicalKey: string;
  isTarget: boolean;
  targetBusinessId: string;
  targetBusinessName: string;
  registeredCompetitorNames: Record<string, string>;
  autoCompetitorEvidence: Record<
    string,
    EntityFactsV2CompetitorDisplayEvidence[]
  >;
}): string | null {
  const key = args.canonicalKey.trim();

  if (args.isTarget) {
    return key === `business:${args.targetBusinessId}`
      ? args.targetBusinessName
      : null;
  }

  const registeredBusinessId = businessIdFromCanonicalKey(key);
  if (registeredBusinessId) {
    if (registeredBusinessId === args.targetBusinessId) return null;
    const name = args.registeredCompetitorNames[registeredBusinessId];
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }

  return pickEntityFactsV2AutoCompetitorDisplayName(
    key,
    args.autoCompetitorEvidence[key] ?? [],
  );
}

/**
 * Candidate-only customer-safe projection.
 *
 * It intentionally accepts only the reviewed aggregate candidate and persisted
 * display evidence. It never exposes canonical keys or falls back to the
 * auto:<surface> suffix as a customer-facing label.
 */
export function buildEntityFactsV2ObservedSourcesReadCandidate(args: {
  business: EntityFactsV2ReadBusinessDTO;
  aggregateCandidate: RunEntityFactsObservedSourcesAggregateCandidateV2;
  registeredCompetitorNames: Record<string, string>;
  autoCompetitorEvidence: Record<
    string,
    EntityFactsV2CompetitorDisplayEvidence[]
  >;
}): EntityFactsV2ObservedSourcesReadCandidateResponse {
  const targetBusinessId = args.business.id.trim().toLowerCase();
  if (
    !UUID_RE.test(targetBusinessId) ||
    args.aggregateCandidate.contractOk !== true ||
    args.aggregateCandidate.candidateContractOk !== true ||
    args.aggregateCandidate.contractIssues.length > 0 ||
    args.aggregateCandidate.candidateContractIssues.length > 0
  ) {
    return { ok: false, error: "INVALID_CANDIDATE" };
  }

  const observedSources: EntityFactsV2ObservedSourceCandidateDTO[] = [];

  for (const source of args.aggregateCandidate.observedSources) {
    const linkedEntities: EntityFactsV2ObservedSourceEntityCandidateDTO[] = [];

    for (const entity of source.entities) {
      const isTarget = entity.side === "target";
      const name = resolveEntityName({
        canonicalKey: entity.canonicalKey,
        isTarget,
        targetBusinessId,
        targetBusinessName: args.business.name,
        registeredCompetitorNames: args.registeredCompetitorNames,
        autoCompetitorEvidence: args.autoCompetitorEvidence,
      });

      if (!name) {
        return {
          ok: false,
          error: "UNRESOLVED_DISPLAY_EVIDENCE",
          canonicalKey: entity.canonicalKey,
        };
      }

      linkedEntities.push({
        name,
        isTarget,
        responseCount: entity.responseCount,
        attributionCount: entity.attributionCount,
        directResponseCount: entity.directResponseCount,
        nearSectionResponseCount: entity.nearSectionResponseCount,
      });
    }

    linkedEntities.sort(
      (a, b) =>
        Number(b.isTarget) - Number(a.isTarget) ||
        b.responseCount - a.responseCount ||
        b.attributionCount - a.attributionCount ||
        a.name.localeCompare(b.name, "ko"),
    );

    observedSources.push({
      domain: source.domain,
      responseCount: source.responseCount,
      targetResponseCount: source.targetResponseCount,
      competitorResponseCount: source.otherResponseCount,
      attributionCount: source.attributionCount,
      linkedEntities,
    });
  }

  observedSources.sort(
    (a, b) =>
      b.responseCount - a.responseCount ||
      b.attributionCount - a.attributionCount ||
      a.domain.localeCompare(b.domain, "en"),
  );

  return {
    ok: true,
    version: ENTITY_FACTS_V2_OBSERVED_SOURCES_READ_CANDIDATE_VERSION,
    observedSources,
  };
}
