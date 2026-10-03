import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
  "utf8",
);

describe("dashboard owner productization layer", () => {
  it("keeps Top3 as supporting context while promoting broad-search visibility in the summary KPIs", () => {
    expect(dashboardSource).toContain('label="기준 검색 노출"');
    expect(dashboardSource).not.toContain('label="상위 3곳에 나온 답변"');
    expect(dashboardSource).toContain("<strong className=\"text-primary\">상위 3곳</strong>");
    expect(dashboardSource).toContain('label="확정 상위 3곳 노출률"');
  });

  it("keeps zero-visibility value useful without changing diagnostic truth", () => {
    expect(dashboardSource).toContain("이번 측정에서 대신 확인된 내용");
    expect(dashboardSource).toContain("가장 자주 함께 나온 업체");
    expect(dashboardSource).toContain("이번 측정에서 자주 나온 업체");
    expect(dashboardSource).not.toContain("검증 대상 없음");
    expect(dashboardSource).toContain("이번 측정에서 확인된 다른 업체");
    expect(dashboardSource).toContain("확인된 출처 연결 차이");
    expect(dashboardSource).toContain('summary.heroVariant === "not_visible"');
    expect(dashboardSource).toContain('summary.heroVariant !== "not_visible"');
  });

  it("hides the verified sources card and widens opportunities in the zero-visibility state", () => {
    expect(dashboardSource).toContain(
      "0% 노출 상태에서는 관련성이 확인된 출처 카드를 숨기고 우선 확인 항목을 전체 폭으로 표시합니다.",
    );
    expect(dashboardSource).toContain(
      'summary.heroVariant === "not_visible"\n            ? "grid gap-5"\n            : "grid gap-5 lg:grid-cols-2"',
    );
    expect(dashboardSource).toContain('summary.heroVariant !== "not_visible" && (');
  });

  it("shows the broad-versus-detail observation without causal wording", () => {
    expect(dashboardSource).toContain("이번 측정에서 확인된 검색 범위 차이");
    expect(dashboardSource).toContain("summary.searchScopeObservation.headline");
    expect(dashboardSource).toContain("summary.searchScopeObservation.evidence");
    expect(dashboardSource).toContain("같은 기준 검색에서 반복 확인된 다른 업체");
    expect(dashboardSource).toContain("summary.searchScopeObservation.repeatedCompetitors");
    expect(dashboardSource).toContain("독립 웹 ·");
    expect(dashboardSource).toContain(
      "특정 출처가 AI 노출의 원인임을 의미하지 않습니다.",
    );
  });

  it("reuses comparison v2 for repeat confirmation instead of inventing a score", () => {
    expect(dashboardSource).toContain("재측정 확인");
    expect(dashboardSource).toContain("comparison.compactSummary");
    expect(dashboardSource).toContain("질문 결과 일치");
    expect(dashboardSource).toContain("새로 확인된 질문");
    expect(dashboardSource).toContain("별도의 신뢰도 점수나 노출 원인을 의미하지 않습니다.");
  });

  it("explains the measurement method without changing the engine", () => {
    expect(dashboardSource).toContain("측정 기준 보기");
    expect(dashboardSource).toContain("8개 검색 상황을 3문항씩, 총 24문항");
    expect(dashboardSource).toContain("애매한");
    expect(dashboardSource).toContain("임의로 노출로 올리지 않습니다.");
    expect(dashboardSource).toContain(
      "실제 검색량, 시장 점유율 또는",
    );
  });
});
