import { canonicalizeUrl } from "./first-party-source-classifier";
import { isInfrastructureSourceDomain } from "./source-domain-classifier";
import type { EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";
import type { CurrentRunSourceReference } from "./action-opportunity-evidence.functions";

export function savedSourceUrl(raw: unknown, domain: string | null): string | null {
  if (typeof raw !== "string" || !domain) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        url.port || !host.includes(".") || host !== domain.toLowerCase().trim().replace(/^www\./u, "") ||
        isInfrastructureSourceDomain(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export type CitedPage = { title: string; url: string; domain: string; responseCount: number; profileName?: string; namedResponseCount?: number };
export type SavedCitation = { title: string | null; url: string | null; domain: string | null; measurement_id: string };

// A recognized single-profile route has one identity regardless of search/tracking
// parameters. All other sites retain their query parameters in the page identity.
function daangnProfile(url: URL, title: string) {
  if (url.hostname.replace(/^www\./u, "") !== "daangn.com" ||
      !/^\/kr\/local-profile\/[^/]+\/?$/u.test(url.pathname)) return null;
  const fields = title.split(/\s*\|\s*/u);
  if (fields.length < 3 || !fields.at(-1)?.includes("당근") || !fields[0]?.trim()) return null;
  return { key: "daangn:" + url.pathname.replace(/\/$/u, ""), name: fields[0].trim() };
}

function visibleAnswerWords(text: string) {
  return text.normalize("NFKC").toLowerCase()
    .replace(/\[[^\]\n]*\]\(https?:\/\/[^\s]*?\)/giu, " ")
    .replace(/https?:\/\/\S+/giu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function scopedCitedPages(
  rows: readonly SavedCitation[], validIds: ReadonlySet<string>, answers: ReadonlyMap<string, string> = new Map(),
): CitedPage[] {
  const words = new Map(Array.from(answers, ([id, text]) => [id, " " + visibleAnswerWords(text) + " "]));
  const pages = new Map<string, { page: CitedPage; answers: Set<string>; named: Set<string> }>();
  for (const row of rows) {
    if (!validIds.has(row.measurement_id)) continue;
    const url = savedSourceUrl(row.url, row.domain);
    if (!url || !row.domain) continue;
    const domain = row.domain.toLowerCase().replace(/^www\./u, "");
    const title = row.title?.trim() || domain;
    const profile = daangnProfile(new URL(url), title);
    const key = profile?.key ?? canonicalizeUrl(url)?.href;
    if (!key) continue;
    const entry = pages.get(key) ?? { page: { title, url, domain, responseCount: 0, ...(profile ? { profileName: profile.name } : {}) }, answers: new Set<string>(), named: new Set<string>() };
    if (profile && entry.page.profileName === profile.name && words.get(row.measurement_id)?.includes(" " + visibleAnswerWords(profile.name) + " ")) {
      entry.named.add(row.measurement_id);
    }
    if (entry.page.title === domain) entry.page.title = title;
    entry.answers.add(row.measurement_id);
    pages.set(key, entry);
  }
  return Array.from(pages.values(), ({ page, answers, named }) => ({ ...page, responseCount: answers.size, ...(page.profileName ? { namedResponseCount: named.size } : {}) }))
    .sort((a, b) => b.responseCount - a.responseCount || a.title.localeCompare(b.title, "ko") || a.url.localeCompare(b.url));
}

export function repeatedPeerEvidence(
  dto: Pick<EntityFactsV2ReadGatewayDTO, "overview" | "competitors" | "observedSources">,
  references: readonly CurrentRunSourceReference[],
) {
  const repeated = dto.competitors.filter(row => row.responseCount >= 2 && row.responseCount <= dto.overview.validCount);
  const pages = new Map<string, string>();
  for (const reference of references) {
    for (const entity of reference.entities) {
      const url = savedSourceUrl(entity.url, reference.domain);
      if (url) pages.set(JSON.stringify([reference.domain, entity.entityName]), url);
    }
  }
  return repeated.map(peer => {
    const sources = dto.observedSources.flatMap(source => {
      if (source.evidence === "clue") return [];
      const entity = source.linkedEntities.find(row => row.name === peer.name && !row.isTarget && row.evidence === "confirmed");
      if (!entity || entity.responseCount <= 0 || entity.responseCount > peer.responseCount) return [];
      return [{ domain: source.domain, count: entity.responseCount, url: pages.get(JSON.stringify([source.domain, peer.name])) }];
    }).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
    return { ...peer, sources };
  }).sort((a,b) => b.responseCount - a.responseCount || a.name.localeCompare(b.name,"ko"));
}

const SITE_DISPLAY_NAMES: Array<{ match: RegExp; name: string }> = [
  { match: /(^|\.)mycle\.co\.kr$/, name: "마이클" },
  { match: /(^|\.)seongnam\.go\.kr$/, name: "성남시" },
  { match: /(^|\.)issuetale\.kr$/, name: "이슈테일" },
  { match: /(^|\.)daangn\.com$/, name: "당근" },
  { match: /(^|\.)pf\.kakao\.com$/, name: "카카오톡 채널" },
  { match: /(^|\.)placeview\.co\.kr$/, name: "플레이스뷰" },
  { match: /(^|\.)oh-car\.kr$/, name: "오늘의카" },
  { match: /(^|\.)blog\.naver\.com$/, name: "네이버 블로그" },
  { match: /(^|\.)cafe\.naver\.com$/, name: "네이버 카페" },
];

export function siteDisplayName(domain: string): string {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return SITE_DISPLAY_NAMES.find((entry) => entry.match.test(normalized))?.name ?? domain;
}
