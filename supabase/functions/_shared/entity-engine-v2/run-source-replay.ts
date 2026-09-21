import {
  buildMeasurementEntityFactsV2,
  type MeasurementAttributionObservationV2,
  type MeasurementEntityFactsV2,
  type MeasurementEntityObservationV2,
  type RawParserTargetSignalV2,
} from "./measurement-entity-facts.ts";
import type { ReplayEntityMentionLinkV2 } from "./historical-measurement-replay.ts";

export const RUN_SOURCE_REPLAY_VERSION = "0.1" as const;
export const RUN_COMPETITOR_SOURCE_CLUE_VERSION = "0.1" as const;

export type ReplayAttributionLevelV2 = "direct" | "section" | string;

export interface ReplayRawAttributionV2 {
  attributionId: string;
  measurementMentionId?: string | null;
  canonicalKey?: string | null;
  domain: string;
  url: string;
  title?: string | null;
  attributionLevel: ReplayAttributionLevelV2;
  evidence?: Record<string, unknown> | null;
  citationStartIndex?: number | null;
  entityEndIndex?: number | null;
}

export interface RunSourceReplayMeasurementInputV2 {
  measurementId: string;
  responseText: string;
  targetBusinessId: string;
  valid: boolean;
  rawParser: RawParserTargetSignalV2;
  observations: MeasurementEntityObservationV2[];
  preliminaryFacts: MeasurementEntityFactsV2;
  entityMentionLinks: ReplayEntityMentionLinkV2[];
  attributions: ReplayRawAttributionV2[];
}

export type RunSourceReplayDiagnosticCodeV2 =
  | "ATTRIBUTION_ENTITY_MAPPING_UNRESOLVED"
  | "ATTRIBUTION_ENTITY_MAPPING_CONFLICT";

export interface RunSourceReplayDiagnosticV2 {
  code: RunSourceReplayDiagnosticCodeV2;
  measurementId: string;
  attributionId: string;
  detail: string;
}

export interface AcceptedReplayAttributionV2 {
  measurementId: string;
  attributionId: string;
  entityRef: string;
  canonicalKey: string | null;
  side: "target" | "other";
  domain: string;
  url: string;
  evidenceTier: "direct" | "near_section";
}

export interface ReplayCompetitorSourceClueV2 {
  domain: string;
  canonicalKey: string;
  responseCount: number;
  attributionCount: number;
  evidenceTier: "near_section_title_match";
}

/**
 * Target-linked source evidence that is valid enough to show as a clue, but
 * not repeated enough to be promoted into targetCitationDomains.
 *
 * This is intentionally advisory output only: it must never turn unresolved
 * identity or competitor evidence into a target source.
 */
export interface ReplayTargetReferenceSourceV2 {
  domain: string;
  responseCount: number;
  evidenceTier: "near_section";
}

export interface RunSourceReplayResultV2 {
  version: typeof RUN_SOURCE_REPLAY_VERSION;
  sourceReplayStatus: "evaluated";
  factsByMeasurement: Array<{
    measurementId: string;
    facts: MeasurementEntityFactsV2;
  }>;
  acceptedAttributions: AcceptedReplayAttributionV2[];
  competitorSourceClueVersion: typeof RUN_COMPETITOR_SOURCE_CLUE_VERSION;
  competitorSourceClues: ReplayCompetitorSourceClueV2[];
  targetReferenceSources: ReplayTargetReferenceSourceV2[];
  diagnostics: RunSourceReplayDiagnosticV2[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function normalizeCanonicalKey(value: string | null | undefined): string {
  const key = (value ?? "").trim();
  if (!key.startsWith("business:")) return key;
  const id = key.slice("business:".length).toLowerCase();
  return UUID_RE.test(id) ? `business:${id}` : key;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./u, "");
}

function normalizeIdentitySurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function strictCompetitorTitleMatch(
  canonicalKey: string | null,
  title: string | null | undefined,
): boolean {
  const key = normalizeCanonicalKey(canonicalKey);
  if (!key.startsWith("auto:")) return false;

  const expected = normalizeIdentitySurface(key.slice("auto:".length));
  const titleSurface = normalizeIdentitySurface(title ?? "");
  return expected.length >= 4 && titleSurface.includes(expected);
}

function sourceGroup(domain: string): string {
  if (domain === "blog.naver.com" || domain.endsWith(".tistory.com")) {
    return "blog";
  }
  if (domain === "cafe.naver.com") return "community";
  if (
    domain === "m.place.naver.com" ||
    domain === "place.naver.com" ||
    domain === "map.naver.com"
  ) {
    return "profile_map";
  }
  if (domain === "oh-car.kr" || domain.endsWith(".oh-car.kr")) {
    return "auto_platform";
  }
  if (
    domain === "youtube.com" ||
    domain === "youtu.be" ||
    domain.endsWith(".youtube.com")
  ) {
    return "video";
  }
  if (
    domain === "newsis.com" ||
    domain === "v.daum.net" ||
    domain === "n.news.naver.com"
  ) {
    return "news";
  }
  return "other";
}

function infrastructureHost(domain: string): boolean {
  return (
    domain === "s3.amazonaws.com" ||
    domain.endsWith(".s3.amazonaws.com") ||
    /\.s3[.-][^.]+\.amazonaws\.com$/u.test(domain) ||
    domain === "storage.googleapis.com" ||
    domain.endsWith(".blob.core.windows.net") ||
    domain.endsWith(".r2.cloudflarestorage.com") ||
    domain.endsWith(".digitaloceanspaces.com")
  );
}

function distanceChars(
  evidence: Record<string, unknown> | null | undefined,
): number | null {
  const raw = evidence?.["distance_chars"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function evidenceTier(
  attribution: ReplayRawAttributionV2,
): "direct" | "near_section" | null {
  if (attribution.attributionLevel === "direct") return "direct";
  const distance = distanceChars(attribution.evidence);
  return attribution.attributionLevel === "section" &&
      distance !== null &&
      distance <= 250
    ? "near_section"
    : null;
}

function comparativeTarget(
  responseText: string,
  attribution: ReplayRawAttributionV2,
): boolean {
  const end = attribution.entityEndIndex;
  const citation = attribution.citationStartIndex;
  if (
    typeof end !== "number" ||
    typeof citation !== "number" ||
    !Number.isInteger(end) ||
    !Number.isInteger(citation) ||
    citation <= end
  ) {
    return false;
  }

  const between = responseText.slice(
    Math.max(0, end),
    Math.min(responseText.length, Math.max(end, citation)),
  ).slice(0, 120);
  const cleaned = between.replace(
    /^[\s*_\x60~()\[\]{}<>:;,.!?—–-]+/u,
    "",
  );
  return /^(?:보다|에\s*비해|에\s*비해서|와\s*비교|과\s*비교|대비해|대비해서)/u.test(
    cleaned,
  );
}

function validUrlState(
  urlValue: string,
): "validated_http_https" | "invalid" {
  try {
    const url = new URL(urlValue);
    return url.protocol === "http:" || url.protocol === "https:"
      ? "validated_http_https"
      : "invalid";
  } catch {
    return "invalid";
  }
}

type ResolvedSide = {
  entityRef: string;
  side: "target" | "other";
  canonicalKey: string | null;
};

function resolveAttributionEntity(
  measurement: RunSourceReplayMeasurementInputV2,
  attribution: ReplayRawAttributionV2,
): { resolved: ResolvedSide | null; conflict: boolean } {
  const relationByRef = new Map(
    measurement.preliminaryFacts.entityRelations.map((relation) => [
      relation.entityRef,
      relation,
    ]),
  );

  let refs: string[] = [];
  const mentionId = (attribution.measurementMentionId ?? "").trim();
  if (mentionId) {
    refs = measurement.entityMentionLinks
      .filter((link) => link.mentionIds.includes(mentionId))
      .map((link) => link.entityRef);
  } else {
    const key = normalizeCanonicalKey(attribution.canonicalKey);
    if (key) {
      refs = measurement.preliminaryFacts.entityRelations
        .filter(
          (relation) =>
            (relation.side === "target" || relation.side === "other") &&
            normalizeCanonicalKey(relation.canonicalKey) === key,
        )
        .map((relation) => relation.entityRef);
    }
  }

  const candidates = [...new Set(refs)]
    .map((ref) => relationByRef.get(ref))
    .filter(
      (
        relation,
      ): relation is NonNullable<typeof relation> =>
        Boolean(
          relation &&
            (relation.side === "target" || relation.side === "other"),
        ),
    )
    .map((relation) => ({
      entityRef: relation.entityRef,
      side: relation.side as "target" | "other",
      canonicalKey: relation.canonicalKey,
    }))
    .sort((a, b) => a.entityRef.localeCompare(b.entityRef, "en"));

  if (candidates.length === 0) {
    return { resolved: null, conflict: false };
  }

  const semantic = new Set(
    candidates.map(
      (candidate) =>
        `${candidate.side}|${normalizeCanonicalKey(candidate.canonicalKey)}`,
    ),
  );
  if (semantic.size !== 1) {
    return { resolved: null, conflict: true };
  }

  return { resolved: candidates[0]!, conflict: false };
}

function potentialActionable(
  measurement: RunSourceReplayMeasurementInputV2,
  attribution: ReplayRawAttributionV2,
): {
  tier: "direct" | "near_section";
  domain: string;
} | null {
  const domain = normalizeDomain(attribution.domain);
  if (!domain || domain === "(unknown)") return null;
  if (infrastructureHost(domain)) return null;
  if (comparativeTarget(measurement.responseText, attribution)) return null;

  const tier = evidenceTier(attribution);
  if (!tier) return null;
  if (tier === "near_section" && sourceGroup(domain) === "news") {
    return null;
  }
  return { tier, domain };
}

export function replayRunSourcesV2(
  measurements: RunSourceReplayMeasurementInputV2[],
): RunSourceReplayResultV2 {
  const diagnostics: RunSourceReplayDiagnosticV2[] = [];

  const candidates = measurements.flatMap((measurement) =>
    measurement.attributions.flatMap((attribution) => {
      const actionable = potentialActionable(measurement, attribution);
      if (!actionable) return [];

      const mapping = resolveAttributionEntity(measurement, attribution);
      if (!mapping.resolved) {
        diagnostics.push({
          code: mapping.conflict
            ? "ATTRIBUTION_ENTITY_MAPPING_CONFLICT"
            : "ATTRIBUTION_ENTITY_MAPPING_UNRESOLVED",
          measurementId: measurement.measurementId,
          attributionId: attribution.attributionId,
          detail: mapping.conflict
            ? "Attribution maps to multiple semantic entity sides."
            : "Attribution could be actionable but cannot be mapped to a target/other entity relation.",
        });
      }

      return [
        {
          measurement,
          attribution,
          actionable,
          mapping,
        },
      ];
    }),
  );

  const nearSupport = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (
      candidate.actionable.tier !== "near_section" ||
      !candidate.mapping.resolved
    ) {
      continue;
    }
    const key =
      `${candidate.mapping.resolved.side}|${candidate.actionable.domain}`;
    const set = nearSupport.get(key) ?? new Set<string>();
    set.add(candidate.measurement.measurementId);
    nearSupport.set(key, set);
  }

  const acceptedAttributions: AcceptedReplayAttributionV2[] = [];
  const competitorClueAttributions: Array<{
    domain: string;
    canonicalKey: string;
    measurementId: string;
    attributionId: string;
  }> = [];
  const targetReferenceResponses = new Map<string, Set<string>>();
  const builderAttributions = new Map<
    string,
    MeasurementAttributionObservationV2[]
  >();

  for (const candidate of candidates) {
    const {
      measurement,
      attribution,
      actionable,
      mapping,
    } = candidate;
    const current =
      builderAttributions.get(measurement.measurementId) ?? [];

    if (!mapping.resolved) {
      current.push({
        attributionId: attribution.attributionId,
        entityRef: `missing:${attribution.attributionId}`,
        domain: attribution.domain,
        url: attribution.url,
        urlValidation: validUrlState(attribution.url),
      });
      builderAttributions.set(measurement.measurementId, current);
      continue;
    }

    const supportKey =
      `${mapping.resolved.side}|${actionable.domain}`;
    const accepted =
      actionable.tier === "direct" ||
      (nearSupport.get(supportKey)?.size ?? 0) >= 2;
    if (!accepted) {
      if (
        mapping.resolved.side === "target" &&
        actionable.tier === "near_section"
      ) {
        const responses =
          targetReferenceResponses.get(actionable.domain) ?? new Set<string>();
        responses.add(measurement.measurementId);
        targetReferenceResponses.set(actionable.domain, responses);
      }

      const mentionId = (attribution.measurementMentionId ?? "").trim();
      const canonicalKey = mapping.resolved.canonicalKey
        ? normalizeCanonicalKey(mapping.resolved.canonicalKey)
        : "";
      if (
        mapping.resolved.side === "other" &&
        actionable.tier === "near_section" &&
        mentionId &&
        canonicalKey &&
        strictCompetitorTitleMatch(canonicalKey, attribution.title)
      ) {
        competitorClueAttributions.push({
          domain: actionable.domain,
          canonicalKey,
          measurementId: measurement.measurementId,
          attributionId: attribution.attributionId,
        });
      }
      continue;
    }

    current.push({
      attributionId: attribution.attributionId,
      entityRef: mapping.resolved.entityRef,
      domain: attribution.domain,
      url: attribution.url,
      urlValidation: validUrlState(attribution.url),
    });
    builderAttributions.set(measurement.measurementId, current);

    acceptedAttributions.push({
      measurementId: measurement.measurementId,
      attributionId: attribution.attributionId,
      entityRef: mapping.resolved.entityRef,
      canonicalKey: mapping.resolved.canonicalKey
        ? normalizeCanonicalKey(mapping.resolved.canonicalKey)
        : null,
      side: mapping.resolved.side,
      domain: actionable.domain,
      url: attribution.url,
      evidenceTier: actionable.tier,
    });
  }

  const competitorClueGroups = new Map<
    string,
    {
      domain: string;
      canonicalKey: string;
      responses: Set<string>;
      attributionIds: Set<string>;
    }
  >();
  for (const clue of competitorClueAttributions) {
    const groupKey = `${clue.domain}\u0000${clue.canonicalKey}`;
    const group = competitorClueGroups.get(groupKey) ?? {
      domain: clue.domain,
      canonicalKey: clue.canonicalKey,
      responses: new Set<string>(),
      attributionIds: new Set<string>(),
    };
    group.responses.add(clue.measurementId);
    group.attributionIds.add(clue.attributionId);
    competitorClueGroups.set(groupKey, group);
  }

  const competitorSourceClues: ReplayCompetitorSourceClueV2[] = [
    ...competitorClueGroups.values(),
  ]
    .map((group) => ({
      domain: group.domain,
      canonicalKey: group.canonicalKey,
      responseCount: group.responses.size,
      attributionCount: group.attributionIds.size,
      evidenceTier: "near_section_title_match" as const,
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        b.attributionCount - a.attributionCount ||
        a.domain.localeCompare(b.domain, "en") ||
        a.canonicalKey.localeCompare(b.canonicalKey, "en"),
    );

  const factsByMeasurement = measurements
    .map((measurement) => ({
      measurementId: measurement.measurementId,
      facts: buildMeasurementEntityFactsV2({
        measurementId: measurement.measurementId,
        targetBusinessId: measurement.targetBusinessId,
        valid: measurement.valid,
        rawParser: measurement.rawParser,
        entities: measurement.observations,
        attributions:
          builderAttributions.get(measurement.measurementId) ?? [],
      }),
    }))
    .sort((a, b) => a.measurementId.localeCompare(b.measurementId, "en"));

  const targetReferenceSources: ReplayTargetReferenceSourceV2[] = [
    ...targetReferenceResponses.entries(),
  ]
    .map(([domain, responses]) => ({
      domain,
      responseCount: responses.size,
      evidenceTier: "near_section" as const,
    }))
    .sort(
      (a, b) =>
        b.responseCount - a.responseCount ||
        a.domain.localeCompare(b.domain, "en"),
    );

  acceptedAttributions.sort(
    (a, b) =>
      a.measurementId.localeCompare(b.measurementId, "en") ||
      a.attributionId.localeCompare(b.attributionId, "en"),
  );
  diagnostics.sort(
    (a, b) =>
      a.measurementId.localeCompare(b.measurementId, "en") ||
      a.attributionId.localeCompare(b.attributionId, "en") ||
      a.code.localeCompare(b.code, "en"),
  );

  return {
    version: RUN_SOURCE_REPLAY_VERSION,
    sourceReplayStatus: "evaluated",
    factsByMeasurement,
    acceptedAttributions,
    competitorSourceClueVersion: RUN_COMPETITOR_SOURCE_CLUE_VERSION,
    competitorSourceClues,
    targetReferenceSources,
    diagnostics,
  };
}
