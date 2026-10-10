import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
  "utf8",
);

const stylesSource = readFileSync(
  resolve(process.cwd(), "src/styles.css"),
  "utf8",
);

describe("dashboard owner productization layer", () => {
  it("keeps Top3 as supporting context while promoting broad-search visibility in the summary KPIs", () => {
    expect(dashboardSource).toContain('scopes ? "기준 검색" : "상위 3곳 확정"');
    expect(dashboardSource).toContain('scopes ? "맞춤 검색" : "내 업체 관련 페이지"');
    expect(dashboardSource).toContain("compactSummaryCount(summary.visibility)");
    expect(dashboardSource).not.toContain('label="상위 3곳에 나온 답변"');
    expect(dashboardSource).toContain("summary.top3");
    expect(dashboardSource).toContain('label="확정 상위 3곳 노출률"');
  });

  it("keeps the ten-second summary to three KPIs and no more than two fact statements", () => {
    expect(dashboardSource).toContain('buildCompactSummaryInsights(summary)');
    expect(dashboardSource).toContain('compactSummarySearchScopes(summary)');
    expect(dashboardSource).toContain("이번 측정에서 주목할 점");
    expect(dashboardSource).toContain("근거와 확인 항목은 상세 분석에서 보기");
    expect(dashboardSource).not.toContain("이번 측정에서 대신 확인된 내용");
    expect(dashboardSource).not.toContain("같은 기준 검색에서 반복 확인된 다른 업체");
    expect(dashboardSource).not.toContain('SummaryKpiCard');
  });

  it("retains detailed evidence, scope comparisons and non-causal disclaimers", () => {
    expect(dashboardSource).toContain("UnifiedDiagnosticLayerSummaryCard");
    expect(dashboardSource).toContain("ActionOpportunitySection");
    expect(dashboardSource).toContain("ComparisonCard model={comparisonModel}");
    expect(dashboardSource).toContain("model.verifiedTargetCitationPages");
    expect(dashboardSource).toContain("SearchContextChart");
    expect(dashboardSource).toContain("METHODOLOGY");
    expect(dashboardSource).toContain(
      "관찰 결과의 차이는 특정 업체·출처가 노출에 영향을 준 원인이나 개선 효과를 의미하지 않습니다.",
    );
  });

  it("preserves comparison v2 in detailed analysis instead of a duplicate summary card", () => {
    expect(dashboardSource).toContain('<ComparisonCard model={comparisonModel}');
    expect(dashboardSource).toContain("buildEntityFactsV2ComparisonViewModel");
    expect(dashboardSource).not.toContain("comparison.compactSummary");
  });

  it("supports customer report printing without changing measurement data", () => {
    expect(dashboardSource).toContain("print-page print-report");
    expect(dashboardSource).toContain("인쇄·PDF 저장");
    expect(dashboardSource).toContain("dashboardPrintTitle");
    expect(dashboardSource).toContain("차보임 AI 노출 진단 -");
    expect(dashboardSource).toContain("openPrintableSnapshot");
    expect(dashboardSource).toContain('document.createElement("iframe")');
    expect(dashboardSource).toContain("printFrame.contentWindow");
    expect(dashboardSource).toContain("const originalParentTitle = document.title");
    expect(dashboardSource).toContain("document.title = title");
    expect(dashboardSource).toContain("document.title = originalParentTitle");
    expect(dashboardSource).toContain("waitForPrintableAssets");
    expect(dashboardSource).toContain('link[rel="stylesheet"]');
    expect(dashboardSource).toContain("document.fonts?.ready");
    expect(dashboardSource).toContain("printWindow.print()");
    expect(dashboardSource).not.toContain('window.open("", "_blank")');
    expect(dashboardSource).not.toContain('print?: "1"');
    expect(dashboardSource).toContain("대상 업체 · {model.businessName}");
    expect(dashboardSource).toContain("report-section print-avoid-break");
    expect(dashboardSource).toContain("no-print flex flex-col items-center");
    expect(dashboardSource).toContain('className="no-print max-h-[90vh] overflow-y-auto sm:max-w-4xl"');
    expect(dashboardSource).toContain("<DialogContent");
  });

  it("lets long detail tables flow across PDF pages without splitting individual rows", () => {
    expect(stylesSource).toContain(".print-report table,");
    expect(stylesSource).toContain(".print-report tbody");
    expect(stylesSource).toContain("break-inside: auto");
    expect(stylesSource).toContain(".print-report tr,");
    expect(dashboardSource).toContain(
      '<p className="report-kicker">OBSERVED BUSINESSES</p>',
    );
    expect(dashboardSource).toContain(
      '<p className="report-kicker">METHODOLOGY</p>',
    );
    expect(dashboardSource).not.toContain(
      'report-section print-avoid-break border-t-2 border-t-primary',
    );
  });

  it("keeps method details in the detailed report rather than the ten-second summary", () => {
    expect(dashboardSource).toContain('<p className="report-kicker">METHODOLOGY</p>');
    expect(dashboardSource).toContain("최근 측정의 메인 노출률은 내 업체로 확정된 응답만 계산합니다.");
    expect(dashboardSource).toContain("이전 측정 비교는 같은 질문과 측정 조건");
    expect(dashboardSource).not.toContain("측정 기준 보기");
  });
});
