import { createClient } from "jsr:@supabase/supabase-js@2";

const DISCOVERY_VERSION = "0.9.1-read-only";
const MAX_CANDIDATES = 8;
const MAX_EXISTING_ROWS = 500;
const WRITE_ROLES = new Set(["owner", "admin", "analyst"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RecordValue = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, max = 300): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, max)
    : "";
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
}

function readSecret(name: string): string {
  const raw = Deno.env.get(name)?.trim() ?? "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed.default === "string" && parsed.default.trim()) {
        return parsed.default.trim();
      }
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
  } catch {
    return raw;
  }
  return raw;
}

function domainOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function extractText(payload: RecordValue): string {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const out: string[] = [];
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string") out.push(part.text);
      else if (isRecord(part.text) && typeof part.text.value === "string") {
        out.push(part.text.value);
      }
    }
  }
  return out.join("\n").trim();
}

function collectSourceUrls(payload: unknown): Array<{
  url: string;
  domain: string;
  title: string | null;
}> {
  const collected: Array<{ url: string; domain: string; title: string | null }> = [];
  const visited = new WeakSet<object>();

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (visited.has(node as object)) return;
    visited.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const record = node as RecordValue;
    const rawUrl = [record.url, record.uri, record.link].find(
      (item) => typeof item === "string",
    );
    if (typeof rawUrl === "string") {
      const url = normalizeUrl(rawUrl);
      const domain = url ? domainOf(url) : null;
      if (url && domain) {
        const rawTitle = [record.title, record.name].find(
          (item) => typeof item === "string",
        );
        collected.push({
          url,
          domain,
          title: typeof rawTitle === "string" ? clean(rawTitle, 300) || null : null,
        });
      }
    }

    for (const child of Object.values(record)) walk(child);
  };

  walk(payload);

  const deduped = new Map<string, { url: string; domain: string; title: string | null }>();
  for (const source of collected) {
    if (!deduped.has(source.url)) deduped.set(source.url, source);
  }
  return [...deduped.values()];
}

function parseJsonText(text: string): RecordValue | null {
  const trimmed = text.trim();
  let unfenced = trimmed;

  if (unfenced.startsWith("```")) {
    const firstNewline = unfenced.indexOf("\n");
    unfenced = firstNewline >= 0 ? unfenced.slice(firstNewline + 1) : "";
    if (unfenced.trimEnd().endsWith("```")) {
      unfenced = unfenced.trimEnd().slice(0, -3).trim();
    }
  }

  try {
    const parsed = JSON.parse(unfenced) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
  const token = authorization.slice(7).trim();
  if (!token) return json({ error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey =
    readSecret("SUPABASE_SECRET_KEYS") ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";

  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return json({ error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "UNAUTHORIZED" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  if (!isRecord(body)) return json({ error: "INVALID_REQUEST" }, 400);

  const orgId = clean(body.orgId, 64).toLowerCase();
  const category = clean(body.category, 100);
  const service = clean(body.service, 100);
  const region = clean(body.region, 100);
  const city = clean(body.city, 100) || null;
  const brandModel = clean(body.brandModel, 200) || null;
  const desiredCountRaw = Number(body.desiredCount);
  const desiredCount = Number.isInteger(desiredCountRaw)
    ? Math.min(MAX_CANDIDATES, Math.max(1, desiredCountRaw))
    : 5;

  if (!UUID_RE.test(orgId) || !category || !service || !region) {
    return json({ error: "INVALID_REQUEST" }, 400);
  }

  const [{ data: org, error: orgError }, { data: membership, error: memberError }] =
    await Promise.all([
      db
        .from("organizations")
        .select("id,name,measurement_data_origin")
        .eq("id", orgId)
        .eq("measurement_data_origin", "internal_observation")
        .maybeSingle(),
      db
        .from("organization_members")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", authData.user.id)
        .maybeSingle(),
    ]);

  if (orgError || memberError) return json({ error: "INTERNAL_ERROR" }, 500);
  if (!org || !membership || !WRITE_ROLES.has(String(membership.role))) {
    return json({ error: "FORBIDDEN" }, 403);
  }

  const prompt = [
    "You are generating a read-only discovery preview for an internal automotive market research tool.",
    "Search the public web for real, identifiable automotive businesses that match the requested area and service.",
    "Return JSON only. Do not use markdown.",
    "Every candidate must be supported by at least one URL actually found through web search.",
    "Prefer official websites or public business/profile pages. Do not invent URLs, addresses, branch names, services, or businesses.",
    "Do not return generic directories, articles, marketplaces, manufacturers, or non-business informational pages as candidates.",
    "When a brand has multiple branches, keep branch identity explicit. If branch identity is unclear, omit the candidate.",
    "",
    `Requested category: ${category}`,
    `Requested service: ${service}`,
    `Region: ${region}`,
    `City/detail area: ${city ?? "(not specified)"}`,
    `Brand/model focus: ${brandModel ?? "(none)"}`,
    `Desired candidate count: ${desiredCount}`,
    "",
    'JSON shape: {"candidates":[{"name":"...","city":"... or null","websiteUrl":"https://... or null","profileUrls":["https://..."],"evidence":[{"url":"https://...","note":"short factual reason this source supports the candidate"}]}]}',
  ].join("\n");

  const model =
    Deno.env.get("OPENAI_DISCOVERY_MODEL")?.trim() ||
    Deno.env.get("OPENAI_MODEL")?.trim() ||
    "gpt-5.6-luna";

  const location = {
    type: "approximate",
    country: "KR",
    region,
    ...(city ? { city } : {}),
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: prompt,
      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
          user_location: location,
        },
      ],
      tool_choice: "required",
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      include: ["web_search_call.action.sources"],
    }),
  });

  const rawText = await response.text();
  let payload: RecordValue = {};
  try {
    payload = rawText ? (JSON.parse(rawText) as RecordValue) : {};
  } catch {
    payload = { unparsed_response: rawText.slice(0, 2000) };
  }

  if (!response.ok) {
    return json(
      {
        error: "DISCOVERY_PROVIDER_FAILED",
        status: response.status,
      },
      502,
    );
  }

  const sourceRows = collectSourceUrls(payload);
  const sourceByUrl = new Map(sourceRows.map((source) => [source.url, source]));
  const sourceDomains = new Set(sourceRows.map((source) => source.domain));
  const parsed = parseJsonText(extractText(payload));
  const rawCandidates = parsed && Array.isArray(parsed.candidates)
    ? parsed.candidates
    : [];

  const [{ data: existingBusinessesRaw }, { data: pipelineItemsRaw }] =
    await Promise.all([
      db
        .from("businesses")
        .select("name,region,city,website_url,naver_place_url,active,is_client_business")
        .eq("org_id", orgId)
        .eq("is_client_business", true)
        .limit(MAX_EXISTING_ROWS),
      db
        .from("internal_observation_pipeline_items")
        .select("business_name,region,city,website_url,naver_place_url,status")
        .eq("org_id", orgId)
        .limit(MAX_EXISTING_ROWS),
    ]);

  const existingBusinesses = Array.isArray(existingBusinessesRaw)
    ? existingBusinessesRaw.filter(isRecord)
    : [];
  const pipelineItems = Array.isArray(pipelineItemsRaw)
    ? pipelineItemsRaw.filter(isRecord)
    : [];

  const resultCandidates: RecordValue[] = [];
  const seenNames = new Set<string>();

  for (const rawCandidate of rawCandidates) {
    if (!isRecord(rawCandidate) || resultCandidates.length >= desiredCount) continue;

    const name = clean(rawCandidate.name, 140);
    if (!name) continue;
    const nameKey = normalizeName(name);
    if (seenNames.has(nameKey)) continue;

    const evidenceRaw = Array.isArray(rawCandidate.evidence)
      ? rawCandidate.evidence
      : [];
    const evidence: Array<{
      url: string;
      domain: string;
      title: string | null;
      note: string | null;
    }> = [];

    for (const item of evidenceRaw) {
      if (!isRecord(item)) continue;
      const requestedUrl = normalizeUrl(clean(item.url, 1000));
      if (!requestedUrl) continue;
      const verified = sourceByUrl.get(requestedUrl);
      if (!verified) continue;
      if (evidence.some((row) => row.url === verified.url)) continue;
      evidence.push({
        ...verified,
        note: clean(item.note, 300) || null,
      });
    }

    if (evidence.length === 0) continue;

    const publicProfileUrls = Array.isArray(rawCandidate.profileUrls)
      ? rawCandidate.profileUrls
          .map((value) => normalizeUrl(clean(value, 1000)))
          .filter((value): value is string => !!value)
          .filter((value) => {
            const domain = domainOf(value);
            return !!domain && sourceDomains.has(domain);
          })
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 5)
      : [];

    const requestedWebsite = normalizeUrl(clean(rawCandidate.websiteUrl, 1000));
    const websiteDomain = requestedWebsite ? domainOf(requestedWebsite) : null;
    const websiteUrl =
      requestedWebsite && websiteDomain && sourceDomains.has(websiteDomain)
        ? requestedWebsite
        : null;

    const warnings: string[] = [];
    let duplicateStatus:
      | "none"
      | "existing_business_exact"
      | "existing_pipeline_exact"
      | "existing_domain_overlap" = "none";
    let matchedExistingBusinessName: string | null = null;
    let matchedPipelineBusinessName: string | null = null;

    const exactBusiness = existingBusinesses.find(
      (row) => normalizeName(clean(row.name, 140)) === nameKey,
    );
    if (exactBusiness) {
      duplicateStatus = "existing_business_exact";
      matchedExistingBusinessName = clean(exactBusiness.name, 140) || null;
      warnings.push(
        `기존 업체명과 정확히 일치: ${matchedExistingBusinessName ?? name}`,
      );
    }

    const exactPipeline = pipelineItems.find(
      (row) => normalizeName(clean(row.business_name, 140)) === nameKey,
    );
    if (exactPipeline) {
      if (duplicateStatus === "none") duplicateStatus = "existing_pipeline_exact";
      matchedPipelineBusinessName = clean(exactPipeline.business_name, 140) || null;
      warnings.push(
        `기존 수집 파이프라인 후보와 일치: ${matchedPipelineBusinessName ?? name}`,
      );
    }

    const candidateDomains = new Set(
      [
        websiteUrl,
        ...publicProfileUrls,
        ...evidence.map((row) => row.url),
      ]
        .map((value) => (value ? domainOf(value) : null))
        .filter((value): value is string => !!value),
    );

    if (duplicateStatus === "none" && candidateDomains.size > 0) {
      const domainOverlap = existingBusinesses.find((row) => {
        const domains = [clean(row.website_url, 1000), clean(row.naver_place_url, 1000)]
          .map((value) => (value ? domainOf(value) : null))
          .filter((value): value is string => !!value);
        return domains.some((domain) => candidateDomains.has(domain));
      });
      if (domainOverlap) {
        duplicateStatus = "existing_domain_overlap";
        matchedExistingBusinessName = clean(domainOverlap.name, 140) || null;
        warnings.push(
          `기존 업체와 공개 도메인이 겹칩니다: ${matchedExistingBusinessName ?? "이름 확인 필요"}`,
        );
      }
    }

    seenNames.add(nameKey);
    resultCandidates.push({
      name,
      category,
      service,
      region,
      city: clean(rawCandidate.city, 100) || city,
      websiteUrl,
      publicProfileUrls,
      evidence,
      duplicateStatus,
      duplicateWarnings: warnings,
      matchedExistingBusinessName,
      matchedPipelineBusinessName,
    });
  }

  return json({
    ok: true,
    preview: {
      version: DISCOVERY_VERSION,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      persisted: false,
      measurementSideEffects: false,
      measurementCreditDebited: false,
      orgId,
      orgName: clean(org.name, 140),
      query: {
        category,
        service,
        region,
        city,
        brandModel,
        desiredCount,
      },
      provider: "openai",
      model: typeof payload.model === "string" ? payload.model : model,
      publicSourceCount: sourceRows.length,
      candidates: resultCandidates,
    },
  });
});
