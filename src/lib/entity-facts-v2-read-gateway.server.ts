import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "@/lib/customer-measurement.helpers";
import { UNIFIED_DIAGNOSTIC_SET_PREFIX } from "@/lib/custom-question-suggestions";
import { buildEntityFactsV2ReadGatewayFromSnapshot } from "./entity-facts-v2-read-gateway.build";
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
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
  pickEntityFactsV2AutoCompetitorDisplayName,
  type EntityFactsV2CompetitorDisplayEvidence,
  type EntityFactsV2ReadBusinessDTO,
  type EntityFactsV2ReadCitationSourceDTO,
  type EntityFactsV2ReadCompetitorDTO,
  type EntityFactsV2ReadTargetReferenceSourceDTO,
  type EntityFactsV2ReadGatewayResponse,
} from "./entity-facts-v2-read-gateway.types";

function jsonObject(value: Json | null): Record<string, Json> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function distanceCharsFromEvidence(value: Json | null): number | null {
  const evidence = jsonObject(value);
  const raw = evidence?.["distance_chars"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSourceDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^www\./u, "");
}

function infrastructureSourceHost(domain: string): boolean {
  return (
    domain === "s3.amazonaws.com" ||
    domain.endsWith(".s3.amazonaws.com") ||
    /\.s3[.-][^.]+\.amazonaws\.com$/u.test(domain) ||
    domain === "storage.googleapis.com" ||
    domain.endsWith(".blob.core.windows.net") ||
    domain.endsWith(".r2.cloudflarestorage.com") ||
    domain.endsWith(".digitaloceanspaces.com")
  );
}

type EntityFactsV2AggregateStorageRow = {
  id: string;
  materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  fact_version: string;
  aggregate_version: string;
  engine_version: string;
  input_fingerprint: string;
  measurement_count: number;
  valid_measurement_count: number;
  contract_ok: boolean;
  aggregate: Json;
  aggregate_hash: string;
  created_at: string;
};

type EntityFactsV2ObservedSourceStorageRow = {
  id: string;
  base_aggregate_id: string;
  base_materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  observed_sources_version: string;
  source_replay_version: string;
  engine_version: string;
  input_fingerprint: string;
  observed_sources: Json;
  observed_sources_hash: string;
  created_at: string;
};

type EntityFactsV2CompetitorSourceClueStorageRow = {
  id: string;
  base_aggregate_id: string;
  base_observed_source_aggregate_id: string;
  base_materialization_id: string;
  org_id: string;
  business_id: string;
  source_run_id: string;
  clue_version: string;
  source_replay_version: string;
  engine_version: string;
  input_fingerprint: string;
  source_clues: Json;
  source_clues_hash: string;
  created_at: string;
};

type ReadGatewayRunRow = Pick<
  Database["public"]["Tables"]["measurement_runs"]["Row"],
  | "id"
  | "name"
  | "question_set_id"
  | "completed_at"
  | "created_at"
  | "repetitions"
  | "selected_providers"
  | "total_jobs"
  | "completed_jobs"
  | "failed_jobs"
>;

type EntityFactsV2Database = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      run_entity_fact_aggregates_v2: {
        Row: EntityFactsV2AggregateStorageRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      run_observed_source_aggregates_v2: {
        Row: EntityFactsV2ObservedSourceStorageRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      run_competitor_source_clue_aggregates_v2: {
        Row: EntityFactsV2CompetitorSourceClueStorageRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
  };
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function asBusinessDTO(value: {
  id: string;
  name: string;
  category: string;
  region: string | null;
  city: string | null;
}): EntityFactsV2ReadBusinessDTO {
  return {
    id: value.id,
    name: value.name,
    category: value.category ?? null,
    region: value.region ?? null,
    city: value.city ?? null,
  };
}

function businessIdFromCanonicalKey(value: string): string | null {
  if (!value.startsWith("business:")) return null;
  const id = value.slice("business:".length).trim().toLowerCase();
  return UUID_RE.test(id) ? id : null;
}

export async function fetchEntityFactsV2ReadGateway(args: {
  orgId: string;
  businessId: string;
}): Promise<EntityFactsV2ReadGatewayResponse> {
  const orgId = args.orgId.trim().toLowerCase();
  const businessId = args.businessId.trim().toLowerCase();
  if (!UUID_RE.test(orgId) || !UUID_RE.test(businessId)) {
    return { ok: false, error: "BUSINESS_NOT_AVAILABLE" };
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id, name, category, region, city")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .eq("is_client_business", true)
    .eq("active", true)
    .maybeSingle();

  if (businessError) return { ok: false, error: "INTERNAL_ERROR" };
  if (!business) return { ok: false, error: "BUSINESS_NOT_AVAILABLE" };

  const businessDTO = asBusinessDTO(business);

  // The newest active unified set is the next customer diagnostic contract.
  // Until that exact set has a completed run, keep the last completed 24-question
  // representative visible without relabeling it as unified.
  const { data: currentUnifiedSet, error: unifiedSetError } = await supabaseAdmin
    .from("question_sets")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("active", true)
    .like("name", `${UNIFIED_DIAGNOSTIC_SET_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (unifiedSetError) {
    return { ok: false, error: "INTERNAL_ERROR", business: businessDTO };
  }

  const baseRunQuery = () =>
    supabaseAdmin
      .from("measurement_runs")
      .select(
        "id, name, question_set_id, completed_at, created_at, repetitions, selected_providers, total_jobs, completed_jobs, failed_jobs",
      )
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .eq("diagnostic_scope", "customer")
      .eq("status", "completed")
      .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)
      .is("experiment_id", null);

  // A newly created unified set does not erase the last representative result.
  // Switch only after that exact unified set has a completed customer run.
  let run: ReadGatewayRunRow | null = null;
  if (currentUnifiedSet) {
    const { data: unifiedRun, error: unifiedRunError } = await baseRunQuery()
      .eq("question_set_id", currentUnifiedSet.id)
      .order("completed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (unifiedRunError) {
      return { ok: false, error: "INTERNAL_ERROR", business: businessDTO };
    }
    run = unifiedRun;
  }

  if (!run) {
    const { data: previousRepresentativeRun, error: previousRunError } =
      await baseRunQuery()
        .order("completed_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (previousRunError) {
      return { ok: false, error: "INTERNAL_ERROR", business: businessDTO };
    }
    run = previousRepresentativeRun;
  }

  if (!run) return { ok: false, error: "NO_V2_DATA", business: businessDTO };

  const { data: questionSet, error: questionSetError } = await supabaseAdmin
    .from("question_sets")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("id", run.question_set_id)
    .maybeSingle();
  if (questionSetError) {
    return { ok: false, error: "INTERNAL_ERROR", business: businessDTO, runId: run.id };
  }

  const v2Admin =
    supabaseAdmin as unknown as SupabaseClient<EntityFactsV2Database>;

  // Fail closed: the gateway only accepts v2 materialization for the exact
  // representative run. It never falls back to an older materialized run.
  const { data: aggregateRows, error: aggregateError } = await v2Admin
    .from("run_entity_fact_aggregates_v2")
    .select(
      "id, materialization_id, source_run_id, fact_version, aggregate_version, engine_version, measurement_count, valid_measurement_count, contract_ok, aggregate",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("source_run_id", run.id)
    .eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION)
    .eq("aggregate_version", ENTITY_FACTS_V2_READ_AGGREGATE_VERSION)
    .eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION)
    .eq("contract_ok", true)
    .limit(2);

  if (aggregateError) {
    return {
      ok: false,
      error: "INTERNAL_ERROR",
      business: businessDTO,
      runId: run.id,
    };
  }

  if (!aggregateRows || aggregateRows.length === 0) {
    return {
      ok: false,
      error: "NO_V2_DATA",
      business: businessDTO,
      runId: run.id,
    };
  }

  if (aggregateRows.length !== 1) {
    return {
      ok: false,
      error: "INVALID_V2_DATA",
      business: businessDTO,
      runId: run.id,
    };
  }

  const storage = aggregateRows[0]!;
  const aggregateForResolution =
    parseEntityFactsV2AggregateForReadGateway(storage.aggregate);

  if (!aggregateForResolution) {
    return {
      ok: false,
      error: "INVALID_V2_DATA",
      business: businessDTO,
      runId: run.id,
    };
  }

  const { data: observedRows, error: observedError } = await v2Admin
    .from("run_observed_source_aggregates_v2")
    .select(
      "id, base_aggregate_id, base_materialization_id, source_run_id, observed_sources_version, source_replay_version, engine_version, observed_sources",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("source_run_id", run.id)
    .eq("base_aggregate_id", storage.id)
    .eq("observed_sources_version", ENTITY_FACTS_V2_OBSERVED_SOURCES_VERSION)
    .eq(
      "source_replay_version",
      ENTITY_FACTS_V2_OBSERVED_SOURCES_SOURCE_REPLAY_VERSION,
    )
    .eq("engine_version", ENTITY_FACTS_V2_OBSERVED_SOURCES_ENGINE_VERSION)
    .limit(2);

  if (observedError) {
    return {
      ok: false,
      error: "INTERNAL_ERROR",
      business: businessDTO,
      runId: run.id,
    };
  }

  if (observedRows && observedRows.length > 1) {
    return {
      ok: false,
      error: "INVALID_V2_DATA",
      business: businessDTO,
      runId: run.id,
    };
  }

  const observedStorage = observedRows?.[0] ?? null;

  let clueStorage: EntityFactsV2CompetitorSourceClueStorageRow | null = null;
  if (observedStorage) {
    const { data: clueRows, error: clueError } = await v2Admin
      .from("run_competitor_source_clue_aggregates_v2")
      .select(
        "id, base_observed_source_aggregate_id, base_aggregate_id, base_materialization_id, org_id, business_id, source_run_id, clue_version, source_replay_version, engine_version, input_fingerprint, source_clues, source_clues_hash, created_at",
      )
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("source_run_id", run.id)
      .eq("base_aggregate_id", storage.id)
      .eq("base_observed_source_aggregate_id", observedStorage.id)
      .eq("clue_version", ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_VERSION)
      .eq(
        "source_replay_version",
        ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_SOURCE_REPLAY_VERSION,
      )
      .eq(
        "engine_version",
        ENTITY_FACTS_V2_COMPETITOR_SOURCE_CLUE_ENGINE_VERSION,
      )
      .limit(2);

    if (clueError) {
      return {
        ok: false,
        error: "INTERNAL_ERROR",
        business: businessDTO,
        runId: run.id,
      };
    }

    if (clueRows && clueRows.length > 1) {
      return {
        ok: false,
        error: "INVALID_V2_DATA",
        business: businessDTO,
        runId: run.id,
      };
    }

    clueStorage = clueRows?.[0] ?? null;
  }

  const competitorBusinessIds = [
    ...new Set(
      aggregateForResolution.competitors
        .map((item) => businessIdFromCanonicalKey(item.canonicalKey))
        .filter(
          (id): id is string => id !== null && id !== businessId,
        ),
    ),
  ];

  const registeredCompetitorNames: Record<string, string> = {};
  if (competitorBusinessIds.length > 0) {
    const { data: competitorBusinesses, error: competitorError } =
      await supabaseAdmin
        .from("businesses")
        .select("id, name")
        .eq("org_id", orgId)
        .in("id", competitorBusinessIds);

    if (competitorError) {
      return {
        ok: false,
        error: "INTERNAL_ERROR",
        business: businessDTO,
        runId: run.id,
      };
    }

    for (const item of competitorBusinesses ?? []) {
      if (item.id !== businessId && item.name?.trim()) {
        registeredCompetitorNames[item.id] = item.name.trim();
      }
    }
  }

  const autoCanonicalKeys = [
    ...new Set(
      aggregateForResolution.competitors
        .map((item) => item.canonicalKey.trim())
        .filter((key) => key.startsWith("auto:")),
    ),
  ];

  const autoCompetitorEvidence: Record<
    string,
    EntityFactsV2CompetitorDisplayEvidence[]
  > = {};

  if (autoCanonicalKeys.length > 0) {
    const { data: canonicalizations, error: canonicalizationError } =
      await supabaseAdmin
        .from("measurement_entity_canonicalizations")
        .select(
          "canonical_key, canonical_display_name, measurement_mention_id",
        )
        .eq("org_id", orgId)
        .eq("business_id", businessId)
        .eq("source_run_id", run.id)
        .in("canonical_key", autoCanonicalKeys);

    if (canonicalizationError) {
      return {
        ok: false,
        error: "INTERNAL_ERROR",
        business: businessDTO,
        runId: run.id,
      };
    }

    const mentionIds = [
      ...new Set(
        (canonicalizations ?? [])
          .map((row) => row.measurement_mention_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    const mentionById = new Map<
      string,
      { display_name: string; matched_alias: string | null }
    >();

    if (mentionIds.length > 0) {
      const { data: mentions, error: mentionError } = await supabaseAdmin
        .from("measurement_mentions")
        .select("id, display_name, matched_alias")
        .eq("org_id", orgId)
        .in("id", mentionIds);

      if (mentionError) {
        return {
          ok: false,
          error: "INTERNAL_ERROR",
          business: businessDTO,
          runId: run.id,
        };
      }

      for (const mention of mentions ?? []) {
        mentionById.set(mention.id, {
          display_name: mention.display_name,
          matched_alias: mention.matched_alias,
        });
      }
    }

    for (const row of canonicalizations ?? []) {
      const key = row.canonical_key?.trim();
      if (!key || !autoCanonicalKeys.includes(key)) continue;
      const evidence = autoCompetitorEvidence[key] ?? [];
      evidence.push({
        label: row.canonical_display_name,
        priority: 1,
      });

      const mention = mentionById.get(row.measurement_mention_id);
      if (mention) {
        evidence.push({
          label: mention.matched_alias,
          priority: 2,
        });
        evidence.push({
          label: mention.display_name,
          priority: 3,
        });
      }
      autoCompetitorEvidence[key] = evidence;
    }
  }

  const gatewayResponse = buildEntityFactsV2ReadGatewayFromSnapshot({
    generatedAt: new Date().toISOString(),
    business: businessDTO,
    scope: {
      runId: run.id,
      runName: run.name,
      questionSetId: run.question_set_id,
      questionSetName: questionSet?.name ?? undefined,
      measuredAt: run.completed_at ?? run.created_at,
      providers: Array.isArray(run.selected_providers)
        ? run.selected_providers.map(String)
        : [],
      repetitions: run.repetitions,
      totalJobs: run.total_jobs,
      completedJobs: run.completed_jobs,
      failedJobs: run.failed_jobs,
    },
    storage: {
      aggregateId: storage.id,
      materializationId: storage.materialization_id,
      sourceRunId: storage.source_run_id,
      factVersion: storage.fact_version,
      aggregateVersion: storage.aggregate_version,
      engineVersion: storage.engine_version,
      measurementCount: storage.measurement_count,
      validMeasurementCount: storage.valid_measurement_count,
      contractOk: storage.contract_ok,
      aggregate: storage.aggregate,
    },
    observedSourcesStorage: observedStorage
      ? {
          observedSourceAggregateId: observedStorage.id,
          baseAggregateId: observedStorage.base_aggregate_id,
          baseMaterializationId: observedStorage.base_materialization_id,
          sourceRunId: observedStorage.source_run_id,
          observedSourcesVersion: observedStorage.observed_sources_version,
          sourceReplayVersion: observedStorage.source_replay_version,
          engineVersion: observedStorage.engine_version,
          observedSources: observedStorage.observed_sources,
        }
      : null,
    competitorSourceClueStorage: clueStorage
      ? {
          baseObservedSourceAggregateId:
            clueStorage.base_observed_source_aggregate_id,
          baseAggregateId: clueStorage.base_aggregate_id,
          baseMaterializationId: clueStorage.base_materialization_id,
          sourceRunId: clueStorage.source_run_id,
          clueVersion: clueStorage.clue_version,
          sourceReplayVersion: clueStorage.source_replay_version,
          engineVersion: clueStorage.engine_version,
          sourceClues: clueStorage.source_clues,
        }
      : null,
    registeredCompetitorNames,
    autoCompetitorEvidence,
  });

  if (!gatewayResponse.ok) return gatewayResponse;

  // Supplemental final-answer citation summary for the exact representative run.
  // This is intentionally separate from strict entity-linked observedSources:
  // citationSources answers "what did the AI actually cite?", while observedSources
  // answers "which cited sources were confidently connected to a specific business?".
  // A citation-summary failure must never make an otherwise valid diagnosis unavailable.
  const { data: citationRows, error: citationError } = await supabaseAdmin
    .from("measurement_citations")
    .select("domain, url, measurement_id, measurements!inner(run_id)")
    .eq("org_id", orgId)
    .eq("measurements.run_id", run.id)
    .limit(2000);

  if (!citationError) {
    const byDomain = new Map<
      string,
      {
        measurementIds: Set<string>;
        citationCount: number;
        sampleUrl: string;
      }
    >();

    for (const row of citationRows ?? []) {
      const domain =
        typeof row.domain === "string"
          ? row.domain.trim().toLowerCase().replace(/^www\./u, "")
          : "";
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (!domain || !url || !/^https?:\/\//iu.test(url)) continue;

      const current = byDomain.get(domain) ?? {
        measurementIds: new Set<string>(),
        citationCount: 0,
        sampleUrl: url,
      };
      current.measurementIds.add(row.measurement_id);
      current.citationCount += 1;
      if (!current.sampleUrl) current.sampleUrl = url;
      byDomain.set(domain, current);
    }

    const citationSources: EntityFactsV2ReadCitationSourceDTO[] = [...byDomain.entries()]
      .map(([domain, value]) => ({
        domain,
        responseCount: value.measurementIds.size,
        citationCount: value.citationCount,
        sampleUrl: value.sampleUrl,
      }))
      .sort(
        (a, b) =>
          b.responseCount - a.responseCount ||
          b.citationCount - a.citationCount ||
          a.domain.localeCompare(b.domain, "en"),
      );

    gatewayResponse.data.citationSources = citationSources;
  }

  // Advisory target-link clues: keep close section-level target attribution visible
  // without promoting it into confirmed targetSources. This mirrors the distance
  // boundary used by source replay, but intentionally does NOT relax the repeated
  // evidence rule. Failures here must never block the core dashboard.
  const targetCanonicalKey = `business:${businessId.trim().toLowerCase()}`;
  const confirmedTargetDomains = new Set(
    gatewayResponse.data.targetSources.map((item) => normalizeSourceDomain(item.domain)),
  );
  const { data: targetReferenceRows, error: targetReferenceError } =
    await supabaseAdmin
      .from("measurement_citation_attributions")
      .select("domain, citation_url, measurement_id, attribution_level, evidence, canonical_key")
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("source_run_id", run.id)
      .eq("canonical_key", targetCanonicalKey)
      .eq("attribution_level", "section")
      .limit(1000);

  if (!targetReferenceError) {
    const byDomain = new Map<
      string,
      { measurementIds: Set<string>; sampleUrl: string }
    >();

    for (const row of targetReferenceRows ?? []) {
      const domain = normalizeSourceDomain(row.domain);
      const sampleUrl = typeof row.citation_url === "string" ? row.citation_url.trim() : "";
      const distance = distanceCharsFromEvidence(row.evidence);
      if (
        !domain ||
        confirmedTargetDomains.has(domain) ||
        infrastructureSourceHost(domain) ||
        distance === null ||
        distance > 250 ||
        !/^https?:\/\//iu.test(sampleUrl)
      ) {
        continue;
      }

      const current = byDomain.get(domain) ?? {
        measurementIds: new Set<string>(),
        sampleUrl,
      };
      current.measurementIds.add(row.measurement_id);
      if (!current.sampleUrl) current.sampleUrl = sampleUrl;
      byDomain.set(domain, current);
    }

    const targetReferenceSources: EntityFactsV2ReadTargetReferenceSourceDTO[] =
      [...byDomain.entries()]
        .map(([domain, value]) => ({
          domain,
          responseCount: value.measurementIds.size,
          sampleUrl: value.sampleUrl,
        }))
        .sort(
          (a, b) =>
            b.responseCount - a.responseCount ||
            a.domain.localeCompare(b.domain, "en"),
        );

    gatewayResponse.data.targetReferenceSources = targetReferenceSources;
  }

  // Supplemental question-location metadata powers Core/Custom presentation only.
  // It must never make an otherwise valid diagnosis unavailable.
  const questionIds = gatewayResponse.data.questionAreas.map((item) => item.questionId);
  if (questionIds.length > 0) {
    const { data: questionLocations, error: questionLocationError } =
      await supabaseAdmin
        .from("questions")
        .select("id, city")
        .eq("org_id", orgId)
        .eq("question_set_id", run.question_set_id)
        .in("id", questionIds);

    if (!questionLocationError && (questionLocations ?? []).length === questionIds.length) {
      gatewayResponse.data.questionLocations = (questionLocations ?? []).map((row) => ({
        questionId: row.id,
        city: row.city ?? null,
      }));
    }
  }

  return gatewayResponse;
}
