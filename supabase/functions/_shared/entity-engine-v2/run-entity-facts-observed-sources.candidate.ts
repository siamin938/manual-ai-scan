import {
  RUN_ENTITY_FACTS_AGGREGATE_VERSION,
  type RunEntityFactsAggregateV2,
} from "./run-entity-facts-aggregate.ts";
import type { RunObservedSourceFactV2 } from "./run-observed-sources.ts";

export const RUN_OBSERVED_SOURCES_AGGREGATE_CANDIDATE_VERSION = "0.1" as const;

export type RunObservedSourcesAggregateCandidateIssueCode =
  | "INVALID_TARGET_BUSINESS_ID"
  | "TARGET_SOURCE_DOMAIN_PARITY_MISMATCH"
  | "TARGET_ENTITY_KEY_MISMATCH"
  | "OTHER_ENTITY_NOT_IN_COMPETITORS"
  | "OBSERVED_SOURCE_COUNT_INVALID";

export type RunObservedSourcesAggregateCandidateIssue = {
  code: RunObservedSourcesAggregateCandidateIssueCode;
  domain?: string;
  canonicalKey?: string;
};

export type RunEntityFactsObservedSourcesAggregateCandidateV2 =
  RunEntityFactsAggregateV2 & {
    candidateVersion:
      typeof RUN_OBSERVED_SOURCES_AGGREGATE_CANDIDATE_VERSION;
    observedSources: RunObservedSourceFactV2[];
    candidateContractOk: boolean;
    candidateContractIssues: RunObservedSourcesAggregateCandidateIssue[];
  };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function normalizeBusinessKey(businessId: string): string | null {
  const id = businessId.trim().toLowerCase();
  return UUID_RE.test(id) ? `business:${id}` : null;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./u, "");
}

function stableStringSet(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en")
  );
}

export function buildRunEntityFactsObservedSourcesAggregateCandidateV2(
  targetBusinessId: string,
  aggregate: RunEntityFactsAggregateV2,
  observedSources: RunObservedSourceFactV2[],
): RunEntityFactsObservedSourcesAggregateCandidateV2 {
  const issues: RunObservedSourcesAggregateCandidateIssue[] = [];
  const targetKey = normalizeBusinessKey(targetBusinessId);

  if (!targetKey) {
    issues.push({ code: "INVALID_TARGET_BUSINESS_ID" });
  }

  const competitorKeys = new Set(
    aggregate.competitors.map((item) => item.canonicalKey.trim()).filter(Boolean),
  );

  for (const source of observedSources) {
    const domain = normalizeDomain(source.domain);

    if (
      !domain ||
      source.responseCount < 0 ||
      source.targetResponseCount < 0 ||
      source.otherResponseCount < 0 ||
      source.attributionCount < 0 ||
      source.responseCount < Math.max(
        source.targetResponseCount,
        source.otherResponseCount,
      ) ||
      source.responseCount >
        source.targetResponseCount + source.otherResponseCount
    ) {
      issues.push({
        code: "OBSERVED_SOURCE_COUNT_INVALID",
        ...(domain ? { domain } : {}),
      });
      continue;
    }

    for (const entity of source.entities) {
      if (entity.side === "target") {
        if (!targetKey || entity.canonicalKey !== targetKey) {
          issues.push({
            code: "TARGET_ENTITY_KEY_MISMATCH",
            domain,
            canonicalKey: entity.canonicalKey,
          });
        }
      } else if (!competitorKeys.has(entity.canonicalKey)) {
        issues.push({
          code: "OTHER_ENTITY_NOT_IN_COMPETITORS",
          domain,
          canonicalKey: entity.canonicalKey,
        });
      }
    }
  }

  const aggregateTargetDomains = stableStringSet(
    aggregate.targetSources.map((source) => normalizeDomain(source.domain)),
  );
  const observedTargetDomains = stableStringSet(
    observedSources
      .filter((source) => source.targetResponseCount > 0)
      .map((source) => normalizeDomain(source.domain)),
  );

  if (
    JSON.stringify(aggregateTargetDomains) !==
      JSON.stringify(observedTargetDomains)
  ) {
    issues.push({ code: "TARGET_SOURCE_DOMAIN_PARITY_MISMATCH" });
  }

  const stableIssues = issues.sort(
    (a, b) =>
      a.code.localeCompare(b.code, "en") ||
      (a.domain ?? "").localeCompare(b.domain ?? "", "en") ||
      (a.canonicalKey ?? "").localeCompare(b.canonicalKey ?? "", "en"),
  );

  return {
    ...aggregate,
    version: RUN_ENTITY_FACTS_AGGREGATE_VERSION,
    candidateVersion: RUN_OBSERVED_SOURCES_AGGREGATE_CANDIDATE_VERSION,
    observedSources,
    candidateContractOk: stableIssues.length === 0,
    candidateContractIssues: stableIssues,
  };
}
