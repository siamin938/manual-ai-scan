import type { AcceptedReplayAttributionV2 } from "./run-source-replay.ts";

export const RUN_OBSERVED_SOURCES_VERSION = "0.1" as const;

export type RunObservedSourceEntityLinkV2 = {
  canonicalKey: string;
  side: "target" | "other";
  responseCount: number;
  attributionCount: number;
  directResponseCount: number;
  nearSectionResponseCount: number;
};

export type RunObservedSourceFactV2 = {
  domain: string;
  responseCount: number;
  targetResponseCount: number;
  otherResponseCount: number;
  attributionCount: number;
  entities: RunObservedSourceEntityLinkV2[];
};

type EntityAccumulator = {
  side: "target" | "other";
  responses: Set<string>;
  directResponses: Set<string>;
  nearSectionResponses: Set<string>;
  attributionCount: number;
};

type SourceAccumulator = {
  responses: Set<string>;
  targetResponses: Set<string>;
  otherResponses: Set<string>;
  attributionCount: number;
  entities: Map<string, EntityAccumulator>;
};

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./u, "");
}

function normalizeCanonicalKey(value: string | null): string | null {
  const key = (value ?? "").trim();
  return key || null;
}

/**
 * Builds a run-level source view from source-replay evidence that has already
 * passed v2 identity mapping and source acceptance.
 *
 * This does not decide source trust or recommendation value. It only preserves
 * which source domains appeared, whether they were linked to the target or
 * other confirmed entities, and how often those links were observed.
 */
export function buildRunObservedSourcesV2(
  acceptedAttributions: AcceptedReplayAttributionV2[],
): RunObservedSourceFactV2[] {
  const sources = new Map<string, SourceAccumulator>();

  for (const attribution of acceptedAttributions) {
    const domain = normalizeDomain(attribution.domain);
    if (!domain) continue;

    const source = sources.get(domain) ?? {
      responses: new Set<string>(),
      targetResponses: new Set<string>(),
      otherResponses: new Set<string>(),
      attributionCount: 0,
      entities: new Map<string, EntityAccumulator>(),
    };

    source.responses.add(attribution.measurementId);
    if (attribution.side === "target") {
      source.targetResponses.add(attribution.measurementId);
    } else {
      source.otherResponses.add(attribution.measurementId);
    }
    source.attributionCount += 1;

    const canonicalKey = normalizeCanonicalKey(attribution.canonicalKey);
    if (canonicalKey) {
      const entity = source.entities.get(canonicalKey) ?? {
        side: attribution.side,
        responses: new Set<string>(),
        directResponses: new Set<string>(),
        nearSectionResponses: new Set<string>(),
        attributionCount: 0,
      };

      if (entity.side === attribution.side) {
        entity.responses.add(attribution.measurementId);
        if (attribution.evidenceTier === "direct") {
          entity.directResponses.add(attribution.measurementId);
        } else {
          entity.nearSectionResponses.add(attribution.measurementId);
        }
        entity.attributionCount += 1;
        source.entities.set(canonicalKey, entity);
      }
    }

    sources.set(domain, source);
  }

  return [...sources.entries()]
    .map(([domain, source]) => ({
      domain,
      responseCount: source.responses.size,
      targetResponseCount: source.targetResponses.size,
      otherResponseCount: source.otherResponses.size,
      attributionCount: source.attributionCount,
      entities: [...source.entities.entries()]
        .map(([canonicalKey, entity]) => ({
          canonicalKey,
          side: entity.side,
          responseCount: entity.responses.size,
          attributionCount: entity.attributionCount,
          directResponseCount: entity.directResponses.size,
          nearSectionResponseCount: entity.nearSectionResponses.size,
        }))
        .sort(
          (a, b) =>
            (a.side === b.side ? 0 : a.side === "target" ? -1 : 1) ||
            b.responseCount - a.responseCount ||
            b.attributionCount - a.attributionCount ||
            a.canonicalKey.localeCompare(b.canonicalKey, "en"),
        ),
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        b.attributionCount - a.attributionCount ||
        a.domain.localeCompare(b.domain, "en"),
    );
}
