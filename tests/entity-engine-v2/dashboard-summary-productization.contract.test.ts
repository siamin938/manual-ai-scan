import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
  "utf8",
);

const layoutSource = readFileSync(resolve(process.cwd(), "src/components/diagnostic-layout.tsx"), "utf8");

const stylesSource = readFileSync(
  resolve(process.cwd(), "src/styles.css"),
  "utf8",
);

describe("dashboard owner productization layer", () => {
  it("keeps existing counts while presenting scope denominators separately", () => {
    expect(layoutSource).toContain('s.kind === (broad ? "core" : "custom")');
    expect(layoutSource).toContain("`${scope.confirmedCount} / ${scope.validCount}`");
    expect(layoutSource).toContain("summary.visibility.total ??");
    expect(layoutSource).toContain("hasCounts ? summary.visibility.count");
    expect(dashboardSource).not.toContain('label="상위 3곳에 나온 답변"');
    expect(layoutSource).toContain("summary.top3");
    expect(dashboardSource).toContain('label="확정 상위 3곳 노출률"');
  });

  it("uses valid-answer counts with Top3 as conditional supporting context", () => {
    expect(layoutSource).toContain("summary.visibility.total ??");
    expect(layoutSource).toContain("hasCounts ? summary.visibility.count");
    expect(layoutSource).toContain("summary.top3.count === null");
    expect(layoutSource).toContain("개에서 상위 3곳");
    expect(layoutSource).toContain("summary.top3.count");
    expect(layoutSource).toContain("summary.visibility.count !== null");
    expect(layoutSource).toContain("결과 확인 중");
    expect(layoutSource).toContain('aria-label="먼저 확인할 일"');
    expect(dashboardSource).not.toContain('String(summary.visibility.total) + "개 질문 중 "');
  });

  it("retains secondary observations below the conclusion and first existing opportunity", () => {
    expect(dashboardSource).toContain('buildCompactSummaryInsights(summary)');
    expect(layoutSource).toContain("scopes={summary.searchScopes}");
    expect(dashboardSource).toContain("summary.opportunities[0]?.observation");
    expect(dashboardSource).toContain("어떤 종류의 질문에서 내 업체가 나왔나요?");
    expect(dashboardSource).toContain("ownerSearchContextLabel(context.intentType)");
    expect(dashboardSource).toContain("ownerSearchContextAnswerText(context.confirmedCount, context.validCount)");
    expect(dashboardSource).toContain('<h3 className="text-base font-semibold">이번 측정에서 관찰된 다른 업체</h3>');
    expect(dashboardSource).toContain("summary.searchContexts.slice(0, 3)");
    expect(dashboardSource).toContain("summary.competitorCount");
    expect(dashboardSource).toContain("답변에서 자주 관찰된 업체");
    expect(dashboardSource).toContain("summary.topCompetitors.map(");
    expect(dashboardSource).toContain("내 업체 관련성이 확인된 인용 페이지");
    expect(dashboardSource).toContain("summary.verifiedPageStatus");
    expect(dashboardSource).toContain("broadQuestionExample={broadQuestionExample}");
    expect(dashboardSource).toContain("질문 종류별 AI 답변에서 내 업체가 등장한 횟수입니다.");
    expect(dashboardSource).not.toContain("{context.confirmedCount}/{context.validCount}");
    expect(dashboardSource).toContain("이번 측정에서 확인할 ");
    expect(dashboardSource).toContain("{item.recommendedCheck}");
    expect(dashboardSource).toContain("상세 분석 보기");
    expect(dashboardSource).not.toContain("이번 측정에서 대신 확인된 내용");
    expect(dashboardSource).not.toContain("같은 기준 검색에서 반복 확인된 다른 업체");
    expect(dashboardSource).not.toContain('SummaryKpiCard');
  });

  it("keeps summary spacing and compact toolbar while grouping the detailed report", () => {
    expect(dashboardSource).toContain(
      '"print-page print-report diagnostic-page"',
    );
    expect(dashboardSource).toContain('dashboard-toolbar diagnostic-header');
    expect(dashboardSource).toContain('function DashboardSummary({');
    expect(layoutSource).toContain("summary.visibility.total ??");
  });

  it("uses the factual other-business label for both visible and zero exposure runs", () => {
    const summaryView = dashboardSource.split("function DashboardSummary({")[1]?.split("function BaselineBadge(")[0];
    expect(summaryView).toContain('<h3 className="text-base font-semibold">이번 측정에서 관찰된 다른 업체</h3>');
    expect(summaryView).not.toContain(': "함께 관찰된 업체"');
    expect(summaryView).toContain("{summary.competitorCount}곳");
    expect(summaryView).toContain("summary.topCompetitors.map(");
  });

  it("preserves secondary question and competitor observations inside the disclosure", () => {
    expect(dashboardSource).toContain('aria-label="이번 측정의 검색 상황과 관찰 업체"');
    expect(dashboardSource).toContain('className="grid gap-3 md:grid-cols-2"');
    expect(dashboardSource).toContain("이번 측정에서 확정 노출된 질문 유형이 없습니다.");
    expect(dashboardSource).toContain('role="progressbar"');
    expect(dashboardSource).toContain("context.validCount > 0");
    expect(dashboardSource).toContain("이번 측정에서 관찰된 다른 업체");
    expect(dashboardSource).not.toContain("{item.evidence}");
    expect(layoutSource).toContain("hasCounts ? summary.visibility.count");
    expect(layoutSource).toContain('aria-label="먼저 확인할 일"');
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
    expect(dashboardSource).toContain('<h1>{model?.businessName ?? "업체 선택"}</h1>');
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

  it("opens questions first, navigates to existing evidence and preserves hidden content for print", () => {
    expect(dashboardSource).toContain('useState("questions")');
    expect(dashboardSource).toContain('onShowDetail(summary.opportunities.length > 0 ? "priorities"');
    expect(dashboardSource).toContain('params={{ runId: dto.scope.runId }}');
    for (const topic of ["questions", "businesses", "sources", "comparison", "priorities", "method"]) {
      expect(dashboardSource).toContain(`id="diagnostic-${topic}"`);
      expect(dashboardSource).toContain(`open={printExpanded || detailTopic === "${topic}"}`);
    }
    expect(dashboardSource).toContain('flushSync(() => setPrintExpanded(true))');
    expect(dashboardSource).toContain('report.querySelectorAll("details")');
    expect(dashboardSource).toContain('(showAllCompetitors || printExpanded)');
    expect(dashboardSource).toContain('(showTargetExposureCitationSources || printExpanded)');
    expect(dashboardSource).toContain('(showAllCitationSources || printExpanded)');
  });

  it("does not treat missing denominators as zero or add an empty verified page card for zero visibility", () => {
    expect(layoutSource).toContain('scope.validCount > 0 ?');
    expect(layoutSource).toContain('"유효 답변 없음"');
    expect(layoutSource).toContain('scopes?.find');
    expect(dashboardSource).toContain('summary.heroVariant !== "not_visible" &&');
    expect(dashboardSource).toContain('summary.verifiedPageStatus === "pending"');
    expect(dashboardSource).toContain('summary.verifiedPageStatus === "not_verified"');
  });
});

describe("approved CHABOIM home and dashboard design", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  it("uses the local approved landing photo and preserves public sample values", () => {
    const home = read("src/routes/index.tsx");
    expect(home).toContain('@/assets/chaboim-landing.webp');
    expect(home).not.toContain("user-uploads://");
    expect(home).toContain('redirect({ to: "/dashboard" })');
    expect(home).toContain("우리 업체는 AI 답변에");
    expect(home).toContain("AI 답변 24개 중");
    expect(home).toContain('count: 14, total: 16');
    expect(home).toContain('name: "경쟁업체 A", count: 5');
  });
  it("uses server-classified broad competitor rows and keeps null benchmark shares unplotted", () => {
    const panels = read("src/components/dashboard-evidence-panels.tsx");
    expect(panels).toContain("observation.singleObservationCompetitors");
    expect(panels).toContain("observation.repeatedCompetitors");
    expect(panels).toContain("aria-pressed={selection === group.key}");
    expect(panels).toContain('!printExpanded && selection !== group.key ? "broad-evidence-list hidden space-y-3 print:block"');
    expect(panels).toContain('share === null ? "집계 전"');
    expect(panels).toContain("group.highEntitySharePct !== null && <span");
    expect(read("src/routes/_authenticated/dashboard.tsx")).toContain("key={`${dto.business.id}:${dto.scope.runId}`}");
  });
});
