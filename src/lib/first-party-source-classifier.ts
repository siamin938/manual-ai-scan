/**
 * First-party Source Classifier v0.1
 *
 * Pure, deterministic classification of a measured source URL against a
 * registry of verified first-party sources (owned domains, Naver Place,
 * Naver Blog). No DB access, no network calls, no side effects.
 */

export type FirstPartySourceType = "owned_domain" | "naver_place" | "naver_blog";

export type MatchMode = "host_or_subdomain" | "exact_url" | "resource_prefix";

export type VerificationStatus = "verified" | "pending" | "rejected";

export interface ClassifierSourceInput {
  url: string;
  domain?: string | null;
}

export interface FirstPartySourceRegistryEntry {
  id: string;
  sourceType: FirstPartySourceType;
  canonicalUrl?: string | null;
  normalizedHost?: string | null;
  resourceKey?: string | null;
  matchMode: MatchMode;
  verificationStatus: VerificationStatus;
  active: boolean;
}

export interface ClassificationResult {
  classification: "first_party" | "third_party";
  matchedFirstPartySourceId: string | null;
  sourceType: string | null;
  matchMethod: MatchMode | "none";
  confidence: "high" | "medium" | "low";
}

const TRACKING_PARAM_EXACT = new Set([
  "gclid",
  "fbclid",
  "yclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAM_EXACT.has(k);
}

export interface CanonicalUrlParts {
  host: string;
  pathname: string;
  search: string;
  href: string;
}

/** Canonicalize a URL. Returns null for invalid or non-http(s) URLs. */
export function canonicalizeUrl(raw: string | null | undefined): CanonicalUrlParts | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return null;

  // pathname: strip trailing slash except root
  let pathname = parsed.pathname || "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
    if (pathname === "") pathname = "/";
  }

  // query: drop tracking params, keep the rest sorted for deterministic compare
  const params = new URLSearchParams(parsed.search);
  const kept: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (!isTrackingParam(key)) kept.push([key, value]);
  });
  kept.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const search = kept.length
    ? "?" + kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : "";

  // hash removed, default port removed (URL drops default ports automatically)
  const port = parsed.port && !isDefaultPort(parsed.protocol, parsed.port) ? `:${parsed.port}` : "";

  return {
    host,
    pathname,
    search,
    href: `${parsed.protocol}//${host}${port}${pathname}${search}`,
  };
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (protocol === "http:" && port === "80") || (protocol === "https:" && port === "443");
}

function normalizeHost(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let host = raw.trim().toLowerCase();
  if (!host) return null;
  // tolerate a full URL or a bare host
  const asUrl = canonicalizeUrl(host);
  if (asUrl) return asUrl.host;
  host = host.replace(/^\/+/, "").split("/")[0] ?? "";
  host = host.replace(/:\d+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  return host || null;
}

function firstSegment(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg ? decodeURIComponent(seg).toLowerCase() : null;
}

function isPathPrefix(sourcePath: string, basePath: string): boolean {
  if (basePath === "/") return true;
  return sourcePath === basePath || sourcePath.startsWith(basePath + "/");
}

const MATCH_PRIORITY: Record<MatchMode, number> = {
  exact_url: 3,
  resource_prefix: 2,
  host_or_subdomain: 1,
};

const NAVER_BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);

function entryMatches(
  entry: FirstPartySourceRegistryEntry,
  source: CanonicalUrlParts,
): boolean {
  switch (entry.matchMode) {
    case "host_or_subdomain": {
      if (entry.sourceType !== "owned_domain") return false;
      const host = normalizeHost(entry.normalizedHost);
      if (!host) return false;
      return source.host === host || source.host.endsWith(`.${host}`);
    }
    case "exact_url": {
      const canonical = canonicalizeUrl(entry.canonicalUrl);
      if (!canonical) return false;
      return source.href === canonical.href;
    }
    case "resource_prefix": {
      if (entry.sourceType === "naver_blog") {
        const host = source.host;
        const allowed = NAVER_BLOG_HOSTS.has(host) || NAVER_BLOG_HOSTS.has(`www.${host}`);
        if (!allowed) return false;
        const key = (entry.resourceKey ?? "").trim().toLowerCase();
        if (!key) return false;
        const seg = firstSegment(source.pathname);
        return seg !== null && seg === key;
      }
      const canonical = canonicalizeUrl(entry.canonicalUrl);
      if (!canonical) return false;
      if (source.host !== canonical.host) return false;
      return isPathPrefix(source.pathname, canonical.pathname);
    }
    default:
      return false;
  }
}

const THIRD_PARTY: ClassificationResult = {
  classification: "third_party",
  matchedFirstPartySourceId: null,
  sourceType: null,
  matchMethod: "none",
  confidence: "high",
};

export function classifyFirstPartySource(
  source: ClassifierSourceInput,
  registry: readonly FirstPartySourceRegistryEntry[],
): ClassificationResult {
  const canonical = canonicalizeUrl(source?.url);
  if (!canonical) {
    return {
      classification: "third_party",
      matchedFirstPartySourceId: null,
      sourceType: null,
      matchMethod: "none",
      confidence: "low",
    };
  }

  let best: FirstPartySourceRegistryEntry | null = null;
  for (const entry of registry ?? []) {
    if (!entry || !entry.active) continue;
    if (entry.verificationStatus !== "verified") continue;
    if (!entryMatches(entry, canonical)) continue;
    if (best === null || MATCH_PRIORITY[entry.matchMode] > MATCH_PRIORITY[best.matchMode]) {
      best = entry;
    }
  }

  if (!best) return { ...THIRD_PARTY };

  return {
    classification: "first_party",
    matchedFirstPartySourceId: best.id,
    sourceType: best.sourceType,
    matchMethod: best.matchMode,
    confidence: "high",
  };
}
