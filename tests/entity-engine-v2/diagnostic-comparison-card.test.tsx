import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComparisonCard } from "../../src/components/diagnostic-comparison-card";
import type {
  EntityFactsV2ComparisonMetricViewModel,
  EntityFactsV2ComparisonViewModel,
} from "../../src/lib/entity-facts-v2-comparison.viewmodel";

function metric(
  label: string,
  previousValueText: string | null,
  currentValueText: string,
  deltaText: string | null,
  additions: Partial<EntityFactsV2ComparisonMetricViewModel> = {},
): EntityFactsV2ComparisonMetricViewModel {
  return {
    label,
    previousValueText,
    currentValueText,
    deltaText,
    comparisonSentence: deltaText === null ? null : `${label} 비교 문장`,
    uncertaintyText: null,
    maximumNotice: null,
    ...additions,
  };
}

function model(
  overrides: Partial<EntityFactsV2ComparisonViewModel> = {},
): EntityFactsV2ComparisonViewModel {
  return {
    version: "0.1",
    mode: "comparison",
    heading: "이전 동일 조건 측정과 비교",
    description: "같은 질문과 측정 조건으로 확인된 결과끼리 비교합니다.",
    comparisonAvailable: true,
    trendAvailable: false,
    compatibleMeasurementCount: 2,
    visibility: metric("확정 AI 노출률", "50%", "50%", "0%p"),
    top3: metric("확정 상위 3곳 노출률", "50%", "50%", "0%p"),
    searchScope: {
      core: metric("기준 검색 확정 노출", "12.5%", "37.5%", "+25%p"),
      custom: metric("상세 검색 확정 노출", "68.75%", "56.25%", "-12.5%p"),
      newlyConfirmedQuestionCount: 2,
      noLongerConfirmedQuestionCount: 2,
    },
    compactSummary: {
      validCount: 24,
      previousConfirmedCount: 12,
      currentConfirmedCount: 12,
      confirmedDeltaCount: 0,
      newlyConfirmedQuestionCount: 2,
      noLongerConfirmedQuestionCount: 2,
      sameQuestionResultCount: 20,
    },
    trendSeries: [],
    ...overrides,
  };
}

function render(viewModel: EntityFactsV2ComparisonViewModel, printExpanded = false) {
  return renderToStaticMarkup(<ComparisonCard model={viewModel} basisLabel="AI 진단 기준" printExpanded={printExpanded} />);
}

describe("diagnostic comparison infographic", () => {
  it("shows the exact previous/current values, scope bars, directions and question counts", () => {
    const html = render(model());

    expect(html).toContain("전체 노출률은 지난번과 같아요");
    expect(html).toContain("전체 AI 노출");
    expect(html).toContain("상위 3곳 노출");
    expect(html).toContain("넓은 지역 검색");
    expect(html).toContain("조건을 좁힌 검색");
    expect(html).toContain('style="width:12.5%"');
    expect(html).toContain('style="width:37.5%"');
    expect(html).toContain('style="width:68.75%"');
    expect(html).toContain('style="width:56.25%"');
    expect(html).toContain("25%p");
    expect(html).toContain("12.5%p");
    expect(html).toContain("새로 등장");
    expect(html).toContain("이번에 등장 미확인");
    expect(html.indexOf("넓은 지역 검색")).toBeLessThan(html.indexOf("조건을 좁힌 검색"));
    expect(html).not.toContain("비교 문장");
    expect(html).toContain('<details class="comparison-basis">');
  });

  it("does not turn an empty denominator or missing question trend into zero or unchanged", () => {
    const html = render(model({
      visibility: metric("확정 AI 노출률", "50%", "–", null),
      top3: metric("확정 상위 3곳 노출률", null, "–", null),
      searchScope: null,
      compactSummary: {
        validCount: 0,
        previousConfirmedCount: 0,
        currentConfirmedCount: 0,
        confirmedDeltaCount: 0,
        newlyConfirmedQuestionCount: null,
        noLongerConfirmedQuestionCount: null,
        sameQuestionResultCount: null,
      },
    }));

    expect(html).toContain("전체 노출 변화는 확인할 수 없어요");
    expect(html).toContain("확인 불가");
    expect(html).not.toContain("전체 노출률은 지난번과 같아요");
    expect(html).not.toContain("width:–");
    expect(html).not.toContain("새로 등장");
    expect(html).not.toContain("이번에 등장 미확인");
  });

  it("keeps uncertainty and maximum notices available inside the comparison basis", () => {
    const html = render(model({
      visibility: metric("확정 AI 노출률", "50%", "50%", "0%p", {
        uncertaintyText: "추가 확인 응답: 이전 0건 · 현재 2건",
        maximumNotice: "추가 확인이 필요한 응답까지 모두 같은 업체로 확인될 경우 현재 최대 58.33%",
      }),
    }));

    expect(html.match(/추가 확인 응답 있음/g)).toHaveLength(1);
    expect(html).toContain("추가 확인 응답: 이전 0건 · 현재 2건");
    expect(html).toContain("현재 최대 58.33%");
    expect(html).toContain("노출이 사라졌다는 뜻은 아닙니다");
  });

  it("opens the saved comparison basis for printing", () => {
    const html = render(model(), true);
    expect(html).toContain('<details class="comparison-basis" open="">');
    expect(html).toContain("AI 진단 기준");
  });

  it("keeps unavailable comparisons as one compact message", () => {
    const html = render(model({
      comparisonAvailable: false,
      heading: "비교 가능한 이전 측정이 아직 없습니다",
      description: "같은 조건으로 한 번 더 측정하면 비교할 수 있습니다.",
      visibility: null,
      top3: null,
      searchScope: null,
      compactSummary: null,
    }));

    expect(html).toContain("comparison-empty");
    expect(html).toContain("비교 가능한 이전 측정이 아직 없습니다. 같은 조건으로 한 번 더 측정하면 비교할 수 있습니다.");
    expect(html).not.toContain("comparison-overall");
  });
});
