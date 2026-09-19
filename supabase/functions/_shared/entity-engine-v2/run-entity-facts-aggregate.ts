import type { MeasurementEntityFactsV2 } from "./measurement-entity-facts.ts";

export const RUN_ENTITY_FACTS_AGGREGATE_VERSION = "0.1" as const;

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
}

export interface RunEntityFactsAggregateV2 {
  version: typeof RUN_ENTITY_FACTS_AGGREGATE_VERSION;
  overview: VisibilityBoundsV2 & {
    invalidCount: number;
    questionCount: number;
    coveredQuestionCount: number;
    unresolvedQuestionCount: number;
    missingQuestionCount: number;
  };
  questionGroups: RunQuestionGroupV2[];
  questionAreas: RunQuestionAreaV2[];
  competitors: RunCompetitorFactV2[];
  targetSources: RunTargetSourceFactV2[];
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
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

function uniqueCount(values: string[]): number {
  return new Set(values.filter(Boolean)).size;
}

export function aggregateRunEntityFactsV2(
  records: RunMeasurementFactRecordV2[],
): RunEntityFactsAggregateV2 {
  const validRecords = records.filter((record) => record.fact.valid);
  const overall = buildBounds(records);

  const byQuestion = new Map<string, RunMeasurementFactRecordV2[]>();
  for (const record of validRecords) {
    const key = record.questionId;
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
        intentType: first.intentType,
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
    const key = record.intentType || "other";
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
      const current = competitor.get(entity.canonicalKey) ?? {
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
      competitor.set(entity.canonicalKey, current);
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

  const sourceResponses = new Map<string, Set<string>>();
  for (const record of validRecords) {
    for (const domain of record.fact.targetCitationDomains) {
      const key = domain.trim().toLowerCase().replace(/^www\./u, "");
      if (!key) continue;
      const current = sourceResponses.get(key) ?? new Set<string>();
      current.add(record.fact.measurementId);
      sourceResponses.set(key, current);
    }
  }

  const targetSources: RunTargetSourceFactV2[] = [...sourceResponses.entries()]
    .map(([domain, responses]) => ({
      domain,
      responseCount: responses.size,
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        a.domain.localeCompare(b.domain, "en"),
    );

  return {
    version: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    overview: {
      ...overall,
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
    },
    questionGroups,
    questionAreas,
    competitors,
    targetSources,
  };
}
