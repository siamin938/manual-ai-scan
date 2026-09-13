import {
  extractEntityCandidatesV2,
  type CandidateBusinessRef,
  type EntityCandidateV2,
} from "./candidate-extractor";
import {
  evaluateIdentityCandidatesV2,
  type IdentityDecisionV2,
  type IdentityEvidenceV2,
} from "./identity-gate";
import {
  parseResponseStructure,
  type ResponseNodeKind,
} from "./response-structure";

export const ENTITY_V2_SHADOW_ADAPTER_VERSION = "0.1" as const;

export interface EntityV2ShadowAdapterInput {
  responseText: string;
  businesses?: CandidateBusinessRef[];
}

export interface EntityV2ShadowEvidence {
  type: IdentityEvidenceV2["type"];
  provenance: IdentityEvidenceV2["provenance"];
  nodeId: string;
}

export interface EntityV2ShadowDecision {
  candidateId: string;
  nodeId: string;
  nodeKind: ResponseNodeKind;
  role: EntityCandidateV2["role"];
  observedSurface: string;
  identitySurface: string;
  matchedBusinessIds: string[];
  decision: IdentityDecisionV2;
  canonicalBusinessId?: string;
  canonicalDisplayName?: string;
  reasons: string[];
  evidence: EntityV2ShadowEvidence[];
}

export interface EntityV2ShadowAdapterResult {
  version: typeof ENTITY_V2_SHADOW_ADAPTER_VERSION;
  structureNodeCount: number;
  candidateCount: number;
  decisionCounts: Record<IdentityDecisionV2, number>;
  decisions: EntityV2ShadowDecision[];
}

function emptyDecisionCounts(): Record<IdentityDecisionV2, number> {
  return {
    confirmed_business: 0,
    non_business: 0,
    unresolved: 0,
    platform: 0,
    brand_network: 0,
  };
}

/**
 * Pure, side-effect-free adapter for running Entity Engine v2 in shadow mode.
 *
 * This function intentionally performs no database writes, network calls, AI calls,
 * canonicalization writes, or customer-facing state changes. Runtime callers may use
 * the result for comparison/telemetry while the existing v1 path remains authoritative.
 */
export function runEntityV2ShadowAdapter(
  input: EntityV2ShadowAdapterInput,
): EntityV2ShadowAdapterResult {
  const businesses = input.businesses ?? [];
  const nodes = parseResponseStructure(input.responseText ?? "");
  const candidates = extractEntityCandidatesV2(nodes, businesses);
  const results = evaluateIdentityCandidatesV2(candidates, nodes, businesses);
  const byCandidateId = new Map(results.map((result) => [result.candidateId, result]));
  const decisionCounts = emptyDecisionCounts();

  const decisions: EntityV2ShadowDecision[] = [];
  for (const candidate of candidates) {
    const result = byCandidateId.get(candidate.id);
    if (!result) continue;

    decisionCounts[result.decision] += 1;
    decisions.push({
      candidateId: candidate.id,
      nodeId: candidate.nodeId,
      nodeKind: candidate.nodeKind,
      role: candidate.role,
      observedSurface: candidate.observedSurface,
      identitySurface: result.identitySurface,
      matchedBusinessIds: [...candidate.matchedBusinessIds],
      decision: result.decision,
      ...(result.canonicalBusinessId
        ? { canonicalBusinessId: result.canonicalBusinessId }
        : {}),
      ...(result.canonicalDisplayName
        ? { canonicalDisplayName: result.canonicalDisplayName }
        : {}),
      reasons: [...result.reasons],
      evidence: result.evidence.map((item) => ({
        type: item.type,
        provenance: item.provenance,
        nodeId: item.nodeId,
      })),
    });
  }

  return {
    version: ENTITY_V2_SHADOW_ADAPTER_VERSION,
    structureNodeCount: nodes.length,
    candidateCount: candidates.length,
    decisionCounts,
    decisions,
  };
}
