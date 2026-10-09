import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVerifiedTargetCitationPageSummary } from "../../src/lib/verified-target-citation-page-summary";
import type { EntityFactsV2ReadVerifiedTargetCitationPageDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";

const page: EntityFactsV2ReadVerifiedTargetCitationPageDTO = {
  domain: "example.test",
  title: "실제 관련 인용 페이지",
  responseCount: 1,
  citationCount: 1,
  sampleUrl: "https://example.test/shop",
  confidence: "high",
  basisLabel: "지점 확인",
};

describe("verified citation page status copy", () => {
  it("counts unique verified related pages only when the verifier is complete", () => {
    expect(buildVerifiedTargetCitationPageSummary({
      verifiedTargetCitationPageStatus: "complete",
      verifiedTargetCitationPages: [page, { ...page, sampleUrl: "https://example.test/shop2" }],
    })).toEqual({ status: "complete", label: "2개", count: 2 });
  });

  it("represents a completed zero-page verification as zero, not pending", () => {
    expect(buildVerifiedTargetCitationPageSummary({
      verifiedTargetCitationPageStatus: "complete",
      verifiedTargetCitationPages: [],
    })).toEqual({ status: "complete", label: "0개", count: 0 });
  });

  it("distinguishes pending and not-verified even if placeholder arrays are present", () => {
    expect(buildVerifiedTargetCitationPageSummary({
      verifiedTargetCitationPageStatus: "pending",
      verifiedTargetCitationPages: [],
    })).toEqual({ status: "pending", label: "확인 중", count: null });

    expect(buildVerifiedTargetCitationPageSummary({
      verifiedTargetCitationPageStatus: "not_verified",
      verifiedTargetCitationPages: [],
    })).toEqual({ status: "not_verified", label: "미검증", count: null });
  });

  it("fails closed when no verification state or complete pages are available", () => {
    expect(buildVerifiedTargetCitationPageSummary({})).toEqual({
      status: "not_verified", label: "미검증", count: null,
    });
    expect(buildVerifiedTargetCitationPageSummary({
      verifiedTargetCitationPageStatus: "complete",
    })).toEqual({ status: "not_verified", label: "미검증", count: null });
  });

  it("recognizes legacy complete pages only when page rows are actually supplied", () => {
    expect(buildVerifiedTargetCitationPageSummary({
      verifiedTargetCitationPages: [page],
    })).toEqual({ status: "complete", label: "1개", count: 1 });
  });

  it("keeps page counts separate from citation source domains in both admin routes", () => {
    for (const route of [
      "src/routes/_authenticated/internal-observation-pipeline.tsx",
      "src/routes/_authenticated/pilot-ops.tsx",
    ]) {
      const code = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(code).toContain("buildVerifiedTargetCitationPageSummary");
      expect(code).toContain("내 업체 관련 페이지");
      expect(code).not.toContain(">관련 출처</p>");
      expect(code).not.toContain("verifiedTargetCitationPages?.length ??\n                      resultQuery.data.data.targetSources.length");
    }
    const pilot = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/pilot-ops.tsx"), "utf8",
    );
    expect(pilot).toContain("별도 관찰: 업체 연결 출처");
    expect(pilot).toContain("내 업체 관련 인용 페이지");
  });
});
