import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
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

type EntityFactsV2Database = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      run_entity_fact_aggregates_v2: {
        Row: EntityFactsV2AggregateStorageRow;
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
    .eq("status", "completed")
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
      "source_run_id, fact_version, aggregate_version, engine_version, measurement_count, valid_measurement_count, contract_ok, aggregate",
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
  const aggregate = parseEntityFactsV2AggregateForReadGateway(storage.aggregate);

  if (
    storage.source_run_id !== run.id ||
    storage.fact_version !== ENTITY_FACTS_V2_READ_FACT_VERSION ||
    storage.aggregate_version !== ENTITY_FACTS_V2_READ_AGGREGATE_VERSION ||
    storage.engine_version !== ENTITY_FACTS_V2_READ_ENGINE_VERSION ||
    storage.contract_ok !== true ||
    !aggregate ||
    aggregate.overview.measurementCount !== storage.measurement_count ||
    aggregate.overview.validCount !== storage.valid_measurement_count
  ) {
    return {
      ok: false,
      error: "INVALID_V2_DATA",
      business: businessDTO,
      runId: run.id,
    };
  }

  const competitorBusinessIds = [
    ...new Set(
      aggregate.competitors
        .map((item) => businessIdFromCanonicalKey(item.canonicalKey))
        .filter(
          (id): id is string => id !== null && id !== businessId,
        ),
    ),
  ];

  const competitorNameById = new Map<string, string>();
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
        competitorNameById.set(item.id, item.name.trim());
      }
    }
  }

  const competitors: EntityFactsV2ReadCompetitorDTO[] = [];
  for (const item of aggregate.competitors) {
    const competitorBusinessId = businessIdFromCanonicalKey(item.canonicalKey);
    if (!competitorBusinessId || competitorBusinessId === businessId) continue;
    const name = competitorNameById.get(competitorBusinessId);
    if (!name) continue;
    competitors.push({
      name,
      responseCount: item.responseCount,
      questionCount: item.questionCount,
      intentCount: item.intentCount,
      top3ResponseCount: item.top3ResponseCount,
    });
  }

  return {
    ok: true,
    data: {
      gatewayVersion: ENTITY_FACTS_V2_READ_GATEWAY_VERSION,
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
      overview: aggregate.overview,
      questionGroups: aggregate.questionGroups,
      questionAreas: aggregate.questionAreas,
      competitors,
      targetSources: aggregate.targetSources,
    },
  };
}
