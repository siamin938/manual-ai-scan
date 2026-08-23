/**
 * Canonical Entity Resolver v0.1 (pure, deterministic).
 *
 * PURPOSE
 * Entity Verification v0.1.1 decides whether a mention counts as a business.
 * This layer runs AFTER it and only decides WHICH mentions refer to the same
 * real-world business, so aggregate cards stop double counting the same shop
 * under two spellings.
 *
 * SECURITY / SAFETY CONTRACT
 * - Pure functions. No Supabase, no secrets, no network, no provider calls.
 * - Inputs: verified mention metadata + already-stored measurement source URLs.
 *   response_text, aliases, registry internals and resolution_evidence are
 *   NEVER inputs.
 * - Fail-closed: when evidence is ambiguous the mention stays `standalone`;
 *   merging requires BOTH a strong name-core relation AND a shared concrete URL.
 * - Never mutates parser or verifier output; display names are only chosen,
 *   never rewritten.
 * - reason codes are internal only and must not be surfaced to the browser.
 */

export const RESOLVER_VERSION = "0.1.0";

export type CanonicalResolutionStatus =
  | "matched_business"
  | "merged"
  | "standalone"
  | "needs_review";

export type CanonicalConfidence = "high" | "medium" | "low";

export type ResolverMentionInput = {
  mentionId: string;
  measurementId: string;
  matchedBusinessId: string | null;
  displayName: string;
  /** Result of Entity Verification v0.1.1 (`isVerifiedBusinessMention`). */
  verified: boolean;
};

export type ResolverInput = {
  businessId: string;
  /** id -> registered business name (target + registered competitors). */
  registeredNames: Record<string, string>;
  mentions: readonly ResolverMentionInput[];
  /** measurement_id -> raw source urls already stored for that measurement. */
  sourceUrlsByMeasurement: Record<string, readonly string[]>;
};

export type CanonicalResolution = {
  mentionId: string;
  measurementId: string;
  canonicalKey: string;
  canonicalDisplayName: string;
  resolutionStatus: CanonicalResolutionStatus;
  confidence: CanonicalConfidence;
  reasonCodes: string[];
};

/* ------------------------------------------------------------------ */
/* name normalization (generic grammar/structure, no brand blacklists)  */
/* ------------------------------------------------------------------ */

/** Generic service / store markers used only as comparison helpers. */
const GENERIC_MARKERS = [
  "서비스센터",
  "정비사업소",
  "정비센터",
  "서비스",
  "센터",
  "본점",
  "직영점",
  "지점",
  "분점",
  "대리점",
  "협력점",
  "공식",
];

const REGION_SUFFIX_CHARS = ["시", "군", "구", "읍", "면", "동"];

export function compactName(value: string): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u00a0]+/g, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return (value ?? "")
    .normalize("NFKC")
    .split(/[\s\u00a0·/,]+/)
    .map((t) => t.replace(/[^0-9a-zA-Z가-힣]/g, ""))
    .filter((t) => t.length > 0);
}

function stripGenericMarkers(compact: string): string {
  let out = compact;
  for (const marker of GENERIC_MARKERS) {
    const m = marker.toLowerCase();
    if (out.length > m.length) out = out.split(m).join("");
  }
  return out;
}

function isRegionLikeToken(token: string): boolean {
  if (token.length < 2 || token.length > 3) return false;
  if (!/^[가-힣]+$/.test(token)) return false;
  return true;
}

function endsWithRegionSuffix(token: string): boolean {
  return REGION_SUFFIX_CHARS.some((c) => token.endsWith(c));
}

/**
 * Deterministic set of core-name variants for a display name. Variants are
 * comparison helpers only — the original display name is never rewritten.
 */
export function coreNameVariants(displayName: string): string[] {
  const variants = new Set<string>();
  const tokens = tokenize(displayName);
  const push = (value: string) => {
    const c = compactName(value);
    if (c.length >= 3) variants.add(c);
    const stripped = stripGenericMarkers(c);
    if (stripped.length >= 3) variants.add(stripped);
  };

  push(displayName);
  if (tokens.length > 1) {
    // drop a leading region-like / brand-prefix token
    const first = tokens[0]!;
    if (isRegionLikeToken(first) || endsWithRegionSuffix(first) || tokens.length > 2) {
      push(tokens.slice(1).join(""));
    }
    // trailing token alone (e.g. `X 서비스센터 Y` -> `Y`)
    const last = tokens[tokens.length - 1]!;
    if (stripGenericMarkers(compactName(last)).length >= 4) push(last);
  }
  return Array.from(variants).sort();
}

/** Strong name relation: shared core variant, or core containment (>= 4 chars). */
export function hasStrongNameRelation(a: string, b: string): boolean {
  const va = coreNameVariants(a);
  const vb = coreNameVariants(b);
  if (va.length === 0 || vb.length === 0) return false;
  const setB = new Set(vb);
  for (const v of va) if (setB.has(v)) return true;
  for (const x of va) {
    for (const y of vb) {
      if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* source url normalization                                            */
/* ------------------------------------------------------------------ */

const TRACKING_PARAM_RE = /^(utm_|ref$|referrer$|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$)/i;

/** Normalized concrete URL, or null when the url carries no path evidence. */
export function normalizeConcreteUrl(raw: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let path = url.pathname.replace(/\/+$/, "");
  const params = Array.from(url.searchParams.entries())
    .filter(([k]) => !TRACKING_PARAM_RE.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  if (!path && !params) return null; // domain-only is not concrete evidence
  if (!path) path = "";
  return `${host}${path}${params ? `?${params}` : ""}`;
}

/* ------------------------------------------------------------------ */
/* resolver                                                            */
/* ------------------------------------------------------------------ */

type NameNode = {
  key: string;
  displayName: string;
  mentions: ResolverMentionInput[];
  urls: Set<string>;
};

function informationScore(name: string): [number, number, string] {
  return [tokenize(name).length, compactName(name).length, name];
}

/** Deterministic pick of the most informative display name in a cluster. */
export function pickCanonicalDisplayName(names: readonly string[]): string {
  const sorted = [...names].sort((a, b) => {
    const [ta, la] = informationScore(a);
    const [tb, lb] = informationScore(b);
    return tb - ta || lb - la || a.localeCompare(b);
  });
  return sorted[0] ?? "";
}

export function resolveCanonicalEntities(input: ResolverInput): CanonicalResolution[] {
  const results: CanonicalResolution[] = [];
  const nodes = new Map<string, NameNode>();

  for (const m of input.mentions) {
    if (!m.verified && m.matchedBusinessId !== input.businessId) continue;

    if (m.matchedBusinessId) {
      const name = input.registeredNames[m.matchedBusinessId] ?? m.displayName;
      results.push({
        mentionId: m.mentionId,
        measurementId: m.measurementId,
        canonicalKey: `business:${m.matchedBusinessId}`,
        canonicalDisplayName: name,
        resolutionStatus: "matched_business",
        confidence: "high",
        reasonCodes: ["REGISTERED_BUSINESS_LINK"],
      });
      continue;
    }

    const key = compactName(m.displayName);
    if (!key) continue;
    let node = nodes.get(key);
    if (!node) {
      node = { key, displayName: m.displayName, mentions: [], urls: new Set<string>() };
      nodes.set(key, node);
    }
    node.mentions.push(m);
    for (const raw of input.sourceUrlsByMeasurement[m.measurementId] ?? []) {
      const n = normalizeConcreteUrl(raw);
      if (n) node.urls.add(n);
    }
  }

  // union-find over unregistered name nodes
  const keys = Array.from(nodes.keys()).sort();
  const parent = new Map<string, string>(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = k;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = nodes.get(keys[i]!)!;
      const b = nodes.get(keys[j]!)!;
      if (!hasStrongNameRelation(a.displayName, b.displayName)) continue;
      let shared = false;
      for (const u of a.urls) {
        if (b.urls.has(u)) {
          shared = true;
          break;
        }
      }
      if (!shared) continue;
      union(a.key, b.key);
    }
  }

  const clusters = new Map<string, NameNode[]>();
  for (const k of keys) {
    const root = find(k);
    const list = clusters.get(root) ?? [];
    list.push(nodes.get(k)!);
    clusters.set(root, list);
  }

  for (const [, group] of clusters) {
    const merged = group.length > 1;
    const canonicalDisplayName = pickCanonicalDisplayName(group.map((g) => g.displayName));
    const canonicalKey = `auto:${compactName(canonicalDisplayName)}`;
    for (const node of group) {
      for (const m of node.mentions) {
        results.push({
          mentionId: m.mentionId,
          measurementId: m.measurementId,
          canonicalKey,
          canonicalDisplayName,
          resolutionStatus: merged ? "merged" : "standalone",
          confidence: "high",
          reasonCodes: merged
            ? ["NAME_CORE_MATCH", "SHARED_SOURCE_URL"]
            : ["VERIFIED_STANDALONE"],
        });
      }
    }
  }

  results.sort((a, b) => a.mentionId.localeCompare(b.mentionId));
  return results;
}
