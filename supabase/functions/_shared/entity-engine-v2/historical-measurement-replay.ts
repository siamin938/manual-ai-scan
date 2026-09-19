import {
  extractEntityCandidatesV2,
  type CandidateBusinessRef,
  type EntityCandidateV2,
} from "./candidate-extractor.ts";
import {
  evaluateIdentityCandidatesV2,
  type IdentityDecisionV2,
  type IdentityGateResultV2,
} from "./identity-gate.ts";
import {
  buildMeasurementEntityFactsV2,
  type MeasurementEntityFactsV2,
  type MeasurementEntityObservationV2,
  type RawParserTargetSignalV2,
} from "./measurement-entity-facts.ts";
import { parseResponseStructure } from "./response-structure.ts";
import {
  evaluateTargetEquivalenceV2,
  normalizeIdentitySurface,
  type PublicBusinessIdentityV2,
  type TargetBusinessIdentityV2,
} from "./target-equivalence.ts";
import {
  assessTargetCandidateV2,
  TARGET_CANDIDATE_ASSESSMENT_VERSION,
} from "./target-candidate-assessment.ts";

export const HISTORICAL_MEASUREMENT_REPLAY_VERSION = "0.1" as const;
export const TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION = "0.3" as const;

export type HistoricalReplayDiagnosticCode =
  | "PUBLIC_IDENTITY_AMBIGUOUS"
  | "STORED_MENTION_CANONICAL_KEY_AMBIGUOUS"
  | "SOURCE_REPLAY_NOT_EVALUATED";

export interface ReplayBusinessIdentityV2 extends CandidateBusinessRef {
  fullAddress?: string | null;
  canonicalNaverPlaceId?: string | null;
  verifiedPhone?: string | null;
  verifiedConcreteOfficialUrls?: string[];
  branchIdentityKey?: string | null;
}

export interface ReplayPublicIdentityV2 {
  name: string;
  aliases?: string[];
  fullAddress?: string | null;
  canonicalNaverPlaceId?: string | null;
  verifiedPhone?: string | null;
  verifiedConcreteOfficialUrls?: string[];
  branchIdentityKey?: string | null;
}

export interface ReplayStoredMentionV2 {
  mentionId: string;
  displayName: string;
  matchedAlias?: string | null;
  matchedBusinessId?: string | null;
  position?: number | null;
  canonicalKey?: string | null;
  canonicalDisplayName?: string | null;
}

export interface HistoricalMeasurementReplayInputV2 {
  measurementId: string;
  valid: boolean;
  responseText: string;
  rawParser: RawParserTargetSignalV2;
  target: ReplayBusinessIdentityV2;
  registeredBusinesses: ReplayBusinessIdentityV2[];
  publicIdentities?: ReplayPublicIdentityV2[];
  storedMentions?: ReplayStoredMentionV2[];
}

export interface HistoricalMeasurementReplayDiagnosticV2 {
  code: HistoricalReplayDiagnosticCode;
  candidateId?: string;
  identitySurface?: string;
  detail: string;
}

export interface ReplayEntityMentionLinkV2 {
  entityRef: string;
  mentionIds: string[];
}

export interface HistoricalMeasurementReplayResultV2 {
  version: typeof HISTORICAL_MEASUREMENT_REPLAY_VERSION;
  sourceReplayStatus: "not_evaluated";
  facts: MeasurementEntityFactsV2;
  observations: MeasurementEntityObservationV2[];
  identityDecisions: IdentityGateResultV2[];
  entityMentionLinks: ReplayEntityMentionLinkV2[];
  diagnostics: HistoricalMeasurementReplayDiagnosticV2[];
}

function compact(value: string | null | undefined): string {
  return normalizeIdentitySurface(value);
}

function validPosition(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function asTargetIdentity(
  target: ReplayBusinessIdentityV2,
): TargetBusinessIdentityV2 {
  return {
    businessId: target.id,
    name: target.name,
    aliases: [...(target.aliases ?? [])],
    canonicalNaverPlaceId: target.canonicalNaverPlaceId ?? null,
    fullAddress: target.fullAddress ?? null,
    verifiedPhone: target.verifiedPhone ?? null,
    verifiedConcreteOfficialUrls: [
      ...(target.verifiedConcreteOfficialUrls ?? []),
    ],
    branchIdentityKey: target.branchIdentityKey ?? null,
  };
}

function asPublicIdentity(
  business: ReplayBusinessIdentityV2,
): PublicBusinessIdentityV2 {
  return {
    businessId: business.id,
    name: business.name,
    aliases: [...(business.aliases ?? [])],
    canonicalNaverPlaceId: business.canonicalNaverPlaceId ?? null,
    fullAddress: business.fullAddress ?? null,
    verifiedPhone: business.verifiedPhone ?? null,
    verifiedConcreteOfficialUrls: [
      ...(business.verifiedConcreteOfficialUrls ?? []),
    ],
    branchIdentityKey: business.branchIdentityKey ?? null,
  };
}

function publicIdentitySignature(identity: ReplayPublicIdentityV2): string {
  return JSON.stringify({
    name: compact(identity.name),
    aliases: [...new Set((identity.aliases ?? []).map(compact).filter(Boolean))].sort(),
    fullAddress: (identity.fullAddress ?? "").trim(),
    canonicalNaverPlaceId: (identity.canonicalNaverPlaceId ?? "").trim(),
    verifiedPhone: (identity.verifiedPhone ?? "").trim(),
    verifiedConcreteOfficialUrls: [
      ...new Set((identity.verifiedConcreteOfficialUrls ?? []).map((value) => value.trim()).filter(Boolean)),
    ].sort(),
    branchIdentityKey: (identity.branchIdentityKey ?? "").trim(),
  });
}

function findPublicIdentity(
  surface: string,
  publicIdentities: ReplayPublicIdentityV2[],
): {
  identity: PublicBusinessIdentityV2;
  ambiguous: boolean;
} {
  const key = compact(surface);
  const matches = publicIdentities.filter((identity) => {
    const surfaces = [identity.name, ...(identity.aliases ?? [])].map(compact);
    return surfaces.includes(key);
  });

  if (matches.length === 0) {
    return {
      identity: { name: surface },
      ambiguous: false,
    };
  }

  const unique = new Map<string, ReplayPublicIdentityV2>();
  for (const match of matches) {
    unique.set(publicIdentitySignature(match), match);
  }

  if (unique.size !== 1) {
    return {
      identity: { name: surface },
      ambiguous: true,
    };
  }

  const match = [...unique.values()][0]!;
  return {
    identity: {
      name: match.name,
      aliases: [...(match.aliases ?? [])],
      canonicalNaverPlaceId: match.canonicalNaverPlaceId ?? null,
      fullAddress: match.fullAddress ?? null,
      verifiedPhone: match.verifiedPhone ?? null,
      verifiedConcreteOfficialUrls: [
        ...(match.verifiedConcreteOfficialUrls ?? []),
      ],
      branchIdentityKey: match.branchIdentityKey ?? null,
    },
    ambiguous: false,
  };
}

function matchingMentions(
  candidate: EntityCandidateV2,
  result: IdentityGateResultV2,
  mentions: ReplayStoredMentionV2[],
): ReplayStoredMentionV2[] {
  if (result.canonicalBusinessId) {
    const byBusinessId = mentions.filter(
      (mention) => mention.matchedBusinessId === result.canonicalBusinessId,
    );
    if (byBusinessId.length > 0) return byBusinessId;
  }

  const surfaces = new Set(
    [
      candidate.identitySurface,
      result.identitySurface,
      result.canonicalDisplayName ?? "",
      candidate.matchedAlias ?? "",
    ]
      .map(compact)
      .filter(Boolean),
  );

  return mentions.filter((mention) =>
    [
      mention.displayName,
      mention.matchedAlias ?? "",
      mention.canonicalDisplayName ?? "",
    ]
      .map(compact)
      .some((value) => Boolean(value && surfaces.has(value))),
  );
}

function bestStoredPosition(mentions: ReplayStoredMentionV2[]): number | null {
  const positions = mentions
    .map((mention) => validPosition(mention.position))
    .filter((value): value is number => value !== null);
  return positions.length > 0 ? Math.min(...positions) : null;
}

function storedCanonicalKey(
  mentions: ReplayStoredMentionV2[],
): { key: string | null; ambiguous: boolean } {
  const keys = [
    ...new Set(
      mentions
        .map((mention) => (mention.canonicalKey ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (keys.length === 1) return { key: keys[0]!, ambiguous: false };
  return { key: null, ambiguous: keys.length > 1 };
}

function notApplicableCandidate() {
  return {
    decision: "unknown" as const,
    version: TARGET_CANDIDATE_ASSESSMENT_VERSION,
    reasonCodes: ["IDENTITY_NOT_CONFIRMED"],
    evidenceKinds: [],
    inputComplete: false,
  };
}

function observationFor(
  candidate: EntityCandidateV2,
  result: IdentityGateResultV2,
  input: HistoricalMeasurementReplayInputV2,
  diagnostics: HistoricalMeasurementReplayDiagnosticV2[],
): MeasurementEntityObservationV2 {
  const mentions = matchingMentions(
    candidate,
    result,
    input.storedMentions ?? [],
  );
  const position = bestStoredPosition(mentions);

  if (result.decision !== "confirmed_business") {
    return {
      entityRef: candidate.id,
      identityDecision: result.decision,
      equivalenceDecision: "unresolved",
      equivalenceVersion: TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION,
      equivalenceReasons: ["IDENTITY_NOT_CONFIRMED"],
      equivalenceEvidenceKinds: [],
      targetCandidate: notApplicableCandidate(),
      canonicalKey: null,
      projectedCanonicalKey: null,
      position,
    };
  }

  let observed: PublicBusinessIdentityV2;
  if (result.canonicalBusinessId) {
    const registered = input.registeredBusinesses.find(
      (business) => business.id === result.canonicalBusinessId,
    );
    observed = registered
      ? asPublicIdentity(registered)
      : {
          businessId: result.canonicalBusinessId,
          name: result.canonicalDisplayName ?? result.identitySurface,
        };
  } else {
    const publicMatch = findPublicIdentity(
      result.identitySurface,
      input.publicIdentities ?? [],
    );
    observed = publicMatch.identity;
    if (publicMatch.ambiguous) {
      diagnostics.push({
        code: "PUBLIC_IDENTITY_AMBIGUOUS",
        candidateId: candidate.id,
        identitySurface: result.identitySurface,
        detail:
          "Multiple distinct public identity records match this exact surface; replay did not choose one.",
      });
    }
  }

  const equivalence = evaluateTargetEquivalenceV2({
    target: asTargetIdentity(input.target),
    observed,
    observedIdentityDecision: result.decision,
  });

  const targetCandidate = assessTargetCandidateV2({
    target: asTargetIdentity(input.target),
    observed,
    observedSurface: result.identitySurface,
    inputComplete: true,
  });

  const canonical = storedCanonicalKey(mentions);
  if (canonical.ambiguous) {
    diagnostics.push({
      code: "STORED_MENTION_CANONICAL_KEY_AMBIGUOUS",
      candidateId: candidate.id,
      identitySurface: result.identitySurface,
      detail:
        "Stored mentions matching this replay entity carry multiple canonical keys; replay did not choose one.",
    });
  }

  const canonicalKey = result.canonicalBusinessId
    ? `business:${result.canonicalBusinessId}`
    : canonical.key;

  return {
    entityRef: candidate.id,
    identityDecision: result.decision,
    equivalenceDecision: equivalence.decision,
    equivalenceVersion: TARGET_EQUIVALENCE_REPLAY_PROVENANCE_VERSION,
    equivalenceReasons: [...equivalence.reasons],
    equivalenceEvidenceKinds: [...equivalence.evidenceKinds],
    targetCandidate,
    canonicalKey,
    projectedCanonicalKey: equivalence.projectedCanonicalKey,
    position,
  };
}

export function replayHistoricalMeasurementV2(
  input: HistoricalMeasurementReplayInputV2,
): HistoricalMeasurementReplayResultV2 {
  const nodes = parseResponseStructure(input.responseText ?? "");
  const businesses = input.registeredBusinesses.map<CandidateBusinessRef>(
    (business) => ({
      id: business.id,
      name: business.name,
      aliases: [...(business.aliases ?? [])],
    }),
  );
  const candidates = extractEntityCandidatesV2(nodes, businesses);
  const decisions = evaluateIdentityCandidatesV2(
    candidates,
    nodes,
    businesses,
  );
  const byCandidateId = new Map(
    decisions.map((decision) => [decision.candidateId, decision]),
  );

  const diagnostics: HistoricalMeasurementReplayDiagnosticV2[] = [
    {
      code: "SOURCE_REPLAY_NOT_EVALUATED",
      detail:
        "This replay stage evaluates entity/target facts only. Source actionability is finalized at run scope.",
    },
  ];

  const observations = candidates.flatMap((candidate) => {
    const result = byCandidateId.get(candidate.id);
    return result ? [observationFor(candidate, result, input, diagnostics)] : [];
  });

  const entityMentionLinks = candidates.flatMap((candidate) => {
    const result = byCandidateId.get(candidate.id);
    if (!result) return [];
    return [
      {
        entityRef: candidate.id,
        mentionIds: matchingMentions(
          candidate,
          result,
          input.storedMentions ?? [],
        )
          .map((mention) => mention.mentionId)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "en")),
      },
    ];
  });

  const facts = buildMeasurementEntityFactsV2({
    measurementId: input.measurementId,
    targetBusinessId: input.target.id,
    valid: input.valid,
    rawParser: input.rawParser,
    entities: observations,
    attributions: [],
  });

  return {
    version: HISTORICAL_MEASUREMENT_REPLAY_VERSION,
    sourceReplayStatus: "not_evaluated",
    facts,
    observations,
    identityDecisions: decisions,
    entityMentionLinks,
    diagnostics,
  };
}
