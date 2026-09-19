import type { IdentityDecisionV2 } from "./identity-gate.ts";
import type { TargetEquivalenceDecision } from "./target-equivalence.ts";

export const MEASUREMENT_ENTITY_FACTS_VERSION = "0.3" as const;

export type MeasurementEntityFactQualityFlag =
  | "invalid_measurement"
  | "invalid_target_business_id"
  | "parser_false_positive"
  | "parser_false_negative"
  | "parser_position_mismatch"
  | "target_identity_unresolved"
  | "target_candidate_provenance_incomplete"
  | "target_position_missing"
  | "equivalence_provenance_incomplete"
  | "equivalent_projection_mismatch"
  | "distinct_entity_missing_canonical_key"
  | "other_entity_missing_canonical_key"
  | "self_key_leakage_blocked"
  | "entity_ref_conflict"
  | "attribution_identity_unresolved"
  | "attribution_identity_conflict"
  | "attribution_id_conflict"
  | "attribution_entity_ref_missing"
  | "attribution_url_unvalidated"
  | "attribution_url_invalid"
  | "attribution_domain_mismatch";

export type TargetCandidateDecisionV2 =
  | "candidate"
  | "not_candidate"
  | "unknown";

export interface TargetCandidateAssessmentV2 {
  decision: TargetCandidateDecisionV2;
  version: string;
  reasonCodes: string[];
  evidenceKinds?: string[];
  inputComplete: boolean;
}

export interface RawParserTargetSignalV2 {
  wasClientMentioned: boolean;
  clientPosition: number | null;
}

export interface MeasurementEntityObservationV2 {
  entityRef: string;
  identityDecision: IdentityDecisionV2;
  equivalenceDecision: TargetEquivalenceDecision;
  equivalenceVersion: string;
  equivalenceReasons: string[];
  equivalenceEvidenceKinds: string[];
  targetCandidate: TargetCandidateAssessmentV2;
  canonicalKey?: string | null;
  projectedCanonicalKey?: string | null;
  position?: number | null;
}

export type AttributionUrlValidationV2 =
  | "validated_http_https"
  | "unverified"
  | "invalid";

export interface MeasurementAttributionObservationV2 {
  attributionId: string;
  entityRef: string;
  domain: string;
  url: string;
  urlValidation: AttributionUrlValidationV2;
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
  entityRef: string;
  domain: string;
  url: string;
}

export interface ConfirmedOtherEntityFactV2 {
  canonicalKey: string;
  bestPosition: number | null;
}

export type MeasurementEntitySideV2 =
  | "target"
  | "other"
  | "unresolved"
  | "excluded"
  | "conflict";

export interface MeasurementEntityRelationV2 {
  entityRef: string;
  side: MeasurementEntitySideV2;
  canonicalKey: string | null;
  bestPosition: number | null;
  identityDecision: IdentityDecisionV2 | null;
  equivalenceDecision: TargetEquivalenceDecision | null;
  equivalenceVersion: string | null;
  equivalenceEvidenceKinds: string[];
  targetCandidateDecision: TargetCandidateDecisionV2 | null;
  targetCandidateVersion: string | null;
  targetCandidateReasonCodes: string[];
  targetCandidateEvidenceKinds: string[];
  relationReasonCodes: string[];
}

export interface MeasurementEntityFactsV2 {
  version: typeof MEASUREMENT_ENTITY_FACTS_VERSION;
  measurementId: string;
  valid: boolean;
  targetSeen: boolean | null;
  targetBestPosition: number | null;
  confirmedOtherEntityKeys: string[];
  confirmedOtherEntities: ConfirmedOtherEntityFactV2[];
  entityRelations: MeasurementEntityRelationV2[];
  targetCitationDomains: string[];
  targetAttributionLinks: TargetAttributionLinkV2[];
  sourceFactsStatus: "complete" | "partial";
  unresolvedIdentityCount: number;
  unresolvedTargetCandidateCount: number;
  dataQualityFlags: MeasurementEntityFactQualityFlag[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const FLAG_ORDER: MeasurementEntityFactQualityFlag[] = [
  "invalid_measurement",
  "invalid_target_business_id",
  "entity_ref_conflict",
  "equivalence_provenance_incomplete",
  "equivalent_projection_mismatch",
  "self_key_leakage_blocked",
  "distinct_entity_missing_canonical_key",
  "other_entity_missing_canonical_key",
  "target_candidate_provenance_incomplete",
  "target_identity_unresolved",
  "target_position_missing",
  "parser_false_negative",
  "parser_false_positive",
  "parser_position_mismatch",
  "attribution_id_conflict",
  "attribution_entity_ref_missing",
  "attribution_identity_conflict",
  "attribution_identity_unresolved",
  "attribution_url_unvalidated",
  "attribution_url_invalid",
  "attribution_domain_mismatch",
];

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function validBusinessId(value: string): string | null {
  const normalized = clean(value).toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

function normalizeCanonicalBusinessKey(
  value: string | null | undefined,
): string {
  const key = clean(value);
  if (!key.startsWith("business:")) return key;

  const businessId = validBusinessId(key.slice("business:".length));
  return businessId ? `business:${businessId}` : key;
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

function stableStrings(values: string[] | undefined): string[] {
  return uniqueSorted((values ?? []).map((value) => clean(value)).filter(Boolean));
}

function uniqueFlags(
  values: MeasurementEntityFactQualityFlag[],
): MeasurementEntityFactQualityFlag[] {
  const set = new Set(values);
  return FLAG_ORDER.filter((flag) => set.has(flag));
}

function normalizedCandidate(
  value: TargetCandidateAssessmentV2,
): TargetCandidateAssessmentV2 {
  return {
    decision: value.decision,
    version: clean(value.version),
    reasonCodes: stableStrings(value.reasonCodes),
    evidenceKinds: stableStrings(value.evidenceKinds),
    inputComplete: value.inputComplete === true,
  };
}

function candidateAssessmentTrusted(
  value: TargetCandidateAssessmentV2,
): boolean {
  const normalized = normalizedCandidate(value);
  return (
    normalized.inputComplete &&
    normalized.version.length > 0 &&
    normalized.reasonCodes.length > 0 &&
    normalized.decision !== "unknown"
  );
}

function equivalenceProvenanceTrusted(
  entity: MeasurementEntityObservationV2,
): boolean {
  return (
    clean(entity.equivalenceVersion).length > 0 &&
    stableStrings(entity.equivalenceReasons).length > 0
  );
}

function entitySemanticSignature(
  entity: MeasurementEntityObservationV2,
): string {
  const candidate = normalizedCandidate(entity.targetCandidate);
  return JSON.stringify({
    identityDecision: entity.identityDecision,
    equivalenceDecision: entity.equivalenceDecision,
    equivalenceVersion: clean(entity.equivalenceVersion),
    equivalenceReasons: stableStrings(entity.equivalenceReasons),
    equivalenceEvidenceKinds: stableStrings(entity.equivalenceEvidenceKinds),
    targetCandidate: candidate,
    canonicalKey: normalizeCanonicalBusinessKey(entity.canonicalKey),
    projectedCanonicalKey: normalizeCanonicalBusinessKey(entity.projectedCanonicalKey),
    position: validPosition(entity.position),
  });
}

function attributionSemanticSignature(
  attribution: MeasurementAttributionObservationV2,
): string {
  return JSON.stringify({
    entityRef: clean(attribution.entityRef),
    domain: normalizeDomain(attribution.domain),
    url: attribution.url,
    urlValidation: attribution.urlValidation,
  });
}

function relationReason(...values: string[]): string[] {
  return uniqueSorted(values.map(clean).filter(Boolean));
}

function relationFromEntity(
  entity: MeasurementEntityObservationV2,
  side: MeasurementEntitySideV2,
  canonicalKey: string | null,
  reasonCodes: string[],
): MeasurementEntityRelationV2 {
  return {
    entityRef: clean(entity.entityRef),
    side,
    canonicalKey,
    bestPosition: validPosition(entity.position),
    identityDecision: entity.identityDecision,
    equivalenceDecision: entity.equivalenceDecision,
    equivalenceVersion: clean(entity.equivalenceVersion) || null,
    equivalenceEvidenceKinds: stableStrings(entity.equivalenceEvidenceKinds),
    targetCandidateDecision: entity.targetCandidate.decision,
    targetCandidateVersion: clean(entity.targetCandidate.version) || null,
    targetCandidateReasonCodes: stableStrings(entity.targetCandidate.reasonCodes),
    targetCandidateEvidenceKinds: stableStrings(entity.targetCandidate.evidenceKinds),
    relationReasonCodes: relationReason(...reasonCodes),
  };
}

function conflictRelation(
  entityRef: string,
  reason: string,
): MeasurementEntityRelationV2 {
  return {
    entityRef,
    side: "conflict",
    canonicalKey: null,
    bestPosition: null,
    identityDecision: null,
    equivalenceDecision: null,
    equivalenceVersion: null,
    equivalenceEvidenceKinds: [],
    targetCandidateDecision: null,
    targetCandidateVersion: null,
    targetCandidateReasonCodes: [],
    targetCandidateEvidenceKinds: [],
    relationReasonCodes: [reason],
  };
}

function validatedStoredAttribution(
  attribution: MeasurementAttributionObservationV2,
  flags: MeasurementEntityFactQualityFlag[],
): { domain: string; url: string } | null {
  if (attribution.urlValidation !== "validated_http_https") {
    flags.push("attribution_url_unvalidated");
    return null;
  }

  let url: URL;
  try {
    url = new URL(attribution.url);
  } catch {
    flags.push("attribution_url_invalid");
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    flags.push("attribution_url_invalid");
    return null;
  }

  const domain = normalizeDomain(attribution.domain);
  const urlHost = url.hostname.toLowerCase().replace(/^www\./u, "");
  if (!domain || domain !== urlHost) {
    flags.push("attribution_domain_mismatch");
    return null;
  }

  return { domain, url: attribution.url };
}

function emptyFacts(
  input: MeasurementEntityFactsInputV2,
  flag: MeasurementEntityFactQualityFlag,
): MeasurementEntityFactsV2 {
  return {
    version: MEASUREMENT_ENTITY_FACTS_VERSION,
    measurementId: input.measurementId,
    valid: input.valid,
    targetSeen: null,
    targetBestPosition: null,
    confirmedOtherEntityKeys: [],
    confirmedOtherEntities: [],
    entityRelations: [],
    targetCitationDomains: [],
    targetAttributionLinks: [],
    sourceFactsStatus: "partial",
    unresolvedIdentityCount: 0,
    unresolvedTargetCandidateCount: 0,
    dataQualityFlags: [flag],
  };
}

export function buildMeasurementEntityFactsV2(
  input: MeasurementEntityFactsInputV2,
): MeasurementEntityFactsV2 {
  if (!input.valid) return emptyFacts(input, "invalid_measurement");

  const targetBusinessId = validBusinessId(input.targetBusinessId);
  if (!targetBusinessId) {
    return emptyFacts(input, "invalid_target_business_id");
  }

  const targetKey = `business:${targetBusinessId}`;
  const flags: MeasurementEntityFactQualityFlag[] = [];

  const groupedEntities = new Map<string, MeasurementEntityObservationV2[]>();
  for (const entity of input.entities) {
    const entityRef = clean(entity.entityRef);
    if (!entityRef) {
      flags.push("entity_ref_conflict");
      continue;
    }
    const list = groupedEntities.get(entityRef) ?? [];
    list.push(entity);
    groupedEntities.set(entityRef, list);
  }

  const relations: MeasurementEntityRelationV2[] = [];
  let unresolvedIdentityCount = 0;
  let unresolvedTargetCandidateCount = 0;
  let hasIdentityContractConflict = flags.includes("entity_ref_conflict");

  for (const entityRef of [...groupedEntities.keys()].sort((a, b) =>
    a.localeCompare(b, "en"),
  )) {
    const rows = groupedEntities.get(entityRef) ?? [];
    const signatures = new Set(rows.map(entitySemanticSignature));

    if (signatures.size !== 1) {
      flags.push("entity_ref_conflict");
      hasIdentityContractConflict = true;
      relations.push(conflictRelation(entityRef, "DUPLICATE_ENTITY_REF_CONFLICT"));
      continue;
    }

    const entity = rows[0]!;

    if (entity.identityDecision !== "confirmed_business") {
      relations.push(
        relationFromEntity(entity, "excluded", null, [
          "NOT_CONFIRMED_BUSINESS",
        ]),
      );
      continue;
    }

    if (!equivalenceProvenanceTrusted(entity)) {
      flags.push("equivalence_provenance_incomplete");
      hasIdentityContractConflict = true;
      relations.push(
        relationFromEntity(entity, "conflict", null, [
          "EQUIVALENCE_PROVENANCE_INCOMPLETE",
        ]),
      );
      continue;
    }

    if (entity.equivalenceDecision === "equivalent") {
      if (normalizeCanonicalBusinessKey(entity.projectedCanonicalKey) !== targetKey) {
        flags.push("equivalent_projection_mismatch");
        hasIdentityContractConflict = true;
        relations.push(
          relationFromEntity(entity, "conflict", null, [
            "EQUIVALENT_PROJECTION_MISMATCH",
          ]),
        );
        continue;
      }

      relations.push(
        relationFromEntity(entity, "target", targetKey, [
          ...entity.equivalenceReasons,
          "AUTHORITATIVE_TARGET",
        ]),
      );
      continue;
    }

    if (entity.equivalenceDecision === "unresolved") {
      unresolvedIdentityCount += 1;
      const candidate = normalizedCandidate(entity.targetCandidate);
      const trusted = candidateAssessmentTrusted(candidate);

      if (!trusted) {
        flags.push("target_candidate_provenance_incomplete");
        unresolvedTargetCandidateCount += 1;
        relations.push(
          relationFromEntity(entity, "unresolved", null, [
            ...entity.equivalenceReasons,
            "TARGET_CANDIDATE_PROVENANCE_INCOMPLETE",
          ]),
        );
        continue;
      }

      if (candidate.decision === "candidate") {
        unresolvedTargetCandidateCount += 1;
        relations.push(
          relationFromEntity(entity, "unresolved", null, [
            ...entity.equivalenceReasons,
            "TARGET_CANDIDATE_CANDIDATE",
          ]),
        );
        continue;
      }

      const key = normalizeCanonicalBusinessKey(entity.canonicalKey);
      if (!key) {
        flags.push("other_entity_missing_canonical_key");
        relations.push(
          relationFromEntity(entity, "excluded", null, [
            ...entity.equivalenceReasons,
            "TARGET_CANDIDATE_NOT_CANDIDATE",
            "OTHER_ENTITY_MISSING_CANONICAL_KEY",
          ]),
        );
        continue;
      }

      if (key === targetKey) {
        flags.push("self_key_leakage_blocked");
        hasIdentityContractConflict = true;
        relations.push(
          relationFromEntity(entity, "conflict", null, [
            ...entity.equivalenceReasons,
            "TARGET_CANDIDATE_NOT_CANDIDATE",
            "UNRESOLVED_NON_CANDIDATE_HAS_CURRENT_TARGET_KEY",
          ]),
        );
        continue;
      }

      relations.push(
        relationFromEntity(entity, "other", key, [
          ...entity.equivalenceReasons,
          "TARGET_CANDIDATE_NOT_CANDIDATE",
          "AUTHORITATIVE_OTHER_BY_TARGET_CANDIDATE",
        ]),
      );
      continue;
    }

    const key = normalizeCanonicalBusinessKey(entity.canonicalKey);
    if (!key) {
      flags.push("distinct_entity_missing_canonical_key");
      relations.push(
        relationFromEntity(entity, "excluded", null, [
          "DISTINCT_ENTITY_MISSING_CANONICAL_KEY",
        ]),
      );
      continue;
    }

    if (key === targetKey) {
      flags.push("self_key_leakage_blocked");
      hasIdentityContractConflict = true;
      relations.push(
        relationFromEntity(entity, "conflict", null, [
          "DISTINCT_ENTITY_HAS_CURRENT_TARGET_KEY",
        ]),
      );
      continue;
    }

    relations.push(
      relationFromEntity(entity, "other", key, [
        ...entity.equivalenceReasons,
        "AUTHORITATIVE_OTHER",
      ]),
    );
  }

  relations.sort((a, b) => a.entityRef.localeCompare(b.entityRef, "en"));

  const targetRelations = relations.filter((relation) => relation.side === "target");
  let targetSeen: boolean | null;

  if (hasIdentityContractConflict) {
    targetSeen = null;
  } else if (targetRelations.length > 0) {
    targetSeen = true;
  } else if (unresolvedTargetCandidateCount > 0) {
    targetSeen = null;
    flags.push("target_identity_unresolved");
  } else {
    targetSeen = false;
  }

  const positions = targetRelations
    .map((relation) => relation.bestPosition)
    .filter((value): value is number => value !== null);

  const targetBestPosition =
    targetSeen === true && positions.length > 0 ? Math.min(...positions) : null;

  if (targetSeen === true && targetBestPosition === null) {
    flags.push("target_position_missing");
  }

  if (targetSeen === true && !input.rawParser.wasClientMentioned) {
    flags.push("parser_false_negative");
  } else if (targetSeen === false && input.rawParser.wasClientMentioned) {
    flags.push("parser_false_positive");
  }

  const rawPosition = validPosition(input.rawParser.clientPosition);
  if (
    targetSeen === true &&
    input.rawParser.wasClientMentioned &&
    rawPosition !== null &&
    targetBestPosition !== null &&
    rawPosition !== targetBestPosition
  ) {
    flags.push("parser_position_mismatch");
  }

  const otherPositions = new Map<string, number | null>();
  for (const relation of relations) {
    if (relation.side !== "other" || !relation.canonicalKey) continue;
    const existing = otherPositions.get(relation.canonicalKey);
    if (existing === undefined) {
      otherPositions.set(relation.canonicalKey, relation.bestPosition);
    } else if (
      relation.bestPosition !== null &&
      (existing === null || relation.bestPosition < existing)
    ) {
      otherPositions.set(relation.canonicalKey, relation.bestPosition);
    }
  }

  const relationByRef = new Map(relations.map((relation) => [relation.entityRef, relation]));

  const groupedAttributions = new Map<string, MeasurementAttributionObservationV2[]>();
  for (const attribution of input.attributions ?? []) {
    const id = clean(attribution.attributionId);
    if (!id) {
      flags.push("attribution_id_conflict");
      continue;
    }
    const list = groupedAttributions.get(id) ?? [];
    list.push(attribution);
    groupedAttributions.set(id, list);
  }

  const targetAttributionLinks: TargetAttributionLinkV2[] = [];

  for (const attributionId of [...groupedAttributions.keys()].sort((a, b) =>
    a.localeCompare(b, "en"),
  )) {
    const rows = groupedAttributions.get(attributionId) ?? [];
    const signatures = new Set(rows.map(attributionSemanticSignature));

    if (signatures.size !== 1) {
      flags.push("attribution_id_conflict");
      continue;
    }

    const attribution = rows[0]!;
    const relation = relationByRef.get(clean(attribution.entityRef));
    if (!relation) {
      flags.push("attribution_entity_ref_missing");
      continue;
    }

    if (relation.side === "conflict") {
      flags.push("attribution_identity_conflict");
      continue;
    }

    if (relation.side === "unresolved") {
      flags.push("attribution_identity_unresolved");
      continue;
    }

    if (relation.side !== "target") continue;

    const validated = validatedStoredAttribution(attribution, flags);
    if (!validated) continue;

    targetAttributionLinks.push({
      attributionId,
      entityRef: relation.entityRef,
      domain: validated.domain,
      url: validated.url,
    });
  }

  targetAttributionLinks.sort((a, b) =>
    a.attributionId.localeCompare(b.attributionId, "en"),
  );

  const confirmedOtherEntities = [...otherPositions.entries()]
    .map(([canonicalKey, bestPosition]) => ({ canonicalKey, bestPosition }))
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey, "en"));

  const finalFlags = uniqueFlags(flags);
  const sourcePartialFlags = new Set<MeasurementEntityFactQualityFlag>([
    "entity_ref_conflict",
    "equivalence_provenance_incomplete",
    "equivalent_projection_mismatch",
    "self_key_leakage_blocked",
    "target_candidate_provenance_incomplete",
    "target_identity_unresolved",
    "distinct_entity_missing_canonical_key",
    "attribution_id_conflict",
    "attribution_entity_ref_missing",
    "attribution_identity_conflict",
    "attribution_identity_unresolved",
    "attribution_url_unvalidated",
    "attribution_url_invalid",
    "attribution_domain_mismatch",
  ]);

  return {
    version: MEASUREMENT_ENTITY_FACTS_VERSION,
    measurementId: input.measurementId,
    valid: true,
    targetSeen,
    targetBestPosition,
    confirmedOtherEntityKeys: confirmedOtherEntities.map(
      (entity) => entity.canonicalKey,
    ),
    confirmedOtherEntities,
    entityRelations: relations,
    targetCitationDomains: uniqueSorted(
      targetAttributionLinks.map((link) => link.domain),
    ),
    targetAttributionLinks,
    sourceFactsStatus: finalFlags.some((flag) => sourcePartialFlags.has(flag))
      ? "partial"
      : "complete",
    unresolvedIdentityCount,
    unresolvedTargetCandidateCount,
    dataQualityFlags: finalFlags,
  };
}
