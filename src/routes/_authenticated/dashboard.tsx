import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { getEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.functions";
import { buildEntityFactsV2DashboardCutoverModel } from "@/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import { getVisibilityBenchmark } from "@/lib/visibility-benchmark.functions";
import {
  BusinessSelector,
  useClientBusinessSelection,
} from "@/components/business-selector";
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
  return lower === upper
    ? format(lower)
    : `${format(lower)} ~ ${format(upper)}`;
}

function weakQuestionBadgeVariant(
  tone: "positive" | "neutral" | "attention",
): "default" | "secondary" | "outline" {
  if (tone === "positive") return "default";
  if (tone === "attention") return "secondary";
  return "outline";
}

function DashboardPage() {
  const { activeOrgId } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const businessId = businesses.selectedBusinessId;

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
  const benchmark =
    benchmarkResult && benchmarkResult.ok ? benchmarkResult.benchmark : null;

  const result = query.data;
  const dto = result && result.ok ? result.data : null;
  const model = dto ? buildEntityFactsV2DashboardCutoverModel(dto) : null;

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
              value={pctRange(
                model.metricCards.top3.lowerPct,
                model.metricCards.top3.lowerPct,
              )}
              note={
                model.metricCards.top3.unresolvedCount > 0
                  ? `유효 응답 ${model.metricCards.top3.validCount}건 중 상위 3곳 확정 ${model.metricCards.top3.confirmedCount}건 · 추가 확인 ${model.metricCards.top3.unresolvedCount}건`
                  : `유효 응답 ${model.metricCards.top3.validCount}건 중 상위 3곳 확정 ${model.metricCards.top3.confirmedCount}건`
              }
            />
            <MetricCard
              label="함께 관찰된 업체"
              value={`${model.metricCards.competitorCount}곳`}
              note="v2에서 확인된 업체만 표시"
            />
            <MetricCard
              label="관찰된 주요 출처"
              value={
                model.sources.available
                  ? `${model.metricCards.observedSourceCount}곳`
                  : "준비 중"
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
              <p className="text-muted-foreground">
                {model.recentSummary.questionSummaryText}
              </p>
              {model.recentSummary.topCompetitor && (
                <p>
                  가장 자주 함께 관찰된 업체:{" "}
                  {model.recentSummary.topCompetitor.name} ·{" "}
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
                이번 측정의 AI 답변에서 업체로 확인된 항목입니다. 아직 v2 기준의 반복 관찰·신규·등급
                판정은 붙이지 않습니다.
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
                    {model.competitors.rows.map((c) => (
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
                            질문 {c.questionCount}개 · 상위 3곳 안에서 {c.top3ResponseCount}건 관찰
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                  노출이 확정되지 않았거나, 일부만 확인됐거나, 대상 동일성 확인이 더 필요한 질문입니다.
                </p>
                {model.weakQuestions.rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    현재 우선 확인할 질문이 없습니다.
                  </p>
                ) : (
                  model.weakQuestions.rows.slice(0, 12).map((q) => (
                    <div key={q.questionId} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{q.questionText}</p>
                        <Badge variant={weakQuestionBadgeVariant(q.statusTone)}>
                          {q.statusLabel}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {intentLabel(q.intentType)}
                        {q.visibilityDisplayText
                          ? ` · 노출 범위 ${q.visibilityDisplayText}`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        확정 노출 {q.confirmedMentionCount}건 · 추가 확인 필요{" "}
                        {q.unresolvedTargetCount}건
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="text-xl">{model.sources.heading}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <p className="mb-3 text-xs text-muted-foreground">
                  이번 측정의 AI 답변에서 내 업체 또는 함께 관찰된 업체와 연결된 출처입니다.
                  반복·직접 근거가 확인된 연결과, 제목까지 일치한 1회 근접 근거는 ‘연결 단서’로 구분합니다.
                  출처의 신뢰도나 추천 이유를 뜻하지는 않습니다.
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
                비슷한 검색 상황끼리 묶어 확정 노출과 추가 확인이 필요한 범위를 함께 표시합니다.
              </p>
              {model.questionGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  질문군 요약이 아직 없습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>검색 상황</TableHead>
                      <TableHead>노출 범위</TableHead>
                      <TableHead>근거</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.questionGroups.map((g) => (
                      <TableRow key={g.intentType}>
                        <TableCell className="text-sm">
                          {intentLabel(g.intentType)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {pctRange(
                            g.visibilityLowerBoundPct,
                            g.visibilityUpperBoundPct,
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          확정 {g.confirmedMentionCount}/{g.validCount}
                          {g.unresolvedTargetCount > 0
                            ? ` · 추가 확인 ${g.unresolvedTargetCount}`
                            : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                현재 화면의 최근 측정 진단은 Entity Facts v2의 확정/미확정 판정을 사용합니다.
                미확정 응답이 있으면 하나의 숫자로 합치지 않고 하한~상한 범위로 표시합니다.
              </p>
              <p>
                반복 종합, 시간에 따른 추세, 경쟁업체 상세 비교는 v2 역사 집계 계약이 준비되기 전까지
                표시하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function BenchmarkCard({
  benchmark,
}: {
  benchmark: NonNullable<
    Extract<
      Awaited<ReturnType<typeof getVisibilityBenchmark>>,
      { ok: true }
    >["benchmark"]
  >;
}) {
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
          <p className="text-xs text-muted-foreground">
            현재는 초기 표본으로 참고용 집계입니다.
          </p>
        )}
        {benchmark.sourceGroups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            아직 공통 출처 패턴을 판단할 표본이 부족합니다.
          </p>
        ) : (
          <div className="space-y-2">
            {benchmark.sourceGroups.slice(0, 6).map((g) => (
              <div key={g.key} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{g.label}</p>
                  <Badge variant={g.targetConnected ? "default" : "secondary"}>
                    {g.targetConnected
                      ? "최근 측정에서 내 업체 직접 연결 확인"
                      : "최근 측정에서 내 업체 직접 연결 미확인"}
                  </Badge>
                </div>
                {g.sites.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {g.sites
                      .slice(0, 4)
                      .map((site) => site.label)
                      .join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  고노출 업체 {benchmark.highVisibilityEntityCount}곳 중 {g.highEntityCount}곳에서
                  관찰
                  {g.highEntitySharePct !== null
                    ? ` (${g.highEntitySharePct.toFixed(1)}%)`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        )}
        {benchmark.categoryContext?.available === true && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">같은 업종에서 특히 자주 보인 출처</p>
            <p className="text-xs text-muted-foreground">
              {benchmark.categoryContext.category ?? "동일"} 업종의 비교 가능한 업체{" "}
              {benchmark.categoryContext.eligibleTargetBusinessCount}곳에서 별도로 관찰된 참고 패턴입니다.
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
                    {labels && (
                      <span className="text-muted-foreground"> · {labels}</span>
                    )}
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
        {note && (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{note}</p>
        )}
      </CardContent>
    </Card>
  );
}
