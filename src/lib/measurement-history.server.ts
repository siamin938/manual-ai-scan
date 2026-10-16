import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { CUSTOMER_STANDARD_QUESTION_COUNT, isUuid } from "./customer-measurement.helpers";
import {
  buildEntityFactsV2ReadGatewayFromSnapshot,
} from "./entity-facts-v2-read-gateway.build";
import {
  ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION,
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
  type EntityFactsV2CompetitorDisplayEvidence,
  type EntityFactsV2ReadCitationSourceDTO,
  type EntityFactsV2ReadGatewayDTO,
} from "./entity-facts-v2-read-gateway.types";
import {
  ENTITY_FACTS_V2_OBSERVED_SOURCES_ENGINE_VERSION,
  ENTITY_FACTS_V2_OBSERVED_SOURCES_SOURCE_REPLAY_VERSION,
  ENTITY_FACTS_V2_OBSERVED_SOURCES_VERSION,
} from "./entity-facts-v2-read-gateway.observed-sources";
import {
  ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_ENGINE_VERSION,
  ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_SOURCE_REPLAY_VERSION,
  ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_VERSION,
} from "./entity-facts-v2-read-gateway.source-clues";
import {
  fetchCrossResponseCompetitorShadowSupplement,
  mergeCrossResponsePromotedCompetitorsForReadLayer,
} from "./cross-response-competitor-confirmation.shadow.server";
import {
  isValidHistoryAggregate,
  MEASUREMENT_HISTORY_PAGE_SIZE,
  type MeasurementHistoryCatalogResponse,
  type MeasurementHistoryDetailResponse,
} from "./measurement-history.model";

type V2AggregateRow = {
  id: string; materialization_id: string; source_run_id: string;
  fact_version: string; aggregate_version: string; engine_version: string;
  measurement_count: number; valid_measurement_count: number;
  contract_ok: boolean; aggregate: Json; aggregate_hash: string;
};
type ObservedRow = {
  id: string; base_aggregate_id: string; base_materialization_id: string;
  source_run_id: string; observed_sources_version: string;
  source_replay_version: string; engine_version: string; observed_sources: Json;
};
type ClueRow = {
  base_observed_source_aggregate_id: string; base_aggregate_id: string;
  base_materialization_id: string; source_run_id: string;
  clue_version: string; source_replay_version: string;
  engine_version: string; source_clues: Json;
};
type HistoryDb = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      run_entity_fact_aggregates_v2: {
        Row: V2AggregateRow; Insert: never; Update: never; Relationships: [];
      };
      run_observed_source_aggregates_v2: {
        Row: ObservedRow; Insert: never; Update: never; Relationships: [];
      };
      run_competitor_source_clue_aggregates_v2: {
        Row: ClueRow; Insert: never; Update: never; Relationships: [];
      };
    };
  };
};

const historyDb = supabaseAdmin as unknown as SupabaseClient<HistoryDb>;


async function getScopedBusiness(orgId: string, businessId: string) {
  const result = await supabaseAdmin.from("businesses")
    .select("id,name,category,region,city")
    .eq("org_id", orgId).eq("id", businessId)
    .eq("is_client_business", true).eq("active", true).maybeSingle();
  return result;
}

const completedCustomerRuns = (orgId: string, businessId: string) =>
  supabaseAdmin.from("measurement_runs")
    .select("id,name,question_set_id,completed_at,created_at,repetitions,selected_providers,total_jobs,completed_jobs,failed_jobs")
    .eq("org_id", orgId).eq("business_id", businessId)
    .eq("run_type", "audit").eq("phase", "standalone")
    .eq("diagnostic_scope", "customer").eq("status", "completed")
    .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)
    .is("experiment_id", null);

export async function fetchMeasurementHistoryCatalog(
  args: { orgId: string; businessId: string; page: number },
  memberClient: SupabaseClient<Database>,
): Promise<MeasurementHistoryCatalogResponse> {
  const { orgId, businessId, page } = args;
  if (!isUuid(orgId) || !isUuid(businessId) ||
    !Number.isInteger(page) || page < 0 || page > 1000) {
    return { ok: false, error: "NOT_AVAILABLE" };
  }

  // The customer history index is visible via member RLS. An administrative
  // materialization failure must not conceal the already-owned date records.
  const { data: business, error: businessError } = await memberClient
    .from("businesses").select("id")
    .eq("org_id", orgId).eq("id", businessId)
    .eq("is_client_business", true).eq("active", true).maybeSingle();
  if (businessError) return { ok: false, error: "INTERNAL_ERROR" };
  if (!business) return { ok: false, error: "NOT_AVAILABLE" };

  // Fetch one additional row to distinguish the last page. The session's
  // RLS client, not the service-role client, reads the index's public fields.
  const start = page * MEASUREMENT_HISTORY_PAGE_SIZE;
  const { data: allRuns, error } = await memberClient
    .from("measurement_runs")
    .select("id,name,completed_at,created_at")
    .eq("org_id", orgId).eq("business_id", businessId)
    .eq("run_type", "audit").eq("phase", "standalone")
    .eq("diagnostic_scope", "customer").eq("status", "completed")
    .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)
    .is("experiment_id", null)
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + MEASUREMENT_HISTORY_PAGE_SIZE);
  if (error) return { ok: false, error: "INTERNAL_ERROR" };

  const runs = (allRuns ?? []).slice(0, MEASUREMENT_HISTORY_PAGE_SIZE);
  const ids = runs.map((run) => run.id);
  const aggregates: V2AggregateRow[] = [];
  let snapshotStatus: "ready" | "temporarily_unavailable" = "ready";
  if (ids.length > 0) {
    try {
      const { data, error: aggregateError } = await historyDb
        .from("run_entity_fact_aggregates_v2")
        .select("id,materialization_id,source_run_id,fact_version,aggregate_version,engine_version,measurement_count,valid_measurement_count,contract_ok,aggregate,aggregate_hash")
        .eq("org_id", orgId).eq("business_id", businessId)
        .in("source_run_id", ids);
      if (aggregateError) {
        snapshotStatus = "temporarily_unavailable";
        console.warn("[measurement-history] optional snapshot index query failed", aggregateError.code);
      } else {
        aggregates.push(...(data ?? []));
      }
    } catch {
      // If the privileged snapshot client is not ready, preserve the
      // member-authorized date index and fail closed on all detailed counts.
      snapshotStatus = "temporarily_unavailable";
      console.warn("[measurement-history] optional snapshot index unavailable");
    }
  }

  return {
    ok: true,
    data: {
      orgId, businessId, page, snapshotStatus,
      hasNextPage: (allRuns ?? []).length > MEASUREMENT_HISTORY_PAGE_SIZE,
      runs: runs.map((run) => {
        const rows = aggregates.filter((row) =>
          row.source_run_id === run.id &&
          row.fact_version === ENTITY_FACTS_V2_READ_FACT_VERSION &&
          row.aggregate_version === ENTITY_FACTS_V2_READ_AGGREGATE_VERSION &&
          row.engine_version === ENTITY_FACTS_V2_READ_ENGINE_VERSION
        );
        const snapshot = rows.length === 1 ? rows[0]! : null;
        const ready = !!snapshot && isValidHistoryAggregate({
          requestedRunId: run.id, sourceRunId: snapshot.source_run_id,
          factVersion: snapshot.fact_version,
          aggregateVersion: snapshot.aggregate_version,
          engineVersion: snapshot.engine_version,
          measurementCount: snapshot.measurement_count,
          validMeasurementCount: snapshot.valid_measurement_count,
          contractOk: snapshot.contract_ok,
          aggregate: snapshot.aggregate,
        });
        const parsed = ready && snapshot
          ? parseEntityFactsV2AggregateForReadGateway(snapshot.aggregate)
          : null;
        return {
          runId: run.id,
          runName: run.name,
          measuredAt: run.completed_at ?? run.created_at,
          status: parsed ? "available" as const : "not_available" as const,
          validCount: parsed?.overview.validCount ?? null,
          confirmedCount: parsed?.overview.confirmedMentionCount ?? null,
          top3Count: parsed?.overview.confirmedTop3Count ?? null,
        };
      }),
    },
  };
}

function getBusinessIdFromKey(key: string): string | null {
  if (!key.startsWith("business:")) return null;
  const id = key.slice("business:".length).trim().toLowerCase();
  return isUuid(id) ? id : null;
}

async function assembleHistoryV2Report(args: {
  orgId: string; businessId: string; runId: string;
}): Promise<EntityFactsV2ReadGatewayDTO | null> {
  const { orgId, businessId, runId } = args;
  const [{ data: business, error: businessError }, { data: run, error: runError }] =
    await Promise.all([
      getScopedBusiness(orgId, businessId),
      completedCustomerRuns(orgId, businessId).eq("id", runId).maybeSingle(),
    ]);
  if (businessError || runError || !business || !run) return null;

  const { data: aggregateRows, error: aggregateError } = await historyDb
    .from("run_entity_fact_aggregates_v2")
    .select("id,materialization_id,source_run_id,fact_version,aggregate_version,engine_version,measurement_count,valid_measurement_count,contract_ok,aggregate,aggregate_hash")
    .eq("org_id", orgId).eq("business_id", businessId).eq("source_run_id", runId)
    .eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION)
    .eq("aggregate_version", ENTITY_FACTS_V2_READ_AGGREGATE_VERSION)
    .eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION).limit(2);
  if (aggregateError || !aggregateRows || aggregateRows.length !== 1) return null;
  const storage = aggregateRows[0]!;
  if (!isValidHistoryAggregate({
    requestedRunId: runId, sourceRunId: storage.source_run_id,
    factVersion: storage.fact_version, aggregateVersion: storage.aggregate_version,
    engineVersion: storage.engine_version, measurementCount: storage.measurement_count,
    validMeasurementCount: storage.valid_measurement_count,
    contractOk: storage.contract_ok, aggregate: storage.aggregate,
  })) return null;
  const parsed = parseEntityFactsV2AggregateForReadGateway(storage.aggregate);
  if (!parsed) return null;

  const { data: observedRows, error: observedError } = await historyDb
    .from("run_observed_source_aggregates_v2")
    .select("id,base_aggregate_id,base_materialization_id,source_run_id,observed_sources_version,source_replay_version,engine_version,observed_sources")
    .eq("org_id", orgId).eq("business_id", businessId)
    .eq("source_run_id", runId).eq("base_aggregate_id", storage.id)
    .eq("observed_sources_version", ENTITY_FACTS_V2_OBSERVED_SOURCES_VERSION)
    .eq("source_replay_version", ENTITY_FACTS_V2_OBSERVED_SOURCES_SOURCE_REPLAY_VERSION)
    .eq("engine_version", ENTITY_FACTS_V2_OBSERVED_SOURCES_ENGINE_VERSION).limit(2);
  if (observedError || (observedRows?.length ?? 0) > 1) return null;
  const observed = observedRows?.[0] ?? null;

  let clue: ClueRow | null = null;
  if (observed) {
    const { data: clueRows, error: clueError } = await historyDb
      .from("run_competitor_source_clue_aggregates_v2")
      .select("base_observed_source_aggregate_id,base_aggregate_id,base_materialization_id,source_run_id,clue_version,source_replay_version,engine_version,source_clues")
      .eq("org_id", orgId).eq("business_id", businessId)
      .eq("source_run_id", runId).eq("base_aggregate_id", storage.id)
      .eq("base_observed_source_aggregate_id", observed.id)
      .eq("clue_version", ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_VERSION)
      .eq("source_replay_version", ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_SOURCE_REPLAY_VERSION)
      .eq("engine_version", ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_ENGINE_VERSION).limit(2);
    if (clueError || (clueRows?.length ?? 0) > 1) return null;
    clue = clueRows?.[0] ?? null;
  }

  const registeredIds = [...new Set(parsed.competitors
    .map((item) => getBusinessIdFromKey(item.canonicalKey))
    .filter((id): id is string => id !== null && id !== businessId))];
  const names: Record<string, string> = {};
  if (registeredIds.length > 0) {
    const { data, error } = await supabaseAdmin.from("businesses")
      .select("id,name").eq("org_id", orgId).in("id", registeredIds);
    if (error) return null;
    for (const row of data ?? []) if (row.name?.trim()) names[row.id] = row.name.trim();
  }

  const autoKeys = [...new Set(parsed.competitors.map((item) => item.canonicalKey)
    .filter((key) => key.startsWith("auto:")))];
  const displayEvidence: Record<string, EntityFactsV2CompetitorDisplayEvidence[]> = {};
  if (autoKeys.length > 0) {
    const { data: canonicalizations, error } = await supabaseAdmin
      .from("measurement_entity_canonicalizations")
      .select("canonical_key,canonical_display_name,measurement_mention_id")
      .eq("org_id", orgId).eq("business_id", businessId)
      .eq("source_run_id", runId).in("canonical_key", autoKeys);
    if (error) return null;
    const mentionIds = [...new Set((canonicalizations ?? [])
      .map((item) => item.measurement_mention_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0))];
    const mentions = new Map<string, { display_name: string; matched_alias: string | null }>();
    if (mentionIds.length > 0) {
      const { data, error: mentionError } = await supabaseAdmin.from("measurement_mentions")
        .select("id,display_name,matched_alias").eq("org_id", orgId)
        .in("id", mentionIds);
      if (mentionError) return null;
      for (const item of data ?? []) mentions.set(item.id, item);
    }
    for (const item of canonicalizations ?? []) {
      const key = item.canonical_key?.trim();
      if (!key || !autoKeys.includes(key)) continue;
      const evidence = displayEvidence[key] ?? [];
      evidence.push({ label: item.canonical_display_name, priority: 1 });
      const mention = mentions.get(item.measurement_mention_id);
      if (mention) {
        evidence.push({ label: mention.matched_alias, priority: 2 });
        evidence.push({ label: mention.display_name, priority: 3 });
      }
      displayEvidence[key] = evidence;
    }
  }

  const { data: questionSet, error: setError } = await supabaseAdmin
    .from("question_sets").select("name")
    .eq("org_id", orgId).eq("business_id", businessId)
    .eq("id", run.question_set_id).maybeSingle();
  if (setError) return null;

  const snapshot = buildEntityFactsV2ReadGatewayFromSnapshot({
    generatedAt: new Date().toISOString(),
    business: {
      id: business.id, name: business.name, category: business.category ?? null,
      region: business.region ?? null, city: business.city ?? null,
    },
    scope: {
      runId, runName: run.name,
      questionSetId: run.question_set_id,
      questionSetName: questionSet?.name ?? undefined,
      measuredAt: run.completed_at ?? run.created_at,
      providers: Array.isArray(run.selected_providers) ? run.selected_providers.map(String) : [],
      repetitions: run.repetitions, totalJobs: run.total_jobs,
      completedJobs: run.completed_jobs, failedJobs: run.failed_jobs,
    },
    storage: {
      aggregateId: storage.id, materializationId: storage.materialization_id,
      sourceRunId: storage.source_run_id, factVersion: storage.fact_version,
      aggregateVersion: storage.aggregate_version, engineVersion: storage.engine_version,
      measurementCount: storage.measurement_count,
      validMeasurementCount: storage.valid_measurement_count,
      contractOk: storage.contract_ok, aggregate: storage.aggregate,
    },
    observedSourcesStorage: observed ? {
      observedSourceAggregateId: observed.id, baseAggregateId: observed.base_aggregate_id,
      baseMaterializationId: observed.base_materialization_id,
      sourceRunId: observed.source_run_id,
      observedSourcesVersion: observed.observed_sources_version,
      sourceReplayVersion: observed.source_replay_version,
      engineVersion: observed.engine_version,
      observedSources: observed.observed_sources,
    } : null,
    competitorSourceClueStorage: clue ? {
      baseObservedSourceAggregateId: clue.base_observed_source_aggregate_id,
      baseAggregateId: clue.base_aggregate_id,
      baseMaterializationId: clue.base_materialization_id,
      sourceRunId: clue.source_run_id,
      clueVersion: clue.clue_version,
      sourceReplayVersion: clue.source_replay_version,
      engineVersion: clue.engine_version,
      sourceClues: clue.source_clues,
    } : null,
    registeredCompetitorNames: names,
    autoCompetitorEvidence: displayEvidence,
  });
  if (!snapshot.ok) return null;
  const report = snapshot.data;

  // Preserve the same strictly scoped approved competitor supplement as the live read layer.
  const shadow = await fetchCrossResponseCompetitorShadowSupplement({
    orgId, businessId, runId,
  }).catch(() => null);
  report.competitors = mergeCrossResponsePromotedCompetitorsForReadLayer({
    baseCompetitors: report.competitors, supplement: shadow, expectedRunId: runId,
    expectedAggregateId: storage.id, expectedAggregateHash: storage.aggregate_hash,
  });

  const ids = report.questionAreas.map((item) => item.questionId);
  if (ids.length > 0) {
    const { data, error } = await supabaseAdmin.from("questions")
      .select("id,city").eq("org_id", orgId)
      .eq("question_set_id", run.question_set_id).in("id", ids);
    if (!error && data?.length === ids.length) {
      report.questionLocations = data.map((item) => ({
        questionId: item.id, city: item.city ?? null,
      }));
    }
  }

  // This is final-answer citation co-observation, not a cause of recommendations.
  const { data: citations, error: citationError } = await supabaseAdmin
    .from("measurement_citations")
    .select("domain,url,measurement_id,measurements!inner(run_id)")
    .eq("org_id", orgId).eq("measurements.run_id", runId).limit(2000);
  if (!citationError) {
    const domains = new Map<string, { measurementIds: Set<string>; count: number; sampleUrl: string }>();
    for (const row of citations ?? []) {
      const domain = typeof row.domain === "string" ? row.domain.trim().toLowerCase().replace(/^www\./u, "") : "";
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (!domain || !/^https?:\/\//iu.test(url)) continue;
      const bucket = domains.get(domain) ?? { measurementIds: new Set<string>(), count: 0, sampleUrl: url };
      bucket.count += 1;
      bucket.measurementIds.add(row.measurement_id);
      domains.set(domain, bucket);
    }
    const sources: EntityFactsV2ReadCitationSourceDTO[] = [...domains.entries()]
      .map(([domain, item]) => ({
        domain, responseCount: item.measurementIds.size,
        citationCount: item.count, sampleUrl: item.sampleUrl,
      }))
      .sort((a, b) => b.responseCount - a.responseCount || b.citationCount - a.citationCount || a.domain.localeCompare(b.domain));
    report.citationSources = sources;
  }

  // A stored verification row alone is never proof that verification finished.
  report.verifiedTargetCitationPageStatus = "not_verified";
  const { data: completion, error: completionError } = await supabaseAdmin.from("system_events")
    .select("id").eq("org_id", orgId).eq("run_id", runId)
    .eq("event_type", "citation_page_entity_verification_completed")
    .eq("metadata->>verifier_version", ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION)
    .eq("metadata->>materialization_id", storage.materialization_id)
    .limit(1).maybeSingle();

  if (completionError) {
    report.verifiedTargetCitationPageStatus = "pending";
  } else if (completion) {
    const { data: targetFacts, error: factError } = await historyDb
      .from("measurement_entity_facts_v2")
      .select("measurement_id,facts").eq("org_id", orgId)
      .eq("business_id", businessId).eq("source_run_id", runId)
      .eq("materialization_id", storage.materialization_id)
      .eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION)
      .eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION)
      .limit(Math.max(storage.measurement_count, 1));
    const confirmedIds = new Set((targetFacts ?? [])
      .filter((row) => row.facts && typeof row.facts === "object" &&
        !Array.isArray(row.facts) && row.facts["targetSeen"] === true)
      .map((row) => row.measurement_id));
    if (!factError && targetFacts?.length === storage.measurement_count &&
      confirmedIds.size === report.overview.confirmedMentionCount) {
      const { data: pages, error: pagesError } = await supabaseAdmin
        .from("citation_page_entity_verifications")
        .select("measurement_id,canonical_url,domain,citation_title,page_title,confidence,evidence")
        .eq("org_id", orgId).eq("business_id", businessId).eq("source_run_id", runId)
        .eq("verifier_version", ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION)
        .eq("verification_status", "confirmed").limit(1000);
      if (!pagesError) {
        const urls = new Map<string, {
          domain: string; title: string | null; ids: Set<string>; count: number;
          confidence: "high" | "medium";
        }>();
        for (const page of pages ?? []) {
          if (!confirmedIds.has(page.measurement_id)) continue;
          const url = typeof page.canonical_url === "string" ? page.canonical_url.trim() : "";
          if (!/^https?:\/\//iu.test(url)) continue;
          const domain = typeof page.domain === "string" ? page.domain.trim() : "";
          if (!domain) continue;
          const item = urls.get(url) ?? {
            domain, title: page.page_title?.trim() || page.citation_title?.trim() || null,
            ids: new Set<string>(), count: 0, confidence: "medium" as const,
          };
          item.ids.add(page.measurement_id);
          item.count += 1;
          if (page.confidence === "high") item.confidence = "high";
          urls.set(url, item);
        }
        report.verifiedTargetCitationPages = [...urls.entries()].map(([sampleUrl, v]) => ({
          domain: v.domain, title: v.title, responseCount: v.ids.size,
          citationCount: v.count, sampleUrl, confidence: v.confidence,
          basisLabel: "관련성 검증 완료",
        })).sort((a, b) => b.responseCount - a.responseCount || a.domain.localeCompare(b.domain));
        report.verifiedTargetCitationPageStatus = "complete";
      } else report.verifiedTargetCitationPageStatus = "pending";
    } else report.verifiedTargetCitationPageStatus = "pending";
  } else {
    const { data: triggered, error } = await supabaseAdmin.from("system_events")
      .select("id").eq("org_id", orgId).eq("run_id", runId)
      .eq("event_type", "citation_page_entity_verification_triggered")
      .eq("metadata->>verifier_version", ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION)
      .limit(1).maybeSingle();
    if (error || triggered) report.verifiedTargetCitationPageStatus = "pending";
  }

  return report;
}

export async function fetchMeasurementHistoryDetail(args: {
  orgId: string; businessId: string; runId: string;
}): Promise<MeasurementHistoryDetailResponse> {
  const { orgId, businessId, runId } = args;
  if (![orgId, businessId, runId].every((id) => isUuid(id))) {
    return { ok: false, error: "NOT_AVAILABLE" };
  }
  const report = await assembleHistoryV2Report(args);
  return report
    ? { ok: true, data: { orgId, businessId, runId, report } }
    : { ok: false, error: "NOT_AVAILABLE" };
}
