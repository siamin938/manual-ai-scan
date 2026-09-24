import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { getEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.functions";
import { buildEntityFactsV2DashboardCutoverModel } from "@/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import { getEntityFactsV2Comparison } from "@/lib/entity-facts-v2-comparison.functions";
import { buildEntityFactsV2ComparisonViewModel } from "@/lib/entity-facts-v2-comparison.viewmodel";
import { buildActionOpportunityEngineV01 } from "@/lib/action-opportunity-engine-v01";
import { getActionOpportunityEvidence } from "@/lib/action-opportunity-evidence.functions";
import { getVerifiedFirstPartySourceTypes } from "@/lib/first-party-source-registry.functions";
import { getVisibilityBenchmark } from "@/lib/visibility-benchmark.functions";
import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "AI 노출 진단 · 차보임 CHABOIM" },
      {
        name: "description",
        content:
          "여러 고객 질문에서 업체가 AI 답변에 관찰된 노출 범위, 함께 관찰된 업체와 연결 출처를 확인하는 진단 대시보드.",
      },
      { property: "og:title", content: "AI 노출 진단 · 차보임 CHABOIM" },
      {
        property: "og:description",
        content: "확정 노출과 추가 확인이 필요한 범위를 구분해 보여주는 AI 노출 진단",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function intentLabel(intentType: string): string {
  return (INTENT_LABELS as Record<string, string>)[intentType] ?? "기타";
}

function pctRange(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) return "–";
  const format = (value: number) => `${Math.round(value * 100) / 100}%`;
  return lower === upper ? format(lower) : `${format(lower)} ~ ${format(upper)}`;
}

function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (100 * part) / total));
}

function MeasurementStatusBar({
  confirmed,
  unresolved,
  total,
}: {
  confirmed: number;
  unresolved: number;
  total: number;
}) {
  const missing = Math.max(0, total - confirmed - unresolved);
  const confirmedPct = percentOf(confirmed, total);
  const unresolvedPct = percentOf(unresolved, total);
  const missingPct = percentOf(missing, total);
  const chartData = [{ name: "최근 측정", confirmed, unresolved, missing }];

  return (
    <div className="rounded-lg border bg-muted/15 p-4 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">이번 측정 한눈에 보기</p>
        <p className="text-xs text-muted-foreground">유효 AI 답변 {total}건</p>
      </div>
      <div
        className="mt-3 h-16 w-full"
        role="img"
        aria-label={`확정 노출 ${confirmed}건, 추가 확인 ${unresolved}건, 노출 미확인 ${missing}건`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 0, bottom: 8, left: 0 }}
          >
            <XAxis type="number" domain={[0, Math.max(total, 1)]} hide />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={<MeasurementTooltip />} cursor={{ fill: "var(--color-muted)" }} />
            <Bar
              dataKey="confirmed"
              name="확정 노출"
              stackId="measurement"
              fill="var(--color-chart-1)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="unresolved"
              name="추가 확인"
              stackId="measurement"
              fill="var(--color-chart-2)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="missing"
              name="노출 미확인"
              stackId="measurement"
              fill="var(--color-muted)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span>
          <span className="font-semibold text-primary">확정 노출 {confirmed}건</span>
          {" · "}
          {confirmedPct.toFixed(1)}%
        </span>
        {unresolved > 0 && (
          <span className="text-muted-foreground">
            추가 확인 {unresolved}건 · {unresolvedPct.toFixed(1)}%
          </span>
        )}
        <span className="text-muted-foreground">
          노출 미확인 {missing}건 · {missingPct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

type ChartTooltipPayload = {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { label?: string; connected?: boolean };
};

function MeasurementTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {payload.map((item) => (
        <p key={item.name} className="flex min-w-32 justify-between gap-4">
          <span>{item.name}</span>
          <span className="font-semibold tabular-nums">{item.value}건</span>
        </p>
      ))}
    </div>
  );
}

function SearchContextChart({
  groups,
}: {
  groups: Array<QuestionGroupCounts & { intentType: string }>;
}) {
  const data = groups.map((group) => ({
    label: intentLabel(group.intentType),
    confirmed: group.confirmedMentionCount,
    unresolved: group.unresolvedTargetCount,
    validCount: group.validCount,
    missing: Math.max(
      0,
      group.validCount - group.confirmedMentionCount - group.unresolvedTargetCount,
    ),
  }));
  const maximum = Math.max(1, ...groups.map((group) => group.validCount));

  return (
    <div>
      <div
        className="h-[26rem] w-full sm:h-[24rem]"
        role="img"
        aria-label="검색 상황별 확정 노출, 추가 확인, 노출 미확인 건수 비교"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
            barCategoryGap="28%"
          >
            <CartesianGrid horizontal={false} stroke="var(--color-border)" />
            <XAxis
              type="number"
              domain={[0, maximum]}
              allowDecimals={false}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={86}
              tick={{ fill: "var(--color-foreground)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<MeasurementTooltip />} cursor={{ fill: "var(--color-muted)" }} />
            <Bar
              dataKey="confirmed"
              name="확정 노출"
              stackId="context"
              fill="var(--color-chart-1)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="unresolved"
              name="추가 확인"
              stackId="context"
              fill="var(--color-chart-2)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="missing"
              name="노출 미확인"
              stackId="context"
              fill="var(--color-muted)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span>
          <span className="mr-1.5 inline-block size-2.5 bg-chart-1" />
          확정 노출
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2.5 bg-chart-2" />
          추가 확인
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2.5 bg-muted" />
          노출 미확인
        </span>
      </div>
      <div
        className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        {data.map((item) => (
          <span key={item.label}>· {item.label} 질문 {item.validCount}개 기준</span>
        ))}
      </div>
      <div className="sr-only">
        {data.map((item) => (
          <p key={item.label}>
            {item.label}: 확정 노출 {item.confirmed}건, 추가 확인 {item.unresolved}건, 노출 미확인{" "}
            {item.missing}건
          </p>
        ))}
      </div>
    </div>
  );
}

function weakQuestionBadgeVariant(
  tone: "positive" | "neutral" | "attention",
): "default" | "secondary" | "outline" {
  if (tone === "positive") return "default";
  if (tone === "attention") return "secondary";
  return "outline";
}

type QuestionGroupCounts = {
  confirmedMentionCount: number;
  validCount: number;
  unresolvedTargetCount: number;
};

function DashboardPage() {
  const { activeOrgId } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const businessId = businesses.selectedBusinessId;
  const [expandedCompetitorBusinessId, setExpandedCompetitorBusinessId] = useState<string | null>(
    null,
  );
  const [expandedWeakQuestionBusinessId, setExpandedWeakQuestionBusinessId] = useState<
    string | null
  >(null);
  const showAllCompetitors = expandedCompetitorBusinessId === businessId;
  const showAllWeakQuestions = expandedWeakQuestionBusinessId === businessId;

  const fetchV2 = useServerFn(getEntityFactsV2ReadGateway);
  const query = useQuery({
    queryKey: ["entity-facts-v2-dashboard", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchV2({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });

  const fetchComparison = useServerFn(getEntityFactsV2Comparison);
  const comparisonQuery = useQuery({
    queryKey: ["entity-facts-v2-comparison", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchComparison({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });

  const fetchBenchmark = useServerFn(getVisibilityBenchmark);
  const benchmarkQuery = useQuery({
    queryKey: ["visibility-benchmark", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchBenchmark({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });
  const benchmarkResult = benchmarkQuery.data;
  const benchmark = benchmarkResult && benchmarkResult.ok ? benchmarkResult.benchmark : null;

  const fetchVerifiedFirstPartySourceTypes = useServerFn(getVerifiedFirstPartySourceTypes);
  const firstPartyQuery = useQuery({
    queryKey: ["verified-first-party-source-types", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchVerifiedFirstPartySourceTypes({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });
  const firstPartyResult = firstPartyQuery.data;
  const verifiedFirstPartySourceTypes =
    firstPartyResult && firstPartyResult.ok ? firstPartyResult.sourceTypes : [];

  const fetchActionOpportunityEvidence = useServerFn(getActionOpportunityEvidence);
  const actionEvidenceQuery = useQuery({
    queryKey: ["action-opportunity-evidence", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId && !!benchmark,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetchActionOpportunityEvidence({
          data: {
            orgId: activeOrgId as string,
            businessId: businessId as string,
            highVisibilityThresholdPct: benchmark?.thresholdPct ?? 20,
          },
        });
        return response && response.ok
          ? {
              highVisibilityExamples: response.highVisibilityExamples,
              currentRunReferences: response.currentRunReferences,
            }
          : { highVisibilityExamples: [], currentRunReferences: [] };
      } catch {
        return { highVisibilityExamples: [], currentRunReferences: [] };
      }
    },
  });
  const actionEvidenceExamples = actionEvidenceQuery.data?.highVisibilityExamples ?? [];
  const currentRunReferences = actionEvidenceQuery.data?.currentRunReferences ?? [];

  const result = query.data;
  const dto = result && result.ok ? result.data : null;
  const model = dto ? buildEntityFactsV2DashboardCutoverModel(dto) : null;
  const actionOpportunityModel = benchmark
    ? buildActionOpportunityEngineV01({
        benchmark,
        verifiedFirstPartySourceTypes,
      })
    : null;
  const comparisonResult = comparisonQuery.data;
  const comparisonModel =
    comparisonResult && comparisonResult.ok
      ? buildEntityFactsV2ComparisonViewModel(comparisonResult.data)
      : null;

  return (
    <div className="space-y-8 lg:space-y-10">
      <div className="border-b border-border pb-6 lg:flex lg:items-end lg:justify-between lg:gap-8">
        <div className="max-w-3xl">
          <p className="report-kicker mb-3">AI VISIBILITY REPORT</p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">내 AI 노출 진단</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            AI 답변에서 확인된 노출과 아직 동일성 확인이 필요한 응답을 구분해 보여드립니다.
          </p>
        </div>
        <div className="mt-5 min-w-0 rounded-lg border border-border bg-card p-3 lg:mt-0">
          <BusinessSelector
            options={businesses.options}
            value={businesses.selectedBusinessId}
            onChange={businesses.select}
            isLoading={businesses.isLoading}
            isError={businesses.isError}
          />
        </div>
      </div>

      {!businessId && !businesses.isLoading && (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <p>진단할 대상 업체가 없습니다. 내 업체를 먼저 등록하세요.</p>
            <Button asChild>
              <Link to="/businesses">내 업체 등록하기</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {query.isLoading && businessId && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}

      {result && !result.ok && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {result.error === "NO_V2_DATA"
              ? "최근 완료된 측정에 v2 진단 데이터가 아직 준비되지 않았습니다."
              : result.error === "FORBIDDEN"
                ? "이 업체의 진단을 볼 권한이 없습니다."
                : result.error === "BUSINESS_NOT_AVAILABLE"
                  ? "현재 진단할 수 있는 업체가 아닙니다."
                  : result.error === "INVALID_V2_DATA"
                    ? "최근 진단 데이터의 검증에 실패해 결과를 표시하지 않습니다."
                    : "진단 결과를 불러오지 못했습니다. 잠시 후 다시 시도하세요."}
          </CardContent>
        </Card>
      )}

      {query.isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            진단 요청이 실패했습니다.
          </CardContent>
        </Card>
      )}

      {dto && model && (
        <>
          <div className="grid overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4 lg:gap-px">
            <MetricCard
              highlight
              label="확정 AI 노출률"
              value={pctRange(
                model.metricCards.visibility.lowerPct,
                model.metricCards.visibility.lowerPct,
              )}
              note={
                model.metricCards.visibility.unresolvedCount > 0
                  ? `유효 응답 ${model.metricCards.visibility.validCount}건 중 확정 노출 ${model.metricCards.visibility.confirmedCount}건 · 추가 확인 ${model.metricCards.visibility.unresolvedCount}건`
                  : `유효 응답 ${model.metricCards.visibility.validCount}건 중 확정 노출 ${model.metricCards.visibility.confirmedCount}건`
              }
            />
            <MetricCard
              label="확정 상위 3곳 노출률"
              value={pctRange(model.metricCards.top3.lowerPct, model.metricCards.top3.lowerPct)}
              note={
                model.metricCards.top3.unresolvedCount > 0
                  ? `유효 응답 ${model.metricCards.top3.validCount}건 중 상위 3곳 확정 ${model.metricCards.top3.confirmedCount}건 · 상위 3곳 여부 추가 확인 ${model.metricCards.top3.unresolvedCount}건`
                  : `유효 응답 ${model.metricCards.top3.validCount}건 중 상위 3곳 확정 ${model.metricCards.top3.confirmedCount}건`
              }
            />
            <MetricCard
              label="함께 관찰된 업체"
              value={`${model.metricCards.competitorCount}곳`}
              note="이번 측정에서 업체로 확인된 항목"
            />
            <MetricCard
              label="관찰된 주요 출처"
              value={
                model.sources.available ? `${model.metricCards.observedSourceCount}곳` : "준비 중"
              }
              note="확인된 연결과 연결 단서를 포함한 출처"
            />
          </div>

          <Card className="report-section border-t-2 border-t-primary">
            <CardHeader className="border-b bg-muted/25 pb-4">
              <p className="report-kicker">EXECUTIVE SUMMARY</p>
              <CardTitle className="text-xl">최근 측정 결과</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-5 text-base leading-7 lg:grid-cols-2 lg:gap-x-10">
              <MeasurementStatusBar
                confirmed={model.recentSummary.visibility.confirmedCount}
                unresolved={model.recentSummary.visibility.unresolvedCount}
                total={model.recentSummary.visibility.validCount}
              />
              <p className="font-medium">
                확정 AI 노출률{" "}
                {pctRange(
                  model.recentSummary.visibility.lowerPct,
                  model.recentSummary.visibility.lowerPct,
                )}
              </p>
              <p className="text-muted-foreground">
                유효 응답 {model.recentSummary.visibility.validCount}건 중 확정 노출{" "}
                {model.recentSummary.visibility.confirmedCount}건
                {model.recentSummary.visibility.unresolvedCount > 0
                  ? ` · 추가 확인 ${model.recentSummary.visibility.unresolvedCount}건`
                  : ""}
              </p>
              {model.recentSummary.visibility.unresolvedCount > 0 &&
                model.recentSummary.visibility.upperPct !== null && (
                  <p className="text-sm text-muted-foreground">
                    추가 확인이 필요한 응답까지 모두 같은 업체로 확인될 경우 최대{" "}
                    {pctRange(
                      model.recentSummary.visibility.upperPct,
                      model.recentSummary.visibility.upperPct,
                    )}
                  </p>
                )}
              {model.recentSummary.uncertaintyNotice && (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground lg:col-span-2">
                  {model.recentSummary.uncertaintyNotice}
                </p>
              )}
              <p className="text-muted-foreground">{model.recentSummary.questionSummaryText}</p>
              {model.recentSummary.topCompetitor && (
                <p>
                  가장 자주 함께 관찰된 업체: {model.recentSummary.topCompetitor.name} ·{" "}
                  {model.recentSummary.topCompetitor.responseCount}개 답변
                </p>
              )}
              {model.recentSummary.sourceQualityNotice && (
                <p className="text-xs text-muted-foreground">
                  {model.recentSummary.sourceQualityNotice}
                </p>
              )}
            </CardContent>
          </Card>

          {actionOpportunityModel && (
            <ActionOpportunitySection
              model={actionOpportunityModel}
              evidenceExamples={actionEvidenceExamples}
              currentRunReferences={currentRunReferences}
            />
          )}

          {currentRunReferences.length > 0 && (
            <CurrentRunReferenceSection references={currentRunReferences} />
          )}

          {comparisonModel && <ComparisonCard model={comparisonModel} />}
          {(comparisonQuery.isError || (comparisonResult && !comparisonResult.ok)) && (
            <Card className="report-section">
              <CardContent className="py-5 text-sm text-muted-foreground">
                이전 측정 비교 정보를 불러오지 못했습니다. 최근 측정 결과에는 영향이 없습니다.
              </CardContent>
            </Card>
          )}

          <p className="border-b border-border pb-5 text-sm text-muted-foreground">
            분석에 사용한 유효 AI 답변 {model.recentSummary.validCount}건 · 최근 측정{" "}
            {formatSeoul(model.measuredAt)}
            {model.recentSummary.invalidCount > 0
              ? ` · 제외 ${model.recentSummary.invalidCount}건`
              : ""}
          </p>

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">OBSERVED BUSINESSES</p>
              <CardTitle className="text-xl">{model.competitors.heading}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs text-muted-foreground">
                이번 측정의 AI 답변에서 업체로 확인된 항목입니다. 같은 업체가 여러 답변에서 보인
                횟수를 함께 표시합니다.
              </p>
              {model.competitors.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  함께 관찰된 다른 업체가 없습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>업체</TableHead>
                      <TableHead>AI 답변에서 관찰</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.competitors.rows
                      .slice(0, showAllCompetitors ? model.competitors.rows.length : 6)
                      .map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="text-sm">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{c.name}</span>
                              <Badge variant="outline">{c.label}</Badge>
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="tabular-nums">{c.responseCount}건</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              질문 {c.questionCount}개 · 상위 3곳 안에서 {c.top3ResponseCount}건
                              관찰
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
              {model.competitors.rows.length > 6 && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedCompetitorBusinessId(showAllCompetitors ? null : businessId)
                    }
                  >
                    {showAllCompetitors ? "접기" : `전체 ${model.competitors.rows.length}곳 보기`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="text-xl">{model.weakQuestions.heading}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  노출이 확정되지 않았거나, 일부만 확인됐거나, 대상 동일성 확인이 더 필요한
                  질문입니다.
                </p>
                {model.weakQuestions.rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    현재 우선 확인할 질문이 없습니다.
                  </p>
                ) : (
                  model.weakQuestions.rows
                    .slice(0, showAllWeakQuestions ? model.weakQuestions.rows.length : 6)
                    .map((q) => (
                      <div key={q.questionId} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium">{q.questionText}</p>
                          <Badge variant={weakQuestionBadgeVariant(q.statusTone)}>
                            {q.statusLabel}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {intentLabel(q.intentType)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          확정 노출 {q.confirmedMentionCount}건 · 추가 확인 필요{" "}
                          {q.unresolvedTargetCount}건
                        </p>
                      </div>
                    ))
                )}
                {model.weakQuestions.rows.length > 6 && (
                  <div className="flex justify-center pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedWeakQuestionBusinessId(showAllWeakQuestions ? null : businessId)
                      }
                    >
                      {showAllWeakQuestions
                        ? "접기"
                        : `전체 ${model.weakQuestions.rows.length}개 질문 보기`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="text-xl">{model.sources.heading}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <p className="mb-3 text-xs text-muted-foreground">
                  이번 측정의 AI 답변에서 내 업체 또는 함께 관찰된 업체와 연결된 출처입니다.{" "}
                  {"연결이 아직 충분히 확인되지 않은 경우에는 ‘연결 단서’로 표시합니다."}
                </p>
                {!model.sources.available ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    이번 측정의 출처 진단 데이터가 아직 준비되지 않았습니다.
                  </p>
                ) : model.sources.rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    이번 측정의 AI 답변에서 업체와 연결된 출처가 확인되지 않았습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>출처</TableHead>
                        <TableHead>관찰된 답변</TableHead>
                        <TableHead>연결된 업체</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {model.sources.rows.map((s) => (
                        <TableRow key={s.domain}>
                          <TableCell className="text-sm font-medium">
                            <span className="flex flex-wrap items-center gap-2">
                              <span>{s.domain}</span>
                              {s.evidence === "clue" && (
                                <Badge variant="secondary">연결 단서</Badge>
                              )}
                              {s.evidence === "mixed" && (
                                <Badge variant="outline">확인 + 단서</Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {s.evidence === "clue" ? (
                              <span className="text-sm">
                                AI 답변 {s.clueResponseCount}건에서 단서 확인
                              </span>
                            ) : (
                              <>
                                <span className="tabular-nums">{s.responseCount}건</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  내 업체 연결 {s.targetResponseCount}건 · 함께 관찰된 업체 연결{" "}
                                  {s.competitorResponseCount}건
                                  {s.evidence === "mixed" && s.clueResponseCount > 0
                                    ? ` · 추가 단서 ${s.clueResponseCount}건`
                                    : ""}
                                </span>
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="flex flex-wrap gap-1.5">
                              {s.linkedEntities.map((entity) => (
                                <Badge
                                  key={`${s.domain}:${entity.isTarget ? "target" : "other"}:${entity.name}:${entity.evidence}`}
                                  variant={
                                    entity.isTarget
                                      ? "default"
                                      : entity.evidence === "clue"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {entity.isTarget ? "내 업체" : entity.name}
                                  {!entity.isTarget && entity.evidence === "confirmed"
                                    ? ` · ${entity.responseCount}건`
                                    : ""}
                                  {entity.evidence === "clue" ? " · 연결 단서" : ""}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {benchmark && <BenchmarkCard benchmark={benchmark} />}

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">SEARCH CONTEXT</p>
              <CardTitle className="text-xl">어떤 검색 상황에서 보였나요?</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs text-muted-foreground">
                비슷한 검색 질문을 묶어 내 업체가 실제로 확인된 질문과 추가 확인이 필요한 질문을
                보여드립니다. 각 검색 상황은 이번 측정의 해당 질문 수를 기준으로 비교합니다.
              </p>
              {model.questionGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  질문군 요약이 아직 없습니다.
                </p>
              ) : (
                <SearchContextChart groups={model.questionGroups} />
              )}
            </CardContent>
          </Card>

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">METHODOLOGY</p>
              <CardTitle className="text-xl">분석 방법과 신뢰도</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                기준 측정: {dto.scope.runName} · 반복 {dto.scope.repetitions}회 · 완료{" "}
                {dto.scope.completedJobs}/{dto.scope.totalJobs}
              </p>
              <p>
                최근 측정의 메인 노출률은 내 업체로 확정된 응답만 계산합니다. 추가 확인이 필요한
                응답은 별도로 표시하며, 가능한 최대 범위는 상세 정보에서 참고할 수 있습니다.
              </p>
              <p>
                이전 측정 비교는 같은 질문과 측정 조건이 확인되는 경우에만 제공합니다. 충분한 동일
                조건 측정이 쌓이기 전까지 시간 추세와 경쟁업체 상세 비교는 표시하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ActionOpportunitySection({
  model,
  evidenceExamples,
  currentRunReferences,
}: {
  model: ReturnType<typeof buildActionOpportunityEngineV01>;
  evidenceExamples: Array<{
    sourceGroupKey: string;
    entityName: string;
    domain: string;
    url: string;
    attributionLevel: "direct" | "section";
  }>;
  currentRunReferences: Array<{
    sourceGroupKey: string;
    domain: string;
    responseCount: number;
    entityCount: number;
    entities: Array<{
      entityName: string;
      url: string;
      attributionLevel: "direct" | "section";
    }>;
  }>;
}) {
  return (
    <Card className="report-section border-t-2 border-t-primary">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">ACTION OPPORTUNITIES</p>
        <CardTitle className="text-xl">{model.heading}</CardTitle>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{model.description}</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {model.items.length === 0 ? (
          <p className="rounded-md border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
            현재 데이터에서는 근거가 충분한 출처 연결 차이를 찾지 못했습니다. 의미가 약한 차이는
            억지로 보여주지 않습니다.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {model.items.map((item) => (
              <div key={item.sourceGroupKey} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={item.rank === 1 ? "default" : "outline"}>{item.rank}순위</Badge>
                  <Badge variant="secondary">
                    {item.signalStrength === "strong" ? "강한 신호" : "보통 신호"}
                  </Badge>
                </div>

                <p className="mt-3 text-base font-semibold leading-6">{item.title}</p>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-xs font-medium">왜 확인하나요?</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.whyText}</p>
                  </div>

                  {item.sites.some((site) => {
                    const normalizedDomain = site.domain?.toLowerCase().replace(/^www\./, "");
                    return currentRunReferences.some(
                      (reference) =>
                        normalizedDomain &&
                        reference.domain === normalizedDomain &&
                        reference.entities.length > 0,
                    );
                  }) && (
                    <div>
                      <p className="text-xs font-medium">실제로 비교할 수 있는 같은 채널 사례</p>
                      <div className="mt-2 space-y-2">
                        {item.sites.flatMap((site) => {
                          const normalizedDomain = site.domain?.toLowerCase().replace(/^www\./, "");
                          const currentReference = currentRunReferences.find(
                            (reference) =>
                              normalizedDomain &&
                              reference.domain === normalizedDomain &&
                              reference.entities.length > 0,
                          );
                          if (!currentReference?.entities[0]) return [];
                          return [
                            <a
                              key={`${site.label}:${currentReference.entities[0].entityName}:${currentReference.entities[0].url}`}
                              href={currentReference.entities[0].url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                            >
                              <span className="font-medium">{site.label}</span>
                              <span className="ml-2 text-muted-foreground">
                                {currentReference.entities[0].entityName} · 실제 페이지 보기 ↗
                              </span>
                            </a>,
                          ];
                        })}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        이번 측정에서 다른 업체와 확정 연결된 동일 채널만 표시합니다.
                      </p>
                    </div>
                  )}

                  {evidenceExamples.some(
                    (example) => example.sourceGroupKey === item.sourceGroupKey,
                  ) && (
                    <div>
                      <p className="text-xs font-medium">실제 비교해볼 업체 사례</p>
                      <div className="mt-2 space-y-1.5">
                        {evidenceExamples
                          .filter((example) => example.sourceGroupKey === item.sourceGroupKey)
                          .slice(0, 2)
                          .map((example) => (
                            <a
                              key={`${example.entityName}:${example.url}`}
                              href={example.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                            >
                              <span className="font-medium">{example.entityName}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {example.domain} · 실제 페이지 보기 ↗
                              </span>
                            </a>
                          ))}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        현재 선택한 업체의 최근 AI 측정에서 함께 관찰된 업체와 실제 출처 연결만
                        보여줍니다. 직접 비교용 참고 사례이며, 해당 페이지가 노출의 원인임을
                        의미하지 않습니다.
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium">확인해볼 차이</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.actionText}
                    </p>
                  </div>
                </div>

                <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                  근거 · {item.evidenceText}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {model.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}

function CurrentRunReferenceSection({
  references,
}: {
  references: Array<{
    sourceGroupKey: string;
    domain: string;
    responseCount: number;
    entityCount: number;
    entities: Array<{
      entityName: string;
      url: string;
      attributionLevel: "direct" | "section";
    }>;
  }>;
}) {
  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">CURRENT RUN REFERENCES</p>
        <CardTitle className="text-xl">이번 측정에서 확인된 타업체 출처 사례</CardTitle>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          고노출 우선순위 근거와는 별도 참고 정보입니다. 내 업체와의 연결은 확인되지 않았지만, 이번
          측정에서 다른 업체와 확정 연결된 출처만 보여드립니다.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 pt-5 lg:grid-cols-3">
        {references.map((reference) => (
          <div key={reference.domain} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{reference.domain}</p>
              <Badge variant="outline">타업체 {reference.entityCount}곳</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 답변 {reference.responseCount}건에서 확인
            </p>
            <div className="mt-3 space-y-2">
              {reference.entities.map((entity) => (
                <a
                  key={`${reference.domain}:${entity.entityName}:${entity.url}`}
                  href={entity.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                >
                  <span className="font-medium">{entity.entityName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">실제 페이지 보기 ↗</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ComparisonCard({
  model,
}: {
  model: ReturnType<typeof buildEntityFactsV2ComparisonViewModel>;
}) {
  if (!model.comparisonAvailable) {
    return (
      <Card>
        <CardContent className="space-y-1.5 py-4">
          <p className="text-sm font-semibold">이전 측정 비교</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {model.heading}. {model.description}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">측정 비교</p>
        <CardTitle className="text-xl">{model.heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <p className="text-sm leading-6 text-muted-foreground">{model.description}</p>

        {model.comparisonAvailable && model.visibility && model.top3 && (
          <div className="grid gap-4 md:grid-cols-2">
            {[model.visibility, model.top3].map((metric) => (
              <div key={metric.label} className="rounded-md border p-4">
                <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-2xl font-semibold tabular-nums">
                    {metric.currentValueText}
                  </span>
                  {metric.deltaText && <Badge variant="outline">{metric.deltaText}</Badge>}
                </div>
                {metric.previousValueText && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    이전 동일 조건 측정 {metric.previousValueText}
                  </p>
                )}
                {metric.comparisonSentence && (
                  <p className="mt-3 text-sm">{metric.comparisonSentence}</p>
                )}
                {metric.uncertaintyText && (
                  <p className="mt-2 text-xs text-muted-foreground">{metric.uncertaintyText}</p>
                )}
                {metric.maximumNotice && (
                  <p className="mt-1 text-xs text-muted-foreground">{metric.maximumNotice}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {model.trendAvailable && model.compatibleMeasurementCount !== null && (
          <p className="text-xs text-muted-foreground">
            동일 조건 측정 {model.compatibleMeasurementCount}회가 확인되었습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BenchmarkCard({
  benchmark,
}: {
  benchmark: NonNullable<
    Extract<Awaited<ReturnType<typeof getVisibilityBenchmark>>, { ok: true }>["benchmark"]
  >;
}) {
  const chartGroups = benchmark.sourceGroups.slice(0, 6);
  const chartData = chartGroups.map((group) => ({
    label: group.label,
    share: group.highEntitySharePct ?? 0,
    connected: group.targetConnected,
  }));

  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">MARKET BENCHMARK</p>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          AI에 자주 추천되는 업체들은 어디에서 많이 보일까요?
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            데이터 축적 중
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          최근 {benchmark.windowDays}일 동안의 별도 벤치마크 집계입니다. 현재 업체의 v2 최근 측정
          진단과는 독립된 참고 정보입니다.
        </p>
        {benchmark.dataStatus === "early" && (
          <p className="text-xs text-muted-foreground">현재는 초기 표본으로 참고용 집계입니다.</p>
        )}
        {benchmark.sourceGroups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            아직 공통 출처 패턴을 판단할 표본이 부족합니다.
          </p>
        ) : (
          <div className="space-y-4">
            <div
              className="h-72 w-full sm:h-80"
              role="img"
              aria-label="시장 벤치마크 출처 그룹별 고노출 업체 관찰 비율"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 8, right: 48, bottom: 8, left: 8 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={112}
                    tick={{ fill: "var(--color-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<BenchmarkTooltip />} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar
                    dataKey="share"
                    name="관찰 비율"
                    fill="var(--color-chart-1)"
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  >
                    <LabelList
                      dataKey="share"
                      position="right"
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                      className="fill-foreground text-[11px] font-semibold"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="divide-y rounded-md border">
              {chartGroups.map((g) => (
                <div
                  key={g.key}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
                >
                  <p className="text-sm font-medium">{g.label}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {g.sites.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {g.sites
                          .slice(0, 4)
                          .map((site) => site.label)
                          .join(" · ")}
                      </p>
                    )}
                    <Badge variant={g.targetConnected ? "default" : "secondary"}>
                      {g.targetConnected
                        ? "최근 측정에서 내 업체 직접 연결 확인"
                        : "최근 측정에서 내 업체 직접 연결 미확인"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="sr-only">
              {chartGroups.map((group) => (
                <p key={group.key}>
                  {group.label}: 고노출 업체 {benchmark.highVisibilityEntityCount}곳 중{" "}
                  {group.highEntityCount}곳에서 관찰
                  {group.highEntitySharePct !== null
                    ? `, ${group.highEntitySharePct.toFixed(1)}%`
                    : ""}
                  .{" "}
                  {group.targetConnected
                    ? "최근 측정에서 내 업체 직접 연결 확인"
                    : "최근 측정에서 내 업체 직접 연결 미확인"}
                </p>
              ))}
            </div>
          </div>
        )}
        {benchmark.categoryContext?.available === true && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">같은 업종에서 특히 자주 보인 출처</p>
            <p className="text-xs text-muted-foreground">
              {benchmark.categoryContext.category ?? "동일"} 업종의 비교 가능한 업체{" "}
              {benchmark.categoryContext.eligibleTargetBusinessCount}곳에서 별도로 관찰된 참고
              패턴입니다.
            </p>
            <div className="space-y-1">
              {benchmark.categoryContext.sourceGroups.slice(0, 3).map((g) => {
                const labels = (g.sites ?? [])
                  .slice(0, 4)
                  .map((site) => site.label)
                  .join(" · ");
                return (
                  <p key={g.key} className="text-xs">
                    <span className="font-medium">{g.label}</span>
                    {labels && <span className="text-muted-foreground"> · {labels}</span>}
                  </p>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{benchmark.disclaimer}</p>
      </CardContent>
    </Card>
  );
}

function BenchmarkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}) {
  const item = payload?.[0];
  if (!active || !item) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{item.payload?.label}</p>
      <p className="mt-1 tabular-nums">관찰 비율 {Number(item.value ?? 0).toFixed(1)}%</p>
      <p className="mt-1 text-muted-foreground">
        {item.payload?.connected
          ? "최근 측정에서 내 업체 직접 연결 확인"
          : "최근 측정에서 내 업체 직접 연결 미확인"}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  note?: string | null;
  highlight?: boolean;
}) {
  return (
    <Card
      className={
        highlight
          ? "rounded-none border-0 bg-primary/[0.04] shadow-none"
          : "rounded-none border-0 bg-card shadow-none"
      }
    >
      <CardHeader
        className={`border-t-2 pb-2 pt-5 ${
          highlight
            ? "border-t-primary"
            : "border-t-transparent transition-colors hover:border-t-primary"
        }`}
      >
        <CardTitle
          className={`text-sm font-semibold leading-5 ${
            highlight ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-5">
        <p
          className={`text-4xl font-bold leading-none tabular-nums ${
            highlight ? "text-primary" : "text-foreground"
          }`}
        >
          {value}
        </p>
        {note && <p className="mt-3 text-sm leading-6 text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}
