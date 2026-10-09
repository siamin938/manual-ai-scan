import { createClient } from "jsr:@supabase/supabase-js@2";

const DISCOVERY_VERSION = "0.9.4-recurring";
const MAX_CANDIDATES = 8;
const MAX_EXISTING_ROWS = 500;
const WRITE_ROLES = new Set(["owner", "admin", "analyst"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Obj = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, max = 300): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, max)
    : "";
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function readSecret(name: string): string {
  const raw = Deno.env.get(name)?.trim() ?? "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isObj(parsed)) {
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

function domainOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function extractText(payload: Obj): string {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const out: string[] = [];
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!isObj(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isObj(part)) continue;
      if (typeof part.text === "string") out.push(part.text);
      else if (isObj(part.text) && typeof part.text.value === "string") {
        out.push(part.text.value);
      }
    }
  }
  return out.join("\n").trim();
}

function parseJsonText(text: string): Obj | null {
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
    return isObj(parsed) ? parsed : null;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
      return isObj(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
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

    const record = node as Obj;
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reviewKey(args: {
  orgId: string;
  businessName: string;
  region: string;
  city: string | null;
  service: string;
}): string {
  return [
    "v0.9.2",
    args.orgId.toLowerCase(),
    normalizeName(args.businessName),
    normalizeName(args.region),
    normalizeName(args.city ?? ""),
    normalizeName(args.service),
  ].join("|");
}

function canonicalCandidatePayload(candidate: Obj) {
  const profiles = Array.isArray(candidate.publicProfileUrls)
    ? candidate.publicProfileUrls.filter((v): v is string => typeof v === "string").sort()
    : [];
  const evidence = Array.isArray(candidate.evidence)
    ? candidate.evidence
        .filter(isObj)
        .map((e) => ({
          url: clean(e.url, 1000),
          domain: clean(e.domain, 255),
          title: clean(e.title, 500) || null,
          note: clean(e.note, 500) || null,
        }))
        .sort((a, b) => a.url.localeCompare(b.url))
    : [];
  const warnings = Array.isArray(candidate.duplicateWarnings)
    ? candidate.duplicateWarnings.filter((v): v is string => typeof v === "string").sort()
    : [];

  return {
    businessName: clean(candidate.name, 140),
    category: clean(candidate.category, 100),
    service: clean(candidate.service, 100),
    region: clean(candidate.region, 100),
    city: clean(candidate.city, 100) || null,
    websiteUrl: clean(candidate.websiteUrl, 1000) || null,
    publicProfileUrls: profiles,
    evidence,
    duplicateStatus: clean(candidate.duplicateStatus, 80) || "none",
    duplicateWarnings: warnings,
    matchedExistingBusinessName:
      clean(candidate.matchedExistingBusinessName, 140) || null,
    matchedPipelineBusinessName:
      clean(candidate.matchedPipelineBusinessName, 140) || null,
  };
}

function canonicalStoredPayload(row: Obj) {
  return canonicalCandidatePayload({
    name: row.business_name,
    category: row.category,
    service: row.service,
    region: row.region,
    city: row.city,
    websiteUrl: row.website_url,
    publicProfileUrls: row.public_profile_urls,
    evidence: row.source_evidence,
    duplicateStatus: row.duplicate_status,
    duplicateWarnings: row.duplicate_warnings,
    matchedExistingBusinessName: row.matched_existing_business_name,
    matchedPipelineBusinessName: row.matched_pipeline_business_name,
  });
}

function identityUrlKey(value: string): string | null {
  const normalized = normalizeUrl(value);
  return normalized ? normalized.toLowerCase() : null;
}

function identityUrlsFromPayload(payload: ReturnType<typeof canonicalCandidatePayload>): Set<string> {
  return new Set(
    [
      payload.websiteUrl,
      ...payload.publicProfileUrls,
      ...payload.evidence.map((item) => item.url),
    ]
      .filter((value): value is string => !!value)
      .map(identityUrlKey)
      .filter((value): value is string => !!value),
  );
}

function identityUrlsFromStored(row: Obj): Set<string> {
  return identityUrlsFromPayload(canonicalStoredPayload(row));
}

function mergeStringUrls(existing: unknown, incoming: string[]): string[] {
  const current = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string")
    : [];
  const byKey = new Map<string, string>();
  for (const value of [...current, ...incoming]) {
    const normalized = normalizeUrl(value);
    const key = normalized ? normalized.toLowerCase() : null;
    if (normalized && key) byKey.set(key, normalized);
  }
  return [...byKey.values()].slice(0, 10);
}

function mergeEvidence(existing: unknown, incoming: Array<{
  url: string;
  domain: string;
  title: string | null;
  note: string | null;
}>): Array<{
  url: string;
  domain: string;
  title: string | null;
  note: string | null;
}> {
  const current = Array.isArray(existing)
    ? existing.filter(isObj).map((item) => ({
        url: clean(item.url, 1000),
        domain: clean(item.domain, 255),
        title: clean(item.title, 500) || null,
        note: clean(item.note, 500) || null,
      }))
    : [];
  const byKey = new Map<string, {
    url: string;
    domain: string;
    title: string | null;
    note: string | null;
  }>();
  for (const item of [...current, ...incoming]) {
    const normalized = normalizeUrl(item.url);
    const key = normalized ? normalized.toLowerCase() : null;
    if (!normalized || !key) continue;
    byKey.set(key, { ...item, url: normalized });
  }
  return [...byKey.values()].slice(0, 50);
}

function mergeWarnings(existing: unknown, incoming: string[]): string[] {
  const current = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string")
    : [];
  return [...new Set([...current, ...incoming])].slice(0, 20);
}

function materiallyChanged(args: {
  existing: Obj;
  payload: ReturnType<typeof canonicalCandidatePayload>;
  identityMatchedByUrl: boolean;
}): boolean {
  const { existing, payload, identityMatchedByUrl } = args;
  const stored = canonicalStoredPayload(existing);

  if (!identityMatchedByUrl && normalizeName(stored.businessName) !== normalizeName(payload.businessName)) {
    return true;
  }
  if (stored.category !== payload.category) return true;
  if (stored.service !== payload.service) return true;
  if (stored.region !== payload.region) return true;
  if ((stored.city ?? null) !== (payload.city ?? null)) return true;

  if (
    payload.websiteUrl &&
    (!stored.websiteUrl ||
      identityUrlKey(payload.websiteUrl) !== identityUrlKey(stored.websiteUrl))
  ) {
    return true;
  }

  const existingProfiles = new Set(
    stored.publicProfileUrls
      .map(identityUrlKey)
      .filter((value): value is string => !!value),
  );
  if (
    payload.publicProfileUrls.some((url) => {
      const key = identityUrlKey(url);
      return !!key && !existingProfiles.has(key);
    })
  ) {
    return true;
  }

  const existingEvidenceUrls = new Set(
    stored.evidence
      .map((item) => identityUrlKey(item.url))
      .filter((value): value is string => !!value),
  );
  if (
    payload.evidence.some((item) => {
      const key = identityUrlKey(item.url);
      return !!key && !existingEvidenceUrls.has(key);
    })
  ) {
    return true;
  }

  if (stored.duplicateStatus !== payload.duplicateStatus) return true;

  if (
    payload.matchedExistingBusinessName &&
    payload.matchedExistingBusinessName !== stored.matchedExistingBusinessName
  ) {
    return true;
  }

  if (
    payload.matchedPipelineBusinessName &&
    payload.matchedPipelineBusinessName !== stored.matchedPipelineBusinessName
  ) {
    return true;
  }

  return false;
}

function batchCandidateFingerprint(
  payload: ReturnType<typeof canonicalCandidatePayload>,
  canonicalBusinessName: string,
): Promise<string> {
  return sha256(
    JSON.stringify({
      businessName: normalizeName(canonicalBusinessName),
      category: payload.category,
      service: payload.service,
      region: payload.region,
      city: payload.city,
      identityUrls: [...identityUrlsFromPayload(payload)].sort(),
    }),
  );
}

function kstParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekdayIso: weekdayMap[get("weekday")] ?? 0,
  };
}

function scheduleDue(schedule: Obj, now: Date): boolean {
  if (schedule.enabled !== true) return false;
  const cadence = clean(schedule.cadence, 20);
  const runHour = Number(schedule.run_hour_kst);
  const weekdayIso =
    schedule.weekday_iso === null ? null : Number(schedule.weekday_iso);
  if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23) return false;

  const current = kstParts(now);
  if (current.hour < runHour) return false;
  if (cadence === "weekly" && current.weekdayIso !== weekdayIso) return false;
  if (cadence !== "daily" && cadence !== "weekly") return false;

  const lastCompleted =
    typeof schedule.last_completed_at === "string"
      ? new Date(schedule.last_completed_at)
      : null;
  if (!lastCompleted || Number.isNaN(lastCompleted.getTime())) return true;

  return kstParts(lastCompleted).date !== current.date;
}

async function runDiscovery(args: {
  db: ReturnType<typeof createClient>;
  openaiKey: string;
  orgId: string;
  category: string;
  service: string;
  region: string;
  city: string | null;
  brandModel: string | null;
  desiredCount: number;
}) {
  const {
    db,
    openaiKey,
    orgId,
    category,
    service,
    region,
    city,
    brandModel,
    desiredCount,
  } = args;

  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("id,name,measurement_data_origin")
    .eq("id", orgId)
    .eq("measurement_data_origin", "internal_observation")
    .maybeSingle();

  if (orgError || !org) throw new Error("INVALID_ORG");

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
          user_location: {
            type: "approximate",
            country: "KR",
            region,
            ...(city ? { city } : {}),
          },
        },
      ],
      tool_choice: "required",
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      include: ["web_search_call.action.sources"],
    }),
  });

  const rawText = await response.text();
  let payload: Obj = {};
  try {
    payload = rawText ? (JSON.parse(rawText) as Obj) : {};
  } catch {
    payload = { unparsed_response: rawText.slice(0, 2000) };
  }

  if (!response.ok) {
    throw new Error(`DISCOVERY_PROVIDER_FAILED_${response.status}`);
  }

  const sourceRows = collectSourceUrls(payload);
  const sourceByUrl = new Map(sourceRows.map((source) => [source.url, source]));
  const sourceDomains = new Set(sourceRows.map((source) => source.domain));
  const parsed = parseJsonText(extractText(payload));
  const rawCandidates =
    parsed && Array.isArray(parsed.candidates) ? parsed.candidates : [];

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
    ? existingBusinessesRaw.filter(isObj)
    : [];
  const pipelineItems = Array.isArray(pipelineItemsRaw)
    ? pipelineItemsRaw.filter(isObj)
    : [];

  const candidates: Obj[] = [];
  const seenNames = new Set<string>();

  for (const rawCandidate of rawCandidates) {
    if (!isObj(rawCandidate) || candidates.length >= desiredCount) continue;

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
      if (!isObj(item)) continue;
      const requestedUrl = normalizeUrl(clean(item.url, 1000));
      if (!requestedUrl) continue;
      const verified = sourceByUrl.get(requestedUrl);
      if (!verified || evidence.some((row) => row.url === verified.url)) continue;
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
    let duplicateStatus =
      "none" as
        | "none"
        | "existing_business_exact"
        | "existing_pipeline_exact"
        | "existing_domain_overlap";
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
      matchedPipelineBusinessName =
        clean(exactPipeline.business_name, 140) || null;
      warnings.push(
        `기존 수집 파이프라인 후보와 일치: ${matchedPipelineBusinessName ?? name}`,
      );
    }

    const candidateDomains = new Set(
      [websiteUrl, ...publicProfileUrls, ...evidence.map((row) => row.url)]
        .map((value) => (value ? domainOf(value) : null))
        .filter((value): value is string => !!value),
    );

    if (duplicateStatus === "none" && candidateDomains.size > 0) {
      const domainOverlap = existingBusinesses.find((row) => {
        const domains = [
          clean(row.website_url, 1000),
          clean(row.naver_place_url, 1000),
        ]
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
    candidates.push({
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

  return {
    orgName: clean(org.name, 140),
    provider: "openai",
    model: typeof payload.model === "string" ? payload.model : model,
    publicSourceCount: sourceRows.length,
    candidates,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey =
    readSecret("SUPABASE_SECRET_KEYS") ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET")?.trim() ?? "";

  if (!supabaseUrl || !serviceRoleKey || !openaiKey || !internalSecret) {
    return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  if (!isObj(body)) return json({ ok: false, error: "INVALID_REQUEST" }, 400);

  const suppliedInternal = request.headers.get("x-internal-secret")?.trim() ?? "";
  const internalMode =
    suppliedInternal.length > 0 && suppliedInternal === internalSecret;

  let actorUserId: string | null = null;

  if (!internalMode) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }
    const token = authorization.slice(7).trim();
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }
    actorUserId = authData.user.id;
  }

  let schedule: Obj | null = null;
  let triggerSource: "manual" | "scheduled" = "manual";

  if (internalMode && body.runDue === true) {
    triggerSource = "scheduled";
    const { data: scheduleRows, error: scheduleError } = await db
      .from("internal_observation_discovery_schedules")
      .select("*")
      .eq("enabled", true)
      .order("updated_at", { ascending: true })
      .limit(50);

    if (scheduleError) return json({ ok: false, error: "SCHEDULE_READ_FAILED" }, 500);

    const now = new Date();
    schedule =
      (Array.isArray(scheduleRows)
        ? scheduleRows.find((row) => isObj(row) && scheduleDue(row, now))
        : null) ?? null;

    if (!schedule) {
      return json({
        ok: true,
        skipped: "NO_DUE_SCHEDULE",
        version: DISCOVERY_VERSION,
      });
    }
    actorUserId = clean(schedule.actor_user_id, 64);
  } else {
    const scheduleId = clean(body.scheduleId, 64).toLowerCase();
    if (!UUID_RE.test(scheduleId)) {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }

    const { data: scheduleRaw, error: scheduleError } = await db
      .from("internal_observation_discovery_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();

    if (scheduleError || !scheduleRaw) {
      return json({ ok: false, error: "SCHEDULE_NOT_FOUND" }, 404);
    }
    schedule = scheduleRaw as Obj;
  }

  if (!schedule || !actorUserId || !UUID_RE.test(actorUserId)) {
    return json({ ok: false, error: "INVALID_SCHEDULE_ACTOR" }, 409);
  }

  const orgId = clean(schedule.org_id, 64).toLowerCase();
  const category = clean(schedule.category, 100);
  const service = clean(schedule.service, 100);
  const region = clean(schedule.region, 100);
  const city = clean(schedule.city, 100) || null;
  const brandModel = clean(schedule.brand_model, 200) || null;
  const desiredCount = Number(schedule.desired_count);

  if (
    !UUID_RE.test(orgId) ||
    !category ||
    !service ||
    !region ||
    !Number.isInteger(desiredCount) ||
    desiredCount < 1 ||
    desiredCount > MAX_CANDIDATES
  ) {
    return json({ ok: false, error: "INVALID_SCHEDULE" }, 409);
  }

  const [{ data: org }, { data: membership }] = await Promise.all([
    db
      .from("organizations")
      .select("id,measurement_data_origin")
      .eq("id", orgId)
      .eq("measurement_data_origin", "internal_observation")
      .maybeSingle(),
    db
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", actorUserId)
      .maybeSingle(),
  ]);

  if (
    !org ||
    !membership ||
    !WRITE_ROLES.has(String(membership.role))
  ) {
    return json({ ok: false, error: "FORBIDDEN" }, 403);
  }

  if (!internalMode && triggerSource === "manual" && actorUserId !== clean(schedule.actor_user_id, 64)) {
    // Manual runs are allowed for any current write-role operator, while the
    // configured actor remains the future scheduled-run identity.
  }

  const querySnapshot = {
    category,
    service,
    region,
    city,
    brandModel,
    desiredCount,
  };

  const { data: batchRaw, error: batchError } = await db
    .from("internal_observation_discovery_batches")
    .insert({
      org_id: orgId,
      schedule_id: schedule.id,
      trigger_source: triggerSource,
      status: "running",
      query_snapshot: querySnapshot,
      started_at: new Date().toISOString(),
      created_by: actorUserId,
    })
    .select("id")
    .single();

  if (batchError || !batchRaw?.id) {
    return json({ ok: false, error: "BATCH_CREATE_FAILED" }, 500);
  }

  const batchId = String(batchRaw.id);
  const startedAt = new Date().toISOString();

  await db
    .from("internal_observation_discovery_schedules")
    .update({
      last_started_at: startedAt,
      updated_by: actorUserId,
    })
    .eq("id", schedule.id);

  try {
    const discovery = await runDiscovery({
      db,
      openaiKey,
      orgId,
      category,
      service,
      region,
      city,
      brandModel,
      desiredCount,
    });

    const { data: existingQueueRaw, error: queueError } = await db
      .from("internal_observation_discovery_candidates")
      .select("*")
      .eq("org_id", orgId)
      .limit(MAX_EXISTING_ROWS);

    if (queueError) throw new Error("REVIEW_QUEUE_READ_FAILED");

    const existingQueue = Array.isArray(existingQueueRaw)
      ? existingQueueRaw.filter(isObj)
      : [];
    const queueByKey = new Map<string, Obj>();
    for (const row of existingQueue) {
      const key = clean(row.idempotency_key, 1000);
      if (key) queueByKey.set(key, row);
    }

    const findIdentityMatchByExactUrl = (
      payload: ReturnType<typeof canonicalCandidatePayload>,
    ): Obj | null => {
      const incomingUrls = identityUrlsFromPayload(payload);
      if (incomingUrls.size === 0) return null;

      const matches = existingQueue.filter((row) => {
        const storedUrls = identityUrlsFromStored(row);
        return [...incomingUrls].some((url) => storedUrls.has(url));
      });

      if (matches.length > 1) {
        throw new Error("REVIEW_QUEUE_IDENTITY_AMBIGUOUS");
      }
      return matches[0] ?? null;
    };

    let newCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;

    for (const candidate of discovery.candidates) {
      const payload = canonicalCandidatePayload(candidate);
      if (!payload.businessName || payload.evidence.length < 1) continue;

      const key = reviewKey({
        orgId,
        businessName: payload.businessName,
        region: payload.region,
        city: payload.city,
        service: payload.service,
      });
      let existing = queueByKey.get(key) ?? null;
      let identityMatchedByUrl = false;
      if (!existing) {
        existing = findIdentityMatchByExactUrl(payload);
        identityMatchedByUrl = !!existing;
      }

      let classification: "new" | "changed" | "unchanged";
      let reviewCandidateId: string | null = null;
      let candidateFingerprint: string;

      if (!existing) {
        candidateFingerprint = await batchCandidateFingerprint(
          payload,
          payload.businessName,
        );
        classification = "new";
        newCount += 1;

        const { data: inserted, error: insertError } = await db
          .from("internal_observation_discovery_candidates")
          .insert({
            org_id: orgId,
            review_status: "needs_review",
            discovery_source: triggerSource === "scheduled" ? "scheduled_web" : "web_preview",
            idempotency_key: key,
            business_name: payload.businessName,
            category: payload.category,
            service: payload.service,
            region: payload.region,
            city: payload.city,
            website_url: payload.websiteUrl,
            public_profile_urls: payload.publicProfileUrls,
            source_evidence: payload.evidence,
            discovery_query: querySnapshot,
            duplicate_status: payload.duplicateStatus,
            duplicate_warnings: payload.duplicateWarnings,
            matched_existing_business_name:
              payload.matchedExistingBusinessName,
            matched_pipeline_business_name:
              payload.matchedPipelineBusinessName,
            preview_generated_at: new Date().toISOString(),
            first_discovered_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            created_by: actorUserId,
          })
          .select("id")
          .single();

        if (insertError || !inserted?.id) throw new Error("REVIEW_QUEUE_INSERT_FAILED");
        reviewCandidateId = String(inserted.id);
        const insertedRow: Obj = {
          ...payload,
          id: reviewCandidateId,
          idempotency_key: key,
          business_name: payload.businessName,
          website_url: payload.websiteUrl,
          public_profile_urls: payload.publicProfileUrls,
          source_evidence: payload.evidence,
          duplicate_status: payload.duplicateStatus,
          duplicate_warnings: payload.duplicateWarnings,
          matched_existing_business_name: payload.matchedExistingBusinessName,
          matched_pipeline_business_name: payload.matchedPipelineBusinessName,
          review_status: "needs_review",
          promoted_pipeline_item_id: null,
          category: payload.category,
          service: payload.service,
          region: payload.region,
          city: payload.city,
        };
        existingQueue.push(insertedRow);
        queueByKey.set(key, insertedRow);
      } else {
        reviewCandidateId = clean(existing.id, 64);
        if (!reviewCandidateId) throw new Error("REVIEW_QUEUE_ID_INVALID");

        const canonicalBusinessName =
          clean(existing.business_name, 140) || payload.businessName;
        candidateFingerprint = await batchCandidateFingerprint(
          payload,
          canonicalBusinessName,
        );

        classification = materiallyChanged({
          existing,
          payload,
          identityMatchedByUrl,
        })
          ? "changed"
          : "unchanged";

        if (classification === "changed") changedCount += 1;
        else unchangedCount += 1;

        const promoted = clean(existing.promoted_pipeline_item_id, 64) || null;
        const previousStatus = clean(existing.review_status, 80);
        const resetForReview =
          classification === "changed" &&
          !promoted &&
          ["approved", "rejected", "duplicate"].includes(previousStatus);

        const existingWebsiteUrl =
          clean(existing.website_url, 1000) || null;
        const mergedProfiles = mergeStringUrls(
          existing.public_profile_urls,
          payload.publicProfileUrls,
        );
        const mergedEvidence = mergeEvidence(
          existing.source_evidence,
          payload.evidence,
        );
        const mergedDuplicateWarnings = mergeWarnings(
          existing.duplicate_warnings,
          payload.duplicateWarnings,
        );

        const updatePayload: Obj = {
          website_url: existingWebsiteUrl ?? payload.websiteUrl,
          public_profile_urls: mergedProfiles,
          source_evidence: mergedEvidence,
          discovery_query: querySnapshot,
          duplicate_status: payload.duplicateStatus,
          duplicate_warnings: mergedDuplicateWarnings,
          matched_existing_business_name:
            payload.matchedExistingBusinessName ??
            clean(existing.matched_existing_business_name, 140) ??
            null,
          matched_pipeline_business_name:
            payload.matchedPipelineBusinessName ??
            clean(existing.matched_pipeline_business_name, 140) ??
            null,
          preview_generated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        };

        if (resetForReview) {
          updatePayload.review_status = "needs_review";
          updatePayload.reviewed_by = null;
          updatePayload.reviewed_at = null;
        }

        const { error: updateError } = await db
          .from("internal_observation_discovery_candidates")
          .update(updatePayload)
          .eq("id", reviewCandidateId)
          .eq("org_id", orgId);
        if (updateError) throw new Error("REVIEW_QUEUE_UPDATE_FAILED");
      }

      const { error: itemError } = await db
        .from("internal_observation_discovery_batch_items")
        .insert({
          batch_id: batchId,
          review_candidate_id: reviewCandidateId,
          classification,
          candidate_fingerprint: candidateFingerprint,
          business_name:
            existing && clean(existing.business_name, 140)
              ? clean(existing.business_name, 140)
              : payload.businessName,
          candidate_snapshot: payload,
        });

      if (itemError) throw new Error("BATCH_ITEM_INSERT_FAILED");
    }

    const completedAt = new Date().toISOString();
    const { error: completeError } = await db
      .from("internal_observation_discovery_batches")
      .update({
        status: "completed",
        provider: discovery.provider,
        model: discovery.model,
        public_source_count: discovery.publicSourceCount,
        candidate_count: discovery.candidates.length,
        new_count: newCount,
        changed_count: changedCount,
        unchanged_count: unchangedCount,
        completed_at: completedAt,
      })
      .eq("id", batchId);

    if (completeError) throw new Error("BATCH_COMPLETE_FAILED");

    await db
      .from("internal_observation_discovery_schedules")
      .update({
        last_completed_at: completedAt,
        last_status: "completed",
        last_error_code: null,
        updated_by: actorUserId,
      })
      .eq("id", schedule.id);

    await db.from("system_events").insert({
      org_id: orgId,
      run_id: null,
      event_type: "internal_discovery_batch_completed",
      severity: "info",
      message: "Recurring discovery batch completed without measurement side effects.",
      metadata: {
        discovery_version: DISCOVERY_VERSION,
        schedule_id: schedule.id,
        batch_id: batchId,
        trigger_source: triggerSource,
        candidate_count: discovery.candidates.length,
        new_count: newCount,
        changed_count: changedCount,
        unchanged_count: unchangedCount,
        measurement_side_effects: false,
        measurement_credit_debited: false,
        auto_approved: false,
        auto_promoted: false,
      },
    });

    return json({
      ok: true,
      version: DISCOVERY_VERSION,
      batchId,
      scheduleId: schedule.id,
      triggerSource,
      candidateCount: discovery.candidates.length,
      newCount,
      changedCount,
      unchangedCount,
      publicSourceCount: discovery.publicSourceCount,
      autoApproved: false,
      autoPromoted: false,
      measurementSideEffects: false,
      measurementCreditDebited: false,
    });
  } catch (error) {
    const errorCode =
      error instanceof Error ? error.message.slice(0, 120) : "DISCOVERY_BATCH_FAILED";
    const completedAt = new Date().toISOString();

    await db
      .from("internal_observation_discovery_batches")
      .update({
        status: "failed",
        error_code: errorCode,
        error_message: errorCode,
        completed_at: completedAt,
      })
      .eq("id", batchId);

    await db
      .from("internal_observation_discovery_schedules")
      .update({
        last_completed_at: completedAt,
        last_status: "failed",
        last_error_code: errorCode,
        updated_by: actorUserId,
      })
      .eq("id", schedule.id);

    return json({ ok: false, error: errorCode, batchId }, 500);
  }
});
