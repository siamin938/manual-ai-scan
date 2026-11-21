import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenchmarkSourceEvidence } from "../../src/components/dashboard-evidence-panels";

const benchmark = {
  windowDays: 30,
  highVisibilityEntityCount: 14,
  eligibleTargetBusinessCount: 20,
  sourceGroups: [
    { key: "profile_directory", label: "업체 프로필", highEntitySharePct: 50, highEntityCount: 7, targetConnected: true, sites: [{ label: "저장된 시장 출처", domain: "market.example" }] },
    { key: "news", label: "언론", highEntitySharePct: null, highEntityCount: 0, targetConnected: false, sites: [] },
  ],
} as never;

describe("market benchmark compact source presentation", () => {
  it("keeps the sample window and entity count in the header and preserves null shares", () => {
    const html = renderToStaticMarkup(createElement(BenchmarkSourceEvidence, { benchmark }));
    expect(html).toContain("AI에 자주 나온 업체의 출처");
    expect(html).toContain("시장 표본 · 최근 30일 · 자동차 업체 14곳");
    expect(html).toContain("50.0%");
    expect(html).toContain("집계 전");
    expect(html).not.toContain("시장 업체 7 / 14곳");
    expect(html).toContain("우리 업체 연결 확인");
    expect(html).toContain("우리 업체의 이번 측정 결과와 합산하지 않습니다");
  });

  it("keeps group examples and the longer methodology available for print", () => {
    const html = renderToStaticMarkup(createElement(BenchmarkSourceEvidence, { benchmark, printExpanded: true }));
    expect(html).toContain("저장된 시장 출처");
    expect(html).not.toContain("diagnostic-source-examples diagnostic-print-only");
    expect(html).toContain("<details open");
    expect(html).toContain("진단 고객 기준 대상 업체 20곳");
    expect(html).toContain("한 업체가 여러 출처 그룹에 포함될 수 있습니다");
  });
});
