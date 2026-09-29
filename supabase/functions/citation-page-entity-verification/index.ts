import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  CITATION_PAGE_ENTITY_VERIFIER_VERSION,
  buildCitationPageIdentitySurfaces,
  verifyCitationPageEntity,
  type CitationPageBusinessIdentity,
} from "../_shared/citation-page-entity-verification.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-visibility-postprocess-token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const MAX_CITATIONS = 120;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 700_000;
const FETCH_TIMEOUT_MS = 8_000;
const SSRF_GUARD_VERSION = "0.1";

type Obj = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readDefaultKey(name: string): string | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) return undefined;
    if (typeof parsed.default === "string" && parsed.default.trim()) {
      return parsed.default.trim();
    }
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function runtimeEnv() {
  return {
    url: Deno.env.get("SUPABASE_URL")?.trim() ?? "",
    secret:
      readDefaultKey("SUPABASE_SECRET_KEYS") ??
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      "",
  };
}

function normalizeDomain(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/^www\./u, "");
}

function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  const remove: string[] = [];
  url.searchParams.forEach((_value, key) => {
    const k = key.toLowerCase();
    if (
      k.startsWith("utm_") ||
      ["gclid", "fbclid", "yclid", "msclkid", "igshid", "mc_cid", "mc_eid"].includes(k)
    ) {
      remove.push(key);
    }
  });
  for (const key of remove) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  if (host.includes(":")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return true;
  return false;
}

function safePublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol)) return null;
  if (url.username || url.password || blockedHostname(url.hostname)) return null;
  return url;
}

async function readTextLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let out = "";
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // no-op
      }
      break;
    }
    out += decoder.decode(part.value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function htmlTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  if (!match?.[1]) return null;
  const title = decodeHtmlEntities(match[1].replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
  return title ? title.slice(0, 500) : null;
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 250_000);
}

async function fetchPage(rawUrl: string): Promise<{
  fetchSucceeded: boolean;
  pageTitle: string | null;
  pageText: string;
  httpStatus: number | null;
  fetchStatus: string;
  finalUrl: string | null;
}> {
  let url = safePublicUrl(rawUrl);
  if (!url) {
    return {
      fetchSucceeded: false,
      pageTitle: null,
      pageText: "",
      httpStatus: null,
      fetchStatus: "blocked_url",
      finalUrl: null,
    };
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
          "User-Agent": "CHABOIM-CitationVerifier/0.1",
        },
      });
    } catch {
      clearTimeout(timeout);
      return {
        fetchSucceeded: false,
        pageTitle: null,
        pageText: "",
        httpStatus: null,
        fetchStatus: "fetch_failed",
        finalUrl: url.toString(),
      };
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        return {
          fetchSucceeded: false,
          pageTitle: null,
          pageText: "",
          httpStatus: response.status,
          fetchStatus: "redirect_failed",
          finalUrl: url.toString(),
        };
      }
      const next = safePublicUrl(new URL(location, url).toString());
      if (!next) {
        return {
          fetchSucceeded: false,
          pageTitle: null,
          pageText: "",
          httpStatus: response.status,
          fetchStatus: "redirect_blocked",
          finalUrl: url.toString(),
        };
      }
      url = next;
      continue;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok) {
      return {
        fetchSucceeded: false,
        pageTitle: null,
        pageText: "",
        httpStatus: response.status,
        fetchStatus: "http_error",
        finalUrl: url.toString(),
      };
    }
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      return {
        fetchSucceeded: false,
        pageTitle: null,
        pageText: "",
        httpStatus: response.status,
        fetchStatus: "unsupported_content_type",
        finalUrl: url.toString(),
      };
    }

    const html = await readTextLimited(response);
    return {
      fetchSucceeded: true,
      pageTitle: htmlTitle(html),
      pageText: contentType.includes("text/plain") ? html.slice(0, 250_000) : htmlToText(html),
      httpStatus: response.status,
      fetchStatus: "fetched",
      finalUrl: url.toString(),
    };
  }

  return {
    fetchSucceeded: false,
    pageTitle: null,
    pageText: "",
    httpStatus: null,
    fetchStatus: "fetch_failed",
    finalUrl: url.toString(),
  };
}

function hostFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = safePublicUrl(raw);
  return url ? normalizeDomain(url.hostname) : null;
}

function pathPrefixMatch(candidateUrl: string, baseUrl: string): boolean {
  const candidate = safePublicUrl(candidateUrl);
  const base = safePublicUrl(baseUrl);
  if (!candidate || !base) return false;
  if (normalizeDomain(candidate.hostname) !== normalizeDomain(base.hostname)) return false;
  const basePath = base.pathname.replace(/\/+$/u, "") || "/";
  const candidatePath = candidate.pathname.replace(/\/+$/u, "") || "/";
  return (
    basePath === "/" ||
    candidatePath === basePath ||
    candidatePath.startsWith(basePath + "/")
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const env = runtimeEnv();
  if (!env.url || !env.secret) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 500);
  const db = createClient(env.url, env.secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const supplied =
    request.headers.get("x-visibility-postprocess-token")?.trim() ?? "";
  if (!supplied) return json({ ok: false, error: "FORBIDDEN" }, 403);
  const { data: tokenRow, error: tokenError } = await db
    .from("visibility_postprocess_tokens")
    .select("name")
    .eq("token", supplied)
    .eq("active", true)
    .maybeSingle();
  if (tokenError || !tokenRow) return json({ ok: false, error: "FORBIDDEN" }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  if (!isObj(body) || typeof body.runId !== "string") {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  const runId = body.runId.trim();

  const { data: run, error: runError } = await db
    .from("measurement_runs")
    .select("id,org_id,business_id,status,run_type,phase,experiment_id")
    .eq("id", runId)
    .maybeSingle();
  if (runError || !run) return json({ ok: false, error: "RUN_NOT_FOUND" }, 404);
  if (
    run.run_type !== "audit" ||
    run.phase !== "standalone" ||
    run.experiment_id !== null ||
    !["completed", "partial"].includes(String(run.status))
  ) {
    return json({ ok: false, error: "RUN_NOT_ELIGIBLE" }, 409);
  }

  const orgId = String(run.org_id);
  const businessId = String(run.business_id);

  const { data: business, error: businessError } = await db
    .from("businesses")
    .select(
      "id,name,aliases,region,city,address,website_url,naver_place_url,official_domains,active",
    )
    .eq("id", businessId)
    .eq("org_id", orgId)
    .eq("active", true)
    .maybeSingle();
  if (businessError || !business) {
    return json({ ok: false, error: "BUSINESS_NOT_FOUND" }, 404);
  }

  const { data: aggregate, error: aggregateError } = await db
    .from("run_entity_fact_aggregates_v2")
    .select("materialization_id,measurement_count")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("source_run_id", runId)
    .eq("fact_version", "0.3")
    .eq("engine_version", "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1")
    .eq("contract_ok", true)
    .maybeSingle();
  if (aggregateError || !aggregate) {
    return json({ ok: false, error: "V2_AGGREGATE_NOT_READY" }, 409);
  }

  const { data: factRows, error: factError } = await db
    .from("measurement_entity_facts_v2")
    .select("measurement_id,facts")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("source_run_id", runId)
    .eq("materialization_id", aggregate.materialization_id)
    .eq("fact_version", "0.3")
    .eq("engine_version", "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1");
  if (factError || (factRows ?? []).length !== aggregate.measurement_count) {
    return json({ ok: false, error: "V2_FACTS_NOT_READY" }, 409);
  }

  const targetMeasurementIds = (factRows ?? [])
    .filter((row) => isObj(row.facts) && row.facts.targetSeen === true)
    .map((row) => String(row.measurement_id));

  if (targetMeasurementIds.length === 0) {
    await db.from("system_events").insert({
      org_id: orgId,
      run_id: runId,
      event_type: "citation_page_entity_verification_completed",
      severity: "info",
      message: "Citation page entity verification completed with no target-visible measurements.",
      metadata: {
        verifier_version: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
        inserted_count: 0,
        skipped_count: 0,
        target_measurement_count: 0,
      },
    });
    return json({
      ok: true,
      runId,
      verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
      insertedCount: 0,
      skippedCount: 0,
      targetMeasurementCount: 0,
    });
  }

  const { data: citations, error: citationError } = await db
    .from("measurement_citations")
    .select("id,measurement_id,url,domain,title")
    .eq("org_id", orgId)
    .in("measurement_id", targetMeasurementIds)
    .limit(MAX_CITATIONS + 1);
  if (citationError) return json({ ok: false, error: "CITATION_READ_FAILED" }, 500);
  if ((citations ?? []).length > MAX_CITATIONS) {
    return json({ ok: false, error: "TOO_MANY_CITATIONS" }, 413);
  }

  const citationIds = (citations ?? []).map((row) => String(row.id));
  const { data: existingRows, error: existingError } = citationIds.length
    ? await db
        .from("citation_page_entity_verifications")
        .select("citation_id")
        .eq("org_id", orgId)
        .eq("business_id", businessId)
        .eq("source_run_id", runId)
        .eq("verifier_version", CITATION_PAGE_ENTITY_VERIFIER_VERSION)
        .in("citation_id", citationIds)
    : { data: [], error: null };
  if (existingError) return json({ ok: false, error: "EXISTING_READ_FAILED" }, 500);
  const existingIds = new Set((existingRows ?? []).map((row) => String(row.citation_id)));

  const { data: orgBusinesses, error: orgBusinessesError } = await db
    .from("businesses")
    .select("id,name,aliases")
    .eq("org_id", orgId)
    .eq("active", true);
  if (orgBusinessesError) {
    return json({ ok: false, error: "BUSINESS_COLLISION_SCOPE_READ_FAILED" }, 500);
  }

  const surfaceOwners = new Map<string, Set<string>>();
  for (const candidate of orgBusinesses ?? []) {
    const candidateIdentity: CitationPageBusinessIdentity = {
      name: String(candidate.name ?? ""),
      aliases: Array.isArray(candidate.aliases)
        ? candidate.aliases.map((item) => String(item))
        : [],
    };
    for (const surface of buildCitationPageIdentitySurfaces(candidateIdentity)) {
      const owners = surfaceOwners.get(surface.compact) ?? new Set<string>();
      owners.add(String(candidate.id));
      surfaceOwners.set(surface.compact, owners);
    }
  }
  const ambiguousIdentityCompacts = new Set(
    [...surfaceOwners.entries()]
      .filter((entry) => entry[1].size > 1)
      .map((entry) => entry[0]),
  );

  const { data: firstPartyRows, error: firstPartyError } = await db
    .from("business_first_party_sources")
    .select(
      "source_type,canonical_url,normalized_host,resource_key,match_mode,verification_status,active",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("active", true)
    .eq("verification_status", "verified");
  if (firstPartyError) {
    return json({ ok: false, error: "FIRST_PARTY_READ_FAILED" }, 500);
  }

  const officialHosts = new Set<string>();
  for (const raw of (business.official_domains ?? []) as string[]) {
    const host = hostFromUrl(raw) ?? normalizeDomain(raw);
    if (host) officialHosts.add(host);
  }
  const websiteHost = hostFromUrl(
    typeof business.website_url === "string" ? business.website_url : null,
  );
  if (websiteHost) officialHosts.add(websiteHost);

  const exactOfficialUrls = new Set<string>();
  const prefixOfficialUrls: string[] = [];
  if (typeof business.naver_place_url === "string") {
    const canonical = canonicalizeUrl(business.naver_place_url);
    if (canonical) exactOfficialUrls.add(canonical);
  }

  for (const row of firstPartyRows ?? []) {
    const host =
      typeof row.normalized_host === "string"
        ? normalizeDomain(row.normalized_host)
        : "";
    if (row.match_mode === "host_or_subdomain" && host) {
      officialHosts.add(host);
    }
    if (typeof row.canonical_url === "string" && row.canonical_url.trim()) {
      const canonical = canonicalizeUrl(row.canonical_url);
      if (!canonical) continue;
      if (row.match_mode === "exact_url") exactOfficialUrls.add(canonical);
      if (row.match_mode === "resource_prefix") prefixOfficialUrls.push(canonical);
    }
  }

  function isOfficialSource(rawUrl: string): boolean {
    const url = safePublicUrl(rawUrl);
    const canonical = canonicalizeUrl(rawUrl);
    if (!url || !canonical) return false;
    const host = normalizeDomain(url.hostname);
    if (
      [...officialHosts].some(
        (officialHost) =>
          host === officialHost || host.endsWith("." + officialHost),
      )
    ) {
      return true;
    }
    if (exactOfficialUrls.has(canonical)) return true;
    return prefixOfficialUrls.some((base) => pathPrefixMatch(canonical, base));
  }

  const businessIdentity: CitationPageBusinessIdentity = {
    name: String(business.name ?? ""),
    aliases: Array.isArray(business.aliases)
      ? business.aliases.map((item) => String(item))
      : [],
    region: typeof business.region === "string" ? business.region : null,
    city: typeof business.city === "string" ? business.city : null,
    address: typeof business.address === "string" ? business.address : null,
  };

  let insertedCount = 0;
  let skippedCount = 0;
  let confirmedCount = 0;
  let unresolvedCount = 0;
  let unrelatedCount = 0;

  for (const citation of citations ?? []) {
    const citationId = String(citation.id);
    if (existingIds.has(citationId)) {
      skippedCount += 1;
      continue;
    }

    const rawUrl = String(citation.url ?? "").trim();
    const canonicalUrl = canonicalizeUrl(rawUrl);
    const officialSource = !!canonicalUrl && isOfficialSource(canonicalUrl);

    let fetchResult = {
      fetchSucceeded: false,
      pageTitle: null as string | null,
      pageText: "",
      httpStatus: null as number | null,
      fetchStatus: officialSource ? "not_needed" : "not_attempted",
      finalUrl: canonicalUrl,
    };

    let verification = verifyCitationPageEntity({
      business: businessIdentity,
      page: {
        url: rawUrl,
        citationTitle:
          typeof citation.title === "string" ? citation.title : null,
        pageTitle: null,
        pageText: null,
        fetchSucceeded: false,
        officialSource,
      },
      ambiguousIdentityCompacts,
    });

    if (verification.status !== "confirmed" && !officialSource && canonicalUrl) {
      fetchResult = await fetchPage(canonicalUrl);
      verification = verifyCitationPageEntity({
        business: businessIdentity,
        page: {
          url: rawUrl,
          citationTitle:
            typeof citation.title === "string" ? citation.title : null,
          pageTitle: fetchResult.pageTitle,
          pageText: fetchResult.pageText,
          fetchSucceeded: fetchResult.fetchSucceeded,
          officialSource: false,
        },
        ambiguousIdentityCompacts,
      });
    }

    const contentHash = fetchResult.fetchSucceeded
      ? await sha256Hex(
          (fetchResult.pageTitle ?? "") + "\n" + fetchResult.pageText,
        )
      : null;

    const evidence = {
      reasons: verification.reasons,
      matched_identity_surfaces: verification.matchedIdentitySurfaces,
      matched_location_signals: verification.matchedLocationSignals,
      branch_specific: verification.branchSpecific,
      official_source: officialSource,
      fetch_status: fetchResult.fetchStatus,
      final_url: fetchResult.finalUrl,
      ssrf_guard_version: SSRF_GUARD_VERSION,
    };

    const { error: insertError } = await db
      .from("citation_page_entity_verifications")
      .insert({
        org_id: orgId,
        business_id: businessId,
        source_run_id: runId,
        measurement_id: String(citation.measurement_id),
        citation_id: citationId,
        citation_url: rawUrl,
        canonical_url: canonicalUrl ?? rawUrl,
        domain:
          normalizeDomain(
            typeof citation.domain === "string"
              ? citation.domain
              : hostFromUrl(rawUrl),
          ) || null,
        citation_title:
          typeof citation.title === "string" ? citation.title : null,
        page_title: fetchResult.pageTitle,
        verification_status: verification.status,
        confidence: verification.confidence,
        evidence,
        verifier_version: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
        http_status: fetchResult.httpStatus,
        fetch_status: fetchResult.fetchStatus,
        content_hash: contentHash,
      });
    if (insertError) {
      return json(
        {
          ok: false,
          error: "VERIFICATION_SAVE_FAILED",
          detail: insertError.message,
        },
        500,
      );
    }

    insertedCount += 1;
    if (verification.status === "confirmed") confirmedCount += 1;
    else if (verification.status === "unresolved") unresolvedCount += 1;
    else unrelatedCount += 1;
  }

  await db.from("system_events").insert({
    org_id: orgId,
    run_id: runId,
    event_type: "citation_page_entity_verification_completed",
    severity: "info",
    message: "Citation page entity verification completed.",
    metadata: {
      verifier_version: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      confirmed_count: confirmedCount,
      unresolved_count: unresolvedCount,
      unrelated_count: unrelatedCount,
      target_measurement_count: targetMeasurementIds.length,
      ssrf_guard_version: SSRF_GUARD_VERSION,
    },
  });

  return json({
    ok: true,
    runId,
    verifierVersion: CITATION_PAGE_ENTITY_VERIFIER_VERSION,
    insertedCount,
    skippedCount,
    confirmedCount,
    unresolvedCount,
    unrelatedCount,
    targetMeasurementCount: targetMeasurementIds.length,
  });
});
