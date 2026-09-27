import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "@/lib/customer-measurement.helpers";
import { UNIFIED_DIAGNOSTIC_SET_PREFIX } from "@/lib/custom-question-suggestions";
import {
  buildUnifiedDiagnosticLayerSummary,
  confirmedRatePct,
  type UnifiedDiagnosticLayerMetric,
} from "@/lib/unified-diagnostic-layer-summary";
import {
  ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
  ENTITY_FACTS_V2_READ_ENGINE_VERSION,
  ENTITY_FACTS_V2_READ_FACT_VERSION,
  parseEntityFactsV2AggregateForReadGateway,
  type EntityFactsV2ReadBusinessDTO,
  type ParsedEntityFactsV2Aggregate,
} from "./entity-facts-v2-read-gateway.types";
import {
  buildEntityFactsV2MetricComparison,
  ENTITY_FACTS_V2_COMPARISON_VERSION,
  isEntityFactsV2TrendEligible,
  type EntityFactsV2ComparisonDTO,
  type EntityFactsV2ComparisonMetricSnapshot,
  type EntityFactsV2ComparisonResponse,
  type EntityFactsV2ComparisonRunPointDTO,
} from "./entity-facts-v2-comparison.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REQUEST_FINGERPRINT_RE = /^[0-9a-f]{64}$/u;
const PRIOR_RUN_SCAN_LIMIT = 20;
const SERIES_LIMIT = 6;

type RunRow = Pick<
  Database["public"]["Tables"]["measurement_runs"]["Row"],
  | "id"
  | "question_set_id"
  | "selected_providers"
  | "repetitions"
  | "data_origin"
  | "total_jobs"
  | "completed_jobs"
  | "failed_jobs"
  | "completed_at"
  | "created_at"
>;

type JobRow = Pick<
  Database["public"]["Tables"]["measurement_jobs"]["Row"],
  | "id"
  | "run_id"
  | "question_id"
  | "provider"
  | "provider_model"
  | "repetition_no"
  | "status"
>;

type MeasurementParserRow = Pick<
  Database["public"]["Tables"]["measurements"]["Row"],
  "run_id" | "job_id" | "parser_version"
>;

type RequestContractRow = Pick<
  Database["public"]["Tables"]["measurement_request_contracts"]["Row"],
  "job_id" | "request_fingerprint"
>;

type AggregateStorageRow = Pick<
  Database["public"]["Tables"]["run_entity_fact_aggregates_v2"]["Row"],
  | "source_run_id"
  | "measurement_count"
  | "valid_measurement_count"
  | "aggregate"
>;

type AggregateSnapshot = {
  measurementCount: number;
  validMeasurementCount: number;
  parsed: ParsedEntityFactsV2Aggregate;
};

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

function unavailableComparison(args: {
  business: EntityFactsV2ReadBusinessDTO;
  reason: "NO_CURRENT_CUSTOMER_RUN" | "CURRENT_V2_UNAVAILABLE";
}): EntityFactsV2ComparisonDTO {
  return {
    version: ENTITY_FACTS_V2_COMPARISON_VERSION,
    generatedAt: new Date().toISOString(),
    business: args.business,
    status: "unavailable",
    reason: args.reason,
    comparisonBasis: "durable_request_fingerprint",
    compatibleRunCount: 0,
    trendEligible: false,
    currentRun: null,
    previousRun: null,
    series: [],
    visibility: null,
    top3: null,
  };
}

function groupByRun<T extends { run_id: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = out.get(row.run_id) ?? [];
    bucket.push(row);
    out.set(row.run_id, bucket);
  }
  return out;
}

function parseAggregateSnapshot(
  rows: readonly AggregateStorageRow[],
): AggregateSnapshot | null {
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  const parsed = parseEntityFactsV2AggregateForReadGateway(row.aggregate);
  if (!parsed) return null;
  if (
    row.measurement_count !== parsed.overview.measurementCount ||
    row.valid_measurement_count !== parsed.overview.validCount
  ) {
    return null;
  }
  return {
    measurementCount: row.measurement_count,
    validMeasurementCount: row.valid_measurement_count,
    parsed,
  };
}

function metricSnapshots(
  aggregate: ParsedEntityFactsV2Aggregate,
): {
  visibility: EntityFactsV2ComparisonMetricSnapshot;
  top3: EntityFactsV2ComparisonMetricSnapshot;
} {
  const overview = aggregate.overview;
  return {
    visibility: {
      validCount: overview.validCount,
      confirmedCount: overview.confirmedMentionCount,
      unresolvedCount: overview.unresolvedTargetCount,
      confirmedPct: overview.visibilityLowerBoundPct,
      maxPct: overview.visibilityUpperBoundPct,
    },
    top3: {
      validCount: overview.validCount,
      confirmedCount: overview.confirmedTop3Count,
      unresolvedCount: overview.top3UncertainCount,
      confirmedPct: overview.top3LowerBoundPct,
      maxPct: overview.top3UpperBoundPct,
    },
  };
}

function roundPct(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function layerMetricSnapshot(
  metric: UnifiedDiagnosticLayerMetric,
): EntityFactsV2ComparisonMetricSnapshot {
  const confirmedPct = confirmedRatePct(metric);
  const maxPct =
    metric.validCount > 0
      ? roundPct(
          ((metric.confirmedCount + metric.unresolvedCount) / metric.validCount) * 100,
        )
      : null;

  return {
    validCount: metric.validCount,
    confirmedCount: metric.confirmedCount,
    unresolvedCount: metric.unresolvedCount,
    confirmedPct,
    maxPct,
  };
}

function questionChangeCounts(
  current: ParsedEntityFactsV2Aggregate["questionAreas"],
  previous: ParsedEntityFactsV2Aggregate["questionAreas"],
): {
  newlyConfirmedQuestionCount: number;
  noLongerConfirmedQuestionCount: number;
} | null {
  if (current.length !== 24 || previous.length !== 24) return null;

  const previousById = new Map(previous.map((row) => [row.questionId, row]));
  if (previousById.size !== previous.length) return null;

  let newlyConfirmedQuestionCount = 0;
  let noLongerConfirmedQuestionCount = 0;

  for (const row of current) {
    const prior = previousById.get(row.questionId);
    if (!prior) return null;

    const currentConfirmed = row.confirmedMentionCount > 0;
    const previousConfirmed = prior.confirmedMentionCount > 0;
    if (currentConfirmed && !previousConfirmed) newlyConfirmedQuestionCount += 1;
    if (!currentConfirmed && previousConfirmed) noLongerConfirmedQuestionCount += 1;
  }

  return { newlyConfirmedQuestionCount, noLongerConfirmedQuestionCount };
}

function runPoint(
  run: RunRow,
  aggregate: ParsedEntityFactsV2Aggregate,
): EntityFactsV2ComparisonRunPointDTO {
  const metrics = metricSnapshots(aggregate);
  return {
    runId: run.id,
    measuredAt: run.completed_at ?? run.created_at,
    visibility: metrics.visibility,
    top3: metrics.top3,
  };
}

/**
 * Build a private comparison signature.
 *
 * Missing durable request fingerprints are never inferred from historical jobs,
 * question text, model names, or other nearby evidence. A run without a complete
 * request contract is intentionally not comparable.
 */
function verifiedRunContractSignature(args: {
  run: RunRow;
  aggregate: AggregateSnapshot;
  jobs: readonly JobRow[];
  measurements: readonly MeasurementParserRow[];
  requestContractByJobId: ReadonlyMap<string, string>;
}): string | null {
  const { run, aggregate, jobs, measurements, requestContractByJobId } = args;

  if (
    run.total_jobs <= 0 ||
    run.completed_jobs !== run.total_jobs ||
    run.failed_jobs !== 0 ||
    jobs.length !== run.total_jobs ||
    aggregate.measurementCount !== run.total_jobs ||
    measurements.length !== run.total_jobs ||
    jobs.some((job) => job.status !== "completed")
  ) {
    return null;
  }

  const measurementJobIds = new Set(measurements.map((row) => row.job_id));
  if (measurementJobIds.size !== measurements.length) return null;
  if (jobs.some((job) => !measurementJobIds.has(job.id))) return null;

  const jobContract = jobs
    .map((job) => {
      const requestFingerprint = requestContractByJobId.get(job.id);
      if (
        !requestFingerprint ||
        !REQUEST_FINGERPRINT_RE.test(requestFingerprint)
      ) {
        return null;
      }
      return {
        questionId: job.question_id,
        provider: String(job.provider),
        providerModel: job.provider_model,
        repetitionNo: job.repetition_no,
        requestFingerprint,
      };
    });

  if (jobContract.some((item) => item === null)) return null;

  const parserVersions = [
    ...new Set(measurements.map((row) => row.parser_version)),
  ].sort();

  const sortedJobs = jobContract
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (a, b) =>
        a.questionId.localeCompare(b.questionId) ||
        a.provider.localeCompare(b.provider) ||
        a.providerModel.localeCompare(b.providerModel) ||
        a.repetitionNo - b.repetitionNo,
    );

  return JSON.stringify({
    questionSetId: run.question_set_id,
    selectedProviders: [...run.selected_providers].map(String).sort(),
    repetitions: run.repetitions,
    dataOrigin: run.data_origin,
    totalJobs: run.total_jobs,
    measurementCount: aggregate.measurementCount,
    parserVersions,
    v2: {
      factVersion: ENTITY_FACTS_V2_READ_FACT_VERSION,
      aggregateVersion: ENTITY_FACTS_V2_READ_AGGREGATE_VERSION,
      engineVersion: ENTITY_FACTS_V2_READ_ENGINE_VERSION,
    },
    jobs: sortedJobs,
  });
}

export async function fetchEntityFactsV2Comparison(args: {
  orgId: string;
  businessId: string;
}): Promise<EntityFactsV2ComparisonResponse> {
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

  // Keep current-run selection exactly aligned with the v2 customer dashboard.
  // A prepared unified set becomes representative only after its first completed run.
  const { data: currentUnifiedSet, error: unifiedSetError } = await supabaseAdmin
    .from("question_sets")
    .select("id")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("active", true)
    .like("name", `${UNIFIED_DIAGNOSTIC_SET_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (unifiedSetError) return { ok: false, error: "INTERNAL_ERROR" };

  const baseCurrentRunQuery = () =>
    supabaseAdmin
      .from("measurement_runs")
      .select(
        "id, question_set_id, selected_providers, repetitions, data_origin, total_jobs, completed_jobs, failed_jobs, completed_at, created_at",
      )
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .eq("diagnostic_scope", "customer")
      .eq("status", "completed")
      .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)
      .is("experiment_id", null);

  let currentRun: RunRow | null = null;
  if (currentUnifiedSet) {
    const { data: unifiedRun, error: unifiedRunError } = await baseCurrentRunQuery()
      .eq("question_set_id", currentUnifiedSet.id)
      .order("completed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (unifiedRunError) return { ok: false, error: "INTERNAL_ERROR" };
    currentRun = unifiedRun;
  }

  if (!currentRun) {
    const { data: previousRepresentativeRun, error: previousRunError } =
      await baseCurrentRunQuery()
        .order("completed_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (previousRunError) return { ok: false, error: "INTERNAL_ERROR" };
    currentRun = previousRepresentativeRun;
  }
  if (!currentRun) {
    return {
      ok: true,
      data: unavailableComparison({
        business: businessDTO,
        reason: "NO_CURRENT_CUSTOMER_RUN",
      }),
    };
  }

  const { data: priorRuns, error: priorRunsError } = await supabaseAdmin
    .from("measurement_runs")
    .select(
      "id, question_set_id, selected_providers, repetitions, data_origin, total_jobs, completed_jobs, failed_jobs, completed_at, created_at",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("question_set_id", currentRun.question_set_id)
    .eq("run_type", "audit")
    .eq("phase", "standalone")
    .eq("diagnostic_scope", "customer")
    .eq("status", "completed")
    .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)
    .is("experiment_id", null)
    .neq("id", currentRun.id)
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PRIOR_RUN_SCAN_LIMIT);

  if (priorRunsError) return { ok: false, error: "INTERNAL_ERROR" };

  const allRuns: RunRow[] = [currentRun, ...(priorRuns ?? [])];
  const runIds = allRuns.map((run) => run.id);

  const { data: aggregateRows, error: aggregateError } = await supabaseAdmin
    .from("run_entity_fact_aggregates_v2")
    .select(
      "source_run_id, measurement_count, valid_measurement_count, aggregate",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .in("source_run_id", runIds)
    .eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION)
    .eq("aggregate_version", ENTITY_FACTS_V2_READ_AGGREGATE_VERSION)
    .eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION)
    .eq("contract_ok", true);

  if (aggregateError) return { ok: false, error: "INTERNAL_ERROR" };

  const aggregateRowsByRun = new Map<string, AggregateStorageRow[]>();
  for (const row of aggregateRows ?? []) {
    const bucket = aggregateRowsByRun.get(row.source_run_id) ?? [];
    bucket.push(row);
    aggregateRowsByRun.set(row.source_run_id, bucket);
  }

  // Fail closed on the exact representative run. Never fall back to an older
  // materialized run when the current customer run has no valid v2 aggregate.
  const currentAggregateRows = aggregateRowsByRun.get(currentRun.id) ?? [];
  if (currentAggregateRows.length === 0) {
    return {
      ok: true,
      data: unavailableComparison({
        business: businessDTO,
        reason: "CURRENT_V2_UNAVAILABLE",
      }),
    };
  }
  const currentAggregate = parseAggregateSnapshot(currentAggregateRows);
  if (!currentAggregate) return { ok: false, error: "INVALID_V2_DATA" };

  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from("measurement_jobs")
    .select(
      "id, run_id, question_id, provider, provider_model, repetition_no, status",
    )
    .eq("org_id", orgId)
    .in("run_id", runIds);

  if (jobsError) return { ok: false, error: "INTERNAL_ERROR" };

  const jobIds = (jobs ?? []).map((job) => job.id);
  let requestContracts: RequestContractRow[] = [];
  if (jobIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("measurement_request_contracts")
      .select("job_id, request_fingerprint")
      .eq("org_id", orgId)
      .in("job_id", jobIds);
    if (error) return { ok: false, error: "INTERNAL_ERROR" };
    requestContracts = data ?? [];
  }

  // Parser version is comparison metadata only. Legacy visibility truth fields
  // such as was_client_mentioned/client_position are deliberately never read.
  const { data: measurementParsers, error: measurementParserError } =
    await supabaseAdmin
      .from("measurements")
      .select("run_id, job_id, parser_version")
      .eq("org_id", orgId)
      .in("run_id", runIds);

  if (measurementParserError) {
    return { ok: false, error: "INTERNAL_ERROR" };
  }

  const jobsByRun = groupByRun<JobRow>(jobs ?? []);
  const measurementsByRun = groupByRun<MeasurementParserRow>(
    measurementParsers ?? [],
  );
  const requestContractByJobId = new Map(
    requestContracts.map((row) => [row.job_id, row.request_fingerprint]),
  );

  const currentSignature = verifiedRunContractSignature({
    run: currentRun,
    aggregate: currentAggregate,
    jobs: jobsByRun.get(currentRun.id) ?? [],
    measurements: measurementsByRun.get(currentRun.id) ?? [],
    requestContractByJobId,
  });

  const currentPoint = runPoint(currentRun, currentAggregate.parsed);
  const currentMetrics = metricSnapshots(currentAggregate.parsed);

  // Never infer missing historical request contracts.
  if (!currentSignature) {
    return {
      ok: true,
      data: {
        version: ENTITY_FACTS_V2_COMPARISON_VERSION,
        generatedAt: new Date().toISOString(),
        business: businessDTO,
        status: "unverified",
        reason: "CURRENT_REQUEST_CONTRACT_UNAVAILABLE",
        comparisonBasis: "durable_request_fingerprint",
        compatibleRunCount: 0,
        trendEligible: false,
        currentRun: currentPoint,
        previousRun: null,
        series: [],
        visibility: buildEntityFactsV2MetricComparison(
          currentMetrics.visibility,
          null,
        ),
        top3: buildEntityFactsV2MetricComparison(currentMetrics.top3, null),
      },
    };
  }

  const compatiblePrior: Array<{
    run: RunRow;
    aggregate: AggregateSnapshot;
  }> = [];

  for (const run of priorRuns ?? []) {
    const priorAggregateRows = aggregateRowsByRun.get(run.id) ?? [];
    const priorAggregate = parseAggregateSnapshot(priorAggregateRows);
    if (!priorAggregate) continue;

    const signature = verifiedRunContractSignature({
      run,
      aggregate: priorAggregate,
      jobs: jobsByRun.get(run.id) ?? [],
      measurements: measurementsByRun.get(run.id) ?? [],
      requestContractByJobId,
    });
    if (!signature || signature !== currentSignature) continue;
    compatiblePrior.push({ run, aggregate: priorAggregate });
  }

  if (compatiblePrior.length === 0) {
    return {
      ok: true,
      data: {
        version: ENTITY_FACTS_V2_COMPARISON_VERSION,
        generatedAt: new Date().toISOString(),
        business: businessDTO,
        status: "single",
        reason: "NO_COMPATIBLE_PRIOR_RUN",
        comparisonBasis: "durable_request_fingerprint",
        compatibleRunCount: 1,
        trendEligible: false,
        currentRun: currentPoint,
        previousRun: null,
        series: [currentPoint],
        visibility: buildEntityFactsV2MetricComparison(
          currentMetrics.visibility,
          null,
        ),
        top3: buildEntityFactsV2MetricComparison(currentMetrics.top3, null),
      },
    };
  }

  const previous = compatiblePrior[0]!;
  const previousPoint = runPoint(previous.run, previous.aggregate.parsed);
  const previousMetrics = metricSnapshots(previous.aggregate.parsed);

  let searchScope: NonNullable<EntityFactsV2ComparisonDTO["searchScope"]> | null = null;
  if (currentUnifiedSet?.id === currentRun.question_set_id) {
    const questionIds = currentAggregate.parsed.questionAreas.map((row) => row.questionId);
    if (questionIds.length === 24 && new Set(questionIds).size === 24) {
      const { data: questionLocationRows, error: questionLocationError } =
        await supabaseAdmin
          .from("questions")
          .select("id, city")
          .eq("org_id", orgId)
          .eq("question_set_id", currentRun.question_set_id)
          .in("id", questionIds);

      // Search-scope detail is supplemental. Never block the verified overall comparison.
      if (!questionLocationError && (questionLocationRows ?? []).length === 24) {
        const questionLocations = (questionLocationRows ?? []).map((row) => ({
          questionId: row.id,
          city: row.city ?? null,
        }));
        const currentLayerSummary = buildUnifiedDiagnosticLayerSummary({
          questionAreas: currentAggregate.parsed.questionAreas,
          questionLocations,
          overview: currentAggregate.parsed.overview,
        });
        const previousLayerSummary = buildUnifiedDiagnosticLayerSummary({
          questionAreas: previous.aggregate.parsed.questionAreas,
          questionLocations,
          overview: previous.aggregate.parsed.overview,
        });
        const questionChanges = questionChangeCounts(
          currentAggregate.parsed.questionAreas,
          previous.aggregate.parsed.questionAreas,
        );

        if (currentLayerSummary && previousLayerSummary && questionChanges) {
          searchScope = {
            custom: buildEntityFactsV2MetricComparison(
              layerMetricSnapshot(currentLayerSummary.custom),
              layerMetricSnapshot(previousLayerSummary.custom),
            ),
            core: buildEntityFactsV2MetricComparison(
              layerMetricSnapshot(currentLayerSummary.core),
              layerMetricSnapshot(previousLayerSummary.core),
            ),
            ...questionChanges,
          };
        }
      }
    }
  }

  const compatibleRunCount = compatiblePrior.length + 1;

  const priorSeries = compatiblePrior
    .slice(0, SERIES_LIMIT - 1)
    .map((item) => runPoint(item.run, item.aggregate.parsed))
    .reverse();
  const series = [...priorSeries, currentPoint];

  return {
    ok: true,
    data: {
      version: ENTITY_FACTS_V2_COMPARISON_VERSION,
      generatedAt: new Date().toISOString(),
      business: businessDTO,
      status: "verified",
      reason: "VERIFIED",
      comparisonBasis: "durable_request_fingerprint",
      compatibleRunCount,
      trendEligible: isEntityFactsV2TrendEligible(compatibleRunCount),
      currentRun: currentPoint,
      previousRun: previousPoint,
      series,
      visibility: buildEntityFactsV2MetricComparison(
        currentMetrics.visibility,
        previousMetrics.visibility,
      ),
      top3: buildEntityFactsV2MetricComparison(
        currentMetrics.top3,
        previousMetrics.top3,
      ),
      searchScope,
    },
  };
}
