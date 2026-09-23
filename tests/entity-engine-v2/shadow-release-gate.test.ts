import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateShadowReleaseGate,
  replayDataset,
  type ShadowReleaseReviewRegistry,
  type ShadowReplayDataset,
  type ShadowReplayReport,
} from "../../scripts/entity-v2-shadow-replay";

const dataset = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/entity-v2-shadow-replay-sample-v0.1.json", import.meta.url),
    ),
    "utf8",
  ),
) as ShadowReplayDataset;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/entity-v2-shadow-release-review-v0.1.json", import.meta.url),
    ),
    "utf8",
  ),
) as ShadowReleaseReviewRegistry;

function cloneReport(report: ShadowReplayReport): ShadowReplayReport {
  return JSON.parse(JSON.stringify(report)) as ShadowReplayReport;
}

describe("Entity Engine v2 shadow release gate", () => {
  const report = replayDataset(dataset);

  it("passes the reviewed sample replay", () => {
    const gate = evaluateShadowReleaseGate(report, registry);

    expect(gate.ok).toBe(true);
    expect(gate.blockingIssueCount).toBe(0);
    expect(gate.checks).toEqual({
      rejectedPromotions: 0,
      registeredCanonicalIdChanges: 0,
      unreviewedConfirmedDrops: 0,
      unqualifiedNeedsReviewPromotions: 0,
      unreviewedNewConfirmed: 0,
    });
  });

  it("requires explicit review for confirmed drops and brand-new confirmations", () => {
    const emptyRegistry: ShadowReleaseReviewRegistry = {
      version: "empty",
      approvedConfirmedDrops: [],
      approvedNewConfirmed: [],
      approvedNeedsReviewPromotions: [],
    };
    const gate = evaluateShadowReleaseGate(report, emptyRegistry);

    expect(gate.ok).toBe(false);
    expect(gate.checks.unreviewedConfirmedDrops).toBe(1);
    expect(gate.checks.unreviewedNewConfirmed).toBe(1);
  });

  it("auto-qualifies a needs-review promotion only when scoped structured evidence exists", () => {
    const promotion = report.diffs.find(
      (diff) => diff.measurementId === "544f3240-91dc-4eeb-a189-592a983d43cd",
    );
    expect(promotion?.category).toBe("v1_needs_review_to_v2_confirmed");
    expect(
      promotion?.v2Evidence?.some(
        (item) =>
          item.type === "address" && item.provenance === "heading_detail_child",
      ),
    ).toBe(true);

    const gate = evaluateShadowReleaseGate(report, registry);
    expect(gate.checks.unqualifiedNeedsReviewPromotions).toBe(0);
  });

  it("blocks rejected-to-confirmed promotion regardless of review registry", () => {
    const unsafe = cloneReport(report);
    unsafe.diffs.push({
      category: "v1_rejected_to_v2_confirmed",
      measurementId: "synthetic-rejected-promotion",
      runId: "shadow-test",
      v1DisplayName: "일반 정비소",
      v1VerificationStatus: "rejected_non_business",
      v2IdentitySurface: "일반 정비소",
      v2Decision: "confirmed_business",
      v2Evidence: [
        { type: "branch", provenance: "branch_identity" },
      ],
    });

    const gate = evaluateShadowReleaseGate(unsafe, registry);
    expect(gate.ok).toBe(false);
    expect(gate.checks.rejectedPromotions).toBe(1);
    expect(gate.issues.map((issue) => issue.code)).toContain(
      "REJECTED_PROMOTED_TO_CONFIRMED",
    );
  });

  it("blocks a registered canonical business id change", () => {
    const unsafe = cloneReport(report);
    unsafe.diffs.push({
      category: "unchanged_confirmed",
      measurementId: "synthetic-canonical-id-change",
      runId: "shadow-test",
      v1DisplayName: "등록 업체",
      v1VerificationStatus: "confirmed_business",
      v1MatchedBusinessId: "11111111-1111-4111-8111-111111111111",
      v2IdentitySurface: "등록 업체",
      v2Decision: "confirmed_business",
      v2CanonicalBusinessId: "22222222-2222-4222-8222-222222222222",
      v2Evidence: [
        { type: "registered", provenance: "registered_exact_subspan" },
      ],
    });

    const gate = evaluateShadowReleaseGate(unsafe, registry);
    expect(gate.ok).toBe(false);
    expect(gate.checks.registeredCanonicalIdChanges).toBe(1);
  });

  it("blocks a needs-review promotion that has only weak branch evidence unless reviewed", () => {
    const unsafe = cloneReport(report);
    unsafe.diffs.push({
      category: "v1_needs_review_to_v2_confirmed",
      measurementId: "synthetic-weak-needs-review",
      runId: "shadow-test",
      v1DisplayName: "가상 파주점",
      v1VerificationStatus: "needs_review",
      v2IdentitySurface: "가상 파주점",
      v2Decision: "confirmed_business",
      v2Evidence: [
        { type: "branch", provenance: "branch_identity" },
      ],
    });

    const gate = evaluateShadowReleaseGate(unsafe, registry);
    expect(gate.ok).toBe(false);
    expect(gate.checks.unqualifiedNeedsReviewPromotions).toBe(1);
  });
});
