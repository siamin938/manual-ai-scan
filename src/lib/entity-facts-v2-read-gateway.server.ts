import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "@/lib/customer-measurement.helpers";
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
  type EntityFactsV2ReadCompetitorDTO,
  type EntityFactsV2ReadGatewayResponse,
} from "./entity-facts-v2-read-gateway.types";

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

  // Keep representative-run semantics aligned with the current diagnostic:
  // newest completed standalone audit, excluding experiment runs.
  const { data: run, error: runError } = await supabaseAdmin
    .from("measurement_runs")
    .select(
      "id, name, completed_at, created_at, repetitions, selected_providers, total_jobs, completed_jobs, failed_jobs",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("run_type", "audit")
    .eq("phase", "standalone")
    .eq("diagnostic_scope", "customer")
    .eq("status", "completed")
    .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)
    .is("experiment_id", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) return { ok: false, error: "INTERNAL_ERROR", business: businessDTO };
  if (!run) return { ok: false, error: "NO_V2_DATA", business: businessDTO };

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

  return buildEntityFactsV2ReadGatewayFromSnapshot({
    generatedAt: new Date().toISOString(),
    business: businessDTO,
    scope: {
      runId: run.id,
      runName: run.name,
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
}
