import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  evaluateCrossResponseCompetitorConfirmationShadow,
  type CrossResponseCompetitorShadowDecision,
  type ExistingV2CompetitorShadowEvidence,
} from "./cross-response-competitor-confirmation.shadow";
import {
  classifySourceDomain,
  normalizeSourceDomain,
} from "./source-domain-classifier";
import { parseEntityFactsV2AggregateForReadGateway } from "./entity-facts-v2-read-gateway.types";

export const CROSS_RESPONSE_COMPETITOR_SHADOW_SUPPLEMENT_VERSION = "0.1" as const;

type ShadowCanonicalizationRow = {
  measurement_id: string;
  measurement_mention_id: string;
  canonical_key: string;
  canonical_display_name: string;
};

type ShadowMentionRow = {
  id: string;
  measurement_id: string;
  matched_business_id: string | null;
  display_name: string;
};

type ShadowVerificationRow = {
  measurement_mention_id: string;
  verification_status: string;
  verified_count_as_business: boolean;
};

type ShadowAttributionRow = {
  measurement_id: string;
  canonical_key: string;
  domain: string | null;
  attribution_level: string;
};

export type CrossResponseCompetitorShadowRuntimeInput = {
  sourceRunId: string;
  baseAggregateId: string;
  baseAggregateHash: string;
  aggregate: Json;
  canonicalizations: ShadowCanonicalizationRow[];
  mentions: ShadowMentionRow[];
  verifications: ShadowVerificationRow[];
  attributions: ShadowAttributionRow[];
};

export type CrossResponseCompetitorShadowSupplementRow = {
  canonicalKey: string;
  displayName: string;
  decision: CrossResponseCompetitorShadowDecision;
  responseCount: number;
  corroboratingDomain: string | null;
  corroboratingDomainResponseCount: number;
  directAttributionCount: number;
  sourceDomainClass: ReturnType<typeof classifySourceDomain>["class"];
  collisionCanonicalKeys: string[];
  reasons: string[];
};

export type CrossResponseCompetitorShadowSupplement = {
  version: typeof CROSS_RESPONSE_COMPETITOR_SHADOW_SUPPLEMENT_VERSION;
  sourceRunId: string;
  baseAggregateId: string;
  baseAggregateHash: string;
  affectsTargetMetrics: false;
  counts: {
    alreadyConfirmed: number;
    promoteCandidate: number;
    mergeReview: number;
    rejected: number;
  };
  promotedCandidates: CrossResponseCompetitorShadowSupplementRow[];
  mergeReviewCandidates: CrossResponseCompetitorShadowSupplementRow[];
  allCandidates: CrossResponseCompetitorShadowSupplementRow[];
};

function chooseDisplayName(values: string[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        b[0].length - a[0].length ||
        a[0].localeCompare(b[0], "ko"),
    )[0]?.[0] ?? fallback;
}

type DomainEvidence = {
  domain: string;
  measurementIds: Set<string>;
  directAttributionCount: number;
};

function bestCorroboratingDomain(
  evidence: Map<string, DomainEvidence>,
): DomainEvidence | null {
  const rows = [...evidence.values()].sort((a, b) => {
    const aClass = classifySourceDomain(a.domain);
    const bClass = classifySourceDomain(b.domain);
    return (
      Number(bClass.strongCompetitorIdentityEligible) -
        Number(aClass.strongCompetitorIdentityEligible) ||
      b.measurementIds.size - a.measurementIds.size ||
      b.directAttributionCount - a.directAttributionCount ||
      a.domain.localeCompare(b.domain, "en")
    );
  });
  return rows[0] ?? null;
}

export function buildCrossResponseCompetitorShadowSupplement(
  input: CrossResponseCompetitorShadowRuntimeInput,
): CrossResponseCompetitorShadowSupplement | null {
  const aggregate = parseEntityFactsV2AggregateForReadGateway(input.aggregate);
  if (!aggregate) return null;

  const mentionById = new Map(input.mentions.map((row) => [row.id, row]));
  const verifiedMentionIds = new Set(
    input.verifications
      .filter(
        (row) =>
          row.verification_status === "confirmed_business" &&
          row.verified_count_as_business === true,
      )
      .map((row) => row.measurement_mention_id),
  );

  const candidateGroups = new Map<
    string,
    {
      displayNames: string[];
      measurementIds: Set<string>;
    }
  >();

  for (const canonicalization of input.canonicalizations) {
    const key = canonicalization.canonical_key.trim();
    if (!key.startsWith("auto:")) continue;
    if (!verifiedMentionIds.has(canonicalization.measurement_mention_id)) continue;

    const mention = mentionById.get(canonicalization.measurement_mention_id);
    if (!mention || mention.matched_business_id) continue;

    const group = candidateGroups.get(key) ?? {
      displayNames: [],
      measurementIds: new Set<string>(),
    };
    group.displayNames.push(
      canonicalization.canonical_display_name || mention.display_name,
    );
    group.displayNames.push(mention.display_name);
    group.measurementIds.add(canonicalization.measurement_id);
    candidateGroups.set(key, group);
  }

  const attributionEvidence = new Map<
    string,
    Map<string, DomainEvidence>
  >();
  for (const attribution of input.attributions) {
    const key = attribution.canonical_key?.trim() ?? "";
    if (!key.startsWith("auto:")) continue;
    const domain = normalizeSourceDomain(attribution.domain);
    if (!domain) continue;

    const byDomain = attributionEvidence.get(key) ?? new Map<string, DomainEvidence>();
    const evidence = byDomain.get(domain) ?? {
      domain,
      measurementIds: new Set<string>(),
      directAttributionCount: 0,
    };
    evidence.measurementIds.add(attribution.measurement_id);
    if (attribution.attribution_level === "direct") {
      evidence.directAttributionCount += 1;
    }
    byDomain.set(domain, evidence);
    attributionEvidence.set(key, byDomain);
  }

  const existingV2Competitors: ExistingV2CompetitorShadowEvidence[] =
    aggregate.competitors.map((competitor) => {
      const key = competitor.canonicalKey.trim();
      const group = candidateGroups.get(key);
      const displayName = chooseDisplayName(
        group?.displayNames ?? [],
        key.startsWith("auto:") ? key.slice("auto:".length) : key,
      );
      return {
        canonicalKey: key,
        displayName,
        corroboratingDomains: [
          ...(attributionEvidence.get(key)?.keys() ?? []),
        ].sort((a, b) => a.localeCompare(b, "en")),
      };
    });

  const allCandidates: CrossResponseCompetitorShadowSupplementRow[] = [];

  for (const [canonicalKey, group] of candidateGroups) {
    const displayName = chooseDisplayName(
      group.displayNames,
      canonicalKey.slice("auto:".length),
    );
    const domainEvidence = bestCorroboratingDomain(
      attributionEvidence.get(canonicalKey) ?? new Map(),
    );
    const domain = domainEvidence?.domain ?? null;
    const domainClassification = classifySourceDomain(domain);

    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: {
        canonicalKey,
        displayName,
        verifierConfirmedBusiness: true,
        distinctResponseCount: group.measurementIds.size,
        corroboratingDomain: domain,
        corroboratingDomainResponseCount:
          domainEvidence?.measurementIds.size ?? 0,
        directAttributionCount:
          domainEvidence?.directAttributionCount ?? 0,
      },
      existingV2Competitors,
    });

    allCandidates.push({
      canonicalKey,
      displayName,
      decision: result.decision,
      responseCount: group.measurementIds.size,
      corroboratingDomain: domain,
      corroboratingDomainResponseCount:
        domainEvidence?.measurementIds.size ?? 0,
      directAttributionCount:
        domainEvidence?.directAttributionCount ?? 0,
      sourceDomainClass: domainClassification.class,
      collisionCanonicalKeys: result.collisionCanonicalKeys,
      reasons: result.reasons,
    });
  }

  allCandidates.sort(
    (a, b) =>
      b.responseCount - a.responseCount ||
      a.displayName.localeCompare(b.displayName, "ko") ||
      a.canonicalKey.localeCompare(b.canonicalKey, "en"),
  );

  const count = (decision: CrossResponseCompetitorShadowDecision) =>
    allCandidates.filter((row) => row.decision === decision).length;

  return {
    version: CROSS_RESPONSE_COMPETITOR_SHADOW_SUPPLEMENT_VERSION,
    sourceRunId: input.sourceRunId,
    baseAggregateId: input.baseAggregateId,
    baseAggregateHash: input.baseAggregateHash,
    affectsTargetMetrics: false,
    counts: {
      alreadyConfirmed: count("already_confirmed"),
      promoteCandidate: count("promote_candidate"),
      mergeReview: count("merge_review"),
      rejected: count("reject"),
    },
    promotedCandidates: allCandidates.filter(
      (row) => row.decision === "promote_candidate",
    ),
    mergeReviewCandidates: allCandidates.filter(
      (row) => row.decision === "merge_review",
    ),
    allCandidates,
  };
}

type ShadowAggregateStorageRow = {
  id: string;
  source_run_id: string;
  contract_ok: boolean;
  aggregate: Json;
  aggregate_hash: string;
};

type ShadowDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      run_entity_fact_aggregates_v2: {
        Row: ShadowAggregateStorageRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
  };
};

/**
 * Read-only shadow supplement for one exact completed run.
 *
 * This function never writes storage and is intentionally not wired into any
 * customer-facing DTO. It binds the shadow result to the exact v2 aggregate
 * row used as its baseline.
 */
export async function fetchCrossResponseCompetitorShadowSupplement(args: {
  orgId: string;
  businessId: string;
  runId: string;
}): Promise<CrossResponseCompetitorShadowSupplement | null> {
  const orgId = args.orgId.trim().toLowerCase();
  const businessId = args.businessId.trim().toLowerCase();
  const runId = args.runId.trim().toLowerCase();

  const { data: run, error: runError } = await supabaseAdmin
    .from("measurement_runs")
    .select("id,status,run_type,phase,experiment_id")
    .eq("id", runId)
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (
    runError ||
    !run ||
    run.status !== "completed" ||
    run.run_type !== "audit" ||
    run.phase !== "standalone" ||
    run.experiment_id !== null
  ) {
    return null;
  }

  const v2Admin = supabaseAdmin as unknown as SupabaseClient<ShadowDatabase>;
  const { data: aggregates, error: aggregateError } = await v2Admin
    .from("run_entity_fact_aggregates_v2")
    .select("id,aggregate,aggregate_hash")
    .eq("source_run_id", runId)
    .eq("contract_ok", true)
    .limit(2);

  if (aggregateError || !aggregates || aggregates.length !== 1) return null;
  const aggregate = aggregates[0]!;

  const { data: canonicalizations, error: canonicalizationError } =
    await supabaseAdmin
      .from("measurement_entity_canonicalizations")
      .select(
        "measurement_id,measurement_mention_id,canonical_key,canonical_display_name",
      )
      .eq("org_id", orgId)
      .eq("business_id", businessId)
      .eq("source_run_id", runId);

  if (canonicalizationError) return null;

  const mentionIds = [
    ...new Set(
      (canonicalizations ?? []).map((row) => row.measurement_mention_id),
    ),
  ];
  if (mentionIds.length === 0) {
    return buildCrossResponseCompetitorShadowSupplement({
      sourceRunId: runId,
      baseAggregateId: aggregate.id,
      baseAggregateHash: aggregate.aggregate_hash,
      aggregate: aggregate.aggregate,
      canonicalizations: [],
      mentions: [],
      verifications: [],
      attributions: [],
    });
  }

  const [mentionsResult, verificationsResult, attributionsResult] =
    await Promise.all([
      supabaseAdmin
        .from("measurement_mentions")
        .select("id,measurement_id,matched_business_id,display_name")
        .eq("org_id", orgId)
        .in("id", mentionIds),
      supabaseAdmin
        .from("measurement_entity_verifications")
        .select(
          "measurement_mention_id,verification_status,verified_count_as_business",
        )
        .eq("org_id", orgId)
        .eq("business_id", businessId)
        .in("measurement_mention_id", mentionIds),
      supabaseAdmin
        .from("measurement_citation_attributions")
        .select("measurement_id,canonical_key,domain,attribution_level")
        .eq("org_id", orgId)
        .eq("business_id", businessId)
        .eq("source_run_id", runId)
        .limit(5000),
    ]);

  if (
    mentionsResult.error ||
    verificationsResult.error ||
    attributionsResult.error
  ) {
    return null;
  }

  return buildCrossResponseCompetitorShadowSupplement({
    sourceRunId: runId,
    baseAggregateId: aggregate.id,
    baseAggregateHash: aggregate.aggregate_hash,
    aggregate: aggregate.aggregate,
    canonicalizations:
      (canonicalizations ?? []) as ShadowCanonicalizationRow[],
    mentions: (mentionsResult.data ?? []) as ShadowMentionRow[],
    verifications:
      (verificationsResult.data ?? []) as ShadowVerificationRow[],
    attributions: (attributionsResult.data ?? []) as ShadowAttributionRow[],
  });
}
