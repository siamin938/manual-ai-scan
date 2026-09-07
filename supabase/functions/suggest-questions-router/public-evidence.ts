type SupabaseAdmin = any;

type PublicEvidenceBusiness = {
  id: string;
  name: string;
  category?: string | null;
  country_code?: string | null;
  region?: string | null;
  city?: string | null;
  address?: string | null;
  website_url?: string | null;
  naver_place_url?: string | null;
  google_maps_url?: string | null;
};

type Source = { url: string; title: string | null };

type EvidenceGenerationBasis = "public_evidence" | "registration_backed" | null;

type EvidenceBasisResult = {
  ready: boolean;
  publicEvidenceReady: boolean;
  registrationBacked: boolean;
  generationBasis: EvidenceGenerationBasis;
};

type EvidenceCheckResult = EvidenceBasisResult & {
  searched: boolean;
  acceptedEvidenceCount: number;
  reason: "already_available" | "verified" | "cached_no_evidence" | "no_evidence" | "check_failed" | "profile_unavailable";
};

// Fail-closed basis: no public evidence readiness and no registration-backed permission.
const CLOSED_BASIS: EvidenceBasisResult = {
  ready: false,
  publicEvidenceReady: false,
  registrationBacked: false,
  generationBasis: null,
};


const MODEL = "gpt-5.6-luna";
const NO_EVIDENCE_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILED_CACHE_MS = 15 * 60 * 1000;
const MAX_SERVICES = 6;
const MAX_URLS_PER_SERVICE = 2;

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeBrandStemHint(name: string, city: string | null | undefined): string {
  const rawName = clean(name);
  if (!rawName) return "";

  const cityTokens = clean(city).split(/\s+/).filter(Boolean);
  const adminSuffixes = ["특별자치시", "특별시", "광역시", "시", "군", "구"];
  const stripTokens = new Set<string>();

  for (const token of cityTokens) {
    if (!token) continue;
    stripTokens.add(token);
    for (const suffix of adminSuffixes) {
      if (token.endsWith(suffix) && token.length > suffix.length) {
        stripTokens.add(token.slice(0, -suffix.length));
      }
    }
  }

  // Remove longer tokens first so that short tokens do not corrupt longer matches.
  const sortedTokens = Array.from(stripTokens).sort((a, b) => b.length - a.length);
  let stem = rawName;
  for (const token of sortedTokens) {
    if (token.length < 1) continue;
    stem = stem.replace(new RegExp(escapeRegExp(token), "g"), "");
  }

  const branchSuffixes = ["본점", "지점"];
  for (const suffix of branchSuffixes) {
    stem = stem.replace(new RegExp(escapeRegExp(suffix) + "$"), "").trim();
  }

  stem = clean(stem);
  if (stem.length < 2) return rawName;
  return stem;
}

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const row = rec(item);
    for (const content of Array.isArray(row?.content) ? row!.content : []) {
      const c = rec(content);
      if (typeof c?.text === "string") parts.push(c.text);
      const textObj = rec(c?.text);
      if (typeof textObj?.value === "string") parts.push(textObj.value);
    }
  }
  return parts.join("\n");
}

function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    const tracking = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
    for (const key of tracking) u.searchParams.delete(key);
    const sorted = [...u.searchParams.entries()].sort(([ak, av], [bk, bv]) =>
      ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk),
    );
    u.search = "";
    for (const [k, v] of sorted) u.searchParams.append(k, v);
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

type SourceQuality = {
  sourceType: "registered_profile" | "first_party_site" | "platform_directory" | "secondary_web";
  evidenceStrength: "strong" | "supporting";
};

const MULTI_TENANT_HOSTS = new Set([
  "blog.naver.com",
  "m.blog.naver.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "youtube.com",
  "www.youtube.com",
  "tistory.com",
]);

function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function bareHost(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

function firstPathSegment(u: URL): string {
  const segments = u.pathname.split("/").filter(Boolean);
  return (segments[0] ?? "").toLowerCase();
}

function naverPlaceId(u: URL): string | null {
  const match = u.pathname.match(/\/place\/(\d+)/);
  return match ? match[1] : null;
}

function sameCanonical(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = canonicalUrl(a);
  const cb = canonicalUrl(b);
  return !!ca && !!cb && ca === cb;
}

function isSameSite(sourceUrl: URL, knownUrl: URL): boolean {
  const sourceHost = sourceUrl.hostname.toLowerCase();
  const knownHost = knownUrl.hostname.toLowerCase();
  if (MULTI_TENANT_HOSTS.has(sourceHost) || MULTI_TENANT_HOSTS.has(knownHost)) {
    if (sourceHost !== knownHost) return false;
    const sourceSegment = firstPathSegment(sourceUrl);
    const knownSegment = firstPathSegment(knownUrl);
    return sourceSegment.length > 0 && sourceSegment === knownSegment;
  }
  return bareHost(sourceUrl) === bareHost(knownUrl);
}

function isPlatformDirectory(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  if (
    host === "map.naver.com" ||
    host === "m.map.naver.com" ||
    host === "place.naver.com" ||
    host === "m.place.naver.com" ||
    host === "place.map.kakao.com" ||
    host === "map.kakao.com" ||
    host === "maps.google.com"
  ) {
    return true;
  }
  if ((host === "google.com" || host === "www.google.com") && u.pathname.startsWith("/maps")) return true;
  if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/maps")) return true;
  return false;
}

function classifySourceQuality(rawSourceUrl: string, business: PublicEvidenceBusiness): SourceQuality {
  const sourceUrl = parseHttpUrl(rawSourceUrl);
  if (!sourceUrl) return { sourceType: "secondary_web", evidenceStrength: "supporting" };

  if (sameCanonical(rawSourceUrl, business.naver_place_url) || sameCanonical(rawSourceUrl, business.google_maps_url)) {
    return { sourceType: "registered_profile", evidenceStrength: "strong" };
  }

  const knownNaver = parseHttpUrl(business.naver_place_url);
  if (knownNaver) {
    const knownId = naverPlaceId(knownNaver);
    const sourceId = naverPlaceId(sourceUrl);
    if (knownId && sourceId && knownId === sourceId) {
      return { sourceType: "registered_profile", evidenceStrength: "strong" };
    }
  }

  const knownSite = parseHttpUrl(business.website_url);
  if (knownSite && (sameCanonical(rawSourceUrl, business.website_url) || isSameSite(sourceUrl, knownSite))) {
    return { sourceType: "first_party_site", evidenceStrength: "strong" };
  }

  if (isPlatformDirectory(sourceUrl)) {
    return { sourceType: "platform_directory", evidenceStrength: "supporting" };
  }

  return { sourceType: "secondary_web", evidenceStrength: "supporting" };
}



function collectSources(payload: Record<string, unknown>): Map<string, Source> {
  const out = new Map<string, Source>();
  const add = (urlValue: unknown, titleValue: unknown) => {
    if (typeof urlValue !== "string") return;
    const key = canonicalUrl(urlValue);
    if (!key) return;
    out.set(key, { url: urlValue, title: typeof titleValue === "string" ? clean(titleValue) || null : null });
  };

  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const row = rec(item);
    if (!row) continue;
    if (row.type === "web_search_call") {
      const action = rec(row.action);
      for (const source of Array.isArray(action?.sources) ? action!.sources : []) {
        const s = rec(source);
        add(s?.url, s?.title);
      }
    }
    for (const content of Array.isArray(row.content) ? row.content : []) {
      const c = rec(content);
      for (const annotation of Array.isArray(c?.annotations) ? c!.annotations : []) {
        const a = rec(annotation);
        if (a?.type === "url_citation") add(a.url, a.title);
      }
    }
  }
  return out;
}

function serviceCandidates(profile: Record<string, unknown>): Array<{ key: string; label: string }> {
  const rows: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const addList = (value: unknown) => {
    for (const raw of Array.isArray(value) ? value : []) {
      const r = rec(raw);
      const key = clean(r?.key);
      const label = clean(r?.label);
      const status = clean(r?.evidenceStatus);
      const targetMatch = r?.targetRegistrationMatch === true;
      if (!key || !label || seen.has(key) || !targetMatch) continue;
      if (status !== "registration_only" && status !== "verification_pending") continue;
      seen.add(key);
      rows.push({ key, label });
    }
  };
  addList(profile.coreServices);
  addList(profile.candidateServices);
  addList(profile.adjacentServices);
  return rows.slice(0, MAX_SERVICES);
}

function profileHasPublicEvidence(profile: Record<string, unknown> | null): boolean {
  return profile?.webEvidenceStatus === "available";
}

// Pure decision helper. Public evidence semantics are unchanged: `ready` and
// `publicEvidenceReady` stay true only for real public evidence. Registration-backed
// generation is a separate, strictly gated permission and never promotes evidence.
export function resolveEvidenceGenerationBasis(
  profile: Record<string, unknown> | null,
  activeTaxonomyKeys: string[],
  publicEvidenceReady: boolean,
): EvidenceBasisResult {
  if (publicEvidenceReady) {
    return {
      ready: true,
      publicEvidenceReady: true,
      registrationBacked: false,
      generationBasis: "public_evidence",
    };
  }
  if (!profile) return { ...CLOSED_BASIS };
  if (profile.inputSensitivityDetected === true) return { ...CLOSED_BASIS };

  const taxonomyKeys = new Set(
    (Array.isArray(activeTaxonomyKeys) ? activeTaxonomyKeys : []).map((k) => clean(k)).filter(Boolean),
  );
  if (taxonomyKeys.size === 0) return { ...CLOSED_BASIS };

  const lists = [profile.coreServices, profile.candidateServices, profile.adjacentServices];
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const r = rec(raw);
      if (!r) continue;
      if (r.targetRegistrationMatch !== true) continue;
      if (!(Number(r.registrationHits) >= 1)) continue;
      const status = clean(r.evidenceStatus);
      if (status !== "registration_only" && status !== "verification_pending") continue;
      const key = clean(r.key);
      if (!key || !taxonomyKeys.has(key)) continue;
      return {
        ready: false,
        publicEvidenceReady: false,
        registrationBacked: true,
        generationBasis: "registration_backed",
      };
    }
  }
  return { ...CLOSED_BASIS };
}



type RegisteredLocatorHint = {
  place_id: string | null;
  summary_checked: boolean;
  summary_status: number | null;
  identity_verified: boolean;
  category: string | null;
  name: string | null;
  address: string | null;
};

// Deterministic exact normalization (NFKC + drop whitespace/punctuation). No substring matching.
function exactNorm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z\uac00-\ud7a3]+/gu, "");
}

// Best-effort, single-shot public Naver place summary lookup.
// Used ONLY as an identity/retrieval hint for the evidence search prompt.
// It is never stored as service evidence and never retried.
async function fetchRegisteredLocatorHint(business: PublicEvidenceBusiness): Promise<RegisteredLocatorHint> {
  const hint: RegisteredLocatorHint = {
    place_id: null,
    summary_checked: false,
    summary_status: null,
    identity_verified: false,
    category: null,
    name: null,
    address: null,
  };

  const known = parseHttpUrl(business.naver_place_url);
  if (!known) return hint;
  const placeId = naverPlaceId(known) ?? (known.searchParams.get("id") || "").match(/^\d+$/)?.[0] ?? null;
  if (!placeId) return hint;
  hint.place_id = placeId;

  try {
    hint.summary_checked = true;
    const res = await fetch(`https://map.naver.com/p/api/place/summary/${placeId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Referer: "https://map.naver.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(2800),
    });
    hint.summary_status = res.status;
    if (!res.ok) return hint;
    const body = rec(await res.json().catch(() => null));
    if (!body) return hint;
    // Actual shape: { data: { placeDetail: { id, name, category: { category }, address: { address, roadAddress } } } }
    const detail = rec(rec(body.data)?.placeDetail) ?? rec(body.placeDetail);
    if (!detail) return hint;

    const responseId = clean(detail.id);
    const name = clean(detail.name) || null;
    const addressNode = rec(detail.address);
    const roadAddress = clean(addressNode?.roadAddress) || null;
    const jibunAddress = clean(addressNode?.address) || null;
    const category = clean(rec(detail.category)?.category) || null;

    hint.name = name;
    hint.address = roadAddress ?? jibunAddress;
    hint.category = category;

    // The summary must describe the exact registered place id.
    if (!responseId || responseId !== placeId) return hint;

    const registeredAddress = clean(business.address);
    const nameOk = !!name && !!exactNorm(name) && exactNorm(name) === exactNorm(business.name);
    if (!nameOk) return hint;

    if (registeredAddress) {
      const target = exactNorm(registeredAddress);
      const matched = [roadAddress, jibunAddress].find((a) => !!a && exactNorm(a) === target) ?? null;
      if (!matched) return hint;
      hint.address = matched;
      hint.identity_verified = true;
    } else {
      // No registered address at all: exact name match on the same place id is the only allowance.
      hint.identity_verified = true;
    }
  } catch {
    // best effort only; never blocks the existing path
  }
  return hint;
}

// Deterministic retrieval queries per candidate service (max 4 each).
// These are prompt retrieval hints only — a query string or the map category is never
// service evidence. Final acceptance still requires explicit customer-facing service
// evidence plus exact source URL matching.
function buildCandidateSearchQueries(args: {
  business: PublicEvidenceBusiness;
  brandStemHint: string | null;
  locatorHint: RegisteredLocatorHint;
  serviceLabel: string;
  anchors: string[];
}): string[] {
  const { business, brandStemHint, locatorHint, serviceLabel, anchors } = args;
  const name = clean(business.name);
  const label = clean(serviceLabel);
  const anchor = anchors.find((a) => !!clean(a)) ?? null;
  const location = clean(business.city) || clean(business.region);
  const queries: string[] = [];

  if (name && label) queries.push(`${name} ${label}`);
  if (name && location && anchor) queries.push(`${name} ${location} ${anchor}`);
  if (name && locatorHint.identity_verified && locatorHint.address && label) {
    queries.push(`${name} ${locatorHint.address} ${label}`);
  }
  if (name && locatorHint.identity_verified && locatorHint.place_id && anchor) {
    queries.push(`${name} ${locatorHint.place_id} ${anchor}`);
  }

  // Only when the trade name genuinely differs from the registered name, replace
  // one of the generic slots with a brand-stem variant.
  const stem = clean(brandStemHint);
  if (stem && name && exactNorm(stem) !== exactNorm(name) && location && anchor) {
    const stemQuery = `${stem} ${location} ${anchor}`;
    if (queries.length >= 2) queries[1] = stemQuery;
    else queries.push(stemQuery);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const trimmed = q.replace(/\s+/g, " ").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 4) break;
  }
  return out;
}




function normalizeServiceLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z\uac00-\ud7a3]+/gu, "");
}

async function queueUnmappedServiceCandidate(
  admin: SupabaseAdmin,
  row: {
    org_id: string;
    business_id: string;
    business_identity_key: string;
    candidate_label: string;
    normalized_label: string;
    source_url: string;
    source_domain: string;
    source_title: string | null;
    evidence_note: string | null;
  },
): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const { data: existing, error: selectErr } = await admin
      .from("measurement_market_service_candidates")
      .select("id,seen_count")
      .eq("business_identity_key", row.business_identity_key)
      .eq("normalized_label", row.normalized_label)
      .eq("source_url", row.source_url)
      .maybeSingle();
    if (selectErr) return false;

    if (existing?.id) {
      const { error: updateErr } = await admin
        .from("measurement_market_service_candidates")
        .update({
          seen_count: Number(existing.seen_count ?? 0) + 1,
          last_seen_at: nowIso,
          source_title: row.source_title,
          evidence_note: row.evidence_note,
        })
        .eq("id", existing.id);
      return !updateErr;
    }

    const { error: insertErr } = await admin.from("measurement_market_service_candidates").insert({
      ...row,
      status: "pending",
      seen_count: 1,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    });
    return !insertErr;
  } catch {
    return false;
  }
}

async function writeCheck(
  admin: SupabaseAdmin,
  businessIdentityKey: string,
  candidateSignature: string,
  status: "completed" | "no_evidence" | "failed",
  sourceCount: number,
  acceptedEvidenceCount: number,
) {
  await admin.from("measurement_market_public_evidence_checks").upsert(
    {
      business_identity_key: businessIdentityKey,
      candidate_signature: candidateSignature,
      status,
      checked_at: new Date().toISOString(),
      source_count: sourceCount,
      accepted_evidence_count: acceptedEvidenceCount,
    },
    { onConflict: "business_identity_key" },
  );
}


export async function ensureMarketPublicEvidence(
  admin: SupabaseAdmin,
  openaiKey: string,
  orgId: string,
  business: PublicEvidenceBusiness,
): Promise<EvidenceCheckResult> {
  const { data: profileRaw, error: profileErr } = await admin.rpc(
    "resolve_measurement_market_profile_candidate_v02",
    { p_business_id: business.id },
  );
  if (profileErr) return { ...CLOSED_BASIS, searched: false, acceptedEvidenceCount: 0, reason: "profile_unavailable" };

  const profile = rec(profileRaw);
  if (!profile) return { ...CLOSED_BASIS, searched: false, acceptedEvidenceCount: 0, reason: "profile_unavailable" };
  if (profileHasPublicEvidence(profile)) {
    return {
      ...resolveEvidenceGenerationBasis(profile, [], true),
      searched: false,
      acceptedEvidenceCount: 0,
      reason: "already_available",
    };
  }

  const identityKey = clean(profile.businessIdentityKey);
  const brandStemHint = makeBrandStemHint(business.name, business.city);
  const services = serviceCandidates(profile);
  const hasStrongLocator =
    !!clean(business.address) &&
    !!(clean(business.naver_place_url) || clean(business.google_maps_url) || clean(business.website_url));
  const bootstrapDiscovery = services.length === 0 && hasStrongLocator;

  if (!identityKey) {
    return { ready: false, searched: false, acceptedEvidenceCount: 0, reason: "no_evidence" };
  }
  if (services.length === 0 && !bootstrapDiscovery) {
    return { ready: false, searched: false,acceptedEvidenceCount: 0, reason: "no_evidence" };
  }

  const { data: taxonomyRaw, error: taxonomyErr } = await admin
    .from("measurement_market_service_taxonomy")
    .select("service_key,label,question_anchors,sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const taxonomyRows: Array<{ key: string; label: string; anchors: string[] }> = [];
  for (const raw of Array.isArray(taxonomyRaw) ? taxonomyRaw : []) {
    const r = rec(raw);
    const key = clean(r?.service_key);
    const label = clean(r?.label);
    const anchors = (Array.isArray(r?.question_anchors) ? r?.question_anchors : [])
      .map((a) => clean(a))
      .filter(Boolean)
      .slice(0, 5);
    if (key && label) taxonomyRows.push({ key, label, anchors });
  }

  const taxonomySignature = taxonomyRows
    .map((t) => `${t.key}:${t.label}`)
    .sort()
    .join("|");

  const candidateSignature = JSON.stringify({
    services: services.map((s) => s.key).sort(),
    name: clean(business.name),
    brand_stem_hint: brandStemHint,
    evidence_search_version: "v0_9_3_candidate_query_anchors",


    bootstrap_discovery: bootstrapDiscovery,
    taxonomy_signature: taxonomySignature,
    region: clean(business.region),
    city: clean(business.city),
    address: clean(business.address),
    website: clean(business.website_url),
    naver: clean(business.naver_place_url),
    google: clean(business.google_maps_url),
  });

  // Fail closed when the central taxonomy cannot be read.
  if (taxonomyErr || taxonomyRows.length === 0) {
    await writeCheck(admin, identityKey, candidateSignature, "failed", 0, 0);
    return { ready: false, searched: false, acceptedEvidenceCount: 0, reason: "check_failed" };
  }

  const { data: cached } = await admin
    .from("measurement_market_public_evidence_checks")
    .select("candidate_signature,status,checked_at,accepted_evidence_count")
    .eq("business_identity_key", identityKey)
    .maybeSingle();

  if (cached && cached.candidate_signature === candidateSignature) {
    const age = Date.now() - new Date(cached.checked_at).getTime();
    if (cached.status === "no_evidence" && age >= 0 && age < NO_EVIDENCE_CACHE_MS) {
      return { ready: false, searched: false, acceptedEvidenceCount: Number(cached.accepted_evidence_count ?? 0), reason: "cached_no_evidence" };
    }
    if (cached.status === "failed" && age >= 0 && age < FAILED_CACHE_MS) {
      return { ready: false, searched: false, acceptedEvidenceCount: 0, reason: "check_failed" };
    }
  }

  const taxonomyKeys = taxonomyRows.map((t) => t.key);
  const taxonomyKeySet = new Set(taxonomyKeys);
  const candidateKeys = services.map((s) => s.key).filter((k) => taxonomyKeySet.has(k));
  const EVIDENCE_KINDS = [
    "customer_service_page",
    "work_case",
    "official_profile_service",
    "review_service",
    "third_party_service_listing",
    "company_registration",
    "business_purpose",
    "job_company_info",
    "product_sale_only",
    "directory_category_only",
    "other_non_service",
  ];

  const buildSchema = (allowedKeys: string[]) => ({
    type: "object",
    additionalProperties: false,
    properties: {
      services: {
        type: "array",
        maxItems: MAX_SERVICES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            // Deterministic guard: a non-allowed service key cannot be produced at all.
            service_key: { type: "string", enum: allowedKeys },
            source_urls: {
              type: "array",
              minItems: 1,
              maxItems: MAX_URLS_PER_SERVICE,
              items: { type: "string" },
            },
            evidence_note: { type: "string", maxLength: 300 },
            evidence_kind: { type: "string", enum: EVIDENCE_KINDS },
            customer_facing_service_explicit: { type: "boolean" },
          },
          required: [
            "service_key",
            "source_urls",
            "evidence_note",
            "evidence_kind",
            "customer_facing_service_explicit",
          ],
        },
      },
      unmapped_services: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_label: { type: "string", minLength: 2, maxLength: 80 },
            source_urls: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: { type: "string" },
            },
            evidence_note: { type: "string", maxLength: 300 },
            evidence_kind: { type: "string", enum: EVIDENCE_KINDS },
            customer_facing_service_explicit: { type: "boolean" },
          },
          required: [
            "service_label",
            "source_urls",
            "evidence_note",
            "evidence_kind",
            "customer_facing_service_explicit",
          ],
        },
      },
    },
    required: ["services", "unmapped_services"],
  });

  const ACCEPTED_EVIDENCE_KINDS = new Set([
    "customer_service_page",
    "work_case",
    "official_profile_service",
    "review_service",
    "third_party_service_listing",
  ]);
  const passesServiceOfferGate = (r: Record<string, unknown> | null): boolean =>
    r?.customer_facing_service_explicit === true && ACCEPTED_EVIDENCE_KINDS.has(clean(r?.evidence_kind));

  type SearchMode = "candidate_verification" | "discovery_fallback" | "bootstrap_discovery";

  type PassStats = {
    search_mode: SearchMode;
    allowed_service_key_count: number;
    source_count: number;
    parsed_service_candidate_count: number;
    parsed_service_keys: string[];
    parsed_unmapped_service_count: number;
    service_source_url_hit_count: number;
    service_source_url_miss_count: number;
    service_source_url_invalid_count: number;
    accepted_evidence_count: number;
    accepted_strong_evidence_count: number;
    accepted_supporting_evidence_count: number;
    unmapped_service_candidate_count: number;
    rejected_non_service_evidence_count: number;
    rejected_low_confidence_discovery_count: number;
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let webSearchCallCount = 0;
  let fallbackTriggered = false;
  const passStats: PassStats[] = [];
  const locatorHint = await fetchRegisteredLocatorHint(business);

  const candidateSearchQueries = new Map<string, string[]>();
  for (const s of services) {
    const anchors = taxonomyRows.find((t) => t.key === s.key)?.anchors ?? [];
    candidateSearchQueries.set(
      s.key,
      buildCandidateSearchQueries({
        business,
        brandStemHint,
        locatorHint,
        serviceLabel: s.label,
        anchors,
      }),
    );
  }
  const candidateSearchQueryCount = Array.from(candidateSearchQueries.values()).reduce(
    (total, list) => total + list.length,
    0,
  );



  const runPass = async (mode: SearchMode, allowedKeys: string[]): Promise<PassStats> => {
    const stats: PassStats = {
      search_mode: mode,
      allowed_service_key_count: allowedKeys.length,
      source_count: 0,
      parsed_service_candidate_count: 0,
      parsed_service_keys: [],
      parsed_unmapped_service_count: 0,
      service_source_url_hit_count: 0,
      service_source_url_miss_count: 0,
      service_source_url_invalid_count: 0,
      accepted_evidence_count: 0,
      accepted_strong_evidence_count: 0,
      accepted_supporting_evidence_count: 0,
      unmapped_service_candidate_count: 0,
      rejected_non_service_evidence_count: 0,
      rejected_low_confidence_discovery_count: 0,
    };
    passStats.push(stats);

    const allowedTaxonomy = taxonomyRows.filter((t) => allowedKeys.includes(t.key));

    const modeInstruction =
      mode === "candidate_verification"
        ? "MODE: candidate verification. candidate_services are the ONLY services you may return in services. Verify each candidate against explicit customer-facing service evidence for this exact business. Do not return, suggest, or substitute any other service in services. If none of the candidates can be verified, return an empty services array."
        : mode === "discovery_fallback"
          ? "MODE: discovery fallback. The registration candidates could not be verified with explicit customer-facing service evidence. First confirm the exact business identity using name/address/known URLs, then discover the actual customer-facing automotive services of this exact business from the full known_service_taxonomy. Never infer services from the generic category or business name alone."
          : "MODE: bootstrap discovery. candidate_services is empty because no service candidates were derived from registration data. First confirm the exact business identity using name/address/known URLs, then discover actual customer-facing automotive services from the full known_service_taxonomy. Never infer services from the generic category or business name alone.";

    const prompt = [
      "Verify public web evidence for the exact Korean automotive local business below.",
      "Search the web. Confirm only services that a public page explicitly connects to this exact business, using business name plus location/address/known URLs to avoid namesakes.",
      "Do not infer a service merely from the business category. Do not invent URLs. Return only source URLs that actually appeared in your web search results.",
      "A directory, map/listing, official site, blog post, cafe post, or news page is acceptable only when it clearly connects the exact business to the service.",
      "If a service cannot be verified, omit it. If nothing can be verified, return an empty services array.",
      "The public trade name may differ from the registered business name. A brand_stem_hint is provided, but treat a name variant as the same business ONLY when the exact address or a known registered URL strongly links the variant to this business. Never merge different branches or same-name businesses. Services must still be explicitly connected to this exact business on the page.",
      "When several sources explicitly verify the same exact business and the same service, prefer source_urls in this order: registered profile / first-party official site > platform or directory listing > secondary or aggregator page. Never drop a service just because no strong source exists, and never relax the exact-business-identity or explicit-service-verification requirements for this preference.",
      modeInstruction,
      "Never let a broad registered category stand in for a specific service. For example generic tuning and software vehicle coding are separate service families and must not be merged.",
      "Return in unmapped_services ONLY an explicit automotive service that has no reasonable match anywhere in known_service_taxonomy. Never force an unmapped service into services, and never map it to a loosely related taxonomy key.",
      "Service evidence must explicitly show an automotive service a customer can actually receive from this exact business at this location.",
      "Never treat as service evidence: corporate/business registration industry codes, stated business purposes, business-description text on recruiting or company-info pages, wholesale/retail/e-commerce product listings, or a plain directory category or keyword tag.",
      "Such non-service sources may support identity confirmation, but must never be returned as valid service evidence in services or unmapped_services.",
      "An independent third-party business/service listing may count only when it explicitly identifies the exact business/location and explicitly states that the business offers the specific automotive service; a generic category/tag/directory classification alone is not enough.",
      "Only an actual service menu, services listed on an official profile, real work/installation/repair cases, customer reviews of using the service at this exact business, or an explicit third-party service listing for this exact business count as customer-facing service evidence.",
      "For every returned item set evidence_kind to the kind of page the evidence came from, and set customer_facing_service_explicit to true only when that page explicitly shows a customer-facing service of this exact business.",
      "registered_locator holds the registered map place identifiers for this exact business. Use its place id, name and address only to pin the exact business and to retrieve its pages. The registered map category itself is NEVER service evidence and must never be returned as a verified service.",
      mode === "candidate_verification"
        ? "Each candidate service carries a deterministic search_queries list. Use those strings as your primary retrieval queries and run at least one query per candidate service when possible, before trying any query of your own."
        : "Search actively by combining the exact business name, address/location and registered place id with service labels and question anchors from the taxonomy.",
      mode === "candidate_verification"
        ? "A search_queries string, a question anchor, or the registered map category is NEVER service evidence. Never conclude that a service exists just because the service name appeared inside a query you ran. A candidate is accepted only when explicit customer-facing service evidence for this exact business is found and the source URL you return actually appeared in your web search results."
        : "A question anchor or the registered map category is NEVER service evidence.",
      JSON.stringify({
        business: {
          name: business.name,
          brand_stem_hint: brandStemHint,
          category_for_candidate_discovery_only: business.category ?? null,
          country_code: business.country_code ?? "KR",
          region: business.region ?? null,
          city: business.city ?? null,
          address: business.address ?? null,
          website_url: business.website_url ?? null,
          naver_place_url: business.naver_place_url ?? null,
          google_maps_url: business.google_maps_url ?? null,
        },
        registered_locator: {
          naver_place_id: locatorHint.place_id,
          summary_checked: locatorHint.summary_checked,
          identity_verified: locatorHint.identity_verified,
          registered_map_name: locatorHint.identity_verified ? locatorHint.name : null,
          registered_map_address: locatorHint.identity_verified ? locatorHint.address : null,
          registered_map_category_identity_hint_only: locatorHint.identity_verified ? locatorHint.category : null,
          category_is_not_service_evidence: true,
        },
        identity_hints: {
          exact_address_must_match_for_name_variant: true,
          known_urls_are_strong_link: true,
          never_merge_branches_or_namesakes: true,
        },
        search_mode: mode,
        candidate_services:
          mode === "candidate_verification"
            ? services.map((s) => ({
                ...s,
                question_anchors: taxonomyRows.find((t) => t.key === s.key)?.anchors ?? [],
                search_queries: candidateSearchQueries.get(s.key) ?? [],
              }))
            : [],
        known_service_taxonomy: allowedTaxonomy.map((t) => ({
          service_key: t.key,
          label: t.label,
          question_anchors: t.anchors,
        })),
      }),

    ].join("\n");

    webSearchCallCount += 1;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        tools: [
          {
            type: "web_search",
            user_location: {
              type: "approximate",
              country: business.country_code ?? "KR",
              region: business.region ?? undefined,
              city: business.city ?? undefined,
            },
          },
        ],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
        reasoning: { effort: "low" },
        max_output_tokens: 1800,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "measurement_market_public_evidence_v01",
            strict: true,
            schema: buildSchema(allowedKeys),
          },
        },
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const usage = rec(payload.usage);
    inputTokens += Number(usage?.input_tokens ?? 0) || 0;
    outputTokens += Number(usage?.output_tokens ?? 0) || 0;

    if (!response.ok) throw new Error("WEB_EVIDENCE_SEARCH_FAILED");

    const sources = collectSources(payload);
    stats.source_count = sources.size;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(outputText(payload)) as Record<string, unknown>;
    } catch {
      throw new Error("WEB_EVIDENCE_OUTPUT_INVALID");
    }

    const allowedServices = new Set(allowedKeys);
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const parsedServices = Array.isArray(parsed.services) ? parsed.services : [];
    stats.parsed_service_candidate_count = parsedServices.length;
    const parsedServiceKeySet = new Set<string>();
    for (const raw of parsedServices) {
      const r = rec(raw);
      const serviceKey = clean(r?.service_key);
      if (serviceKey) parsedServiceKeySet.add(serviceKey);
      if (!allowedServices.has(serviceKey)) continue;
      if (!passesServiceOfferGate(r)) {
        stats.rejected_non_service_evidence_count += 1;
        continue;
      }
      const note = clean(r?.evidence_note).slice(0, 500) || null;
      for (const rawUrl of Array.isArray(r?.source_urls) ? r!.source_urls : []) {
        if (typeof rawUrl !== "string") {
          stats.service_source_url_invalid_count += 1;
          continue;
        }
        const key = canonicalUrl(rawUrl);
        if (!key) {
          stats.service_source_url_invalid_count += 1;
          continue;
        }
        if (seen.has(`${serviceKey}|${key}`)) continue;
        const source = sources.get(key);
        if (!source) {
          stats.service_source_url_miss_count += 1;
          continue;
        }
        stats.service_source_url_hit_count += 1;
        let domain = "";
        try { domain = new URL(source.url).hostname.toLowerCase(); } catch { continue; }
        if (!domain) continue;
        seen.add(`${serviceKey}|${key}`);
        const quality = classifySourceQuality(source.url, business);
        rows.push({
          business_identity_key: identityKey,
          service_key: serviceKey,
          source_url: source.url,
          source_domain: domain,
          source_title: source.title,
          source_type: quality.sourceType,
          evidence_strength: quality.evidenceStrength,
          evidence_note: note,
          observed_at: new Date().toISOString(),
          active: true,
        });
      }
    }
    stats.parsed_service_keys = Array.from(parsedServiceKeySet).sort();

    // Discovery fallback only: a service that was NOT a registration candidate needs either one
    // strong source or two supporting sources on distinct domains. Precision over recall.
    let acceptedRows = rows;
    if (mode === "discovery_fallback") {
      const candidateKeySet = new Set(candidateKeys);
      const byService = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const key = String(row.service_key);
        const list = byService.get(key);
        if (list) list.push(row);
        else byService.set(key, [row]);
      }
      acceptedRows = [];
      for (const [serviceKey, serviceRows] of byService) {
        if (candidateKeySet.has(serviceKey)) {
          acceptedRows.push(...serviceRows);
          continue;
        }
        const hasStrong = serviceRows.some((r) => r.evidence_strength === "strong");
        const supportingDomains = new Set(
          serviceRows.filter((r) => r.evidence_strength !== "strong").map((r) => String(r.source_domain)),
        );
        if (hasStrong || supportingDomains.size >= 2) acceptedRows.push(...serviceRows);
        else stats.rejected_low_confidence_discovery_count += 1;
      }
    }
    for (const row of acceptedRows) {
      if (row.evidence_strength === "strong") stats.accepted_strong_evidence_count += 1;
      else stats.accepted_supporting_evidence_count += 1;
    }


    // Unmapped services never reach live questions; they only enter the internal review queue.
    const queuedLabels = new Set<string>();
    const parsedUnmapped = Array.isArray(parsed.unmapped_services) ? parsed.unmapped_services : [];
    stats.parsed_unmapped_service_count = parsedUnmapped.length;
    for (const raw of parsedUnmapped) {
      const r = rec(raw);
      const candidateLabel = clean(r?.service_label);
      const normalizedLabel = normalizeServiceLabel(candidateLabel);
      if (normalizedLabel.length < 2) continue;
      if (queuedLabels.has(normalizedLabel)) continue;
      if (!passesServiceOfferGate(r)) {
        stats.rejected_non_service_evidence_count += 1;
        continue;
      }
      const note = clean(r?.evidence_note).slice(0, 500) || null;

      let matched: { source: Source; domain: string } | null = null;
      for (const rawUrl of Array.isArray(r?.source_urls) ? r!.source_urls : []) {
        if (typeof rawUrl !== "string") continue;
        const key = canonicalUrl(rawUrl);
        if (!key) continue;
        const source = sources.get(key);
        if (!source) continue;
        let domain = "";
        try { domain = new URL(source.url).hostname.toLowerCase(); } catch { continue; }
        if (!domain) continue;
        matched = { source, domain };
        break;
      }
      if (!matched) continue;

      const queued = await queueUnmappedServiceCandidate(admin, {
        org_id: orgId,
        business_id: business.id,
        business_identity_key: identityKey,
        candidate_label: candidateLabel,
        normalized_label: normalizedLabel,
        source_url: matched.source.url,
        source_domain: matched.domain,
        source_title: matched.source.title,
        evidence_note: note,
      });
      if (queued) {
        queuedLabels.add(normalizedLabel);
        stats.unmapped_service_candidate_count += 1;
      }
    }

    if (acceptedRows.length > 0) {
      const { error: insertErr } = await admin.from("measurement_market_public_evidence").upsert(acceptedRows, {
        onConflict: "business_identity_key,service_key,source_url",
        ignoreDuplicates: false,
      });
      if (insertErr) throw new Error("WEB_EVIDENCE_SAVE_FAILED");
      stats.accepted_evidence_count = acceptedRows.length;
    }

    return stats;
  };

  const sumStats = (field: keyof PassStats): number =>
    passStats.reduce((total, s) => total + (typeof s[field] === "number" ? (s[field] as number) : 0), 0);

  let acceptedEvidenceCount = 0;

  try {
    const firstMode: SearchMode = candidateKeys.length > 0 ? "candidate_verification" : "bootstrap_discovery";
    const firstKeys = firstMode === "candidate_verification" ? candidateKeys : taxonomyKeys;

    const first = await runPass(firstMode, firstKeys);
    acceptedEvidenceCount = first.accepted_evidence_count;

    // Discovery fallback runs at most once, and only when candidate verification produced
    // no storable accepted evidence.
    if (firstMode === "candidate_verification" && acceptedEvidenceCount === 0 && hasStrongLocator) {
      fallbackTriggered = true;
      const second = await runPass("discovery_fallback", taxonomyKeys);
      acceptedEvidenceCount += second.accepted_evidence_count;
    }

    await writeCheck(
      admin,
      identityKey,
      candidateSignature,
      acceptedEvidenceCount > 0 ? "completed" : "no_evidence",
      sumStats("source_count"),
      acceptedEvidenceCount,
    );

    const { data: refreshedRaw } = await admin.rpc("resolve_measurement_market_profile_candidate_v02", {
      p_business_id: business.id,
    });
    const refreshed = rec(refreshedRaw);
    const ready = profileHasPublicEvidence(refreshed);
    return {
      ready,
      searched: true,
      acceptedEvidenceCount,
      reason: ready ? "verified" : "no_evidence",
    };
  } catch {
    await writeCheck(admin, identityKey, candidateSignature, "failed", sumStats("source_count"), acceptedEvidenceCount);
    return { ready: false, searched: true, acceptedEvidenceCount, reason: "check_failed" };
  } finally {
    await admin.from("cost_events").insert({
      org_id: orgId,
      provider: "openai",
      model: MODEL,
      amount_usd: 0,
      input_tokens: inputTokens || null,
      output_tokens: outputTokens || null,
      metadata: {
        cost_source: "unpriced_usage",
        pricing_status: "not_yet_priced",
        feature: "measurement_market_public_evidence_v0_9_3_candidate_query_anchors",
        evidence_search_prompt_version: "v0_9_3_candidate_query_anchors",

        search_mode: passStats[0]?.search_mode ?? null,
        search_modes: passStats.map((s) => s.search_mode),
        web_search_call_count: webSearchCallCount,
        web_search_call_limit: candidateKeys.length > 0 ? 2 : 1,
        fallback_triggered: fallbackTriggered,
        candidate_search_query_count: candidateSearchQueryCount,
        bootstrap_discovery: bootstrapDiscovery,
        naver_place_id: locatorHint.place_id,
        naver_summary_checked: locatorHint.summary_checked,
        naver_summary_status: locatorHint.summary_status,
        naver_identity_verified: locatorHint.identity_verified,
        naver_summary_category: locatorHint.identity_verified ? locatorHint.category : null,

        business_id: business.id,
        candidate_service_count: services.length,
        candidate_service_keys: candidateKeys,
        passes: passStats,
        source_count: sumStats("source_count"),
        parsed_service_candidate_count: sumStats("parsed_service_candidate_count"),
        parsed_service_keys: Array.from(new Set(passStats.flatMap((s) => s.parsed_service_keys))).sort(),
        parsed_unmapped_service_count: sumStats("parsed_unmapped_service_count"),
        service_source_url_hit_count: sumStats("service_source_url_hit_count"),
        service_source_url_miss_count: sumStats("service_source_url_miss_count"),
        service_source_url_invalid_count: sumStats("service_source_url_invalid_count"),
        accepted_evidence_count: acceptedEvidenceCount,
        accepted_strong_evidence_count: sumStats("accepted_strong_evidence_count"),
        accepted_supporting_evidence_count: sumStats("accepted_supporting_evidence_count"),
        unmapped_service_candidate_count: sumStats("unmapped_service_candidate_count"),
        rejected_non_service_evidence_count: sumStats("rejected_non_service_evidence_count"),
        rejected_low_confidence_discovery_count: sumStats("rejected_low_confidence_discovery_count"),
        total_input_tokens: inputTokens,
        total_output_tokens: outputTokens,
      },
    });
  }
}
