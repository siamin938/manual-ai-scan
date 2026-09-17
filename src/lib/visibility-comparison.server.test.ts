import { describe, expect, it } from "vitest";
import { parseVisibilityComparison } from "./visibility-comparison.server";
describe("comparison presentation contract", () => {
  it("preserves unknown and unavailable as different states", () => {
    expect(parseVisibilityComparison({ status: "unverified", compatibleRunCount: 0 })?.status).toBe("unverified");
    expect(parseVisibilityComparison({ status: "unavailable", compatibleRunCount: 0 })?.status).toBe("unavailable");
  });
  it("rejects contradictory status/counts", () => {
    expect(parseVisibilityComparison({ status: "verified", compatibleRunCount: 0 })).toBeNull();
    expect(parseVisibilityComparison({ status: "single", compatibleRunCount: 2 })).toBeNull();
    expect(parseVisibilityComparison({ status: "unverified", compatibleRunCount: -1 })).toBeNull();
  });
});
