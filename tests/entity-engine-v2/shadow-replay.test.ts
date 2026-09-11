import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  replayDataset,
  type ShadowReplayDataset,
} from "../../scripts/entity-v2-shadow-replay";

const fixtureUrl = new URL(
  "../fixtures/entity-v2-shadow-replay-sample-v0.1.json",
  import.meta.url,
);
const dataset = JSON.parse(
  readFileSync(fileURLToPath(fixtureUrl), "utf8"),
) as ShadowReplayDataset;

describe("Entity Engine v2 historical shadow replay", () => {
  const report = replayDataset(dataset);

  it("drops the known fake ranked heading without dropping its real table businesses", () => {
    const fake = report.diffs.find(
      (diff) =>
        diff.measurementId === "889f16ae-e0f1-470f-b720-2538eb281a73" &&
        diff.v1DisplayName === "로 문의해볼 곳",
    );
    expect(fake?.category).toBe("v1_confirmed_to_v2_dropped");

    const retained = report.diffs.filter(
      (diff) =>
        diff.measurementId === "889f16ae-e0f1-470f-b720-2538eb281a73" &&
        diff.category === "unchanged_confirmed",
    );
    expect(retained.map((diff) => diff.v1DisplayName).sort()).toEqual([
      "XPEL Pro 일산로점",
      "XPEL Pro 일산백석점",
    ]);
  });

  it("normalizes registered overcapture to the canonical business identity", () => {
    const normalized = report.diffs.find(
      (diff) => diff.measurementId === "426285de-bc2d-41a6-b660-39ff63819a74",
    );
    expect(normalized?.category).toBe("canonical_surface_normalized");
    expect(normalized?.v2IdentitySurface).toBe("카스페이스 구로본점");
    expect(normalized?.v2CanonicalKey).toBe(
      "business:8fa9168b-4dc2-4417-b2ef-bbdafd842c38",
    );
    expect(normalized?.canonicalKeyChanged).toBe(false);
  });

  it("keeps a tightly-scoped confirmed positive control", () => {
    const control = report.diffs.find(
      (diff) => diff.measurementId === "replay-positive-control-green-car-service",
    );
    expect(control?.category).toBe("unchanged_confirmed");
  });

  it("surfaces needs-review promotions for manual precision review", () => {
    const promotion = report.diffs.find(
      (diff) => diff.measurementId === "544f3240-91dc-4eeb-a189-592a983d43cd",
    );
    expect(promotion?.category).toBe("v1_needs_review_to_v2_confirmed");
    expect(report.releaseSignals.reviewNeedsReviewPromotions).toBeGreaterThan(0);
  });

  it("does not promote a regional network placeholder into a concrete branch", () => {
    const placeholder = report.diffs.find(
      (diff) => diff.measurementId === "8e866de0-a6d3-4072-9ee1-0ae1bb4ff0cd",
    );
    expect(placeholder?.category).toBe("unchanged_needs_review");
    expect(placeholder?.v2Decision).not.toBe("confirmed_business");
  });

  it("keeps rejected-to-confirmed promotions as a blocking safety signal", () => {
    expect(report.releaseSignals.blockingRejectedPromotions).toBe(0);
    expect(report.releaseSignals.shadowHasBlockingPromotion).toBe(false);
  });

  it("preserves sibling business candidates when a criterion contains multiple businesses", () => {
    const newConfirmed = report.diffs.find(
      (diff) =>
        diff.measurementId === "62c9fe7e-5c73-410e-98f0-492a21cb23e2" &&
        diff.category === "v2_new_confirmed",
    );
    expect(newConfirmed?.v2IdentitySurface).toBe("더타이어샵 봉일천점");

    const normalized = report.diffs.find(
      (diff) =>
        diff.measurementId === "62c9fe7e-5c73-410e-98f0-492a21cb23e2" &&
        diff.category === "canonical_surface_normalized",
    );
    expect(normalized?.v2IdentitySurface).toBe("타이어프로 봉일천점");
  });

  it("has only the reviewed new-confirmed sibling in the sample", () => {
    const newConfirmed = report.diffs
      .filter((diff) => diff.category === "v2_new_confirmed")
      .map((diff) => `${diff.measurementId}:${diff.v2IdentitySurface}`)
      .sort();

    expect(newConfirmed).toEqual([
      "62c9fe7e-5c73-410e-98f0-492a21cb23e2:더타이어샵 봉일천점",
    ]);
  });

  it("produces a stable summary over the sample corpus", () => {
    expect(report.summary.measurementCount).toBe(dataset.rows.length);
    expect(report.summary.v1EntityCount).toBe(8);
    expect(report.summary.diffCounts.v1_confirmed_to_v2_dropped).toBe(1);
    expect(report.summary.diffCounts.canonical_surface_normalized).toBe(2);
  });
});
