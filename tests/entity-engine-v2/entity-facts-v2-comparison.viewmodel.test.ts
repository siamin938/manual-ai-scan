import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  EntityFactsV2ComparisonDTO,
  EntityFactsV2ComparisonMetricSnapshot,
  EntityFactsV2ComparisonRunPointDTO,
} from "../../src/lib/entity-facts-v2-comparison.types";
import { buildEntityFactsV2ComparisonViewModel } from "../../src/lib/entity-facts-v2-comparison.viewmodel";

const CURRENT_RUN = "11111111-1111-4111-8111-111111111111";
const PREVIOUS_RUN = "22222222-2222-4222-8222-222222222222";
const OLDER_RUN = "33333333-3333-4333-8333-333333333333";

function metric(
  confirmedPct: number,
  unresolvedCount = 0,
  maxPct = confirmedPct,
): EntityFactsV2ComparisonMetricSnapshot {
  return {
    validCount: 24,
    confirmedCount: Math.round((confirmedPct / 100) * 24),
    unresolvedCount,
    confirmedPct,
    maxPct,
  };
}

function point(
  runId: string,
  measuredAt: string,
  visibilityPct: number,
  top3Pct = visibilityPct,
): EntityFactsV2ComparisonRunPointDTO {
  return {
    runId,
    measuredAt,
    visibility: metric(visibilityPct),
    top3: metric(top3Pct),
  };
}

function baseDto(
  overrides: Partial<EntityFactsV2ComparisonDTO> = {},
): EntityFactsV2ComparisonDTO {
  const currentRun = point(
    CURRENT_RUN,
    "2026-09-22T00:00:00.000Z",
    16.67,
    0,
  );
  return {
    version: "0.1",
    generatedAt: "2026-09-22T01:00:00.000Z",
    business: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "테스트 업체",
      category: null,
      region: null,
      city: null,
    },
    status: "single",
    reason: "NO_COMPATIBLE_PRIOR_RUN",
    comparisonBasis: "durable_request_fingerprint",
    compatibleRunCount: 1,
    trendEligible: false,
    currentRun,
    previousRun: null,
    series: [currentRun],
    visibility: {
      current: metric(16.67),
      previous: null,
      confirmedDeltaPctPoints: null,
    },
    top3: {
      current: metric(0),
      previous: null,
      confirmedDeltaPctPoints: null,
    },
    ...overrides,
  };
}

describe("Entity Facts v2 comparison customer ViewModel", () => {
  it("turns a single verified-contract run into a customer waiting state", () => {
    const vm = buildEntityFactsV2ComparisonViewModel(baseDto());

    expect(vm.mode).toBe("waiting");
    expect(vm.heading).toBe("비교 가능한 이전 측정이 아직 없습니다");
    expect(vm.description).toContain("같은 질문과 측정 조건");
    expect(vm.comparisonAvailable).toBe(false);
    expect(vm.trendAvailable).toBe(false);
    expect(vm.visibility?.currentValueText).toBe("16.67%");
    expect(vm.visibility?.previousValueText).toBeNull();
    expect(vm.visibility?.deltaText).toBeNull();

    const customerSurface = JSON.stringify(vm);
    expect(customerSurface).not.toContain("single");
    expect(customerSurface).not.toContain("NO_COMPATIBLE_PRIOR_RUN");
    expect(customerSurface).not.toContain("durable_request_fingerprint");
  });

  it("explains old unverified history without manufacturing a delta", () => {
    const dto = baseDto({
      status: "unverified",
      reason: "CURRENT_REQUEST_CONTRACT_UNAVAILABLE",
      compatibleRunCount: 0,
      series: [],
      visibility: {
        current: metric(16.67, 2, 25),
        previous: null,
        confirmedDeltaPctPoints: null,
      },
    });

    const vm = buildEntityFactsV2ComparisonViewModel(dto);

    expect(vm.mode).toBe("not_comparable");
    expect(vm.heading).toBe("이전 측정과 직접 비교하지 않습니다");
    expect(vm.description).toContain("조건이 같았는지 확인할 기록");
    expect(vm.comparisonAvailable).toBe(false);
    expect(vm.visibility?.currentValueText).toBe("16.67%");
    expect(vm.visibility?.deltaText).toBeNull();
    expect(vm.visibility?.uncertaintyText).toBe(
      "현재 추가 확인이 필요한 응답 2건",
    );
    expect(vm.visibility?.maximumNotice).toBe(
      "추가 확인이 필요한 응답까지 모두 같은 업체로 확인될 경우 현재 최대 25%",
    );

    const customerSurface = JSON.stringify(vm);
    expect(customerSurface).not.toContain("unverified");
    expect(customerSurface).not.toContain(
      "CURRENT_REQUEST_CONTRACT_UNAVAILABLE",
    );
  });

  it("shows only confirmed-rate change for a verified two-run comparison", () => {
    const currentRun: EntityFactsV2ComparisonRunPointDTO = {
      ...point(CURRENT_RUN, "2026-09-22T00:00:00.000Z", 16.67, 0),
      visibility: metric(16.67, 2, 25),
      top3: metric(0, 5, 20.83),
    };
    const previousRun: EntityFactsV2ComparisonRunPointDTO = {
      ...point(PREVIOUS_RUN, "2026-09-15T00:00:00.000Z", 29.17, 16.67),
      visibility: metric(29.17, 0, 29.17),
      top3: metric(16.67, 0, 16.67),
    };
    const dto = baseDto({
      status: "verified",
      reason: "VERIFIED",
      compatibleRunCount: 2,
      trendEligible: false,
      currentRun,
      previousRun,
      series: [previousRun, currentRun],
      visibility: {
        current: currentRun.visibility,
        previous: previousRun.visibility,
        confirmedDeltaPctPoints: -12.5,
      },
      top3: {
        current: currentRun.top3,
        previous: previousRun.top3,
        confirmedDeltaPctPoints: -16.67,
      },
    });

    const vm = buildEntityFactsV2ComparisonViewModel(dto);

    expect(vm.mode).toBe("comparison");
    expect(vm.heading).toBe("이전 동일 조건 측정과 비교");
    expect(vm.comparisonAvailable).toBe(true);
    expect(vm.trendAvailable).toBe(false);
    expect(vm.visibility?.previousValueText).toBe("29.17%");
    expect(vm.visibility?.currentValueText).toBe("16.67%");
    expect(vm.visibility?.deltaText).toBe("-12.5%p");
    expect(vm.visibility?.comparisonSentence).toBe(
      "이전 동일 조건 측정보다 확정 AI 노출률이 12.5%p 낮게 관찰되었습니다.",
    );
    expect(vm.visibility?.uncertaintyText).toBe(
      "추가 확인 응답: 이전 0건 · 현재 2건",
    );
    expect(vm.visibility?.maximumNotice).toContain("현재 최대 25%");
    expect(vm.trendSeries).toEqual([]);
  });

  it("uses cautious wording for higher and unchanged observations", () => {
    const previousRun = point(
      PREVIOUS_RUN,
      "2026-09-15T00:00:00.000Z",
      10,
      10,
    );
    const higherRun = point(
      CURRENT_RUN,
      "2026-09-22T00:00:00.000Z",
      20,
      10,
    );

    const higherVm = buildEntityFactsV2ComparisonViewModel(
      baseDto({
        status: "verified",
        reason: "VERIFIED",
        compatibleRunCount: 2,
        currentRun: higherRun,
        previousRun,
        series: [previousRun, higherRun],
        visibility: {
          current: higherRun.visibility,
          previous: previousRun.visibility,
          confirmedDeltaPctPoints: 10,
        },
        top3: {
          current: higherRun.top3,
          previous: previousRun.top3,
          confirmedDeltaPctPoints: 0,
        },
      }),
    );

    expect(higherVm.visibility?.deltaText).toBe("+10%p");
    expect(higherVm.visibility?.comparisonSentence).toBe(
      "이전 동일 조건 측정보다 확정 AI 노출률이 10%p 높게 관찰되었습니다.",
    );
    expect(higherVm.top3?.comparisonSentence).toBe(
      "이전 동일 조건 측정과 확정 상위 3곳 노출률이 같게 관찰되었습니다.",
    );
    expect(JSON.stringify(higherVm)).not.toContain("개선");
    expect(JSON.stringify(higherVm)).not.toContain("악화");
  });

  it("enables the trend surface only with at least three verified compatible points", () => {
    const olderRun = point(
      OLDER_RUN,
      "2026-09-08T00:00:00.000Z",
      30,
      20,
    );
    const previousRun = point(
      PREVIOUS_RUN,
      "2026-09-15T00:00:00.000Z",
      20,
      15,
    );
    const currentRun = point(
      CURRENT_RUN,
      "2026-09-22T00:00:00.000Z",
      10,
      10,
    );

    const vm = buildEntityFactsV2ComparisonViewModel(
      baseDto({
        status: "verified",
        reason: "VERIFIED",
        compatibleRunCount: 3,
        trendEligible: true,
        currentRun,
        previousRun,
        series: [olderRun, previousRun, currentRun],
        visibility: {
          current: currentRun.visibility,
          previous: previousRun.visibility,
          confirmedDeltaPctPoints: -10,
        },
        top3: {
          current: currentRun.top3,
          previous: previousRun.top3,
          confirmedDeltaPctPoints: -5,
        },
      }),
    );

    expect(vm.mode).toBe("trend");
    expect(vm.heading).toBe("동일 조건 측정 추세");
    expect(vm.trendAvailable).toBe(true);
    expect(vm.compatibleMeasurementCount).toBe(3);
    expect(vm.trendSeries).toEqual([
      {
        measuredAt: "2026-09-08T00:00:00.000Z",
        confirmedPct: 30,
        unresolvedCount: 0,
      },
      {
        measuredAt: "2026-09-15T00:00:00.000Z",
        confirmedPct: 20,
        unresolvedCount: 0,
      },
      {
        measuredAt: "2026-09-22T00:00:00.000Z",
        confirmedPct: 10,
        unresolvedCount: 0,
      },
    ]);
  });

  it("fails closed when a verified DTO is structurally incomplete", () => {
    const vm = buildEntityFactsV2ComparisonViewModel(
      baseDto({
        status: "verified",
        reason: "VERIFIED",
        compatibleRunCount: 2,
        previousRun: null,
      }),
    );

    expect(vm.mode).toBe("unavailable");
    expect(vm.comparisonAvailable).toBe(false);
    expect(vm.visibility).toBeNull();
    expect(vm.top3).toBeNull();
  });

  it("uses customer wording for unavailable states without exposing internal reasons", () => {
    const vm = buildEntityFactsV2ComparisonViewModel(
      baseDto({
        status: "unavailable",
        reason: "NO_CURRENT_CUSTOMER_RUN",
        compatibleRunCount: 0,
        currentRun: null,
        previousRun: null,
        series: [],
        visibility: null,
        top3: null,
      }),
    );

    expect(vm.mode).toBe("unavailable");
    expect(vm.heading).toBe("아직 비교할 측정 결과가 없습니다");
    const customerCopy = `${vm.heading} ${vm.description}`;
    expect(customerCopy).not.toContain("NO_CURRENT_CUSTOMER_RUN");
    expect(customerCopy).not.toContain("unavailable");
  });

  it("is still not wired into the dashboard", () => {
    const dashboardSource = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(dashboardSource).not.toContain(
      "buildEntityFactsV2ComparisonViewModel",
    );
    expect(dashboardSource).not.toContain("getEntityFactsV2Comparison");
  });
});
