import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_CLASSIFIER_VERSION,
  aggregateCoverageFirstParty,
  buildMeasurementSummaryRows,
  mergeMeasurementSummaries,
  summarizeMeasurementSummaryRows,
  type SourceClassificationFact,
} from "./first-party-measurement-summary.helpers";

const ORG = "org-1";
const BIZ = "biz-1";

const classifications: SourceClassificationFact[] = [
  { measurement_source_id: "s1", classification: "first_party", confidence: "high" },
  { measurement_source_id: "s2", classification: "third_party", confidence: "high" },
  { measurement_source_id: "s3", classification: "third_party", confidence: "low" },
  { measurement_source_id: "s4", classification: "third_party", confidence: "high" },
];

describe("buildMeasurementSummaryRows", () => {
  it("creates a zero-source row for measurements without sources", () => {
    const { rows, incompleteClassificationCount } = buildMeasurementSummaryRows({
      orgId: ORG,
      businessId: BIZ,
      measurements: [{ measurementId: "m0", sourceIds: [] }],
      classifications,
      alreadySummarizedMeasurementIds: new Set(),
    });
    expect(incompleteClassificationCount).toBe(0);
    expect(rows[0]).toEqual({
      org_id: ORG,
      business_id: BIZ,
      measurement_id: "m0",
      classifier_version: "0.1.0",
      source_count: 0,
      first_party_source_count: 0,
      client_first_party_cited: false,
      low_confidence_source_count: 0,
    });
  });

  it("marks a measurement cited when at least one source is first_party", () => {
    const { rows } = buildMeasurementSummaryRows({
      orgId: ORG,
      businessId: BIZ,
      measurements: [{ measurementId: "m1", sourceIds: ["s1", "s2", "s3"] }],
      classifications,
      alreadySummarizedMeasurementIds: new Set(),
    });
    expect(rows[0]).toMatchObject({
      source_count: 3,
      first_party_source_count: 1,
      client_first_party_cited: true,
      low_confidence_source_count: 1,
    });
  });

  it("marks all-third-party measurements as uncited", () => {
    const { rows } = buildMeasurementSummaryRows({
      orgId: ORG,
      businessId: BIZ,
      measurements: [{ measurementId: "m2", sourceIds: ["s2", "s4"] }],
      classifications,
      alreadySummarizedMeasurementIds: new Set(),
    });
    expect(rows[0]).toMatchObject({
      source_count: 2,
      first_party_source_count: 0,
      client_first_party_cited: false,
    });
  });

  it("does not persist measurements with incomplete classifications", () => {
    const { rows, incompleteClassificationCount } = buildMeasurementSummaryRows({
      orgId: ORG,
      businessId: BIZ,
      measurements: [{ measurementId: "m3", sourceIds: ["s1", "unclassified"] }],
      classifications,
      alreadySummarizedMeasurementIds: new Set(),
    });
    expect(rows).toHaveLength(0);
    expect(incompleteClassificationCount).toBe(1);
  });

  it("skips measurements already summarized for this version", () => {
    const { rows, skippedCount } = buildMeasurementSummaryRows({
      orgId: ORG,
      businessId: BIZ,
      measurements: [
        { measurementId: "m1", sourceIds: ["s1"] },
        { measurementId: "m2", sourceIds: ["s2"] },
      ],
      classifications,
      alreadySummarizedMeasurementIds: new Set(["m1"]),
    });
    expect(skippedCount).toBe(1);
    expect(rows.map((r) => r.measurement_id)).toEqual(["m2"]);
  });
});

describe("measurement summary aggregation", () => {
  it("produces a SAFE summary shape", () => {
    const { rows, skippedCount, incompleteClassificationCount } = buildMeasurementSummaryRows({
      orgId: ORG,
      businessId: BIZ,
      measurements: [
        { measurementId: "m1", sourceIds: ["s1"] },
        { measurementId: "m2", sourceIds: ["s2"] },
        { measurementId: "m3", sourceIds: ["missing"] },
        { measurementId: "m4", sourceIds: [] },
      ],
      classifications,
      alreadySummarizedMeasurementIds: new Set(["m4"]),
    });

    const summary = summarizeMeasurementSummaryRows({
      measurementCount: 4,
      skippedCount,
      incompleteClassificationCount,
      insertedRows: rows,
    });

    expect(summary).toEqual({
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      measurementCount: 4,
      insertedCount: 2,
      skippedCount: 1,
      incompleteClassificationCount: 1,
      citedMeasurementCount: 1,
      uncitedMeasurementCount: 1,
    });
    expect(Object.keys(summary).sort()).toEqual([
      "citedMeasurementCount",
      "classifierVersion",
      "incompleteClassificationCount",
      "insertedCount",
      "measurementCount",
      "skippedCount",
      "uncitedMeasurementCount",
    ]);
  });

  it("merges per-batch summaries", () => {
    const one = {
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      measurementCount: 2,
      insertedCount: 1,
      skippedCount: 1,
      incompleteClassificationCount: 0,
      citedMeasurementCount: 1,
      uncitedMeasurementCount: 0,
    };
    expect(mergeMeasurementSummaries([one, one]).measurementCount).toBe(4);
    expect(mergeMeasurementSummaries([]).insertedCount).toBe(0);
  });
});

describe("aggregateCoverageFirstParty", () => {
  const eligible = [
    { measurementId: "m1", questionId: "q1" },
    { measurementId: "m2", questionId: "q1" },
    { measurementId: "m3", questionId: "q1" },
    { measurementId: "m4", questionId: "q2" },
    { measurementId: "m5", questionId: "q2" },
    { measurementId: "m6", questionId: "q2" },
  ];

  it("computes 2/6 = 33.3% and per-question rates", () => {
    const agg = aggregateCoverageFirstParty({
      eligible,
      citedByMeasurementId: new Map([
        ["m1", true],
        ["m2", false],
        ["m3", false],
        ["m4", true],
        ["m5", false],
        ["m6", false],
      ]),
    });
    expect(agg.complete).toBe(true);
    expect(agg.citedCount).toBe(2);
    expect(((agg.clientFirstPartyCitationRate ?? 0) * 100).toFixed(1)).toBe("33.3");
    const q1 = agg.perQuestion.find((q) => q.questionId === "q1");
    expect(q1).toMatchObject({ measurementCount: 3, firstPartyCitedCount: 1 });
    expect((q1?.firstPartyCitationRate ?? 0).toFixed(4)).toBe("0.3333");
  });

  it("is incomplete when any eligible measurement lacks a summary", () => {
    const agg = aggregateCoverageFirstParty({
      eligible,
      citedByMeasurementId: new Map([
        ["m1", true],
        ["m2", false],
      ]),
    });
    expect(agg.complete).toBe(false);
    expect(agg.missingSummaryCount).toBe(4);
    expect(agg.clientFirstPartyCitationRate).toBeNull();
  });

  it("is incomplete with no eligible measurements", () => {
    const agg = aggregateCoverageFirstParty({ eligible: [], citedByMeasurementId: new Map() });
    expect(agg.complete).toBe(false);
    expect(agg.clientFirstPartyCitationRate).toBeNull();
  });
});
