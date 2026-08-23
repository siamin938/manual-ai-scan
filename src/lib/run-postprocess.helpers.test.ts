import { describe, expect, it } from "vitest";
import {
  initialSteps,
  isRunEligibleForPostprocess,
  isUuid,
  markFailure,
  toSafeErrorCode,
} from "./run-postprocess.helpers";

describe("run postprocess helpers", () => {
  it("validates uuids", () => {
    expect(isUuid("ac940ca3-edc7-4b1e-8ac3-e2af9d166782")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("only allows completed/partial standalone audit runs", () => {
    const base = {
      run_type: "audit",
      phase: "standalone",
      status: "completed",
      business_id: "b1",
    };
    expect(isRunEligibleForPostprocess(base)).toBe(true);
    expect(isRunEligibleForPostprocess({ ...base, status: "partial" })).toBe(true);
    expect(isRunEligibleForPostprocess({ ...base, status: "running" })).toBe(false);
    expect(isRunEligibleForPostprocess({ ...base, run_type: "experiment" })).toBe(false);
    expect(isRunEligibleForPostprocess({ ...base, phase: "baseline" })).toBe(false);
    expect(isRunEligibleForPostprocess({ ...base, business_id: null })).toBe(false);
  });

  it("marks later steps as skipped on failure", () => {
    const steps = markFailure({ ...initialSteps(), reparse: "ok" }, "profileCoverage");
    expect(steps.reparse).toBe("ok");
    expect(steps.profileCoverage).toBe("failed");
    expect(steps.firstPartyCoverage).toBe("skipped");
    expect(steps.insights).toBe("skipped");
  });

  it("maps unknown errors to a safe code", () => {
    expect(toSafeErrorCode("REPARSE_FAILED")).toBe("REPARSE_FAILED");
    expect(toSafeErrorCode("relation \"x\" does not exist")).toBe("POSTPROCESS_FAILED");
    expect(toSafeErrorCode(null)).toBe("POSTPROCESS_FAILED");
  });
});
