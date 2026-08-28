import { describe, expect, it } from "vitest";
import {
  calcEstimatedCostUsd,
  calcInternalMaxCostUsd,
  calcPlannedJobs,
  checkUsageAllowance,
  customerErrorMessage,
  defaultRunName,
} from "./customer-measurement.helpers";

describe("customer measurement capacity helpers", () => {
  it("24 public questions × 1 repetition × 1 engine = 24 jobs", () => {
    expect(calcPlannedJobs(24)).toBe(24);
  });

  it("returns 0 jobs for empty question sets", () => {
    expect(calcPlannedJobs(0)).toBe(0);
  });

  it("estimated $1.20 becomes internal max cost $1.50", () => {
    const estimated = calcEstimatedCostUsd(0.05, 24);
    expect(estimated).toBeCloseTo(1.2, 6);
    expect(calcInternalMaxCostUsd(estimated)).toBe(1.5);
  });

  it("never returns a max cost below the estimate", () => {
    expect(calcInternalMaxCostUsd(0.011)).toBeGreaterThanOrEqual(0.011);
    expect(calcInternalMaxCostUsd(0)).toBe(0.01);
  });

  it("blocks when daily request limit would be exceeded", () => {
    expect(
      checkUsageAllowance({
        usage: { dailyRequests: 90, monthlyActualCostUsd: 0, monthlyReservedCostUsd: 0 },
        limits: { dailyRequestLimit: 100, monthlyBudgetUsd: 100 },
        plannedJobs: 24,
        maxCostUsd: 1.5,
      }),
    ).toBe("DAILY_USAGE_LIMIT");
  });

  it("blocks when actual + reserved + max cost exceeds the monthly budget", () => {
    expect(
      checkUsageAllowance({
        usage: { dailyRequests: 0, monthlyActualCostUsd: 8, monthlyReservedCostUsd: 1 },
        limits: { dailyRequestLimit: 1000, monthlyBudgetUsd: 10 },
        plannedJobs: 24,
        maxCostUsd: 1.5,
      }),
    ).toBe("MONTHLY_USAGE_LIMIT");
  });

  it("allows a run within both limits", () => {
    expect(
      checkUsageAllowance({
        usage: { dailyRequests: 10, monthlyActualCostUsd: 2, monthlyReservedCostUsd: 0 },
        limits: { dailyRequestLimit: 1000, monthlyBudgetUsd: 50 },
        plannedJobs: 24,
        maxCostUsd: 1.5,
      }),
    ).toBeNull();
  });

  it("maps error codes to customer-safe messages without internal detail", () => {
    const message = customerErrorMessage("DAILY_USAGE_LIMIT");
    expect(message).toBe("오늘 가능한 AI 측정 횟수를 모두 사용했습니다.");
    for (const code of ["MEASUREMENT_NOT_READY", "INTERNAL_ERROR"] as const) {
      const text = customerErrorMessage(code);
      expect(text).not.toMatch(/openai|provider|cost|\$/i);
    }
  });

  it("builds a safe default run name", () => {
    expect(defaultRunName("현대엑스티어 판교", new Date("2026-08-28T00:00:00Z"))).toBe(
      "현대엑스티어 판교 측정 2026-08-28",
    );
    expect(defaultRunName(null, new Date("2026-08-28T00:00:00Z"))).toBe("AI 측정 2026-08-28");
  });
});
