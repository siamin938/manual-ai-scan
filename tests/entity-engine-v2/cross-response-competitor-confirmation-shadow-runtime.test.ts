import { describe, expect, it } from "vitest";
import {
  CROSS_RESPONSE_COMPETITOR_SHADOW_SUPPLEMENT_VERSION,
  buildCrossResponseCompetitorShadowSupplement,
} from "../../src/lib/cross-response-competitor-confirmation.shadow.server";

function aggregateFixture() {
  return {
    version: "0.1",
    factsVersion: "0.3",
    contractOk: true,
    contractIssues: [],
    overview: {
      validCount: 5,
      invalidCount: 0,
      measurementCount: 5,
      questionCount: 5,
      coveredQuestionCount: 0,
      unresolvedQuestionCount: 0,
      missingQuestionCount: 5,
      confirmedMentionCount: 0,
      unresolvedTargetCount: 0,
      visibilityLowerBoundPct: 0,
      visibilityUpperBoundPct: 0,
      confirmedTop3Count: 0,
      top3UncertainCount: 0,
      top3LowerBoundPct: 0,
      top3UpperBoundPct: 0,
      sourcePartialMeasurementCount: 0,
    },
    questionGroups: [],
    questionAreas: [],
    competitors: [
      {
        canonicalKey: "auto:모먼트카케어",
        responseCount: 1,
        questionCount: 1,
        intentCount: 1,
        top3ResponseCount: 1,
      },
    ],
    targetSources: [],
    qualityFlagCounts: {},
  };
}

function rowsFor(
  key: string,
  name: string,
  domain: string,
  positions: number[],
  intents: string[],
  directAt = 1,
) {
  const canonicalizations = [];
  const mentions = [];
  const verifications = [];
  const attributions = [];
  const measurements = [];
  const questions = [];

  for (let i = 0; i < positions.length; i += 1) {
    const mentionId = `${key}:mention:${i}`;
    const measurementId = `${key}:measurement:${i}`;
    const questionId = `${key}:question:${i}`;
    canonicalizations.push({
      measurement_id: measurementId,
      measurement_mention_id: mentionId,
      canonical_key: key,
      canonical_display_name: name,
    });
    mentions.push({
      id: mentionId,
      measurement_id: measurementId,
      matched_business_id: null,
      display_name: name,
      position: positions[i] ?? null,
    });
    verifications.push({
      measurement_mention_id: mentionId,
      verification_status: "confirmed_business",
      verified_count_as_business: true,
    });
    attributions.push({
      measurement_id: measurementId,
      canonical_key: key,
      domain,
      attribution_level: i < directAt ? "direct" : "section",
    });
    measurements.push({
      id: measurementId,
      question_id: questionId,
    });
    questions.push({
      id: questionId,
      intent_type: intents[i] ?? "other",
    });
  }

  return {
    canonicalizations,
    mentions,
    verifications,
    attributions,
    measurements,
    questions,
  };
}

describe("cross-response competitor runtime shadow supplement", () => {
  it("builds v2-compatible competitor preview metrics while keeping target metrics untouched", () => {
    const kugs = rowsFor(
      "auto:국스월드",
      "국스월드",
      "kugs.net",
      [2, 4, 4, 5, 6],
      ["discovery", "comparison", "recommendation", "discovery", "trust"],
    );
    const moment = rowsFor(
      "auto:모먼트",
      "모먼트",
      "momentcarcare.co.kr",
      [1, 2, 3],
      ["local", "recommendation", "discovery"],
    );
    const existingMoment = rowsFor(
      "auto:모먼트카케어",
      "모먼트 카케어",
      "momentcarcare.co.kr",
      [4],
      ["comparison"],
      0,
    );
    const tstyle = rowsFor(
      "auto:t스타일랩",
      "T 스타일 랩",
      "tstylelab.com",
      [2, 4],
      ["service", "comparison"],
    );
    const falsePositive = rowsFor(
      "auto:블랙박스나오토프렁크설치시배선작업방식",
      "블랙박스나 오토프렁크 설치 시 배선 작업 방식",
      "example.com",
      [4],
      ["service"],
    );

    const parts = [kugs, moment, existingMoment, tstyle, falsePositive];
    const result = buildCrossResponseCompetitorShadowSupplement({
      sourceRunId: "run-1",
      baseAggregateId: "aggregate-1",
      baseAggregateHash: "hash-1",
      aggregate: aggregateFixture(),
      canonicalizations: parts.flatMap((part) => part.canonicalizations),
      mentions: parts.flatMap((part) => part.mentions),
      verifications: parts.flatMap((part) => part.verifications),
      attributions: parts.flatMap((part) => part.attributions),
      measurements: parts.flatMap((part) => part.measurements),
      questions: parts.flatMap((part) => part.questions),
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      version: CROSS_RESPONSE_COMPETITOR_SHADOW_SUPPLEMENT_VERSION,
      sourceRunId: "run-1",
      baseAggregateId: "aggregate-1",
      baseAggregateHash: "hash-1",
      affectsTargetMetrics: false,
      counts: {
        alreadyConfirmed: 1,
        promoteCandidate: 2,
        mergeReview: 1,
        rejected: 1,
      },
    });

    expect(result?.promotedCandidates).toEqual([
      expect.objectContaining({
        displayName: "국스월드",
        responseCount: 5,
        questionCount: 5,
        intentCount: 4,
        top3ResponseCount: 1,
      }),
      expect.objectContaining({
        displayName: "T 스타일 랩",
        responseCount: 2,
        questionCount: 2,
        intentCount: 2,
        top3ResponseCount: 1,
      }),
    ]);
    expect(result?.mergeReviewCandidates).toEqual([
      expect.objectContaining({
        displayName: "모먼트",
        responseCount: 3,
        questionCount: 3,
        intentCount: 3,
        top3ResponseCount: 3,
        decision: "merge_review",
        collisionCanonicalKeys: ["auto:모먼트카케어"],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("targetSeen");
    expect(JSON.stringify(result)).not.toContain("targetBestPosition");
  });

  it("uses persisted verifier decisions, not canonicalization presence alone", () => {
    const candidate = rowsFor(
      "auto:후보업체",
      "후보업체",
      "candidate.example",
      [1, 2],
      ["local", "service"],
    );
    candidate.verifications = candidate.verifications.map((row) => ({
      ...row,
      verification_status: "needs_review",
      verified_count_as_business: false,
    }));

    const result = buildCrossResponseCompetitorShadowSupplement({
      sourceRunId: "run-2",
      baseAggregateId: "aggregate-2",
      baseAggregateHash: "hash-2",
      aggregate: aggregateFixture(),
      canonicalizations: candidate.canonicalizations,
      mentions: candidate.mentions,
      verifications: candidate.verifications,
      attributions: candidate.attributions,
      measurements: candidate.measurements,
      questions: candidate.questions,
    });

    expect(result?.allCandidates).toEqual([]);
    expect(result?.counts).toEqual({
      alreadyConfirmed: 0,
      promoteCandidate: 0,
      mergeReview: 0,
      rejected: 0,
    });
  });

  it("does not promote repeated shared-platform evidence", () => {
    const shared = rowsFor(
      "auto:공유플랫폼후보",
      "공유플랫폼후보",
      "pf.kakao.com",
      [1, 2, 3, 4],
      ["local", "service", "trust", "discovery"],
      2,
    );

    const result = buildCrossResponseCompetitorShadowSupplement({
      sourceRunId: "run-3",
      baseAggregateId: "aggregate-3",
      baseAggregateHash: "hash-3",
      aggregate: aggregateFixture(),
      canonicalizations: shared.canonicalizations,
      mentions: shared.mentions,
      verifications: shared.verifications,
      attributions: shared.attributions,
      measurements: shared.measurements,
      questions: shared.questions,
    });

    expect(result?.allCandidates[0]).toMatchObject({
      decision: "reject",
      sourceDomainClass: "shared_profile",
      reasons: ["SHARED_OR_AGGREGATOR_DOMAIN"],
    });
  });
});
