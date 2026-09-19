import type { IdentityDecisionV2 } from "./identity-gate.ts";
import type { TargetEquivalenceDecision } from "./target-equivalence.ts";

export const MEASUREMENT_ENTITY_FACTS_VERSION = "0.1" as const;

export type MeasurementEntityFactQualityFlag =
  | "invalid_measurement"
  | "parser_false_positive"
  | "parser_false_negative"
  | "target_identity_unresolved"
  | "target_position_missing"
  | "equivalent_projection_mismatch"
  | "distinct_entity_missing_canonical_key"
  | "self_key_leakage_blocked"
  | "attribution_identity_unresolved";

export interface RawParserTargetSignalV2 {
  wasClientMentioned: boolean;
  clientPosition: number | null;
}

export interface MeasurementEntityObservationV2 {
  entityRef: string;
  identityDecision: IdentityDecisionV2;
  equivalenceDecision: TargetEquivalenceDecision;
  /**
   * Broad recall-only signal: this unresolved business could plausibly be the
   * current target. It never proves equivalence by itself.
   */
  isTargetCandidate: boolean;
  /**
   * Current canonical key for a confirmed distinct business, if available.
   * Equivalent observations use projectedCanonicalKey instead.
   */
  canonicalKey?: string | null;
  /**
   * Output of Target Equivalence. Equivalent observations must project only to
   * business:<CURRENT TARGET BUSINESS ID>.
   */
  projectedCanonicalKey?: string | null;
  /** 1-based rank/position from the structured mention, when available. */
  position?: number | null;
}

export interface MeasurementAttributionObservationV2 {
  attributionId: string;
  entityRef: string;
  domain: string;
  url: string;
}

export interface MeasurementEntityFactsInputV2 {
  measurementId: string;
  targetBusinessId: string;
  valid: boolean;
  rawParser: RawParserTargetSignalV2;
  entities: MeasurementEntityObservationV2[];
  attributions?: MeasurementAttributionObservationV2[];
}

export interface TargetAttributionLinkV2 {
  attributionId: string;
  domain: string;
  url: string;
}

export interface MeasurementEntityFactsV2 {
  version: typeof MEASUREMENT_ENTITY_FACTS_VERSION;
  measurementId: string;
  valid: boolean;
  targetSeen: boolean | null;
  targetBestPosition: number | null;
  confirmedOtherEntityKeys: string[];
  targetCitationDomains: string[];
  targetAttributionLinks: TargetAttributionLinkV2[];
  unresolvedIdentityCount: number;
  unresolvedTargetCandidateCount: number;
  dataQualityFlags: MeasurementEntityFactQualityFlag[];
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./u, "");
}

function validPosition(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
}

function uniqueFlags(
  values: MeasurementEntityFactQualityFlag[],
): MeasurementEntityFactQualityFlag[] {
  return [...new Set(values)];
}

export function buildMeasurementEntityFactsV2(
  input: MeasurementEntityFactsInputV2,
): MeasurementEntityFactsV2 {
  const targetKey = `business:${input.targetBusinessId}`;
  const flags: MeasurementEntityFactQualityFlag[] = [];

  if (!input.valid) {
    return {
      version: MEASUREMENT_ENTITY_FACTS_VERSION,
      measurementId: input.measurementId,
      valid: false,
      targetSeen: null,
      targetBestPosition: null,
      confirmedOtherEntityKeys: [],
      targetCitationDomains: [],
      targetAttributionLinks: [],
      unresolvedIdentityCount: 0,
      unresolvedTargetCandidateCount: 0,
      dataQualityFlags: ["invalid_measurement"],
    };
  }

  const entityByRef = new Map<string, MeasurementEntityObservationV2>();
  for (const entity of input.entities) {
    if (!entity.entityRef || entityByRef.has(entity.entityRef)) continue;
    entityByRef.set(entity.entityRef, entity);
  }

  const confirmed = [...entityByRef.values()].filter(
    (entity) => entity.identityDecision === "confirmed_business",
  );

  const equivalent: MeasurementEntityObservationV2[] = [];
  const otherKeys: string[] = [];
  let unresolvedIdentityCount = 0;
  let unresolvedTargetCandidateCount = 0;
  let equivalentProjectionMismatchCount = 0;

  for (const entity of confirmed) {
    if (entity.equivalenceDecision === "equivalent") {
      if (clean(entity.projectedCanonicalKey) !== targetKey) {
        flags.push("equivalent_projection_mismatch");
        equivalentProjectionMismatchCount += 1;
        continue;
      }
      equivalent.push(entity);
      continue;
    }

    if (entity.equivalenceDecision === "unresolved") {
      unresolvedIdentityCount += 1;
      if (entity.isTargetCandidate) unresolvedTargetCandidateCount += 1;
      continue;
    }

    const key = clean(entity.canonicalKey);
    if (!key) {
      flags.push("distinct_entity_missing_canonical_key");
      continue;
    }
    if (key === targetKey) {
      flags.push("self_key_leakage_blocked");
      continue;
    }
    otherKeys.push(key);
  }

  let targetSeen: boolean | null;
  if (equivalent.length > 0) {
    targetSeen = true;
  } else if (
    equivalentProjectionMismatchCount > 0 ||
    unresolvedTargetCandidateCount > 0
  ) {
    targetSeen = null;
    if (unresolvedTargetCandidateCount > 0) {
      flags.push("target_identity_unresolved");
    }
  } else {
    targetSeen = false;
  }

  const positions = equivalent
    .map((entity) => validPosition(entity.position))
    .filter((value): value is number => value !== null);
  const targetBestPosition =
    positions.length > 0 ? Math.min(...positions) : null;

  if (targetSeen === true && targetBestPosition === null) {
    flags.push("target_position_missing");
  }

  if (targetSeen === true && !input.rawParser.wasClientMentioned) {
    flags.push("parser_false_negative");
  } else if (targetSeen === false && input.rawParser.wasClientMentioned) {
    flags.push("parser_false_positive");
  }

  const targetAttributionLinks: TargetAttributionLinkV2[] = [];
  const seenAttributions = new Set<string>();

  for (const attribution of input.attributions ?? []) {
    if (!attribution.attributionId || seenAttributions.has(attribution.attributionId)) {
      continue;
    }
    const entity = entityByRef.get(attribution.entityRef);
    if (!entity || entity.identityDecision !== "confirmed_business") continue;

    if (
      entity.equivalenceDecision === "equivalent" &&
      clean(entity.projectedCanonicalKey) === targetKey
    ) {
      seenAttributions.add(attribution.attributionId);
      targetAttributionLinks.push({
        attributionId: attribution.attributionId,
        domain: normalizeDomain(attribution.domain),
        url: attribution.url,
      });
      continue;
    }

    if (
      entity.equivalenceDecision === "unresolved" &&
      entity.isTargetCandidate
    ) {
      flags.push("attribution_identity_unresolved");
    }
  }

  targetAttributionLinks.sort((a, b) =>
    a.attributionId.localeCompare(b.attributionId, "en"),
  );

  return {
    version: MEASUREMENT_ENTITY_FACTS_VERSION,
    measurementId: input.measurementId,
    valid: true,
    targetSeen,
    targetBestPosition,
    confirmedOtherEntityKeys: uniqueSorted(otherKeys),
    targetCitationDomains: uniqueSorted(
      targetAttributionLinks
        .map((link) => link.domain)
        .filter((domain) => domain.length > 0),
    ),
    targetAttributionLinks,
    unresolvedIdentityCount,
    unresolvedTargetCandidateCount,
    dataQualityFlags: uniqueFlags(flags),
  };
}
