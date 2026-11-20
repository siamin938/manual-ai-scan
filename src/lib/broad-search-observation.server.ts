import { scopedCitedPages } from "./diagnostic-source-links";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifySourceDomain, normalizeSourceDomain } from "./source-domain-classifier";
import type {
  EntityFactsV2ReadBroadSearchObservationDTO,
  EntityFactsV2ReadBroadSearchSourceDTO,
  EntityFactsV2ReadBroadSearchSourcePatternDTO,
} from "./entity-facts-v2-read-gateway.types";

export const BROAD_SEARCH_OBSERVATION_VERSION = "0.2" as const;
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


const SOURCE_PATTERN_LABELS: Record<
  EntityFactsV2ReadBroadSearchSourcePatternDTO["key"],
  string
> = {
  independent_web: "독립 웹",
  shared_profile: "공유 프로필",
  community: "커뮤니티·블로그",
  auto_platform: "자동차 플랫폼",
  video_platform: "영상",
  news: "뉴스",
  job_board: "채용",
  public_information: "공공 정보",
  brand_or_manufacturer: "브랜드·제조사",
  marketplace_or_directory: "디렉터리·마켓",
};

function sourcePatternKey(
  value: ReturnType<typeof classifySourceDomain>["class"],
): EntityFactsV2ReadBroadSearchSourcePatternDTO["key"] | null {
  if (value === "unknown" || value === "infrastructure") return null;
  return value;
}

function sourceClassesForCompetitor(args: {
  attributions: AttributionRow[];
  measurementIds: Set<string>;
  canonicalKeys: Set<string>;
}): Set<EntityFactsV2ReadBroadSearchSourcePatternDTO["key"]> {
  const out = new Set<EntityFactsV2ReadBroadSearchSourcePatternDTO["key"]>();
  for (const row of args.attributions) {
    if (!args.measurementIds.has(row.measurement_id)) continue;
    if (!args.canonicalKeys.has(normalizedKey(row.canonical_key))) continue;
    const domain = normalizeSourceDomain(row.domain);
    if (!domain) continue;
    const key = sourcePatternKey(classifySourceDomain(domain).class);
    if (key) out.add(key);
  }
  return out;
}

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

  function recordAppearance(key: string, id: string, position: Json | undefined) {
    const measurement = measurementById.get(id);
    const question = measurement && questionById.get(measurement.question_id);
    if (!measurement || !question || !input.finalCompetitorNamesByCanonicalKey[key]) return;
    const group = groups.get(key) ?? {
      measurementIds: new Set<string>(), questionIds: new Set<string>(),
      intentTypes: new Set<string>(), bestPositionByMeasurement: new Map<string, number>(),
    };
    group.measurementIds.add(id);
    group.questionIds.add(question.id);
    if (question.intent_type) group.intentTypes.add(question.intent_type);
    if (typeof position === "number" && Number.isInteger(position) && position >= 1) {
      group.bestPositionByMeasurement.set(id, Math.min(group.bestPositionByMeasurement.get(id) ?? Infinity, position));
    }
    groups.set(key, group);
  }

  // A materialized per-answer confirmation does not require a second legacy parser hit.
  const authoritativePositions = new Set<string>();
  for (const row of input.facts) {
    const keys = confirmedOtherKeysByMeasurement.get(row.measurement_id);
    if (!keys) continue;
    const entities = factObject(row.facts)?.["confirmedOtherEntities"];
    const positions = new Map<string, Json>();
    for (const entity of Array.isArray(entities) ? entities : []) {
      const detail = factObject(entity);
      if (detail && typeof detail["canonicalKey"] === "string" && typeof detail["bestPosition"] === "number") {
        positions.set(detail["canonicalKey"], detail["bestPosition"]);
      }
    }
    for (const key of keys) {
      if (!baseV2Keys.has(key)) continue;
      if (positions.has(key)) authoritativePositions.add(JSON.stringify([key, row.measurement_id]));
      recordAppearance(key, row.measurement_id, positions.get(key));
    }
  }

  // Existing promoted identities and older facts without a saved position use
  // the scoped verifier. It may never add a base identity to an unconfirmed answer.
  for (const row of input.canonicalizations) {
    if (!validMeasurementIds.has(row.measurement_id) || !verifiedMentionIds.has(row.measurement_mention_id)) continue;
    const mention = mentionById.get(row.measurement_mention_id);
    if (!mention || mention.measurement_id !== row.measurement_id || mention.matched_business_id === input.businessId) continue;
    const key = resolveCanonicalKey(normalizedKey(row.canonical_key), input.mergeCanonicalAliases);
    if (baseV2Keys.has(key)) {
      if (!confirmedOtherKeysByMeasurement.get(row.measurement_id)?.has(key)) continue;
      if (authoritativePositions.has(JSON.stringify([key, row.measurement_id]))) continue;
    } else if (!promotedKeys.has(key) || mention.matched_business_id) continue;
    recordAppearance(key, row.measurement_id, mention.position);
  }

  const competitorRows = [...groups.entries()]
    .map(([canonicalKey, group]) => {
      const canonicalKeys =
        rawKeysByResolved.get(canonicalKey) ?? new Set([canonicalKey]);
      const sources = summarizeIndependentSources({
        attributions: input.attributions,
        measurementIds: group.measurementIds,
        canonicalKeys,
      });
      const sourceClasses = sourceClassesForCompetitor({
        attributions: input.attributions,
        measurementIds: group.measurementIds,
        canonicalKeys,
      });

      return {
        canonicalKey,
        sourceClasses,
        row: {
          name: input.finalCompetitorNamesByCanonicalKey[canonicalKey]!,
          responseCount: group.measurementIds.size,
          questionCount: group.questionIds.size,
          intentCount: group.intentTypes.size,
          top3ResponseCount: [...group.bestPositionByMeasurement.values()].filter(
            (position) => position <= 3,
          ).length,
          strongestIndependentSource: sources[0] ?? null,
        },
      };
    })
    .sort(
      (a, b) =>
        b.row.responseCount - a.row.responseCount ||
        b.row.intentCount - a.row.intentCount ||
        b.row.top3ResponseCount - a.row.top3ResponseCount ||
        a.row.name.localeCompare(b.row.name, "ko"),
    );

  const repeatedCompetitors = competitorRows
    .filter(({ row }) => row.responseCount >= REPEATED_COMPETITOR_MIN_RESPONSES)
    .map(({ row }) => row);

  const singleObservationCompetitors = competitorRows
    .filter(({ row }) => row.responseCount === 1)
    .map(({ row }) => row);

  const sourcePatternCounts = new Map<
    EntityFactsV2ReadBroadSearchSourcePatternDTO["key"],
    number
  >();
  for (const competitor of competitorRows) {
    for (const key of competitor.sourceClasses) {
      sourcePatternCounts.set(key, (sourcePatternCounts.get(key) ?? 0) + 1);
    }
  }

  const sourcePatterns: EntityFactsV2ReadBroadSearchSourcePatternDTO[] =
    [...sourcePatternCounts.entries()]
      .map(([key, competitorCount]) => ({
        key,
        label: SOURCE_PATTERN_LABELS[key],
        competitorCount,
      }))
      .sort(
        (a, b) =>
          b.competitorCount - a.competitorCount ||
          a.label.localeCompare(b.label, "ko"),
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
    singleObservationCompetitors,
    observedCompetitorCount: competitorRows.length,
    independentWebLinkedCompetitorCount: competitorRows.filter(
      ({ row }) => row.strongestIndependentSource !== null,
    ).length,
    repeatedIndependentWebLinkedCompetitorCount: competitorRows.filter(
      ({ row }) =>
        row.responseCount >= REPEATED_COMPETITOR_MIN_RESPONSES &&
        row.strongestIndependentSource !== null,
    ).length,
    sourcePatterns,
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
    .select("id,question_id,response_text")
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

  const emptyLegacyRows = { data: [], error: null };
  const [mentionsResult, verificationsResult, attributionsResult] = await Promise.all([
    mentionIds.length ? supabaseAdmin.from("measurement_mentions")
      .select("id,measurement_id,matched_business_id,position")
      .eq("org_id", args.orgId)
      .in("id", mentionIds) : emptyLegacyRows,
    mentionIds.length ? supabaseAdmin.from("measurement_entity_verifications")
      .select("measurement_mention_id,verification_status,verified_count_as_business")
      .eq("org_id", args.orgId)
      .eq("business_id", args.businessId)
      .in("measurement_mention_id", mentionIds) : emptyLegacyRows,
    supabaseAdmin.from("measurement_citation_attributions")
      .select("measurement_id,canonical_key,domain,attribution_level", { count: "exact" })
      .eq("org_id", args.orgId)
      .eq("business_id", args.businessId)
      .eq("source_run_id", args.runId)
      .in("attribution_level", ["direct", "section"])
      .in("measurement_id", measurementIds),
  ]);

  if (
    mentionsResult.error ||
    verificationsResult.error ||
    attributionsResult.error || attributionsResult.count !== attributionsResult.data?.length
  ) {
    return null;
  }

  const observation = buildBroadSearchObservation({
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
  const validIds = new Set((facts ?? []).filter(row => factObject(row.facts)?.["valid"] === true).map(row => row.measurement_id));
  if (validIds.size === 0) return observation;
  const citations = await supabaseAdmin.from("measurement_citations")
    .select("measurement_id,title,url,domain", { count: "exact" })
    .eq("org_id", args.orgId)
    .in("measurement_id", [...validIds]);
  if (!citations.error && citations.data && citations.count === citations.data.length) {
    const answers = new Map(measurements.map(row => [row.id, row.response_text ?? ""]));
    observation.citedPages = scopedCitedPages(citations.data, validIds, answers);
  }
  return observation;
}
