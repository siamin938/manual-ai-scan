import { describe, expect, it } from "vitest";
import { runEntityV2RuntimeShadowComparison } from "../../supabase/functions/_shared/entity-engine-v2/runtime-shadow";

describe("Entity v2 runtime shadow comparison", () => {
  it("matches v1 when the same registered business is confirmed", () => {
    const result = runEntityV2RuntimeShadowComparison({
      responseText: "- 오토트리",
      businesses: [{ id: "business-1", name: "오토트리", aliases: [] }],
      v1Resolutions: [{
        displayName: "오토트리",
        matchedBusinessId: "business-1",
        countAsConfirmedBusiness: true,
      }],
    });

    expect(result.match).toBe(true);
    expect(result.mismatchCount).toBe(0);
    expect(result.registeredBusinesses.v1Confirmed).toEqual(["business-1"]);
    expect(result.registeredBusinesses.v2Confirmed).toEqual(["business-1"]);
  });

  it("surfaces a v1-only generic shop false positive without changing v1", () => {
    const result = runEntityV2RuntimeShadowComparison({
      responseText: "- 동네 PPF 업체",
      businesses: [],
      v1Resolutions: [{
        displayName: "동네 PPF 업체",
        matchedBusinessId: null,
        countAsConfirmedBusiness: true,
      }],
    });

    expect(result.match).toBe(false);
    expect(result.unregisteredBusinesses.v1Only).toEqual(["동네 PPF 업체"]);
    expect(result.unregisteredBusinesses.v2Only).toEqual([]);
    expect(result.decisionCounts.non_business).toBeGreaterThan(0);
  });

  it("surfaces a v2-only structured business candidate", () => {
    const result = runEntityV2RuntimeShadowComparison({
      responseText: [
        "| 업체 | 주소 |",
        "| --- | --- |",
        "| 커스텀개러지 | 경기 고양시 일산동구 중앙로 123 |",
      ].join("\n"),
      businesses: [],
      v1Resolutions: [],
    });

    expect(result.match).toBe(false);
    expect(result.unregisteredBusinesses.v2Only).toContain("커스텀개러지");
    expect(result.decisionCounts.confirmed_business).toBeGreaterThan(0);
  });

  it("ignores non-confirmed v1 resolutions in the comparison authority set", () => {
    const result = runEntityV2RuntimeShadowComparison({
      responseText: "- 일반 정비소",
      businesses: [],
      v1Resolutions: [{
        displayName: "일반 정비소",
        matchedBusinessId: null,
        countAsConfirmedBusiness: false,
      }],
    });

    expect(result.unregisteredBusinesses.v1Confirmed).toEqual([]);
    expect(result.unregisteredBusinesses.v1Only).toEqual([]);
  });
});
