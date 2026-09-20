import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateRunEntityFactsV2,
  type RunCompetitorFactV2,
  type RunMeasurementFactRecordV2,
  type RunQuestionAreaV2,
  type RunQuestionGroupV2,
  type RunTargetSourceFactV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-entity-facts-aggregate";
import {
  replayHistoricalMeasurementV2,
  type ReplayBusinessIdentityV2,
  type ReplayPublicIdentityV2,
  type ReplayStoredMentionV2,
} from "../supabase/functions/_shared/entity-engine-v2/historical-measurement-replay";
import type { RawParserTargetSignalV2 } from "../supabase/functions/_shared/entity-engine-v2/measurement-entity-facts";
import {
  replayRunSourcesV2,
  type ReplayRawAttributionV2,
} from "../supabase/functions/_shared/entity-engine-v2/run-source-replay";

export interface Phase2CCurrentCompetitorBaseline {
  canonicalKey: string;
  name: string;
}

export interface Phase2CCurrentTargetSourceBaseline {
  domain: string;
  responseCount: number;
}

export interface Phase2CReplayDatasetRow {
  measurementId: string;
  runId: string;
  businessId: string;
  questionId: string;
  questionText: string;
  intentType: string;
  valid: boolean;
  responseText: string;
  rawParser: RawParserTargetSignalV2;
  target: ReplayBusinessIdentityV2;
  registeredBusinesses: ReplayBusinessIdentityV2[];
  storedMentions: ReplayStoredMentionV2[];
  attributions: ReplayRawAttributionV2[];
  currentCompetitors: Phase2CCurrentCompetitorBaseline[];
  currentTargetSources: Phase2CCurrentTargetSourceBaseline[];
}

export interface Phase2CReplayDataset {
  version: string;
  source?: string;
  publicIdentities: ReplayPublicIdentityV2[];
  rows: Phase2CReplayDatasetRow[];
}

export interface CurrentRunMetricsV2 {
  validCount: number;
  mentionCount: number;
  top3Count: number;
  visibilityRatePct: number | null;
  top3RatePct: number | null;
  competitorKeys: string[];
  targetSourceDomains: string[];
}

export interface Phase2CCompetitorDeltaSupportV2 {
  measurementId: string;
  entityRef: string | null;
  identitySurface: string | null;
  identityDecision: string | null;
  relationSide: string | null;
  relationCanonicalKey: string | null;
  relationReasonCodes: string[];
  storedMentionIds: string[];
  storedDisplayNames: string[];
  storedCanonicalKeys: string[];
}

export interface Phase2CCompetitorDeltaEvidenceV2 {
  direction: "added" | "removed";
  canonicalKey: string;
  support: Phase2CCompetitorDeltaSupportV2[];
}

export interface Phase2CRunDiff {
  runId: string;
  businessId: string;
  businessName: string;
  current: CurrentRunMetricsV2;
  proposed: {
    confirmedMentionCount: number;
    unresolvedTargetCount: number;
    visibilityLowerBoundPct: number | null;
    visibilityUpperBoundPct: number | null;
    confirmedTop3Count: number;
    top3UncertainCount: number;
    top3LowerBoundPct: number | null;
    top3UpperBoundPct: number | null;
    competitorCount: number;
    questionGroups: RunQuestionGroupV2[];
    questionAreas: RunQuestionAreaV2[];
    competitors: RunCompetitorFactV2[];
    targetSources: RunTargetSourceFactV2[];
    sourceReplayStatus: "evaluated";
    sourceDomainCount: number;
    sourcePartialMeasurementCount: number;
    acceptedAttributionCount: number;
    sourceDiagnosticCount: number;
  };
  currentVisibilityInsideProposedBounds: boolean | null;
  currentTop3InsideProposedBounds: boolean | null;
  competitorAdded: string[];
  competitorRemoved: string[];
  competitorDeltaEvidence: Phase2CCompetitorDeltaEvidenceV2[];
  targetSourceAdded: string[];
  targetSourceRemoved: string[];
  contractOk: boolean;
  contractIssues: ReturnType<typeof aggregateRunEntityFactsV2>["contractIssues"];
  qualityFlagCounts: Record<string, number>;
  replayDiagnostics: Record<string, number>;
}

export type Phase2CReplayGateIssueCode =
  | "RUN_CONTRACT_ISSUE"
  | "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS"
  | "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS"
  | "CURRENT_COMPETITOR_SET_CHANGED"
  | "CURRENT_TARGET_SOURCE_REMOVED";

export interface Phase2CReplayGateIssue {
  code: Phase2CReplayGateIssueCode;
  runId: string;
  detail: string;
}

export interface Phase2CReplayReleaseGate {
  version: "0.1";
  ok: boolean;
  blockingIssueCount: number;
  issues: Phase2CReplayGateIssue[];
  checks: {
    contractIssueRuns: number;
    visibilityOutsideBoundsRuns: number;
    top3OutsideBoundsRuns: number;
    competitorChangedRuns: number;
    targetSourceRemovalRuns: number;
  };
}

export interface Phase2CReplayReport {
  version: "0.1";
  datasetVersion: string;
  generatedAt: string;
  summary: {
    runCount: number;
    measurementCount: number;
    validMeasurementCount: number;
    invalidMeasurementCount: number;
    contractIssueRunCount: number;
    visibilityOutsideBoundsRunCount: number;
    top3OutsideBoundsRunCount: number;
    unresolvedRunCount: number;
    sourceReplayStatus: "evaluated";
    sourcePartialRunCount: number;
    acceptedAttributionCount: number;
    sourceDiagnosticCount: number;
  };
  runs: Phase2CRunDiff[];
  releaseGate: Phase2CReplayReleaseGate;
}

function competitorDeltaIsEvidenceBacked(
  delta: Phase2CCompetitorDeltaEvidenceV2,
): boolean {
  if (delta.support.length === 0) return false;

  if (delta.direction === "added") {
    return delta.support.every((item) =>
      Boolean(item.entityRef) &&
      item.identityDecision === "confirmed_business" &&
      item.relationSide === "other" &&
      item.relationCanonicalKey === delta.canonicalKey &&
      item.relationReasonCodes.includes(
        "AUTHORITATIVE_OTHER_BY_TARGET_CANDIDATE",
      )
    );
  }

  return delta.support.every((item) => {
    if (!item.entityRef) return false;
    if (!item.storedCanonicalKeys.includes(delta.canonicalKey)) return false;

    if (
      item.identityDecision === "non_business" ||
      item.identityDecision === "platform" ||
      item.identityDecision === "brand_network" ||
      item.identityDecision === "unresolved"
    ) {
      return item.relationSide === "excluded";
    }

    if (
      item.identityDecision === "confirmed_business" &&
      item.relationSide === "unresolved"
    ) {
      return item.relationReasonCodes.includes(
        "TARGET_CANDIDATE_CANDIDATE",
      );
    }

    return false;
  });
}

function buildReleaseGate(
  runs: Phase2CRunDiff[],
): Phase2CReplayReleaseGate {
  const issues: Phase2CReplayGateIssue[] = [];

  for (const run of runs) {
    if (!run.contractOk) {
      issues.push({
        code: "RUN_CONTRACT_ISSUE",
        runId: run.runId,
        detail: run.contractIssues.map((item) => item.code).join(",") ||
          "Run aggregate contract failed.",
      });
    }
    if (run.currentVisibilityInsideProposedBounds === false) {
      issues.push({
        code: "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS",
        runId: run.runId,
        detail:
          `Current visibility ${run.current.visibilityRatePct} is outside proposed bounds ${run.proposed.visibilityLowerBoundPct}-${run.proposed.visibilityUpperBoundPct}.`,
      });
    }
    if (run.currentTop3InsideProposedBounds === false) {
      issues.push({
        code: "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS",
        runId: run.runId,
        detail:
          `Current Top3 ${run.current.top3RatePct} is outside proposed bounds ${run.proposed.top3LowerBoundPct}-${run.proposed.top3UpperBoundPct}.`,
      });
    }
    const unsafeCompetitorDeltas = run.competitorDeltaEvidence.filter(
      (delta) => !competitorDeltaIsEvidenceBacked(delta),
    );
    if (unsafeCompetitorDeltas.length > 0) {
      const unsafeAdded = unsafeCompetitorDeltas
        .filter((delta) => delta.direction === "added")
        .map((delta) => delta.canonicalKey);
      const unsafeRemoved = unsafeCompetitorDeltas
        .filter((delta) => delta.direction === "removed")
        .map((delta) => delta.canonicalKey);
      issues.push({
        code: "CURRENT_COMPETITOR_SET_CHANGED",
        runId: run.runId,
        detail:
          `Unreviewed competitor change. Added=${unsafeAdded.join("|")}; Removed=${unsafeRemoved.join("|")}.`,
      });
    }
    if (run.targetSourceRemoved.length > 0) {
      issues.push({
        code: "CURRENT_TARGET_SOURCE_REMOVED",
        runId: run.runId,
        detail:
          `Current target source domains disappeared: ${run.targetSourceRemoved.join("|")}.`,
      });
    }
  }

  issues.sort(
    (a, b) =>
      a.runId.localeCompare(b.runId, "en") ||
      a.code.localeCompare(b.code, "en"),
  );

  const count = (code: Phase2CReplayGateIssueCode) =>
    issues.filter((issue) => issue.code === code).length;

  return {
    version: "0.1",
    ok: issues.length === 0,
    blockingIssueCount: issues.length,
    issues,
    checks: {
      contractIssueRuns: count("RUN_CONTRACT_ISSUE"),
      visibilityOutsideBoundsRuns: count(
        "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS",
      ),
      top3OutsideBoundsRuns: count(
        "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS",
      ),
      competitorChangedRuns: count("CURRENT_COMPETITOR_SET_CHANGED"),
      targetSourceRemovalRuns: count("CURRENT_TARGET_SOURCE_REMOVED"),
    },
  };
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function currentMetrics(rows: Phase2CReplayDatasetRow[]): CurrentRunMetricsV2 {
  const valid = rows.filter((row) => row.valid);
  const mentionCount = valid.filter(
    (row) => row.rawParser.wasClientMentioned,
  ).length;
  const top3Count = valid.filter(
    (row) =>
      row.rawParser.wasClientMentioned &&
      typeof row.rawParser.clientPosition === "number" &&
      Number.isInteger(row.rawParser.clientPosition) &&
      row.rawParser.clientPosition >= 1 &&
      row.rawParser.clientPosition <= 3,
  ).length;
  return {
    validCount: valid.length,
    mentionCount,
    top3Count,
    visibilityRatePct: pct(mentionCount, valid.length),
    top3RatePct: pct(top3Count, valid.length),
    competitorKeys: [],
    targetSourceDomains: [],
  };
}

function inside(
  value: number | null,
  lower: number | null,
  upper: number | null,
): boolean | null {
  if (value === null || lower === null || upper === null) return null;
  return value >= lower - 0.005 && value <= upper + 0.005;
}

function countDiagnostics(
  values: string[],
): Record<string, number> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

function competitorDeltaEvidence(
  direction: "added" | "removed",
  canonicalKeys: string[],
  preliminary: Array<{
    row: Phase2CReplayDatasetRow;
    replay: ReturnType<typeof replayHistoricalMeasurementV2>;
  }>,
): Phase2CCompetitorDeltaEvidenceV2[] {
  return canonicalKeys.map((canonicalKey) => {
    const support: Phase2CCompetitorDeltaSupportV2[] = [];

    for (const { row, replay } of preliminary) {
      const relationByRef = new Map(
        replay.facts.entityRelations.map((relation) => [
          relation.entityRef,
          relation,
        ]),
      );
      const decisionByRef = new Map(
        replay.identityDecisions.map((decision) => [
          decision.candidateId,
          decision,
        ]),
      );
      const linkByRef = new Map(
        replay.entityMentionLinks.map((link) => [link.entityRef, link]),
      );
      const storedById = new Map(
        row.storedMentions.map((mention) => [mention.mentionId, mention]),
      );

      const refs = new Set<string>();

      if (direction === "added") {
        for (const relation of replay.facts.entityRelations) {
          if (
            relation.side === "other" &&
            relation.canonicalKey === canonicalKey
          ) {
            refs.add(relation.entityRef);
          }
        }
      } else {
        const mentionIds = row.storedMentions
          .filter((mention) => mention.canonicalKey === canonicalKey)
          .map((mention) => mention.mentionId);

        for (const link of replay.entityMentionLinks) {
          if (link.mentionIds.some((id) => mentionIds.includes(id))) {
            refs.add(link.entityRef);
          }
        }

        if (mentionIds.length > 0 && refs.size === 0) {
          support.push({
            measurementId: row.measurementId,
            entityRef: null,
            identitySurface: null,
            identityDecision: null,
            relationSide: null,
            relationCanonicalKey: null,
            relationReasonCodes: ["STORED_COMPETITOR_MENTION_NOT_LINKED_TO_REPLAY_ENTITY"],
            storedMentionIds: [...mentionIds].sort((a, b) =>
              a.localeCompare(b, "en")
            ),
            storedDisplayNames: row.storedMentions
              .filter((mention) => mentionIds.includes(mention.mentionId))
              .map((mention) => mention.displayName)
              .sort((a, b) => a.localeCompare(b, "ko")),
            storedCanonicalKeys: [canonicalKey],
          });
        }
      }

      for (const entityRef of [...refs].sort((a, b) =>
        a.localeCompare(b, "en")
      )) {
        const relation = relationByRef.get(entityRef);
        const decision = decisionByRef.get(entityRef);
        const linkedIds = linkByRef.get(entityRef)?.mentionIds ?? [];
        const linkedMentions = linkedIds
          .map((id) => storedById.get(id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item));

        support.push({
          measurementId: row.measurementId,
          entityRef,
          identitySurface: decision?.identitySurface ?? null,
          identityDecision: decision?.decision ?? null,
          relationSide: relation?.side ?? null,
          relationCanonicalKey: relation?.canonicalKey ?? null,
          relationReasonCodes: [...(relation?.relationReasonCodes ?? [])],
          storedMentionIds: linkedMentions
            .map((mention) => mention.mentionId)
            .sort((a, b) => a.localeCompare(b, "en")),
          storedDisplayNames: linkedMentions
            .map((mention) => mention.displayName)
            .sort((a, b) => a.localeCompare(b, "ko")),
          storedCanonicalKeys: [
            ...new Set(
              linkedMentions
                .map((mention) => mention.canonicalKey ?? "")
                .filter(Boolean),
            ),
          ].sort((a, b) => a.localeCompare(b, "en")),
        });
      }
    }

    support.sort(
      (a, b) =>
        a.measurementId.localeCompare(b.measurementId, "en") ||
        (a.entityRef ?? "").localeCompare(b.entityRef ?? "", "en"),
    );

    return {
      direction,
      canonicalKey,
      support,
    };
  });
}

export function replayPhase2CDataset(
  dataset: Phase2CReplayDataset,
): Phase2CReplayReport {
  const byRun = new Map<string, Phase2CReplayDatasetRow[]>();
  for (const row of dataset.rows) {
    const current = byRun.get(row.runId) ?? [];
    current.push(row);
    byRun.set(row.runId, current);
  }

  const runs: Phase2CRunDiff[] = [];

  for (const [runId, rows] of [...byRun.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const first = rows[0]!;
    const diagnosticCodes: string[] = [];

    const preliminary = rows.map((row) => {
      const replay = replayHistoricalMeasurementV2({
        measurementId: row.measurementId,
        valid: row.valid,
        responseText: row.responseText,
        rawParser: row.rawParser,
        target: row.target,
        registeredBusinesses: row.registeredBusinesses,
        publicIdentities: dataset.publicIdentities,
        storedMentions: row.storedMentions,
      });

      diagnosticCodes.push(
        ...replay.diagnostics
          .map((item) => item.code)
          .filter((code) => code !== "SOURCE_REPLAY_NOT_EVALUATED"),
      );

      return { row, replay };
    });

    const sourceReplay = replayRunSourcesV2(
      preliminary.map(({ row, replay }) => ({
        measurementId: row.measurementId,
        responseText: row.responseText,
        targetBusinessId: row.businessId,
        valid: row.valid,
        rawParser: row.rawParser,
        observations: replay.observations,
        preliminaryFacts: replay.facts,
        entityMentionLinks: replay.entityMentionLinks,
        attributions: row.attributions ?? [],
      })),
    );

    diagnosticCodes.push(
      ...sourceReplay.diagnostics.map((item) => item.code),
    );

    const sourceFactsByMeasurement = new Map(
      sourceReplay.factsByMeasurement.map((item) => [
        item.measurementId,
        item.facts,
      ]),
    );

    const factsRecords: RunMeasurementFactRecordV2[] = preliminary.map(
      ({ row, replay }) => ({
        fact: sourceFactsByMeasurement.get(row.measurementId) ?? replay.facts,
        questionId: row.questionId,
        questionText: row.questionText,
        intentType: row.intentType,
      }),
    );

    const aggregate = aggregateRunEntityFactsV2(
      first.businessId,
      factsRecords,
    );
    const current = currentMetrics(rows);
    current.competitorKeys = [
      ...new Set(
        (first.currentCompetitors ?? [])
          .map((item) => item.canonicalKey.trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "en"));
    current.targetSourceDomains = [
      ...new Set(
        (first.currentTargetSources ?? [])
          .map((item) => item.domain.trim().toLowerCase().replace(/^www\./u, ""))
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "en"));
    const proposed = {
      confirmedMentionCount: aggregate.overview.confirmedMentionCount,
      unresolvedTargetCount: aggregate.overview.unresolvedTargetCount,
      visibilityLowerBoundPct: aggregate.overview.visibilityLowerBoundPct,
      visibilityUpperBoundPct: aggregate.overview.visibilityUpperBoundPct,
      confirmedTop3Count: aggregate.overview.confirmedTop3Count,
      top3UncertainCount: aggregate.overview.top3UncertainCount,
      top3LowerBoundPct: aggregate.overview.top3LowerBoundPct,
      top3UpperBoundPct: aggregate.overview.top3UpperBoundPct,
      competitorCount: aggregate.competitors.length,
      questionGroups: aggregate.questionGroups,
      questionAreas: aggregate.questionAreas,
      competitors: aggregate.competitors,
      targetSources: aggregate.targetSources,
      sourceReplayStatus: "evaluated" as const,
      sourceDomainCount: aggregate.targetSources.length,
      sourcePartialMeasurementCount:
        aggregate.overview.sourcePartialMeasurementCount,
      acceptedAttributionCount: sourceReplay.acceptedAttributions.length,
      sourceDiagnosticCount: sourceReplay.diagnostics.length,
    };

    const proposedCompetitorKeys = aggregate.competitors
      .map((item) => item.canonicalKey)
      .sort((a, b) => a.localeCompare(b, "en"));
    const proposedTargetSourceDomains = aggregate.targetSources
      .map((item) => item.domain)
      .sort((a, b) => a.localeCompare(b, "en"));
    const currentCompetitorSet = new Set(current.competitorKeys);
    const proposedCompetitorSet = new Set(proposedCompetitorKeys);
    const currentSourceSet = new Set(current.targetSourceDomains);
    const proposedSourceSet = new Set(proposedTargetSourceDomains);

    const competitorAdded = proposedCompetitorKeys.filter(
      (key) => !currentCompetitorSet.has(key),
    );
    const competitorRemoved = current.competitorKeys.filter(
      (key) => !proposedCompetitorSet.has(key),
    );
    const competitorDeltaReview = [
      ...competitorDeltaEvidence("added", competitorAdded, preliminary),
      ...competitorDeltaEvidence("removed", competitorRemoved, preliminary),
    ].sort(
      (a, b) =>
        a.direction.localeCompare(b.direction, "en") ||
        a.canonicalKey.localeCompare(b.canonicalKey, "en"),
    );

    runs.push({
      runId,
      businessId: first.businessId,
      businessName: first.target.name,
      current,
      proposed,
      currentVisibilityInsideProposedBounds: inside(
        current.visibilityRatePct,
        proposed.visibilityLowerBoundPct,
        proposed.visibilityUpperBoundPct,
      ),
      currentTop3InsideProposedBounds: inside(
        current.top3RatePct,
        proposed.top3LowerBoundPct,
        proposed.top3UpperBoundPct,
      ),
      competitorAdded,
      competitorRemoved,
      competitorDeltaEvidence: competitorDeltaReview,
      targetSourceAdded: proposedTargetSourceDomains.filter(
        (domain) => !currentSourceSet.has(domain),
      ),
      targetSourceRemoved: current.targetSourceDomains.filter(
        (domain) => !proposedSourceSet.has(domain),
      ),
      contractOk: aggregate.contractOk,
      contractIssues: aggregate.contractIssues,
      qualityFlagCounts: aggregate.qualityFlagCounts,
      replayDiagnostics: countDiagnostics(diagnosticCodes),
    });
  }

  const releaseGate = buildReleaseGate(runs);

  return {
    version: "0.1",
    datasetVersion: dataset.version,
    generatedAt: new Date().toISOString(),
    summary: {
      runCount: runs.length,
      measurementCount: dataset.rows.length,
      validMeasurementCount: dataset.rows.filter((row) => row.valid).length,
      invalidMeasurementCount: dataset.rows.filter((row) => !row.valid).length,
      contractIssueRunCount: runs.filter((run) => !run.contractOk).length,
      visibilityOutsideBoundsRunCount: runs.filter(
        (run) => run.currentVisibilityInsideProposedBounds === false,
      ).length,
      top3OutsideBoundsRunCount: runs.filter(
        (run) => run.currentTop3InsideProposedBounds === false,
      ).length,
      unresolvedRunCount: runs.filter(
        (run) => run.proposed.unresolvedTargetCount > 0,
      ).length,
      sourceReplayStatus: "evaluated",
      sourcePartialRunCount: runs.filter(
        (run) => run.proposed.sourcePartialMeasurementCount > 0,
      ).length,
      acceptedAttributionCount: runs.reduce(
        (sum, run) => sum + run.proposed.acceptedAttributionCount,
        0,
      ),
      sourceDiagnosticCount: runs.reduce(
        (sum, run) => sum + run.proposed.sourceDiagnosticCount,
        0,
      ),
    },
    runs,
    releaseGate,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "Usage: bun scripts/entity-facts-phase2c-replay.ts <dataset.json>",
    );
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(
      readFileSync(resolve(inputPath), "utf8"),
    ) as Phase2CReplayDataset;
    console.log(JSON.stringify(replayPhase2CDataset(dataset), null, 2));
  }
}
