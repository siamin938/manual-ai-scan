/**
 * Citation attribution persistence pipeline v0.1.0 (server-only).
 *
 * SAFETY CONTRACT
 * - Rules live in `citation-attribution.engine.server.ts` (pure, no data).
 * - No provider / OpenAI call. Only stored payloads are re-read.
 * - org_id + business_id + run scope enforced on every query.
 * - Raw payloads, response text, indices and evidence never leave the server;
 *   only a safe aggregate summary is returned.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CITATION_ATTRIBUTION_VERSION,
  buildAttributionRows,
  domainFromUrl,
  extractUrlCitations,
  type AttributionEntityInput,
  type AttributionRow,
} from "./citation-attribution.engine.server";

export { CITATION_ATTRIBUTION_VERSION };

export type CitationAttributionSummary = {
  attributionVersion: string;
  measurementCount: number;
  citationCount: number;
  directCount: number;
  sectionCount: number;
  entityCount: number;
};

const CHUNK = 200;

async function assertRunInScope(orgId: string, businessId: string, runId: string) {
  const { data, error } = await supabaseAdmin
    .from("measurement_runs")
    .select("id")
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error("RUN_SCOPE_LOOKUP_FAILED");
  if (!data) throw new Error("RUN_NOT_IN_SCOPE");
}

export async function attributeAndPersistRunCitations(args: {
  orgId: string;
  businessId: string;
  runId: string;
}): Promise<CitationAttributionSummary> {
  const { orgId, businessId, runId } = args;
  await assertRunInScope(orgId, businessId, runId);

  const { data: business, error: bizErr } = await supabaseAdmin
    .from("businesses")
    .select("id, name, aliases")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (bizErr || !business) throw new Error("BUSINESS_NOT_IN_ORG");
  const targetKey = `business:${businessId}`;
  const targetTexts = [business.name, ...((business.aliases as string[] | null) ?? [])].filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0,
  );

  const { data: measurements, error: mErr } = await supabaseAdmin
    .from("measurements")
    .select("id, job_id, response_text")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .eq("valid", true);
  if (mErr) throw new Error("MEASUREMENT_LOAD_FAILED");
  const rowsByMeasurement = new Map<string, { jobId: string; text: string }>();
  for (const m of measurements ?? []) {
    if (typeof m.response_text !== "string" || m.response_text.length === 0) continue;
    rowsByMeasurement.set(m.id as string, {
      jobId: m.job_id as string,
      text: m.response_text as string,
    });
  }
  if (rowsByMeasurement.size === 0) {
    return {
      attributionVersion: CITATION_ATTRIBUTION_VERSION,
      measurementCount: 0,
      citationCount: 0,
      directCount: 0,
      sectionCount: 0,
      entityCount: 0,
    };
  }

  // canonical entities in this run scope
  const { data: canon, error: cErr } = await supabaseAdmin
    .from("measurement_entity_canonicalizations")
    .select("measurement_id, measurement_mention_id, canonical_key, canonical_display_name")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("source_run_id", runId);
  if (cErr) throw new Error("CANONICAL_LOAD_FAILED");

  const mentionIds = Array.from(
    new Set((canon ?? []).map((c) => c.measurement_mention_id as string).filter(Boolean)),
  );
  const mentionInfo = new Map<string, { displayName: string; alias: string | null }>();
  for (let i = 0; i < mentionIds.length; i += CHUNK) {
    const slice = mentionIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("measurement_mentions")
      .select("id, display_name, matched_alias")
      .eq("org_id", orgId)
      .in("id", slice);
    if (error) throw new Error("MENTION_LOAD_FAILED");
    for (const m of data ?? []) {
      mentionInfo.set(m.id as string, {
        displayName: (m.display_name as string) ?? "",
        alias: (m.matched_alias as string | null) ?? null,
      });
    }
  }

  const entitiesByMeasurement = new Map<string, Map<string, AttributionEntityInput>>();
  for (const row of canon ?? []) {
    const measurementId = row.measurement_id as string;
    if (!rowsByMeasurement.has(measurementId)) continue;
    const key = row.canonical_key as string;
    let bucket = entitiesByMeasurement.get(measurementId);
    if (!bucket) {
      bucket = new Map();
      entitiesByMeasurement.set(measurementId, bucket);
    }
    const info = mentionInfo.get(row.measurement_mention_id as string);
    const texts = [row.canonical_display_name as string, info?.displayName, info?.alias].filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
    if (key === targetKey) texts.push(...targetTexts);
    const existing = bucket.get(key);
    if (existing) {
      existing.matchTexts = Array.from(new Set([...existing.matchTexts, ...texts]));
    } else {
      bucket.set(key, {
        canonicalKey: key,
        canonicalDisplayName: row.canonical_display_name as string,
        mentionId: (row.measurement_mention_id as string) ?? null,
        matchTexts: Array.from(new Set(texts)),
      });
    }
  }

  // payloads by job
  const jobIds = Array.from(new Set([...rowsByMeasurement.values()].map((v) => v.jobId)));
  const payloadByJob = new Map<string, unknown>();
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const slice = jobIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from("provider_payloads")
      .select("job_id, response_payload")
      .eq("org_id", orgId)
      .in("job_id", slice);
    if (error) throw new Error("PAYLOAD_LOAD_FAILED");
    for (const p of data ?? []) payloadByJob.set(p.job_id as string, p.response_payload);
  }

  let citationCount = 0;
  const allRows: AttributionRow[] = [];
  for (const [measurementId, { jobId, text }] of rowsByMeasurement) {
    const payload = payloadByJob.get(jobId);
    if (!payload) continue;
    const citations = extractUrlCitations(payload);
    if (citations.length === 0) continue;
    citationCount += citations.length;
    const entities = Array.from(entitiesByMeasurement.get(measurementId)?.values() ?? []);
    if (entities.length === 0) continue;
    allRows.push(...buildAttributionRows({ measurementId, responseText: text, citations, entities }));
  }

  const dbRows = allRows.map((r) => ({
    org_id: orgId,
    business_id: businessId,
    source_run_id: runId,
    measurement_id: r.measurementId,
    measurement_mention_id: r.measurementMentionId,
    canonical_key: r.canonicalKey,
    canonical_display_name: r.canonicalDisplayName,
    citation_url: r.citationUrl,
    domain: domainFromUrl(r.citationUrl),
    title: r.title,
    citation_start_index: r.citationStartIndex,
    citation_end_index: r.citationEndIndex,
    entity_start_index: r.entityStartIndex,
    entity_end_index: r.entityEndIndex,
    attribution_level: r.attributionLevel,
    attribution_version: CITATION_ATTRIBUTION_VERSION,
    evidence: r.evidence,
  }));

  for (let i = 0; i < dbRows.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from("measurement_citation_attributions")
      .upsert(dbRows.slice(i, i + CHUNK), {
        onConflict:
          "measurement_id,canonical_key,citation_url,citation_start_index,attribution_version",
      });
    if (error) throw new Error("ATTRIBUTION_UPSERT_FAILED");
  }

  return {
    attributionVersion: CITATION_ATTRIBUTION_VERSION,
    measurementCount: rowsByMeasurement.size,
    citationCount,
    directCount: allRows.filter((r) => r.attributionLevel === "direct").length,
    sectionCount: allRows.filter((r) => r.attributionLevel === "section").length,
    entityCount: new Set(allRows.map((r) => r.canonicalKey)).size,
  };
}
