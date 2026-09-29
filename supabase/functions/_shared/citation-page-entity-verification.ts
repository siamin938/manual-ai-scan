export const CITATION_PAGE_ENTITY_VERIFIER_VERSION = "0.1.0" as const;

export type CitationPageEntityVerificationStatus =
  | "confirmed"
  | "unresolved"
  | "unrelated";

export type CitationPageEntityVerificationConfidence =
  | "high"
  | "medium"
  | "low";

export type CitationPageBusinessIdentity = {
  name: string;
  aliases: string[];
  region?: string | null;
  city?: string | null;
  address?: string | null;
};

export type CitationPageEvidenceInput = {
  url: string;
  citationTitle?: string | null;
  pageTitle?: string | null;
  pageText?: string | null;
  fetchSucceeded: boolean;
  officialSource: boolean;
};

export type CitationPageEntityVerificationResult = {
  verifierVersion: typeof CITATION_PAGE_ENTITY_VERIFIER_VERSION;
  status: CitationPageEntityVerificationStatus;
  confidence: CitationPageEntityVerificationConfidence;
  reasons: string[];
  matchedIdentitySurfaces: string[];
  matchedLocationSignals: string[];
  branchSpecific: boolean;
};

export type CitationPageIdentitySurface = {
  value: string;
  compact: string;
  kind: "explicit" | "inferred_branch";
};

type BranchIdentity = {
  branchSpecific: boolean;
  branchCore: string | null;
  brandCore: string | null;
};

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

function compact(value: string): string {
  return normalize(value).replace(/[^0-9a-z가-힣]/giu, "");
}

function containsSurface(haystack: string, surface: string): boolean {
  const needle = compact(surface);
  return needle.length >= 2 && compact(haystack).includes(needle);
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    const key = compact(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function branchIdentity(name: string): BranchIdentity {
  const normalized = name.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2) {
    return { branchSpecific: false, branchCore: null, brandCore: null };
  }

  const last = tokens.at(-1)!;
  if (/^(?:본점|직영점|지점|분점)$/u.test(last) && tokens.length >= 3) {
    const branchCore = tokens.at(-2) ?? null;
    const brandCore = tokens.slice(0, -2).join(" ").trim() || null;
    return {
      branchSpecific: !!branchCore && !!brandCore,
      branchCore,
      brandCore,
    };
  }

  const compactSuffix = last.match(/^([0-9A-Za-z가-힣]{2,}?)(본점|직영점|지점|분점|점)$/u);
  if (!compactSuffix?.[1]) {
    return { branchSpecific: false, branchCore: null, brandCore: null };
  }

  const branchCore = compactSuffix[1];
  const brandCore = tokens.slice(0, -1).join(" ").trim() || null;
  return {
    branchSpecific: !!branchCore && !!brandCore,
    branchCore,
    brandCore,
  };
}

function safeBranchVariant(value: string): string | null {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2) return null;

  const last = tokens.at(-1)!;
  const compactSuffix = last.match(/^([0-9A-Za-z가-힣]{2,}?)점$/u);
  if (!compactSuffix?.[1]) return null;
  const branchCore = compactSuffix[1];
  if (/(?:본|직영|지|분)$/u.test(branchCore)) return null;
  const alias = [...tokens.slice(0, -1), branchCore].join(" ").trim();
  return compact(alias).length >= 4 ? alias : null;
}

export function buildCitationPageIdentitySurfaces(
  business: CitationPageBusinessIdentity,
): CitationPageIdentitySurface[] {
  const explicit = unique([business.name, ...(business.aliases ?? [])]);
  const out: CitationPageIdentitySurface[] = explicit.map((value) => ({
    value,
    compact: compact(value),
    kind: "explicit",
  }));

  if ((business.aliases ?? []).length === 0) {
    const inferred = safeBranchVariant(business.name);
    if (inferred && !out.some((item) => item.compact === compact(inferred))) {
      out.push({
        value: inferred,
        compact: compact(inferred),
        kind: "inferred_branch",
      });
    }
  }

  return out.sort(
    (a, b) => b.compact.length - a.compact.length || a.value.localeCompare(b.value, "ko"),
  );
}

function locationSignals(business: CitationPageBusinessIdentity): string[] {
  const values: string[] = [];
  for (const value of [business.city, business.region]) {
    if (typeof value === "string" && compact(value).length >= 2) values.push(value);
  }

  if (typeof business.address === "string" && business.address.trim()) {
    const addressTokens = business.address
      .normalize("NFKC")
      .split(/[\s,()]+/u)
      .map((token) => token.trim())
      .filter(
        (token) =>
          compact(token).length >= 3 &&
          !/^(?:대한민국|경기도|서울특별시|서울시|광역시|특별시|도|시|구|군|읍|면|동)$/u.test(token),
      );
    values.push(...addressTokens.slice(-5));
  }

  return unique(values);
}

function officialReason(): CitationPageEntityVerificationResult {
  return {
    verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
    status: "confirmed",
    confidence: "high",
    reasons: ["official_source"],
    matchedIdentitySurfaces: [],
    matchedLocationSignals: [],
    branchSpecific: false,
  };
}

export function verifyCitationPageEntity(args: {
  business: CitationPageBusinessIdentity;
  page: CitationPageEvidenceInput;
  ambiguousIdentityCompacts?: ReadonlySet<string>;
}): CitationPageEntityVerificationResult {
  const business = args.business;
  const page = args.page;
  if (page.officialSource) return officialReason();

  const identity = branchIdentity(business.name);
  const surfaces = buildCitationPageIdentitySurfaces(business);
  const ambiguous = args.ambiguousIdentityCompacts ?? new Set<string>();

  const title = [page.citationTitle ?? "", page.pageTitle ?? ""].filter(Boolean).join(" ");
  const body = page.pageText ?? "";
  const combined = [title, body].filter(Boolean).join(" ");

  const matchedTitle = surfaces.filter(
    (surface) => !ambiguous.has(surface.compact) && containsSurface(title, surface.value),
  );
  const matchedBody = surfaces.filter(
    (surface) => !ambiguous.has(surface.compact) && containsSurface(body, surface.value),
  );
  const matched = unique([...matchedTitle, ...matchedBody].map((item) => item.value));

  const locationMatches = locationSignals(business).filter((signal) =>
    containsSurface(combined, signal)
  );

  const fullNameCompact = compact(business.name);
  const fullNameTitle = fullNameCompact.length >= 4 && containsSurface(title, business.name);
  const fullNameBody = fullNameCompact.length >= 4 && containsSurface(body, business.name);

  const inferredTitle = matchedTitle.some((item) => item.kind === "inferred_branch");
  const inferredBody = matchedBody.some((item) => item.kind === "inferred_branch");

  const brandMatch =
    !!identity.brandCore &&
    compact(identity.brandCore).length >= 3 &&
    containsSurface(combined, identity.brandCore);
  const branchMatch =
    !!identity.branchCore &&
    compact(identity.branchCore).length >= 2 &&
    containsSurface(combined, identity.branchCore);
  const branchCombinationCompact =
    identity.brandCore && identity.branchCore
      ? compact(identity.brandCore + " " + identity.branchCore)
      : "";
  const branchCombinationAmbiguous =
    !!branchCombinationCompact && ambiguous.has(branchCombinationCompact);

  if (identity.branchSpecific) {
    if (fullNameTitle || fullNameBody) {
      return {
        verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
        status: "confirmed",
        confidence: fullNameTitle ? "high" : "medium",
        reasons: [fullNameTitle ? "exact_branch_identity_title" : "exact_branch_identity_body"],
        matchedIdentitySurfaces: matched.length ? matched : [business.name],
        matchedLocationSignals: locationMatches,
        branchSpecific: true,
      };
    }

    if (inferredTitle || inferredBody) {
      return {
        verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
        status: "confirmed",
        confidence: inferredTitle ? "high" : "medium",
        reasons: [
          inferredTitle
            ? "safe_branch_identity_title"
            : "safe_branch_identity_body",
        ],
        matchedIdentitySurfaces: matched,
        matchedLocationSignals: locationMatches,
        branchSpecific: true,
      };
    }

    if (brandMatch && branchMatch && !branchCombinationAmbiguous) {
      return {
        verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
        status: "confirmed",
        confidence: locationMatches.length > 0 ? "high" : "medium",
        reasons: [
          "brand_and_branch_on_page",
          ...(locationMatches.length > 0 ? ["location_corroborated"] : []),
        ],
        matchedIdentitySurfaces: matched,
        matchedLocationSignals: locationMatches,
        branchSpecific: true,
      };
    }

    if (
      brandMatch ||
      branchMatch ||
      matched.length > 0 ||
      branchCombinationAmbiguous
    ) {
      return {
        verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
        status: "unresolved",
        confidence: "low",
        reasons: ["partial_branch_identity_evidence"],
        matchedIdentitySurfaces: matched,
        matchedLocationSignals: locationMatches,
        branchSpecific: true,
      };
    }

    return {
      verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
      status: page.fetchSucceeded ? "unrelated" : "unresolved",
      confidence: page.fetchSucceeded ? "high" : "low",
      reasons: [page.fetchSucceeded ? "no_target_identity_signal" : "page_fetch_unavailable"],
      matchedIdentitySurfaces: [],
      matchedLocationSignals: locationMatches,
      branchSpecific: true,
    };
  }

  const bestMatchedCompact = Math.max(
    0,
    ...matchedTitle.map((item) => item.compact.length),
    ...matchedBody.map((item) => item.compact.length),
  );

  if (matchedTitle.length > 0 && bestMatchedCompact >= 4) {
    return {
      verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
      status: "confirmed",
      confidence: "high",
      reasons: ["exact_identity_title"],
      matchedIdentitySurfaces: matched,
      matchedLocationSignals: locationMatches,
      branchSpecific: false,
    };
  }

  if (
    matchedBody.length > 0 &&
    bestMatchedCompact >= 4 &&
    (bestMatchedCompact >= 6 || locationMatches.length > 0)
  ) {
    return {
      verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
      status: "confirmed",
      confidence: locationMatches.length > 0 ? "high" : "medium",
      reasons: [
        "exact_identity_body",
        ...(locationMatches.length > 0 ? ["location_corroborated"] : []),
      ],
      matchedIdentitySurfaces: matched,
      matchedLocationSignals: locationMatches,
      branchSpecific: false,
    };
  }

  if (matched.length > 0) {
    return {
      verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
      status: "unresolved",
      confidence: "low",
      reasons: ["identity_signal_needs_corroboration"],
      matchedIdentitySurfaces: matched,
      matchedLocationSignals: locationMatches,
      branchSpecific: false,
    };
  }

  return {
    verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
    status: page.fetchSucceeded ? "unrelated" : "unresolved",
    confidence: page.fetchSucceeded ? "high" : "low",
    reasons: [page.fetchSucceeded ? "no_target_identity_signal" : "page_fetch_unavailable"],
    matchedIdentitySurfaces: [],
    matchedLocationSignals: locationMatches,
    branchSpecific: false,
  };
}
