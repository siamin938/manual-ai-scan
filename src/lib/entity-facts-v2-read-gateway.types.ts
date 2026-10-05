export const ENTITY_FACTS_V2_READ_GATEWAY_VERSION = "0.1" as const;
export const ENTITY_FACTS_V2_READ_FACT_VERSION = "0.3" as const;
export const ENTITY_FACTS_V2_READ_AGGREGATE_VERSION = "0.1" as const;
export const ENTITY_FACTS_V2_READ_ENGINE_VERSION =
  "entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1" as const;
export const ENTITY_FACTS_V2_CITATION_PAGE_VERIFIER_VERSION = "0.1.1" as const;

export type EntityFactsV2ReadError =
  | "FORBIDDEN"
  | "BUSINESS_NOT_AVAILABLE"
  | "NO_V2_DATA"
  | "INVALID_V2_DATA"
  | "INTERNAL_ERROR";

export type EntityFactsV2ReadBoundsDTO = {
  validCount: number;
  confirmedMentionCount: number;
  unresolvedTargetCount: number;
  visibilityLowerBoundPct: number | null;
  visibilityUpperBoundPct: number | null;
  confirmedTop3Count: number;
  top3UncertainCount: number;
  top3LowerBoundPct: number | null;
  top3UpperBoundPct: number | null;
};

export type EntityFactsV2ReadOverviewDTO = EntityFactsV2ReadBoundsDTO & {
  measurementCount: number;
  invalidCount: number;
  questionCount: number;
  coveredQuestionCount: number;
  unresolvedQuestionCount: number;
  missingQuestionCount: number;
  sourcePartialMeasurementCount: number;
};

export type EntityFactsV2ReadQuestionGroupDTO = EntityFactsV2ReadBoundsDTO & {
  intentType: string;
  questionCount: number;
};

export type EntityFactsV2ReadQuestionAreaDTO = EntityFactsV2ReadBoundsDTO & {
  questionId: string;
  questionText: string;
  intentType: string;
  status: "covered" | "partial" | "unresolved" | "missing";
};

export type EntityFactsV2ReadCompetitorDTO = {
  name: string;
  responseCount: number;
  questionCount: number;
  intentCount: number;
  top3ResponseCount: number;
};


export type EntityFactsV2ReadBroadSearchSourceDTO = {
  domain: string;
  responseCount: number;
  directAttributionCount: number;
};

export type EntityFactsV2ReadBroadSearchSourcePatternDTO = {
  key:
    | "independent_web"
    | "shared_profile"
    | "community"
    | "auto_platform"
    | "video_platform"
    | "news"
    | "job_board"
    | "public_information"
    | "brand_or_manufacturer"
    | "marketplace_or_directory";
  label: string;
  competitorCount: number;
};

export type EntityFactsV2ReadBroadSearchCompetitorDTO = {
  name: string;
  responseCount: number;
  questionCount: number;
  intentCount: number;
  top3ResponseCount: number;
  strongestIndependentSource: EntityFactsV2ReadBroadSearchSourceDTO | null;
};

export type EntityFactsV2ReadBroadSearchObservationDTO = {
  version: "0.2";
  validCount: number;
  targetConfirmedCount: number;
  targetTop3Count: number;
  targetIndependentSourceResponseCount: number;
  targetIndependentSources: EntityFactsV2ReadBroadSearchSourceDTO[];
  repeatedCompetitors: EntityFactsV2ReadBroadSearchCompetitorDTO[];
  singleObservationCompetitors: EntityFactsV2ReadBroadSearchCompetitorDTO[];
  observedCompetitorCount: number;
  independentWebLinkedCompetitorCount: number;
  repeatedIndependentWebLinkedCompetitorCount: number;
  sourcePatterns: EntityFactsV2ReadBroadSearchSourcePatternDTO[];
};

export type EntityFactsV2ReadTargetSourceDTO = {
  domain: string;
  responseCount: number;
  completeResponseCount: number;
  partialResponseCount: number;
};

export type EntityFactsV2ReadObservedSourceEntityDTO = {
  name: string;
  isTarget: boolean;
  responseCount: number;
  evidence: "confirmed" | "clue";
};

export type EntityFactsV2ReadObservedSourceDTO = {
  domain: string;
  responseCount: number;
  targetResponseCount: number;
  competitorResponseCount: number;
  clueResponseCount: number;
  evidence: "confirmed" | "mixed" | "clue";
  linkedEntities: EntityFactsV2ReadObservedSourceEntityDTO[];
};

export type EntityFactsV2ReadCitationSourceDTO = {
  domain: string;
  responseCount: number;
  citationCount: number;
  sampleUrl: string;
};

export type EntityFactsV2ReadTargetReferenceSourceDTO = {
  domain: string;
  responseCount: number;
  sampleUrl: string;
};

export type EntityFactsV2ReadTargetExposureCitationSourceDTO = {
  domain: string;
  responseCount: number;
  citationCount: number;
  sampleUrl: string;
};

export type EntityFactsV2ReadVerifiedTargetCitationPageDTO = {
  domain: string;
  title: string | null;
  responseCount: number;
  citationCount: number;
  sampleUrl: string;
  confidence: "high" | "medium";
  basisLabel: string;
};

export type EntityFactsV2ReadObservedSourcesStatus =
  | "available"
  | "not_materialized";

export type EntityFactsV2ReadBusinessDTO = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  city: string | null;
};

export type EntityFactsV2ReadScopeDTO = {
  runId: string;
  runName: string;
  /** Optional metadata for legacy snapshot compatibility. */
  questionSetId?: string | undefined;
  questionSetName?: string | undefined;
  measuredAt: string;
  providers: string[];
  repetitions: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
};

export type EntityFactsV2ReadQuestionLocationDTO = {
  questionId: string;
  city: string | null;
};

export type EntityFactsV2ReadGatewayDTO = {
  gatewayVersion: typeof ENTITY_FACTS_V2_READ_GATEWAY_VERSION;
  generatedAt: string;
  business: EntityFactsV2ReadBusinessDTO;
  scope: EntityFactsV2ReadScopeDTO;
  /** Optional supplemental metadata. Missing data must never block the core dashboard. */
  questionLocations?: EntityFactsV2ReadQuestionLocationDTO[];
  overview: EntityFactsV2ReadOverviewDTO;
  questionGroups: EntityFactsV2ReadQuestionGroupDTO[];
  questionAreas: EntityFactsV2ReadQuestionAreaDTO[];
  /**
   * Customer-visible confirmed competitor rows. The server may append the
   * exact-run cross-response supplement after the core v2 snapshot is built.
   */
  competitors: EntityFactsV2ReadCompetitorDTO[];
  /**
   * Read-only comparison inside the wide Core search layer. This summarizes
   * repeated confirmed competitors and co-observed independent web sources.
   * It is descriptive evidence only and never changes target visibility truth.
   */
  broadSearchObservation?: EntityFactsV2ReadBroadSearchObservationDTO;
  targetSources: EntityFactsV2ReadTargetSourceDTO[];
  /** Supplemental final-answer citation summary for the exact representative run. */
  citationSources?: EntityFactsV2ReadCitationSourceDTO[];
  /**
   * Advisory target-link clues from close section-level citation attribution that
   * did not satisfy the repeated-evidence promotion rule. Never treat as confirmed.
   */
  targetReferenceSources?: EntityFactsV2ReadTargetReferenceSourceDTO[];
  /**
   * Final-answer citations observed specifically inside measurements where v2
   * confirmed targetSeen=true. This is co-observation only, not target attribution.
   */
  targetExposureCitationSources?: EntityFactsV2ReadTargetExposureCitationSourceDTO[];
  /**
   * Cited pages whose own page-level content was independently confirmed to
   * concern the current target business. Advisory only; never changes v2 truth.
   */
  verifiedTargetCitationPages?: EntityFactsV2ReadVerifiedTargetCitationPageDTO[];
  observedSourcesStatus: EntityFactsV2ReadObservedSourcesStatus;
  observedSources: EntityFactsV2ReadObservedSourceDTO[];
};

export type EntityFactsV2ReadGatewayResponse =
  | { ok: true; data: EntityFactsV2ReadGatewayDTO }
  | {
      ok: false;
      error: EntityFactsV2ReadError;
      business?: EntityFactsV2ReadBusinessDTO;
      runId?: string;
    };

type Obj = Record<string, unknown>;

export type EntityFactsV2CompetitorDisplayEvidence = {
  label: string | null | undefined;
  priority: number;
};

function normalizeCompetitorDisplaySurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function normalizeCompetitorDisplaySurfaceWithoutCorporateMarker(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/(?:\(주\)|주식회사)/gu, "")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

/**
 * Mirrors the persisted canonicalization brand-core rule used by
 * get_auto_business_brand_core_v01. This is intentionally used only for
 * priority-1 canonical_display_name evidence that is already bound to the
 * exact canonical_key in storage. Weaker mention/alias evidence remains
 * exact-surface only.
 */
function normalizePersistedCanonicalBrandCoreSurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/(?:\(주\)|주식회사)/gu, "")
    .replace(/[^0-9a-z가-힣]/giu, "")
    .replace(
      /(?:ppf|필름|랩핑|래핑|썬팅|틴팅|tinting|tint|wrapping|wrap|디테일링|코팅|세차)$/iu,
      "",
    );
}

function autoCanonicalSurface(value: string): string | null {
  const key = value.trim();
  if (!key.startsWith("auto:")) return null;
  const suffix = key.slice("auto:".length);
  return suffix.length > 0 ? suffix : null;
}

/**
 * Resolve an auto:<normalized-surface> key only from persisted display evidence
 * whose normalized surface exactly matches the key. The key suffix itself is
 * never used as a customer-visible fallback.
 */
export function pickEntityFactsV2AutoCompetitorDisplayName(
  canonicalKey: string,
  evidence: readonly EntityFactsV2CompetitorDisplayEvidence[],
): string | null {
  const expectedSurface = autoCanonicalSurface(canonicalKey);
  if (!expectedSurface) return null;

  const counts = new Map<string, { label: string; priority: number; count: number }>();
  for (const item of evidence) {
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const normalizedLabel = normalizeCompetitorDisplaySurface(label);
    const normalizedWithoutCorporateMarker =
      normalizeCompetitorDisplaySurfaceWithoutCorporateMarker(label);

    const persistedCanonicalBrandCore =
      item.priority === 1
        ? normalizePersistedCanonicalBrandCoreSurface(label)
        : null;

    if (
      !label ||
      !Number.isInteger(item.priority) ||
      item.priority < 1 ||
      (normalizedLabel !== expectedSurface &&
        normalizedWithoutCorporateMarker !== expectedSurface &&
        persistedCanonicalBrandCore !== expectedSurface)
    ) {
      continue;
    }

    const key = `${item.priority}\u0000${label}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { label, priority: item.priority, count: 1 });
  }

  const candidates = [...counts.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      b.count - a.count ||
      a.label.localeCompare(b.label, "ko"),
  );

  return candidates[0]?.label ?? null;
}

export type ParsedEntityFactsV2Competitor = {
  canonicalKey: string;
  responseCount: number;
  questionCount: number;
  intentCount: number;
  top3ResponseCount: number;
};

export type ParsedEntityFactsV2Aggregate = {
  overview: EntityFactsV2ReadOverviewDTO;
  questionGroups: EntityFactsV2ReadQuestionGroupDTO[];
  questionAreas: EntityFactsV2ReadQuestionAreaDTO[];
  competitors: ParsedEntityFactsV2Competitor[];
  targetSources: EntityFactsV2ReadTargetSourceDTO[];
};

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out ? out : null;
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function nullablePct(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  ) {
    return { ok: true, value };
  }
  return { ok: false };
}

function parseBounds(value: unknown): EntityFactsV2ReadBoundsDTO | null {
  if (!isObj(value)) return null;

  const validCount = nonNegativeInt(value["validCount"]);
  const confirmedMentionCount = nonNegativeInt(value["confirmedMentionCount"]);
  const unresolvedTargetCount = nonNegativeInt(value["unresolvedTargetCount"]);
  const visibilityLowerBoundPct = nullablePct(
    value["visibilityLowerBoundPct"],
  );
  const visibilityUpperBoundPct = nullablePct(
    value["visibilityUpperBoundPct"],
  );
  const confirmedTop3Count = nonNegativeInt(value["confirmedTop3Count"]);
  const top3UncertainCount = nonNegativeInt(value["top3UncertainCount"]);
  const top3LowerBoundPct = nullablePct(value["top3LowerBoundPct"]);
  const top3UpperBoundPct = nullablePct(value["top3UpperBoundPct"]);

  if (
    validCount === null ||
    confirmedMentionCount === null ||
    unresolvedTargetCount === null ||
    !visibilityLowerBoundPct.ok ||
    !visibilityUpperBoundPct.ok ||
    confirmedTop3Count === null ||
    top3UncertainCount === null ||
    !top3LowerBoundPct.ok ||
    !top3UpperBoundPct.ok
  ) {
    return null;
  }

  if (
    confirmedMentionCount + unresolvedTargetCount > validCount ||
    confirmedTop3Count + top3UncertainCount > validCount
  ) {
    return null;
  }

  const pctPairs = [
    [visibilityLowerBoundPct.value, visibilityUpperBoundPct.value],
    [top3LowerBoundPct.value, top3UpperBoundPct.value],
  ] as const;

  for (const [lower, upper] of pctPairs) {
    if (validCount === 0) {
      if (lower !== null || upper !== null) return null;
    } else {
      if (lower === null || upper === null || lower > upper) return null;
    }
  }

  return {
    validCount,
    confirmedMentionCount,
    unresolvedTargetCount,
    visibilityLowerBoundPct: visibilityLowerBoundPct.value,
    visibilityUpperBoundPct: visibilityUpperBoundPct.value,
    confirmedTop3Count,
    top3UncertainCount,
    top3LowerBoundPct: top3LowerBoundPct.value,
    top3UpperBoundPct: top3UpperBoundPct.value,
  };
}

function parseOverview(value: unknown): EntityFactsV2ReadOverviewDTO | null {
  const bounds = parseBounds(value);
  if (!bounds || !isObj(value)) return null;

  const measurementCount = nonNegativeInt(value["measurementCount"]);
  const invalidCount = nonNegativeInt(value["invalidCount"]);
  const questionCount = nonNegativeInt(value["questionCount"]);
  const coveredQuestionCount = nonNegativeInt(value["coveredQuestionCount"]);
  const unresolvedQuestionCount = nonNegativeInt(
    value["unresolvedQuestionCount"],
  );
  const missingQuestionCount = nonNegativeInt(value["missingQuestionCount"]);
  const sourcePartialMeasurementCount = nonNegativeInt(
    value["sourcePartialMeasurementCount"],
  );

  if (
    measurementCount === null ||
    invalidCount === null ||
    questionCount === null ||
    coveredQuestionCount === null ||
    unresolvedQuestionCount === null ||
    missingQuestionCount === null ||
    sourcePartialMeasurementCount === null
  ) {
    return null;
  }

  if (
    bounds.validCount + invalidCount !== measurementCount ||
    coveredQuestionCount + unresolvedQuestionCount + missingQuestionCount !==
      questionCount ||
    sourcePartialMeasurementCount > bounds.validCount
  ) {
    return null;
  }

  return {
    ...bounds,
    measurementCount,
    invalidCount,
    questionCount,
    coveredQuestionCount,
    unresolvedQuestionCount,
    missingQuestionCount,
    sourcePartialMeasurementCount,
  };
}

function parseQuestionGroup(
  value: unknown,
): EntityFactsV2ReadQuestionGroupDTO | null {
  const bounds = parseBounds(value);
  if (!bounds || !isObj(value)) return null;
  const intentType = nonEmptyString(value["intentType"]);
  const questionCount = nonNegativeInt(value["questionCount"]);
  if (!intentType || questionCount === null) return null;
  return { intentType, questionCount, ...bounds };
}

function parseQuestionArea(
  value: unknown,
): EntityFactsV2ReadQuestionAreaDTO | null {
  const bounds = parseBounds(value);
  if (!bounds || !isObj(value)) return null;
  const questionId = nonEmptyString(value["questionId"]);
  const questionText = nonEmptyString(value["questionText"]);
  const intentType = nonEmptyString(value["intentType"]);
  const status = value["status"];
  if (
    !questionId ||
    !questionText ||
    !intentType ||
    (status !== "covered" &&
      status !== "partial" &&
      status !== "unresolved" &&
      status !== "missing")
  ) {
    return null;
  }
  return { questionId, questionText, intentType, status, ...bounds };
}

function parseCompetitor(value: unknown): ParsedEntityFactsV2Competitor | null {
  if (!isObj(value)) return null;
  const canonicalKey = nonEmptyString(value["canonicalKey"]);
  const responseCount = nonNegativeInt(value["responseCount"]);
  const questionCount = nonNegativeInt(value["questionCount"]);
  const intentCount = nonNegativeInt(value["intentCount"]);
  const top3ResponseCount = nonNegativeInt(value["top3ResponseCount"]);
  if (
    !canonicalKey ||
    responseCount === null ||
    questionCount === null ||
    intentCount === null ||
    top3ResponseCount === null ||
    top3ResponseCount > responseCount
  ) {
    return null;
  }
  return {
    canonicalKey,
    responseCount,
    questionCount,
    intentCount,
    top3ResponseCount,
  };
}

function parseTargetSource(
  value: unknown,
): EntityFactsV2ReadTargetSourceDTO | null {
  if (!isObj(value)) return null;
  const domain = nonEmptyString(value["domain"]);
  const responseCount = nonNegativeInt(value["responseCount"]);
  const completeResponseCount = nonNegativeInt(value["completeResponseCount"]);
  const partialResponseCount = nonNegativeInt(value["partialResponseCount"]);
  if (
    !domain ||
    responseCount === null ||
    completeResponseCount === null ||
    partialResponseCount === null ||
    completeResponseCount + partialResponseCount !== responseCount
  ) {
    return null;
  }
  return {
    domain,
    responseCount,
    completeResponseCount,
    partialResponseCount,
  };
}

function strictArray<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function validQualityFlagCounts(value: unknown): boolean {
  if (!isObj(value)) return false;
  return Object.entries(value).every(
    ([key, count]) => key.trim().length > 0 && nonNegativeInt(count) !== null,
  );
}

export function parseEntityFactsV2AggregateForReadGateway(
  value: unknown,
): ParsedEntityFactsV2Aggregate | null {
  if (!isObj(value)) return null;
  if (
    value["version"] !== ENTITY_FACTS_V2_READ_AGGREGATE_VERSION ||
    value["factsVersion"] !== ENTITY_FACTS_V2_READ_FACT_VERSION ||
    value["contractOk"] !== true ||
    !Array.isArray(value["contractIssues"]) ||
    value["contractIssues"].length !== 0
  ) {
    return null;
  }

  const overview = parseOverview(value["overview"]);
  const questionGroups = strictArray(
    value["questionGroups"],
    parseQuestionGroup,
  );
  const questionAreas = strictArray(value["questionAreas"], parseQuestionArea);
  const competitors = strictArray(value["competitors"], parseCompetitor);
  const targetSources = strictArray(value["targetSources"], parseTargetSource);

  if (
    !overview ||
    !questionGroups ||
    !questionAreas ||
    !competitors ||
    !targetSources ||
    !validQualityFlagCounts(value["qualityFlagCounts"])
  ) {
    return null;
  }

  return {
    overview,
    questionGroups,
    questionAreas,
    competitors,
    targetSources,
  };
}
