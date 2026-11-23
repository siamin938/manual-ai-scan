import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleHelp,
  Eye,
  GitCompareArrows,
  ListFilter,
  MapPin,
  Minus,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  EntityFactsV2ComparisonMetricViewModel,
  EntityFactsV2ComparisonViewModel,
} from "@/lib/entity-facts-v2-comparison.viewmodel";

type Metric = EntityFactsV2ComparisonMetricViewModel;
type MetricEntry = { metric: Metric; label: string; Icon: LucideIcon };

function direction(metric: Metric): "up" | "down" | "same" | "unknown" {
  if (metric.deltaText === null) return "unknown";
  if (metric.deltaText.startsWith("+")) return "up";
  if (metric.deltaText.startsWith("-")) return "down";
  return "same";
}

function displayValue(value: string | null): string {
  return value && value !== "–" ? value : "확인 불가";
}

function ComparisonDelta({ metric }: { metric: Metric }) {
  const state = direction(metric);
  if (state === "unknown") return <span className="comparison-delta" data-direction="unknown">확인 불가</span>;
  if (state === "same") return <span className="comparison-delta" data-direction="same"><Minus aria-hidden="true" />같음</span>;
  const Icon = state === "up" ? ArrowUp : ArrowDown;
  return <span className="comparison-delta" data-direction={state}><Icon aria-hidden="true" /><span className="sr-only">{state === "up" ? "증가" : "감소"}</span>{metric.deltaText?.slice(1)}</span>;
}

function OverallMetric({ metric, label, Icon }: MetricEntry) {
  return <section className="comparison-overall-metric" aria-label={label}>
    <p><Icon aria-hidden="true" />{label}</p>
    <div className="comparison-overall-result">
      <span className="comparison-overall-values">
        <span className="sr-only">지난번 {displayValue(metric.previousValueText)}, 이번 {displayValue(metric.currentValueText)}</span>
        <span aria-hidden="true">{displayValue(metric.previousValueText)}</span>
        <ArrowRight aria-hidden="true" />
        <strong aria-hidden="true">{displayValue(metric.currentValueText)}</strong>
      </span>
      <ComparisonDelta metric={metric} />
    </div>
  </section>;
}

function ScopeMetric({ metric, label, Icon }: MetricEntry) {
  const previousWidth = metric.previousValueText && metric.previousValueText !== "–" ? metric.previousValueText : null;
  const currentWidth = metric.currentValueText !== "–" ? metric.currentValueText : null;
  return <section className="comparison-scope-row" aria-label={label}>
    <div className="comparison-scope-heading">
      <h4><Icon aria-hidden="true" />{label}</h4>
      <ComparisonDelta metric={metric} />
    </div>
    <div className="comparison-scope-values">
      <span className="sr-only">지난번 {displayValue(metric.previousValueText)}, 이번 {displayValue(metric.currentValueText)}</span>
      <span aria-hidden="true">{displayValue(metric.previousValueText)}</span>
      <ArrowRight aria-hidden="true" />
      <strong aria-hidden="true">{displayValue(metric.currentValueText)}</strong>
    </div>
    <div className="comparison-scope-chart" role="img" aria-label={`${label}, 0에서 100% 눈금. 지난번 ${displayValue(metric.previousValueText)}, 이번 ${displayValue(metric.currentValueText)}`}>
      <div className="comparison-scope-track" data-period="previous" data-empty={previousWidth === null} aria-hidden="true">
        <span style={previousWidth ? { width: previousWidth } : undefined} />
      </div>
      <div className="comparison-scope-track" data-period="current" data-empty={currentWidth === null} aria-hidden="true">
        <span style={currentWidth ? { width: currentWidth } : undefined} />
      </div>
    </div>
  </section>;
}

export function ComparisonCard({ model, basisLabel, printExpanded = false }: {
  model: EntityFactsV2ComparisonViewModel;
  basisLabel: string;
  printExpanded?: boolean;
}) {
  if (!model.comparisonAvailable || !model.visibility || !model.top3) {
    return <Card className="report-section comparison-card comparison-empty">
      <CardContent><GitCompareArrows aria-hidden="true" /><p>{model.heading}. {model.description}</p></CardContent>
    </Card>;
  }

  const visibility = model.visibility;
  const top3 = model.top3;
  const overall: MetricEntry[] = [
    { metric: visibility, label: "전체 AI 노출", Icon: Eye },
    { metric: top3, label: "상위 3곳 노출", Icon: Trophy },
  ];
  const scopes: MetricEntry[] = model.searchScope ? [
    { metric: model.searchScope.core, label: "넓은 지역 검색", Icon: MapPin },
    { metric: model.searchScope.custom, label: "조건을 좁힌 검색", Icon: ListFilter },
  ] : [];
  const noticeMetrics = [...overall, ...scopes].filter(({ metric }) => metric.uncertaintyText || metric.maximumNotice);
  const newlyConfirmed = model.compactSummary?.newlyConfirmedQuestionCount ?? null;
  const noLongerConfirmed = model.compactSummary?.noLongerConfirmedQuestionCount ?? null;
  const visibilityDirection = direction(visibility);
  const headline = visibilityDirection === "same"
    ? "전체 노출률은 지난번과 같아요"
    : visibilityDirection === "up"
      ? "전체 노출률은 지난번보다 높아요"
      : visibilityDirection === "down"
        ? "전체 노출률은 지난번보다 낮아요"
        : "전체 노출 변화는 확인할 수 없어요";

  return <Card className="report-section comparison-card">
    <CardHeader className="comparison-card-header">
      <div className="comparison-heading-icon"><GitCompareArrows aria-hidden="true" /></div>
      <div className="comparison-heading-copy">
        <p className="report-kicker">측정 비교</p>
        <CardTitle>{model.heading}</CardTitle>
        <p className="comparison-headline">{headline}</p>
      </div>
      {noticeMetrics.length > 0 && <span className="comparison-notice"><CircleHelp aria-hidden="true" />추가 확인 응답 있음</span>}
    </CardHeader>
    <CardContent className="comparison-content">
      <div className="comparison-overall">{overall.map(entry => <OverallMetric key={entry.label} {...entry} />)}</div>

      {scopes.length > 0 && <section className="comparison-scopes" aria-labelledby="comparison-scopes-title">
        <div className="comparison-section-heading">
          <h3 id="comparison-scopes-title">검색 유형별 변화</h3>
          <div className="comparison-legend" aria-label="그래프 범례">
            <span><i data-period="previous" aria-hidden="true" />지난번</span>
            <span><i data-period="current" aria-hidden="true" />이번</span>
          </div>
        </div>
        <div className="comparison-scope-list">{scopes.map(entry => <ScopeMetric key={entry.label} {...entry} />)}</div>
      </section>}

      {(newlyConfirmed !== null || noLongerConfirmed !== null) && <section className="comparison-questions" aria-label="질문별 변화">
        {newlyConfirmed !== null && <div><Sparkles aria-hidden="true" /><span>새로 등장</span><strong>{newlyConfirmed}<small>개</small></strong></div>}
        {noLongerConfirmed !== null && <div><CircleHelp aria-hidden="true" /><span>이번에 등장 미확인</span><strong>{noLongerConfirmed}<small>개</small></strong></div>}
      </section>}

      <details className="comparison-basis" open={printExpanded ? true : undefined}>
        <summary>비교 기준</summary>
        <div className="comparison-basis-content">
          <div><Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground">{basisLabel}</Badge><p>{model.description}</p></div>
          <p>동일한 질문 세트와 측정 조건이 확인된 두 측정의 확정 여부만 비교하며, 변화의 원인을 의미하지 않습니다.</p>
          {(newlyConfirmed !== null || noLongerConfirmed !== null) && <p>‘새로 등장’은 이번에 등장이 확정된 질문이며, ‘이번에 등장 미확인’은 이전에는 확정됐지만 이번에는 확정되지 않은 질문입니다. 노출이 사라졌다는 뜻은 아닙니다.</p>}
          {noticeMetrics.length > 0 && <div className="comparison-notice-details"><h4>추가 확인 응답과 최대 범위</h4>{noticeMetrics.map(({ metric, label }) => <section key={label}><strong>{label}</strong>{metric.uncertaintyText && <p>{metric.uncertaintyText}</p>}{metric.maximumNotice && <p>{metric.maximumNotice}</p>}</section>)}</div>}
          {model.trendAvailable && model.compatibleMeasurementCount !== null && <p>동일 조건 측정 {model.compatibleMeasurementCount}회가 확인되었습니다.</p>}
        </div>
      </details>
    </CardContent>
  </Card>;
}
