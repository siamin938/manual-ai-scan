import type { ResponseNode } from "./response-structure";

export interface CandidateBusinessRef {
  id: string;
  name: string;
  aliases: string[];
}

export type CandidateRole =
  | "registered_subspan"
  | "table_primary_cell"
  | "heading_surface"
  | "criterion_body"
  | "list_item_surface";

export interface EntityCandidateV2 {
  id: string;
  nodeId: string;
  nodeKind: ResponseNode["kind"];
  role: CandidateRole;
  observedSurface: string;
  identitySurface: string;
  matchedBusinessIds: string[];
  matchedAlias?: string;
  structuralScope: ResponseNode["kind"];
}

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function escapeRegexChar(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexibleAliasRegex(alias: string): RegExp | null {
  const chars = Array.from(compact(alias));
  if (chars.length < 2) return null;

  const body = chars
    .map(escapeRegexChar)
    .join("[\\s\\p{P}\\p{S}]*");

  return new RegExp(body, "iu");
}

function aliasesFor(business: CandidateBusinessRef): string[] {
  return [...new Set([business.name, ...(business.aliases ?? [])])]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => compact(b).length - compact(a).length);
}

function findRegisteredMatches(
  value: string,
  businesses: CandidateBusinessRef[],
): Array<{
  surface: string;
  alias: string;
  businessId: string;
  index: number;
}> {
  const matches: Array<{
    surface: string;
    alias: string;
    businessId: string;
    index: number;
  }> = [];

  for (const business of businesses) {
    for (const alias of aliasesFor(business)) {
      const regex = flexibleAliasRegex(alias);
      if (!regex) continue;

      const match = regex.exec(value);
      if (!match?.[0]) continue;

      matches.push({
        surface: match[0].trim(),
        alias,
        businessId: business.id,
        index: match.index,
      });

      break;
    }
  }

  return matches.sort(
    (a, b) =>
      a.index - b.index ||
      compact(b.alias).length - compact(a.alias).length ||
      a.businessId.localeCompare(b.businessId),
  );
}

function isLikelyTableHeader(value: string): boolean {
  const key = compact(value);
  return [
    "업체",
    "업체명",
    "매장",
    "정비소",
    "상호",
    "구분",
    "지역",
    "패키지",
  ].includes(key);
}

function dedupeCandidates(candidates: EntityCandidateV2[]): EntityCandidateV2[] {
  const out = new Map<string, EntityCandidateV2>();

  for (const candidate of candidates) {
    const key = [
      candidate.nodeId,
      candidate.role,
      compact(candidate.identitySurface),
      candidate.matchedBusinessIds.slice().sort().join(","),
    ].join("|");

    if (!out.has(key)) out.set(key, candidate);
  }

  return [...out.values()];
}

export function extractEntityCandidatesV2(
  nodes: ResponseNode[],
  businesses: CandidateBusinessRef[],
): EntityCandidateV2[] {
  const candidates: EntityCandidateV2[] = [];

  for (const node of nodes) {
    const searchSurface =
      node.kind === "list_item" && node.criterionBody
        ? node.criterionBody
        : node.text;

    const registered = findRegisteredMatches(searchSurface, businesses);

    if (registered.length > 0) {
      const grouped = new Map<string, typeof registered>();

      for (const match of registered) {
        const surfaceKey = compact(match.surface);
        const current = grouped.get(surfaceKey) ?? [];
        current.push(match);
        grouped.set(surfaceKey, current);
      }

      for (const group of grouped.values()) {
        const first = group[0]!;
        const businessIds = [...new Set(group.map((item) => item.businessId))];

        candidates.push({
          id: `${node.id}:registered:${compact(first.surface)}`,
          nodeId: node.id,
          nodeKind: node.kind,
          role: "registered_subspan",
          observedSurface: node.text,
          identitySurface: first.surface,
          matchedBusinessIds: businessIds,
          matchedAlias: first.alias,
          structuralScope: node.kind,
        });
      }

      // Registered identity is authoritative for extraction. Do not also emit the
      // whole descriptive heading/criterion as a competing identity candidate.
      continue;
    }

    if (node.kind === "table_row") {
      const primary = node.cells?.[0]?.trim() ?? "";
      if (primary && !isLikelyTableHeader(primary)) {
        candidates.push({
          id: `${node.id}:table:${compact(primary)}`,
          nodeId: node.id,
          nodeKind: node.kind,
          role: "table_primary_cell",
          observedSurface: node.text,
          identitySurface: primary,
          matchedBusinessIds: [],
          structuralScope: node.kind,
        });
      }
      continue;
    }

    if (node.kind === "heading") {
      candidates.push({
        id: `${node.id}:heading:${compact(node.text)}`,
        nodeId: node.id,
        nodeKind: node.kind,
        role: "heading_surface",
        observedSurface: node.text,
        identitySurface: node.text,
        matchedBusinessIds: [],
        structuralScope: node.kind,
      });
      continue;
    }

    if (node.kind === "list_item" && node.criterionBody) {
      candidates.push({
        id: `${node.id}:criterion:${compact(node.criterionBody)}`,
        nodeId: node.id,
        nodeKind: node.kind,
        role: "criterion_body",
        observedSurface: node.text,
        identitySurface: node.criterionBody,
        matchedBusinessIds: [],
        structuralScope: node.kind,
      });
      continue;
    }

    if (node.kind === "list_item") {
      candidates.push({
        id: `${node.id}:list:${compact(node.text)}`,
        nodeId: node.id,
        nodeKind: node.kind,
        role: "list_item_surface",
        observedSurface: node.text,
        identitySurface: node.text,
        matchedBusinessIds: [],
        structuralScope: node.kind,
      });
    }
  }

  return dedupeCandidates(candidates);
}
