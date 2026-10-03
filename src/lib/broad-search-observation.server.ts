import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifySourceDomain, normalizeSourceDomain } from "./source-domain-classifier";
import type {
  EntityFactsV2ReadBroadSearchObservationDTO,
  EntityFactsV2ReadBroadSearchSourceDTO,
} from "./entity-facts-v2-read-gateway.types";

export const BROAD_SEARCH_OBSERVATION_VERSION = "0.1" as const;
const REPEATED_COMPETITOR_MIN_RESPONSES = 2;

type QuestionRow = {
  id: string;
  intent_type: string;
};

type MeasurementRow = {
  id: string;
  question_id: string;
};

type MentionRow = {
  id: string;
  measurement_id: string;
  matched_business_id: string | null;
  position: number | null;
};

type VerificationRow = {
  measurement_mention_id: string;
  verification_status: string;
  verified_count_as_business: boolean;
};

type CanonicalizationRow = {
  measurement_id: string;
  measurement_mention_id: string;
  canonical_key: string;
};

type AttributionRow = {
  measurement_id: string;
  canonical_key: string;
  domain: string | null;
  attribution_level: string;
};

type FactRow = {
  measurement_id: string;
  facts: Json;
};

export type BroadSearchObservationInput = {
  businessId: string;
  questions: QuestionRow[];
  measurements: MeasurementRow[];
  mentions: MentionRow[];
  verifications: VerificationRow[];
  canonicalizations: CanonicalizationRow[];
  attributions: AttributionRow[];
  facts: FactRow[];
  finalCompetitorNamesByCanonicalKey: Record<string, string>;
  baseV2CompetitorCanonicalKeys: string[];
  promotedCompetitorCanonicalKeys: string[];
  mergeCanonicalAliases: Record<string, string>;
};

function factObject(value: Json): Record<string, Json> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function normalizedKey(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function resolveCanonicalKey(
  rawKey: string,
  aliases: Record<string, string>,
): string {
  return aliases[rawKey] ?? rawKey;
}

type SourceAccumulator = {
  measurementIds: Set<string>;
  directAttributionCount: number;
};

function summarizeIndependentSources(args: {
  attributions: AttributionRow[];
  measurementIds: Set<string>;
  canonicalKeys: Set<string>;
}): EntityFactsV2ReadBroadSearchSourceDTO[] {
  const byDomain = new Map<string, SourceAccumulator>();

  for (const row of args.attributions) {
    if (!args.measurementIds.has(row.measurement_id)) continue;
    if (!args.canonicalKeys.has(normalizedKey(row.canonical_key))) continue;

    const domain = normalizeSourceDomain(row.domain);
    if (!domain) continue;

    const classification = classifySourceDomain(domain);
    if (!classification.strongCompetitorIdentityEligible) continue;

    const current = byDomain.get(domain) ?? {
      measurementIds: new Set<string>(),
      directAttributionCount: 0,
    };
    current.measurementIds.add(row.measurement_id);
    if (row.attribution_level === "direct") current.directAttributionCount += 1;
    byDomain.set(domain, current);
  }

  return [...byDomain.entries()]
    .map(([domain, value]) => ({
      domain,
      responseCount: value.measurementIds.size,
      directAttributionCount: value.directAttributionCount,
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        b.directAttributionCount - a.directAttributionCount ||
        a.domain.localeCompare(b.domain, "en"),
    );
}

export function buildBroadSearchObservation(
  input: BroadSearchObservationInput,
): EntityFactsV2ReadBroadSearchObservationDTO {
  const questionById = new Map(input.questions.map((row) => [row.id, row]));
  const measurementById = new Map(
    input.measurements.map((row) => [row.id, row]),
  );
  const mentionById = new Map(input.mentions.map((row) => [row.id, row]));

  const validMeasurementIds = new Set<string>();
  const confirmedOtherKeysByMeasurement = new Map<string, Set<string>>();
  let targetConfirmedCount = 0;
  let targetTop3Count = 0;

  for (const row of input.facts) {
    const facts = factObject(row.facts);
    if (!facts || facts["valid"] !== true) continue;
    validMeasurementIds.add(row.measurement_id);

    const confirmedOtherKeys = Array.isArray(facts["confirmedOtherEntityKeys"])
      ? facts["confirmedOtherEntityKeys"].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
    confirmedOtherKeysByMeasurement.set(
      row.measurement_id,
      new Set(confirmedOtherKeys.map((value) => value.trim())),
    );

    if (facts["targetSeen"] === true) {
      targetConfirmedCount += 1;
      const rawPosition = facts["targetBestPosition"];
      if (
        typeof rawPosition === "number" &&
        Number.isInteger(rawPosition) &&
        rawPosition >= 1 &&
        rawPosition <= 3
      ) {
        targetTop3Count += 1;
      }
    }
  }

  const verifiedMentionIds = new Set(
    input.verifications
      .filter(
        (row) =>
          row.verification_status === "confirmed_business" &&
          row.verified_count_as_business === true,
      )
      .map((row) => row.measurement_mention_id),
  );

  const rawKeysByResolved = new Map<string, Set<string>>();
  for (const row of input.canonicalizations) {
    const rawKey = normalizedKey(row.canonical_key);
    if (!rawKey) continue;
    const resolvedKey = resolveCanonicalKey(rawKey, input.mergeCanonicalAliases);
    const keys = rawKeysByResolved.get(resolvedKey) ?? new Set<string>();
    keys.add(rawKey);
    keys.add(resolvedKey);
    rawKeysByResolved.set(resolvedKey, keys);
  }

  const baseV2Keys = new Set(
    input.baseV2CompetitorCanonicalKeys.map((value) => value.trim()).filter(Boolean),
  );
  const promotedKeys = new Set(
    input.promotedCompetitorCanonicalKeys.map((value) => value.trim()).filter(Boolean),
  );

  const groups = new Map<
    string,
    {
      measurementIds: Set<string>;
      questionIds: Set<string>;
      intentTypes: Set<string>;
      bestPositionByMeasurement: Map<string, number>;
    }
  >();

  for (const row of input.canonicalizations) {
    if (!validMeasurementIds.has(row.measurement_id)) continue;
    if (!verifiedMentionIds.has(row.measurement_mention_id)) continue;

    const mention = mentionById.get(row.measurement_mention_id);
    if (!mention || mention.matched_business_id) continue;

    const rawKey = normalizedKey(row.canonical_key);
    const resolvedKey = resolveCanonicalKey(rawKey, input.mergeCanonicalAliases);
    if (!input.finalCompetitorNamesByCanonicalKey[resolvedKey]) continue;

    // Existing v2 competitors use exact per-response v2 confirmation. Only
    // cross-response PROMOTE identities may use the persisted legacy verifier
    // for scoped counting. This keeps the scoped count from exceeding or
    // contradicting the final run-wide v2 competitor truth.
    if (
      baseV2Keys.has(resolvedKey) &&
      !confirmedOtherKeysByMeasurement.get(row.measurement_id)?.has(resolvedKey)
    ) {
      continue;
    }
    if (!baseV2Keys.has(resolvedKey) && !promotedKeys.has(resolvedKey)) continue;

    const measurement = measurementById.get(row.measurement_id);
    if (!measurement) continue;
    const question = questionById.get(measurement.question_id);
    if (!question) continue;

    const group = groups.get(resolvedKey) ?? {
      measurementIds: new Set<string>(),
      questionIds: new Set<string>(),
      intentTypes: new Set<string>(),
      bestPositionByMeasurement: new Map<string, number>(),
    };

    group.measurementIds.add(row.measurement_id);
    group.questionIds.add(measurement.question_id);
    if (question.intent_type) group.intentTypes.add(question.intent_type);

    if (
      typeof mention.position === "number" &&
      Number.isInteger(mention.position) &&
      mention.position >= 1
    ) {
      const current = group.bestPositionByMeasurement.get(row.measurement_id);
      if (current === undefined || mention.position < current) {
        group.bestPositionByMeasurement.set(row.measurement_id, mention.position);
      }
    }

    groups.set(resolvedKey, group);
  }

  const repeatedCompetitors = [...groups.entries()]
    .filter(([, group]) => group.measurementIds.size >= REPEATED_COMPETITOR_MIN_RESPONSES)
    .map(([canonicalKey, group]) => {
      const canonicalKeys =
        rawKeysByResolved.get(canonicalKey) ?? new Set([canonicalKey]);
      const sources = summarizeIndependentSources({
        attributions: input.attributions,
        measurementIds: group.measurementIds,
        canonicalKeys,
      });

      return {
        name: input.finalCompetitorNamesByCanonicalKey[canonicalKey]!,
        responseCount: group.measurementIds.size,
        questionCount: group.questionIds.size,
        intentCount: group.intentTypes.size,
        top3ResponseCount: [...group.bestPositionByMeasurement.values()].filter(
          (position) => position <= 3,
        ).length,
        strongestIndependentSource: sources[0] ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        b.intentCount - a.intentCount ||
        b.top3ResponseCount - a.top3ResponseCount ||
        a.name.localeCompare(b.name, "ko"),
    );

  const targetCanonicalKey = `business:${input.businessId.trim().toLowerCase()}`;
  const targetSources = summarizeIndependentSources({
    attributions: input.attributions,
    measurementIds: validMeasurementIds,
    canonicalKeys: new Set([targetCanonicalKey]),
  });

  const targetIndependentMeasurementIds = new Set<string>();
  const targetIndependentDomains = new Set(targetSources.map((row) => row.domain));
  for (const row of input.attributions) {
    if (!validMeasurementIds.has(row.measurement_id)) continue;
    if (normalizedKey(row.canonical_key) !== targetCanonicalKey) continue;
    const domain = normalizeSourceDomain(row.domain);
    if (targetIndependentDomains.has(domain)) {
      targetIndependentMeasurementIds.add(row.measurement_id);
    }
  }

  return {
    version: BROAD_SEARCH_OBSERVATION_VERSION,
    validCount: validMeasurementIds.size,
    targetConfirmedCount,
    targetTop3Count,
    targetIndependentSourceResponseCount: targetIndependentMeasurementIds.size,
    targetIndependentSources: targetSources,
    repeatedCompetitors,
  };
}

export async function fetchBroadSearchObservation(args: {
  orgId: string;
  businessId: string;
  runId: string;
  questionSetId: string;
  materializationId: string;
  factVersion: string;
  engineVersion: string;
  finalCompetitorNamesByCanonicalKey: Record<string, string>;
  baseV2CompetitorCanonicalKeys: string[];
  promotedCompetitorCanonicalKeys: string[];
  mergeCanonicalAliases: Record<string, string>;
}): Promise<EntityFactsV2ReadBroadSearchObservationDTO | null> {
  const { data: questions, error: questionError } = await supabaseAdmin
    .from("questions")
    .select("id,intent_type")
    .eq("org_id", args.orgId)
    .eq("question_set_id", args.questionSetId)
    .is("city", null)
    .eq("active", true);

  if (questionError || !questions || questions.length === 0) return null;
  const questionIds = questions.map((row) => row.id);

  const { data: measurements, error: measurementError } = await supabaseAdmin
    .from("measurements")
    .select("id,question_id")
    .eq("org_id", args.orgId)
    .eq("run_id", args.runId)
    .in("question_id", questionIds);

  if (measurementError || !measurements || measurements.length === 0) return null;
  const measurementIds = measurements.map((row) => row.id);

  const [{ data: facts, error: factError }, { data: canonicalizations, error: canonicalizationError }] =
    await Promise.all([
      supabaseAdmin
        .from("measurement_entity_facts_v2")
        .select("measurement_id,facts")
        .eq("org_id", args.orgId)
        .eq("business_id", args.businessId)
        .eq("source_run_id", args.runId)
        .eq("materialization_id", args.materializationId)
        .eq("fact_version", args.factVersion)
        .eq("engine_version", args.engineVersion)
        .in("measurement_id", measurementIds),
      supabaseAdmin
        .from("measurement_entity_canonicalizations")
        .select("measurement_id,measurement_mention_id,canonical_key")
        .eq("org_id", args.orgId)
        .eq("business_id", args.businessId)
        .eq("source_run_id", args.runId)
        .in("measurement_id", measurementIds),
    ]);

  if (factError || canonicalizationError) return null;
  if ((facts ?? []).length !== measurementIds.length) return null;

  const mentionIds = [
    ...new Set(
      (canonicalizations ?? []).map((row) => row.measurement_mention_id),
    ),
  ];

  const [mentionsResult, verificationsResult, attributionsResult] =
    mentionIds.length > 0
      ? await Promise.all([
          supabaseAdmin
            .from("measurement_mentions")
            .select("id,measurement_id,matched_business_id,position")
            .eq("org_id", args.orgId)
            .in("id", mentionIds),
          supabaseAdmin
            .from("measurement_entity_verifications")
            .select(
              "measurement_mention_id,verification_status,verified_count_as_business",
            )
            .eq("org_id", args.orgId)
            .eq("business_id", args.businessId)
            .in("measurement_mention_id", mentionIds),
          supabaseAdmin
            .from("measurement_citation_attributions")
            .select("measurement_id,canonical_key,domain,attribution_level")
            .eq("org_id", args.orgId)
            .eq("business_id", args.businessId)
            .eq("source_run_id", args.runId)
            .in("measurement_id", measurementIds)
            .limit(2000),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (
    mentionsResult.error ||
    verificationsResult.error ||
    attributionsResult.error
  ) {
    return null;
  }

  return buildBroadSearchObservation({
    businessId: args.businessId,
    questions: questions as QuestionRow[],
    measurements: measurements as MeasurementRow[],
    mentions: (mentionsResult.data ?? []) as MentionRow[],
    verifications: (verificationsResult.data ?? []) as VerificationRow[],
    canonicalizations: (canonicalizations ?? []) as CanonicalizationRow[],
    attributions: (attributionsResult.data ?? []) as AttributionRow[],
    facts: (facts ?? []) as FactRow[],
    finalCompetitorNamesByCanonicalKey:
      args.finalCompetitorNamesByCanonicalKey,
    baseV2CompetitorCanonicalKeys: args.baseV2CompetitorCanonicalKeys,
    promotedCompetitorCanonicalKeys: args.promotedCompetitorCanonicalKeys,
    mergeCanonicalAliases: args.mergeCanonicalAliases,
  });
}
