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

type EvidenceCheckResult = {
  ready: boolean;
  searched: boolean;
  acceptedEvidenceCount: number;
  reason: "already_available" | "verified" | "cached_no_evidence" | "no_evidence" | "check_failed" | "profile_unavailable";
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
  if (profileErr) return { ready: false, searched: false, acceptedEvidenceCount: 0, reason: "profile_unavailable" };

  const profile = rec(profileRaw);
  if (!profile) return { ready: false, searched: false, acceptedEvidenceCount: 0, reason: "profile_unavailable" };
  if (profileHasPublicEvidence(profile)) {
    return { ready: true, searched: false, acceptedEvidenceCount: 0, reason: "already_available" };
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

  const taxonomyRows: Array<{ key: string; label: string }> = [];
  for (const raw of Array.isArray(taxonomyRaw) ? taxonomyRaw : []) {
    const r = rec(raw);
    const key = clean(r?.service_key);
    const label = clean(r?.label);
    if (key && label) taxonomyRows.push({ key, label });
  }

  const taxonomySignature = taxonomyRows
    .map((t) => `${t.key}:${t.label}`)
    .sort()
    .join("|");

  const candidateSignature = JSON.stringify({
    services: services.map((s) => s.key).sort(),
    name: clean(business.name),
    brand_stem_hint: brandStemHint,
    evidence_search_version: "v0_8_1_candidate_prompt_fix",
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
  const schema = {
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
            service_key: { type: "string", enum: taxonomyKeys },
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
  };

  const ACCEPTED_EVIDENCE_KINDS = new Set([
    "customer_service_page",
    "work_case",
    "official_profile_service",
    "review_service",
    "third_party_service_listing",
  ]);
  const passesServiceOfferGate = (r: Record<string, unknown> | null): boolean =>
    r?.customer_facing_service_explicit === true && ACCEPTED_EVIDENCE_KINDS.has(clean(r?.evidence_kind));



  let inputTokens = 0;
  let outputTokens = 0;
  let sourceCount = 0;
  let acceptedEvidenceCount = 0;
  let acceptedStrongEvidenceCount = 0;
  let acceptedSupportingEvidenceCount = 0;
  let unmappedServiceCandidateCount = 0;
  let rejectedNonServiceEvidenceCount = 0;
  let parsedServiceCandidateCount = 0;
  let parsedUnmappedServiceCount = 0;
  let parsedServiceKeys: string[] = [];
  let serviceSourceUrlHitCount = 0;
  let serviceSourceUrlMissCount = 0;
  let serviceSourceUrlInvalidCount = 0;

  try {
    const prompt = [
      "Verify public web evidence for the exact Korean automotive local business below.",
      "Search the web. Confirm only services that a public page explicitly connects to this exact business, using business name plus location/address/known URLs to avoid namesakes.",
      "Do not infer a service merely from the business category. Do not invent URLs. Return only source URLs that actually appeared in your web search results.",
      "A directory, map/listing, official site, blog post, cafe post, or news page is acceptable only when it clearly connects the exact business to the service.",
      "If a service cannot be verified, omit it. If nothing can be verified, return an empty services array.",
      "The public trade name may differ from the registered business name. A brand_stem_hint is provided, but treat a name variant as the same business ONLY when the exact address or a known registered URL strongly links the variant to this business. Never merge different branches or same-name businesses. Services must still be explicitly connected to this exact business on the page.",
      "When several sources explicitly verify the same exact business and the same service, prefer source_urls in this order: registered profile / first-party official site > platform or directory listing > secondary or aggregator page. Never drop a service just because no strong source exists, and never relax the exact-business-identity or explicit-service-verification requirements for this preference.",
      "candidate_services are only priority candidates derived from registration data. Any other service in known_service_taxonomy may also be returned in services when a public page explicitly connects it to this exact business.",
      bootstrapDiscovery
        ? "candidate_services is empty because no service candidates were derived from registration data. First confirm the exact business identity using name/address/known URLs, then discover actual customer-facing automotive services from the full known_service_taxonomy. Never infer services from the generic category or business name alone."
        : "candidate_services is non-empty. Treat these as priority verification targets, not as confirmed services. Verify them first against explicit customer-facing service evidence for this exact business.",
      "Never let a broad registered category stand in for a specific service. For example generic tuning and software vehicle coding are separate service families and must not be merged.",
      "Return in unmapped_services ONLY an explicit automotive service that has no reasonable match anywhere in known_service_taxonomy. Never force an unmapped service into services, and never map it to a loosely related taxonomy key.",
      "Service evidence must explicitly show an automotive service a customer can actually receive from this exact business at this location.",
      "Never treat as service evidence: corporate/business registration industry codes, stated business purposes, business-description text on recruiting or company-info pages, wholesale/retail/e-commerce product listings, or a plain directory category or keyword tag.",
      "Such non-service sources may support identity confirmation, but must never be returned as valid service evidence in services or unmapped_services.",
      "An independent third-party business/service listing may count only when it explicitly identifies the exact business/location and explicitly states that the business offers the specific automotive service; a generic category/tag/directory classification alone is not enough.",
      "Only an actual service menu, services listed on an official profile, real work/installation/repair cases, customer reviews of using the service at this exact business, or an explicit third-party service listing for this exact business count as customer-facing service evidence.",
      "For every returned item set evidence_kind to the kind of page the evidence came from, and set customer_facing_service_explicit to true only when that page explicitly shows a customer-facing service of this exact business.",
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
        identity_hints: {
          exact_address_must_match_for_name_variant: true,
          known_urls_are_strong_link: true,
          never_merge_branches_or_namesakes: true,
        },
        candidate_services: services,
        known_service_taxonomy: taxonomyRows.map((t) => ({ service_key: t.key, label: t.label })),
      }),

    ].join("\n");

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
        text: { format: { type: "json_schema", name: "measurement_market_public_evidence_v01", strict: true, schema } },
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const usage = rec(payload.usage);
    inputTokens = Number(usage?.input_tokens ?? 0) || 0;
    outputTokens = Number(usage?.output_tokens ?? 0) || 0;

    if (!response.ok) throw new Error("WEB_EVIDENCE_SEARCH_FAILED");

    const sources = collectSources(payload);
    sourceCount = sources.size;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(outputText(payload)) as Record<string, unknown>;
    } catch {
      throw new Error("WEB_EVIDENCE_OUTPUT_INVALID");
    }

    const allowedServices = new Set(taxonomyKeys);
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const parsedServices = Array.isArray(parsed.services) ? parsed.services : [];
    parsedServiceCandidateCount = parsedServices.length;
    const parsedServiceKeySet = new Set<string>();
    for (const raw of parsedServices) {
      const r = rec(raw);
      const serviceKey = clean(r?.service_key);
      if (serviceKey) parsedServiceKeySet.add(serviceKey);
      if (!allowedServices.has(serviceKey)) continue;
      if (!passesServiceOfferGate(r)) {
        rejectedNonServiceEvidenceCount += 1;
        continue;
      }
      const note = clean(r?.evidence_note).slice(0, 500) || null;
      for (const rawUrl of Array.isArray(r?.source_urls) ? r!.source_urls : []) {
        if (typeof rawUrl !== "string") {
          serviceSourceUrlInvalidCount += 1;
          continue;
        }
        const key = canonicalUrl(rawUrl);
        if (!key) {
          serviceSourceUrlInvalidCount += 1;
          continue;
        }
        if (seen.has(`${serviceKey}|${key}`)) continue;
        const source = sources.get(key);
        if (!source) {
          serviceSourceUrlMissCount += 1;
          continue;
        }
        serviceSourceUrlHitCount += 1;
        let domain = "";
        try { domain = new URL(source.url).hostname.toLowerCase(); } catch { continue; }
        if (!domain) continue;
        seen.add(`${serviceKey}|${key}`);
        const quality = classifySourceQuality(source.url, business);
        if (quality.evidenceStrength === "strong") acceptedStrongEvidenceCount += 1;
        else acceptedSupportingEvidenceCount += 1;
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
    parsedServiceKeys = Array.from(parsedServiceKeySet).sort();

    // Unmapped services never reach live questions; they only enter the internal review queue.
    const queuedLabels = new Set<string>();
    const parsedUnmapped = Array.isArray(parsed.unmapped_services) ? parsed.unmapped_services : [];
    parsedUnmappedServiceCount = parsedUnmapped.length;
    for (const raw of parsedUnmapped) {
      const r = rec(raw);
      const candidateLabel = clean(r?.service_label);
      const normalizedLabel = normalizeServiceLabel(candidateLabel);
      if (normalizedLabel.length < 2) continue;
      if (queuedLabels.has(normalizedLabel)) continue;
      if (!passesServiceOfferGate(r)) {
        rejectedNonServiceEvidenceCount += 1;
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
        unmappedServiceCandidateCount += 1;
      }
    }


    if (rows.length > 0) {
      const { error: insertErr } = await admin.from("measurement_market_public_evidence").upsert(rows, {
        onConflict: "business_identity_key,service_key,source_url",
        ignoreDuplicates: false,
      });
      if (insertErr) throw new Error("WEB_EVIDENCE_SAVE_FAILED");
      acceptedEvidenceCount = rows.length;
    }

    await writeCheck(
      admin,
      identityKey,
      candidateSignature,
      acceptedEvidenceCount > 0 ? "completed" : "no_evidence",
      sourceCount,
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
    await writeCheck(admin, identityKey, candidateSignature, "failed", sourceCount, acceptedEvidenceCount);
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
        feature: "measurement_market_public_evidence_v0_8_bootstrap_discovery",
        evidence_search_prompt_version: "v0_8_1_candidate_prompt_fix",
        search_mode: bootstrapDiscovery ? "bootstrap_discovery" : "candidate_verification",
        business_id: business.id,
        web_search_call_limit: 1,
        candidate_service_count: services.length,
        bootstrap_discovery: bootstrapDiscovery,
        source_count: sourceCount,
        parsed_service_candidate_count: parsedServiceCandidateCount,
        parsed_service_keys: parsedServiceKeys,
        parsed_unmapped_service_count: parsedUnmappedServiceCount,
        service_source_url_hit_count: serviceSourceUrlHitCount,
        service_source_url_miss_count: serviceSourceUrlMissCount,
        service_source_url_invalid_count: serviceSourceUrlInvalidCount,
        accepted_evidence_count: acceptedEvidenceCount,
        accepted_strong_evidence_count: acceptedStrongEvidenceCount,
        accepted_supporting_evidence_count: acceptedSupportingEvidenceCount,
        unmapped_service_candidate_count: unmappedServiceCandidateCount,
        rejected_non_service_evidence_count: rejectedNonServiceEvidenceCount,
      },
    });
  }
}
