import type {
  CandidateBusinessRef,
  EntityCandidateV2,
} from "./candidate-extractor";
import type { ResponseNode } from "./response-structure";

export type IdentityDecisionV2 =
  | "confirmed_business"
  | "non_business"
  | "unresolved"
  | "platform"
  | "brand_network";

export type EvidenceProvenance =
  | "registered_exact_subspan"
  | "same_table_row"
  | "same_list_item"
  | "heading_detail_child"
  | "branch_identity"
  | "descendant_branch_pattern";

export interface IdentityEvidenceV2 {
  type: "address" | "phone" | "url" | "registered" | "branch" | "network_pattern";
  provenance: EvidenceProvenance;
  nodeId: string;
  value?: string;
}

export interface IdentityGateResultV2 {
  candidateId: string;
  decision: IdentityDecisionV2;
  identitySurface: string;
  canonicalBusinessId?: string;
  canonicalDisplayName?: string;
  evidence: IdentityEvidenceV2[];
  reasons: string[];
}

const DETAIL_LABELS = new Set([
  "주소",
  "도로명",
  "지번",
  "전화",
  "연락처",
  "위치",
  "영업시간",
  "운영시간",
  "홈페이지",
  "웹사이트",
]);

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function detectPhone(text: string): string | null {
  const match = text.match(/(?:0\d{1,2})[-\s]?\d{3,4}[-\s]?\d{4}/u);
  return match?.[0] ?? null;
}

function detectUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)\]}>,]+/iu);
  return match?.[0] ?? null;
}

function detectAddress(text: string): string | null {
  const explicit = text.match(/(?:주소|도로명|지번)\s*[:：]\s*([^\n|]{3,120})/u);
  if (explicit?.[1]) return explicit[1].trim();

  const road = text.match(
    /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기(?:도)?|강원(?:도)?|충청[남북]도?|전라[남북]도?|경상[남북]도?|제주(?:도)?)?\s*[가-힣]{1,12}(?:시|군|구)\s+[가-힣0-9·.-]{1,20}(?:로|길|대로)\s*\d{1,5}(?:[-\s,][^|\n]{0,40})?/u,
  );
  return road?.[0]?.trim() ?? null;
}

function hasBranchMarker(value: string): boolean {
  const text = value.trim();
  return /(?:본점|지점|분점|직영점|대리점|전문점|[가-힣A-Za-z0-9]{2,}점)$/u.test(text);
}

function hasBusinessDescriptor(value: string): boolean {
  return /(?:모터스|모터|개러지|거라지|garage|팩토리|factory|카센터|카센타|정비소|정비공장|공업사|카케어|오토|auto|랩|타이어|썬팅|스튜디오|바디샵)/iu.test(
    value,
  );
}

function isGenericOfficialNetwork(value: string): boolean {
  const key = compact(value);
  return /(공식|공인).*(인증점|취급점|시공점|대리점|판매점|협력점)$/u.test(key);
}

function isGenericHeading(value: string): boolean {
  const key = compact(value);
  if (!key) return true;

  if (
    /(문의해볼곳|문의할곳|상담해볼곳|상담할곳|고려할곳|찾아볼곳|추천해볼곳|추천할곳|비교할곳|맡길곳|시공할곳|확인할곳)$/u.test(
      key,
    )
  ) {
    return true;
  }

  if (
    /(비교|비교표|정리|요약|목록|체인점|선택지|패키지구성|추천목록)$/u.test(key)
  ) {
    return true;
  }

  if (/^(목적별|상황별|가격대별|작업별|업체별)/u.test(key)) return true;

  return false;
}

function isPlatformDescription(value: string): boolean {
  const key = compact(value);
  return (
    /(앱|플랫폼|제휴|등록).*(정비소|업체|매장|시공점)$/u.test(key) ||
    /(정비소|업체|매장).*(앱|플랫폼|제휴|등록)$/u.test(key)
  );
}

function nodeMap(nodes: ResponseNode[]): Map<string, ResponseNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function isDescendant(
  node: ResponseNode,
  ancestorId: string,
  byId: Map<string, ResponseNode>,
): boolean {
  let parentId = node.parentId;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }

  return false;
}

function collectOwnEvidence(
  candidate: EntityCandidateV2,
  node: ResponseNode,
): IdentityEvidenceV2[] {
  const evidence: IdentityEvidenceV2[] = [];
  const provenance: EvidenceProvenance =
    node.kind === "table_row" ? "same_table_row" : "same_list_item";

  const address = detectAddress(node.scopeText);
  const phone = detectPhone(node.scopeText);
  const url = detectUrl(node.scopeText);

  if (address) evidence.push({ type: "address", provenance, nodeId: node.id, value: address });
  if (phone) evidence.push({ type: "phone", provenance, nodeId: node.id, value: phone });
  if (url) evidence.push({ type: "url", provenance, nodeId: node.id, value: url });

  if (hasBranchMarker(candidate.identitySurface)) {
    evidence.push({
      type: "branch",
      provenance: "branch_identity",
      nodeId: node.id,
      value: candidate.identitySurface,
    });
  }

  return evidence;
}

function collectHeadingDetailEvidence(
  candidate: EntityCandidateV2,
  node: ResponseNode,
  nodes: ResponseNode[],
  byId: Map<string, ResponseNode>,
): IdentityEvidenceV2[] {
  if (node.kind !== "heading") return [];

  const evidence: IdentityEvidenceV2[] = [];

  for (const child of nodes) {
    if (!isDescendant(child, node.id, byId)) continue;
    if (child.kind !== "list_item") continue;
    const label = child.criterionLabel?.trim() ?? "";
    if (!DETAIL_LABELS.has(label)) continue;

    const text = child.criterionBody ?? child.scopeText;
    const address = detectAddress(`${label}: ${text}`);
    const phone = detectPhone(text);
    const url = detectUrl(text);

    if (address) {
      evidence.push({
        type: "address",
        provenance: "heading_detail_child",
        nodeId: child.id,
        value: address,
      });
    }
    if (phone) {
      evidence.push({
        type: "phone",
        provenance: "heading_detail_child",
        nodeId: child.id,
        value: phone,
      });
    }
    if (url) {
      evidence.push({
        type: "url",
        provenance: "heading_detail_child",
        nodeId: child.id,
        value: url,
      });
    }
  }

  return evidence;
}

function inferBrandNetworkFromDescendants(
  candidate: EntityCandidateV2,
  node: ResponseNode,
  nodes: ResponseNode[],
  byId: Map<string, ResponseNode>,
): IdentityEvidenceV2[] {
  if (node.kind !== "heading") return [];
  const prefix = compact(candidate.identitySurface);
  if (prefix.length < 3) return [];

  const branchNodes = nodes.filter((child) => {
    if (!isDescendant(child, node.id, byId)) return false;
    const text = child.kind === "table_row" ? child.cells?.[0] ?? "" : child.text;
    const key = compact(text);
    return key.startsWith(prefix) && key !== prefix && hasBranchMarker(text);
  });

  if (branchNodes.length < 2) return [];

  return [
    {
      type: "network_pattern",
      provenance: "descendant_branch_pattern",
      nodeId: node.id,
      value: `${branchNodes.length}`,
    },
  ];
}

export function evaluateIdentityCandidateV2(
  candidate: EntityCandidateV2,
  nodes: ResponseNode[],
  businesses: CandidateBusinessRef[],
): IdentityGateResultV2 {
  const byId = nodeMap(nodes);
  const node = byId.get(candidate.nodeId);

  if (!node) {
    return {
      candidateId: candidate.id,
      decision: "unresolved",
      identitySurface: candidate.identitySurface,
      evidence: [],
      reasons: ["SOURCE_NODE_MISSING"],
    };
  }

  if (candidate.matchedBusinessIds.length > 1) {
    return {
      candidateId: candidate.id,
      decision: "unresolved",
      identitySurface: candidate.identitySurface,
      evidence: [],
      reasons: ["REGISTERED_ALIAS_COLLISION"],
    };
  }

  if (candidate.matchedBusinessIds.length === 1) {
    const id = candidate.matchedBusinessIds[0]!;
    const business = businesses.find((item) => item.id === id);

    return {
      candidateId: candidate.id,
      decision: "confirmed_business",
      identitySurface: candidate.identitySurface,
      canonicalBusinessId: id,
      canonicalDisplayName: business?.name ?? candidate.identitySurface,
      evidence: [
        {
          type: "registered",
          provenance: "registered_exact_subspan",
          nodeId: node.id,
          value: candidate.matchedAlias ?? candidate.identitySurface,
        },
      ],
      reasons: ["REGISTERED_IDENTITY_SUBSPAN"],
    };
  }

  if (isPlatformDescription(candidate.identitySurface)) {
    return {
      candidateId: candidate.id,
      decision: "platform",
      identitySurface: candidate.identitySurface,
      evidence: [],
      reasons: ["PLATFORM_DESCRIPTION"],
    };
  }

  if (isGenericOfficialNetwork(candidate.identitySurface)) {
    return {
      candidateId: candidate.id,
      decision: "brand_network",
      identitySurface: candidate.identitySurface,
      evidence: [],
      reasons: ["GENERIC_OFFICIAL_NETWORK"],
    };
  }

  if (candidate.role === "heading_surface" && isGenericHeading(candidate.identitySurface)) {
    return {
      candidateId: candidate.id,
      decision: "non_business",
      identitySurface: candidate.identitySurface,
      evidence: [],
      reasons: ["GENERIC_HEADING_SEMANTICS"],
    };
  }

  const networkEvidence = inferBrandNetworkFromDescendants(candidate, node, nodes, byId);
  if (networkEvidence.length > 0) {
    return {
      candidateId: candidate.id,
      decision: "brand_network",
      identitySurface: candidate.identitySurface,
      evidence: networkEvidence,
      reasons: ["DESCENDANT_BRANCH_NETWORK_PATTERN"],
    };
  }

  const evidence = [
    ...collectOwnEvidence(candidate, node),
    ...collectHeadingDetailEvidence(candidate, node, nodes, byId),
  ];

  const hasStrongStructured = evidence.some((item) =>
    item.type === "address" || item.type === "phone" || item.type === "url",
  );
  const branch = hasBranchMarker(candidate.identitySurface);
  const descriptor = hasBusinessDescriptor(candidate.identitySurface);

  if (
    candidate.role === "table_primary_cell" &&
    (hasStrongStructured || branch || descriptor)
  ) {
    return {
      candidateId: candidate.id,
      decision: "confirmed_business",
      identitySurface: candidate.identitySurface,
      canonicalDisplayName: candidate.identitySurface,
      evidence,
      reasons: ["TABLE_ROW_BUSINESS_IDENTITY"],
    };
  }

  if (
    candidate.role === "heading_surface" &&
    !isGenericHeading(candidate.identitySurface) &&
    (hasStrongStructured || branch)
  ) {
    return {
      candidateId: candidate.id,
      decision: "confirmed_business",
      identitySurface: candidate.identitySurface,
      canonicalDisplayName: candidate.identitySurface,
      evidence,
      reasons: ["HEADING_WITH_SCOPED_IDENTITY_EVIDENCE"],
    };
  }

  if (
    (candidate.role === "list_item_surface" || candidate.role === "criterion_body") &&
    branch &&
    !isGenericHeading(candidate.identitySurface)
  ) {
    return {
      candidateId: candidate.id,
      decision: "confirmed_business",
      identitySurface: candidate.identitySurface,
      canonicalDisplayName: candidate.identitySurface,
      evidence,
      reasons: ["LIST_BRANCH_IDENTITY"],
    };
  }

  return {
    candidateId: candidate.id,
    decision: "unresolved",
    identitySurface: candidate.identitySurface,
    evidence,
    reasons: ["INSUFFICIENT_SCOPED_IDENTITY_EVIDENCE"],
  };
}

export function evaluateIdentityCandidatesV2(
  candidates: EntityCandidateV2[],
  nodes: ResponseNode[],
  businesses: CandidateBusinessRef[],
): IdentityGateResultV2[] {
  return candidates.map((candidate) =>
    evaluateIdentityCandidateV2(candidate, nodes, businesses),
  );
}
