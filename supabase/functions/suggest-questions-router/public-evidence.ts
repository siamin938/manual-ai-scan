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
  const services = serviceCandidates(profile);
  if (!identityKey || services.length === 0) {
    return { ready: false, searched: false, acceptedEvidenceCount: 0, reason: "no_evidence" };
  }

  const candidateSignature = JSON.stringify({
    services: services.map((s) => s.key).sort(),
    name: clean(business.name),
    region: clean(business.region),
    city: clean(business.city),
    address: clean(business.address),
    website: clean(business.website_url),
    naver: clean(business.naver_place_url),
    google: clean(business.google_maps_url),
  });

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

  const serviceKeys = services.map((s) => s.key);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      services: {
        type: "array",
        maxItems: services.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            service_key: { type: "string", enum: serviceKeys },
            source_urls: {
              type: "array",
              minItems: 1,
              maxItems: MAX_URLS_PER_SERVICE,
              items: { type: "string" },
            },
            evidence_note: { type: "string", maxLength: 300 },
          },
          required: ["service_key", "source_urls", "evidence_note"],
        },
      },
    },
    required: ["services"],
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let sourceCount = 0;
  let acceptedEvidenceCount = 0;

  try {
    const prompt = [
      "Verify public web evidence for the exact Korean automotive local business below.",
      "Search the web. Confirm only services that a public page explicitly connects to this exact business, using business name plus location/address/known URLs to avoid namesakes.",
      "Do not infer a service merely from the business category. Do not invent URLs. Return only source URLs that actually appeared in your web search results.",
      "A directory, map/listing, official site, blog post, cafe post, or news page is acceptable only when it clearly connects the exact business to the service.",
      "If a service cannot be verified, omit it. If nothing can be verified, return an empty services array.",
      JSON.stringify({
        business: {
          name: business.name,
          category_for_candidate_discovery_only: business.category ?? null,
          country_code: business.country_code ?? "KR",
          region: business.region ?? null,
          city: business.city ?? null,
          address: business.address ?? null,
          website_url: business.website_url ?? null,
          naver_place_url: business.naver_place_url ?? null,
          google_maps_url: business.google_maps_url ?? null,
        },
        candidate_services: services,
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
            search_context_size: "low",
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
        max_output_tokens: 1200,
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

    const allowedServices = new Set(serviceKeys);
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(parsed.services) ? parsed.services : []) {
      const r = rec(raw);
      const serviceKey = clean(r?.service_key);
      if (!allowedServices.has(serviceKey)) continue;
      const note = clean(r?.evidence_note).slice(0, 500) || null;
      for (const rawUrl of Array.isArray(r?.source_urls) ? r!.source_urls : []) {
        if (typeof rawUrl !== "string") continue;
        const key = canonicalUrl(rawUrl);
        if (!key || seen.has(`${serviceKey}|${key}`)) continue;
        const source = sources.get(key);
        if (!source) continue;
        let domain = "";
        try { domain = new URL(source.url).hostname.toLowerCase(); } catch { continue; }
        if (!domain) continue;
        seen.add(`${serviceKey}|${key}`);
        rows.push({
          business_identity_key: identityKey,
          service_key: serviceKey,
          source_url: source.url,
          source_domain: domain,
          source_title: source.title,
          source_type: "public_web",
          evidence_strength: "supporting",
          evidence_note: note,
          observed_at: new Date().toISOString(),
          active: true,
        });
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
        feature: "measurement_market_public_evidence_v0_2",
        business_id: business.id,
        web_search_call_limit: 1,
        search_context_size: "low",
        candidate_service_count: services.length,
        source_count: sourceCount,
        accepted_evidence_count: acceptedEvidenceCount,
      },
    });
  }
}
