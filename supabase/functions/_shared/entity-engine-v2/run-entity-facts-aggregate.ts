import {
  MEASUREMENT_ENTITY_FACTS_VERSION,
  type MeasurementEntityFactsV2,
} from "./measurement-entity-facts.ts";

export const RUN_ENTITY_FACTS_AGGREGATE_VERSION = "0.1" as const;

export type RunEntityFactsContractIssueCode =
  | "INVALID_TARGET_BUSINESS_ID"
  | "MIXED_FACT_VERSION"
  | "SELF_COMPETITOR_LEAK";

export interface RunMeasurementFactRecordV2 {
  fact: MeasurementEntityFactsV2;
  questionId: string;
  questionText: string;
  intentType: string;
}

export interface VisibilityBoundsV2 {
  validCount: number;
  confirmedMentionCount: number;
  unresolvedTargetCount: number;
  visibilityLowerBoundPct: number | null;
  visibilityUpperBoundPct: number | null;
  confirmedTop3Count: number;
  top3LowerBoundPct: number | null;
  top3UpperBoundPct: number | null;
}

export interface RunQuestionGroupV2 extends VisibilityBoundsV2 {
  intentType: string;
  questionCount: number;
}

export type RunQuestionStatusV2 =
  | "covered"
  | "partial"
  | "unresolved"
  | "missing";

export interface RunQuestionAreaV2 extends VisibilityBoundsV2 {
  questionId: string;
  questionText: string;
  intentType: string;
  status: RunQuestionStatusV2;
}

export interface RunCompetitorFactV2 {
  canonicalKey: string;
  responseCount: number;
  questionCount: number;
  intentCount: number;
  top3ResponseCount: number;
}

export interface RunTargetSourceFactV2 {
  domain: string;
  responseCount: number;
  completeResponseCount: number;
  partialResponseCount: number;
}

export interface RunEntityFactsContractIssueV2 {
  code: RunEntityFactsContractIssueCode;
  measurementId?: string;
  canonicalKey?: string;
}

export interface RunEntityFactsAggregateV2 {
  version: typeof RUN_ENTITY_FACTS_AGGREGATE_VERSION;
  factsVersion: typeof MEASUREMENT_ENTITY_FACTS_VERSION;
  contractOk: boolean;
  contractIssues: RunEntityFactsContractIssueV2[];
  overview: VisibilityBoundsV2 & {
    measurementCount: number;
    invalidCount: number;
    questionCount: number;
    coveredQuestionCount: number;
    unresolvedQuestionCount: number;
    missingQuestionCount: number;
    sourcePartialMeasurementCount: number;
  };
  questionGroups: RunQuestionGroupV2[];
  questionAreas: RunQuestionAreaV2[];
  competitors: RunCompetitorFactV2[];
  targetSources: RunTargetSourceFactV2[];
  qualityFlagCounts: Record<string, number>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function canonicalBusinessKey(
  value: string | null | undefined,
): string | null {
  const key = clean(value);
  if (!key.startsWith("business:")) return key || null;
  const id = key.slice("business:".length).toLowerCase();
  return UUID_RE.test(id) ? `business:${id}` : key || null;
}

function targetKeyFor(value: string): string | null {
  const id = clean(value).toLowerCase();
  return UUID_RE.test(id) ? `business:${id}` : null;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function uniqueCount(values: string[]): number {
  return new Set(values.filter(Boolean)).size;
}

function buildBounds(
  records: RunMeasurementFactRecordV2[],
): VisibilityBoundsV2 {
  const valid = records.filter((record) => record.fact.valid);
  const confirmedMentionCount = valid.filter(
    (record) => record.fact.targetSeen === true,
  ).length;
  const unresolvedTargetCount = valid.filter(
    (record) => record.fact.targetSeen === null,
  ).length;
  const confirmedTop3Count = valid.filter(
    (record) =>
      record.fact.targetSeen === true &&
      record.fact.targetBestPosition !== null &&
      record.fact.targetBestPosition <= 3,
  ).length;

  return {
    validCount: valid.length,
    confirmedMentionCount,
    unresolvedTargetCount,
    visibilityLowerBoundPct: pct(confirmedMentionCount, valid.length),
    visibilityUpperBoundPct: pct(
      confirmedMentionCount + unresolvedTargetCount,
      valid.length,
    ),
    confirmedTop3Count,
    top3LowerBoundPct: pct(confirmedTop3Count, valid.length),
    top3UpperBoundPct: pct(
      confirmedTop3Count + unresolvedTargetCount,
      valid.length,
    ),
  };
}

function questionStatus(bounds: VisibilityBoundsV2): RunQuestionStatusV2 {
  if (
    bounds.validCount > 0 &&
    bounds.confirmedMentionCount === bounds.validCount &&
    bounds.unresolvedTargetCount === 0
  ) {
    return "covered";
  }
  if (bounds.confirmedMentionCount > 0) return "partial";
  if (bounds.unresolvedTargetCount > 0) return "unresolved";
  return "missing";
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./u, "");
}

export function aggregateRunEntityFactsV2(
  targetBusinessId: string,
  records: RunMeasurementFactRecordV2[],
): RunEntityFactsAggregateV2 {
  const targetKey = targetKeyFor(targetBusinessId);
  const issues: RunEntityFactsContractIssueV2[] = [];

  if (!targetKey) {
    issues.push({ code: "INVALID_TARGET_BUSINESS_ID" });
  }

  const validRecords = records.filter((record) => record.fact.valid);
  const overall = buildBounds(records);

  for (const record of records) {
    if (String(record.fact.version) !== MEASUREMENT_ENTITY_FACTS_VERSION) {
      issues.push({
        code: "MIXED_FACT_VERSION",
        measurementId: record.fact.measurementId,
      });
    }
  }

  const byQuestion = new Map<string, RunMeasurementFactRecordV2[]>();
  for (const record of validRecords) {
    const key = clean(record.questionId);
    if (!key) continue;
    const current = byQuestion.get(key) ?? [];
    current.push(record);
    byQuestion.set(key, current);
  }

  const questionAreas: RunQuestionAreaV2[] = [...byQuestion.entries()]
    .map(([questionId, rows]) => {
      const bounds = buildBounds(rows);
      const first = rows[0]!;
      return {
        questionId,
        questionText: first.questionText,
        intentType: first.intentType || "other",
        status: questionStatus(bounds),
        ...bounds,
      };
    })
    .sort((a, b) => {
      const order: Record<RunQuestionStatusV2, number> = {
        unresolved: 0,
        missing: 1,
        partial: 2,
        covered: 3,
      };
      return (
        order[a.status] - order[b.status] ||
        (a.visibilityLowerBoundPct ?? 0) - (b.visibilityLowerBoundPct ?? 0) ||
        a.questionText.localeCompare(b.questionText, "ko")
      );
    });

  const byIntent = new Map<string, RunMeasurementFactRecordV2[]>();
  for (const record of validRecords) {
    const key = clean(record.intentType) || "other";
    const current = byIntent.get(key) ?? [];
    current.push(record);
    byIntent.set(key, current);
  }

  const questionGroups: RunQuestionGroupV2[] = [...byIntent.entries()]
    .map(([intentType, rows]) => ({
      intentType,
      questionCount: uniqueCount(rows.map((row) => row.questionId)),
      ...buildBounds(rows),
    }))
    .sort(
      (a, b) =>
        (b.visibilityLowerBoundPct ?? -1) -
          (a.visibilityLowerBoundPct ?? -1) ||
        a.intentType.localeCompare(b.intentType, "en"),
    );

  const competitor = new Map<
    string,
    {
      responses: Set<string>;
      questions: Set<string>;
      intents: Set<string>;
      top3Responses: Set<string>;
    }
  >();

  for (const record of validRecords) {
    for (const entity of record.fact.confirmedOtherEntities) {
      const key = canonicalBusinessKey(entity.canonicalKey);
      if (!key) continue;

      if (targetKey && key === targetKey) {
        issues.push({
          code: "SELF_COMPETITOR_LEAK",
          measurementId: record.fact.measurementId,
          canonicalKey: key,
        });
        continue;
      }

      const current = competitor.get(key) ?? {
        responses: new Set<string>(),
        questions: new Set<string>(),
        intents: new Set<string>(),
        top3Responses: new Set<string>(),
      };
      current.responses.add(record.fact.measurementId);
      current.questions.add(record.questionId);
      current.intents.add(record.intentType || "other");
      if (entity.bestPosition !== null && entity.bestPosition <= 3) {
        current.top3Responses.add(record.fact.measurementId);
      }
      competitor.set(key, current);
    }
  }

  const competitors: RunCompetitorFactV2[] = [...competitor.entries()]
    .map(([canonicalKey, value]) => ({
      canonicalKey,
      responseCount: value.responses.size,
      questionCount: value.questions.size,
      intentCount: value.intents.size,
      top3ResponseCount: value.top3Responses.size,
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        b.questionCount - a.questionCount ||
        b.top3ResponseCount - a.top3ResponseCount ||
        a.canonicalKey.localeCompare(b.canonicalKey, "en"),
    );

  const sources = new Map<
    string,
    { responses: Set<string>; complete: Set<string>; partial: Set<string> }
  >();

  for (const record of validRecords) {
    for (const rawDomain of record.fact.targetCitationDomains) {
      const domain = normalizeDomain(rawDomain);
      if (!domain) continue;
      const current = sources.get(domain) ?? {
        responses: new Set<string>(),
        complete: new Set<string>(),
        partial: new Set<string>(),
      };
      current.responses.add(record.fact.measurementId);
      if (record.fact.sourceFactsStatus === "complete") {
        current.complete.add(record.fact.measurementId);
      } else {
        current.partial.add(record.fact.measurementId);
      }
      sources.set(domain, current);
    }
  }

  const targetSources: RunTargetSourceFactV2[] = [...sources.entries()]
    .map(([domain, value]) => ({
      domain,
      responseCount: value.responses.size,
      completeResponseCount: value.complete.size,
      partialResponseCount: value.partial.size,
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        b.completeResponseCount - a.completeResponseCount ||
        a.domain.localeCompare(b.domain, "en"),
    );

  const qualityFlagCounts = new Map<string, number>();
  for (const record of records) {
    for (const flag of record.fact.dataQualityFlags) {
      qualityFlagCounts.set(flag, (qualityFlagCounts.get(flag) ?? 0) + 1);
    }
  }

  const stableIssues = issues
    .map((issue) => ({
      ...issue,
      ...(issue.canonicalKey
        ? { canonicalKey: canonicalBusinessKey(issue.canonicalKey) ?? issue.canonicalKey }
        : {}),
    }))
    .sort(
      (a, b) =>
        a.code.localeCompare(b.code, "en") ||
        (a.measurementId ?? "").localeCompare(b.measurementId ?? "", "en") ||
        (a.canonicalKey ?? "").localeCompare(b.canonicalKey ?? "", "en"),
    );

  return {
    version: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    factsVersion: MEASUREMENT_ENTITY_FACTS_VERSION,
    contractOk: stableIssues.length === 0,
    contractIssues: stableIssues,
    overview: {
      ...overall,
      measurementCount: records.length,
      invalidCount: records.length - validRecords.length,
      questionCount: byQuestion.size,
      coveredQuestionCount: questionAreas.filter(
        (area) => area.status === "covered" || area.status === "partial",
      ).length,
      unresolvedQuestionCount: questionAreas.filter(
        (area) => area.status === "unresolved",
      ).length,
      missingQuestionCount: questionAreas.filter(
        (area) => area.status === "missing",
      ).length,
      sourcePartialMeasurementCount: validRecords.filter(
        (record) => record.fact.sourceFactsStatus === "partial",
      ).length,
    },
    questionGroups,
    questionAreas,
    competitors,
    targetSources,
    qualityFlagCounts: Object.fromEntries(
      [...qualityFlagCounts.entries()].sort(([a], [b]) =>
        a.localeCompare(b, "en"),
      ),
    ),
  };
}
