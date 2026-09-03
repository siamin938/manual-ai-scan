/**
 * Integrated Canonical Resolver v0.1.1 — server-only pure rule engine.
 *
 * This mirrors the resolver semantics used by the production
 * `visibility-postprocess` pipeline without exposing them to the browser.
 *
 * v0.1.1 change:
 * - Treat a strict cross-script parenthetical alias as the same name surface
 *   (e.g. `제이존` ↔ `제이존(J Zone)`) only when the candidates also share the
 *   same concrete source URL.
 * - Same-script parentheticals such as `레이노(구로점)` are deliberately NOT
 *   promoted by this rule.
 * - Existing name-core + shared-concrete-URL merge requirements remain intact.
 */

export const INTEGRATED_CANONICAL_RESOLVER_VERSION = "0.1.1";

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

const REGION_SUFFIXES = ["시", "군", "구", "읍", "면", "동"];
const TRACKING_PARAM = /^(utm_|ref$|referrer$|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$)/i;

function normalizeText(value: string): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function compact(value: string): string {
  return normalizeText(value).replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

function tokenizeName(value: string): string[] {
  return (value ?? "")
    .normalize("NFKC")
    .split(/[\s\u00a0·/,]+/)
    .map((token) => token.replace(/[^0-9a-zA-Z가-힣]/g, ""))
    .filter(Boolean);
}

function stripGenericMarkers(value: string): string {
  let output = value;
  for (const marker of GENERIC_MARKERS) {
    const normalizedMarker = compact(marker);
    if (output.length > normalizedMarker.length) {
      output = output.split(normalizedMarker).join("");
    }
  }
  return output;
}

function isRegionToken(token: string): boolean {
  return token.length >= 2 && token.length <= 3 && /^[가-힣]+$/.test(token);
}

function coreVariants(name: string): string[] {
  const variants = new Set<string>();
  const tokens = tokenizeName(name);
  const push = (value: string) => {
    const normalized = compact(value);
    if (normalized.length >= 3) variants.add(normalized);
    const stripped = stripGenericMarkers(normalized);
    if (stripped.length >= 3) variants.add(stripped);
  };

  push(name);

  if (tokens.length > 1) {
    const first = tokens[0]!;
    if (
      isRegionToken(first) ||
      REGION_SUFFIXES.some((suffix) => first.endsWith(suffix)) ||
      tokens.length > 2
    ) {
      push(tokens.slice(1).join(""));
    }

    const last = tokens.at(-1)!;
    if (stripGenericMarkers(compact(last)).length >= 4) push(last);
  }

  return [...variants];
}

/**
 * Returns the outer name only for a strict opposite-script alias form.
 *
 * Allowed examples:
 * - 제이존(J Zone)
 * - 카핏(Carfit)
 * - J Zone(제이존)
 *
 * Intentionally rejected:
 * - 레이노(구로점)      // both Hangul
 * - ABC모터스(서울점)   // mixed outer name; too ambiguous for auto-merge
 */
export function crossScriptParentheticalBase(name: string): string | null {
  const normalized = normalizeText(name);
  const match = normalized.match(/^(.{2,60}?)\s*[\(（]([^()（）]{1,40})[\)）]\s*$/u);
  if (!match) return null;

  const base = normalizeText(match[1]!);
  const alias = normalizeText(match[2]!);
  const baseHasHangul = /[가-힣]/u.test(base);
  const baseHasLatin = /[A-Za-z]/.test(base);
  const aliasHasHangul = /[가-힣]/u.test(alias);
  const aliasHasLatin = /[A-Za-z]/.test(alias);

  const strictOppositeScript =
    (baseHasHangul && !baseHasLatin && aliasHasLatin && !aliasHasHangul) ||
    (baseHasLatin && !baseHasHangul && aliasHasHangul && !aliasHasLatin);

  if (!strictOppositeScript) return null;

  const normalizedBase = compact(base);
  return normalizedBase.length >= 2 ? normalizedBase : null;
}

/** Name-only relation. Source evidence is checked separately and remains mandatory. */
export function canonicalNamesRelated(a: string, b: string): boolean {
  const compactA = compact(a);
  const compactB = compact(b);
  if (!compactA || !compactB) return false;

  const aliasBaseA = crossScriptParentheticalBase(a);
  const aliasBaseB = crossScriptParentheticalBase(b);

  if (aliasBaseA && aliasBaseA === compactB) return true;
  if (aliasBaseB && aliasBaseB === compactA) return true;

  const variantsA = coreVariants(a);
  const variantsB = coreVariants(b);
  const variantsBSet = new Set(variantsB);

  for (const left of variantsA) {
    if (variantsBSet.has(left)) return true;
  }

  for (const left of variantsA) {
    for (const right of variantsB) {
      if (
        left.length >= 4 &&
        right.length >= 4 &&
        (left.includes(right) || right.includes(left))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalize only concrete source URLs. Domain roots are intentionally excluded,
 * and tracking parameters do not create artificial URL differences.
 */
export function normalizeConcreteSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    if (!path && !query) return null;
    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function concreteSourceSet(urls: string[]): Set<string> {
  const output = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeConcreteSourceUrl(raw);
    if (normalized) output.add(normalized);
  }
  return output;
}

export function sharesConcreteSourceUrl(aUrls: string[], bUrls: string[]): boolean {
  const a = concreteSourceSet(aUrls);
  const b = concreteSourceSet(bUrls);
  for (const url of a) {
    if (b.has(url)) return true;
  }
  return false;
}

export function shouldMergeCanonicalCandidates(args: {
  leftName: string;
  rightName: string;
  leftSourceUrls: string[];
  rightSourceUrls: string[];
}): boolean {
  return (
    canonicalNamesRelated(args.leftName, args.rightName) &&
    sharesConcreteSourceUrl(args.leftSourceUrls, args.rightSourceUrls)
  );
}
