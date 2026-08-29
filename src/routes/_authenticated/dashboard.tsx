import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { getVisibilityDiagnostic } from "@/lib/visibility-diagnostic.functions";
import { getVisibilityRepeatAggregate } from "@/lib/visibility-repeat-aggregate.functions";
import { getVisibilityBenchmark } from "@/lib/visibility-benchmark.functions";
import type { VisibilityDiagnosticDTO } from "@/lib/visibility-diagnostic.types";
import { CompetitorDetailDialog } from "@/components/competitor-detail-dialog";
import { ActionRecommendationsSection } from "@/components/action-recommendations-section";

import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "AI 노출 진단 · AI Visibility Lab" },
      {
        name: "description",
        content:
          "여러 고객 질문에서 업체가 AI 답변에 관찰된 노출 상태, 질문군별 수치, 대신 등장한 경쟁업체와 인용 출처를 확인하는 진단 대시보드.",
      },
      { property: "og:title", content: "AI 노출 진단 · AI Visibility Lab" },
      {
        property: "og:description",
        content: "관찰된 AI 노출 상태와 우선 점검 영역을 요약한 진단 대시보드",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

/** Edge DTO가 준 퍼센트 값을 그대로 표시한다(재계산/변환 없음). */
function pct(value: number | null): string {
  return value === null ? "–" : `${value.toFixed(1)}%`;
}

/** 내부 intent 값은 노출하지 않고 기존 공용 라벨만 재사용한다. */
function intentLabel(intentType: string): string {
  return (INTENT_LABELS as Record<string, string>)[intentType] ?? "기타";
}

const STATUS_LABEL: Record<"missing" | "partial", string> = {
  missing: "미노출",
  partial: "부분 노출",
};

function DashboardPage() {
  const { activeOrgId } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const fetchDiagnostic = useServerFn(getVisibilityDiagnostic);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);


  const businessId = businesses.selectedBusinessId;

  const query = useQuery({
    queryKey: ["visibility-diagnostic", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchDiagnostic({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });

  const fetchRepeatAggregate = useServerFn(getVisibilityRepeatAggregate);
  const repeatQuery = useQuery({
    queryKey: ["visibility-repeat-aggregate", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchRepeatAggregate({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });
  const repeatResult = repeatQuery.data;
  const aggregate = repeatResult && repeatResult.ok ? repeatResult.aggregate : null;

  const fetchBenchmark = useServerFn(getVisibilityBenchmark);
  const benchmarkQuery = useQuery({
    queryKey: ["visibility-benchmark", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchBenchmark({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });
  const benchmarkResult = benchmarkQuery.data;
  const benchmark = benchmarkResult && benchmarkResult.ok ? benchmarkResult.benchmark : null;

  const result = query.data;
  const payload: VisibilityDiagnosticDTO | null = result && result.ok ? result.diagnostic : null;
  const d = payload?.diagnostic ?? null;


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI 노출 진단</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            실제 고객이 물을 법한 질문들을 반복 측정해, AI 답변에서 내 업체가 얼마나 추천되는지와
            함께 등장한 업체·인용 출처를 정리해 보여줍니다. 특정 작업이 노출을 올렸다는 인과관계는
            주장하지 않으며, 관찰된 값만 표시합니다.
          </p>
        </div>
        <BusinessSelector
          options={businesses.options}
          value={businesses.selectedBusinessId}
          onChange={businesses.select}
          isLoading={businesses.isLoading}
          isError={businesses.isError}
        />
      </div>


      {!businessId && !businesses.isLoading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            진단할 대상 업체가 없습니다. 업체 관리에서 대상 업체를 먼저 등록하세요.
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
            {result.error === "NO_DATA"
              ? "아직 진단에 사용할 수 있는 완료된 측정이 없습니다. 자동 측정을 실행한 뒤 다시 확인하세요."
              : result.error === "FORBIDDEN"
                ? "이 업체의 진단을 볼 권한이 없습니다."
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

      {payload && d && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="전체 AI 노출률"
              value={pct(d.overview.visibilityRatePct)}
              note={`반복 측정한 AI 답변 ${d.overview.validCount}건 중 내 업체가 추천된 ${d.overview.mentionCount}건`}
            />
            <MetricCard
              label="Top3 노출률"
              value={pct(d.overview.top3RatePct)}
              note={`추천 순위 3위 안에 든 답변 ${d.overview.top3Count}건`}
            />
            <MetricCard
              label="노출된 질문 비율"
              value={pct(d.overview.questionCoverageRatePct)}
              note={`질문 ${d.overview.questionCount}개 중 내 업체가 한 번 이상 노출된 ${d.overview.coveredQuestionCount}개`}
            />
            <MetricCard
              label="유효 측정 수"
              value={String(d.overview.validCount)}
              note={`최근 측정 ${formatSeoul(d.scope.measuredAt)}`}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            기준 측정: {d.scope.runName} · {d.scope.providers.join(", ")} · 반복{" "}
            {d.scope.repetitions}회 · 완료 {d.scope.completedJobs}/{d.scope.totalJobs}
            {d.overview.invalidCount > 0 ? ` · 제외 ${d.overview.invalidCount}건` : ""}
          </p>

          {aggregate && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">반복 측정 통합</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  최신 상태 진단과 별개이며, 동일 조건 반복 측정의 표본을 합친 신뢰도 참고값입니다.
                </p>
                <p className="text-sm">
                  동일 조건 측정 {aggregate.compatibleRunCount}회 · 유효 답변{" "}
                  {aggregate.validCount}건
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">통합 노출률</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {pct(aggregate.visibilityRatePct)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      노출 {aggregate.mentionCount}건
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">통합 Top3 노출률</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {pct(aggregate.top3RatePct)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Top3 {aggregate.top3Count}건
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  질문 안정성 · 질문 {aggregate.questionCount}개 중 항상 노출{" "}
                  {aggregate.alwaysVisibleQuestionCount}개 · 일부 노출{" "}
                  {aggregate.sometimesVisibleQuestionCount}개 · 미노출{" "}
                  {aggregate.neverVisibleQuestionCount}개
                </p>
                <p className="text-xs text-muted-foreground">
                  집계 기간 {formatSeoul(aggregate.windowStart)} ~{" "}
                  {formatSeoul(aggregate.windowEnd)}
                </p>
              </CardContent>
            </Card>
          )}



          {(d.dataQuality.measurementRowsCapped || d.dataQuality.sourceRowsCapped) && (
            <p className="text-xs text-muted-foreground">
              이번 진단은 조회 상한에 도달해 일부 기록만 사용했습니다.
            </p>
          )}

          {benchmark && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">고노출 업체 공통 출처 패턴</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  AI 노출률 {benchmark.thresholdPct}% 이상인 업체 {benchmark.highVisibilityEntityCount}곳에서
                  자주 연결된 출처를 모았습니다.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    최근 {benchmark.windowDays}일
                  </Badge>
                  {benchmark.dataStatus === "early" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      표본 축적 중
                    </Badge>
                  )}
                  {benchmark.dataStatus === "early" && (
                    <span className="text-xs text-muted-foreground">
                      현재는 초기 패턴입니다. 데이터가 쌓이면 고노출 기준과 출처 패턴이 자동으로
                      다시 계산됩니다.
                    </span>
                  )}
                </div>
                {benchmark.sourceGroups.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    아직 공통 출처 패턴을 판단할 표본이 부족합니다.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {benchmark.sourceGroups.slice(0, 4).map((g) => {
                      const siteLabels = g.sites
                        .slice(0, 3)
                        .map((s) => s.label)
                        .join(" · ");
                      return (
                        <div
                          key={g.key}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{g.label}</p>
                            {siteLabels && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{siteLabels}</p>
                            )}
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              고노출 업체 {benchmark.highVisibilityEntityCount}곳 중 {g.highEntityCount}곳에서
                              관찰
                              {g.highEntitySharePct !== null
                                ? ` (${g.highEntitySharePct.toFixed(1)}%)`
                                : ""}
                              {g.patternStrength !== "early" ? " · 반복 관찰" : ""}
                            </p>
                          </div>
                          <Badge variant={g.targetConnected ? "default" : "secondary"}>
                            {g.targetConnected ? "연결 있음" : "미관찰"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{benchmark.disclaimer}</p>
              </CardContent>
            </Card>
          )}


          <ActionRecommendationsSection orgId={activeOrgId ?? null} businessId={businessId ?? null} />

          <div className="grid gap-4 lg:grid-cols-2">

            <Card>
              <CardHeader>
                <CardTitle className="text-base">질문군 경쟁력</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <p className="mb-3 text-xs text-muted-foreground">
                  질문을 의도별로 묶은 뒤, 각 질문군에서 내 업체가 얼마나 추천됐는지 관찰값을
                  비교한 표입니다. 표는 실제 측정된 값만 보여주며, 노출률과 Top3 값을 기준으로
                  질문군별 차이를 확인하세요.
                </p>
                {d.questionGroups.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    질문군 요약이 아직 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>질문군</TableHead>
                        <TableHead>질문</TableHead>
                        <TableHead>측정</TableHead>
                        <TableHead>노출</TableHead>
                        <TableHead>노출률</TableHead>
                        <TableHead>Top3</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.questionGroups.map((g) => (
                        <TableRow key={g.intentType}>
                          <TableCell className="text-sm">{intentLabel(g.intentType)}</TableCell>
                          <TableCell className="text-sm tabular-nums">{g.questionCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {g.measurementCount}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{g.mentionCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(g.visibilityRatePct)}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(g.top3RatePct)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI 추천시장에 함께 등장한 업체</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <p className="mb-1 text-xs text-muted-foreground">
                  반복 노출·질문 다양성·동일 조건 재현성을 바탕으로 확인할 가치가 있는 업체만
                  표시합니다. 1회성 관찰 후보는 내부에만 보관되며 목록에는 나오지 않습니다.
                  업체를 클릭하면 등장 질문과 함께 인용된 출처를 볼 수 있습니다.
                </p>
                {d.competitorGate ? (
                  <p className="mb-3 text-xs text-muted-foreground">
                    핵심 {d.competitorGate.coreCount}곳 · 주목 {d.competitorGate.notableCount}곳 ·
                    관찰 후보 {d.competitorGate.watchCount}곳
                  </p>
                ) : null}
                {d.competitors.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    함께 등장한 다른 업체가 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>업체</TableHead>
                        <TableHead>질문 수</TableHead>
                        <TableHead>등장 답변 수</TableHead>
                        <TableHead>답변 비율</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.competitors.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="text-sm">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => setSelectedCompetitor(c.name)}
                              >
                                {c.name}
                                <span className="sr-only"> 상세 보기</span>
                              </button>
                              <Badge
                                variant={c.tier === "core" ? "default" : "secondary"}
                                className="text-[10px] px-1.5 py-0"
                              >
                                {c.tierLabel}
                              </Badge>
                              {c.isNew && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  신규
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{c.questionCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">{c.responseCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(c.responseRatePct)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI 답변에 자주 인용된 출처</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <p className="mb-3 text-xs text-muted-foreground">
                  AI가 검색 중 검토한 모든 URL이 아니라, 최종 답변에 실제로 인용된 출처만
                  모았습니다.
                </p>
                {d.sources.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    인용 출처 정보가 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>도메인</TableHead>
                        <TableHead>등장 답변 수</TableHead>
                        <TableHead>인용 수</TableHead>
                        <TableHead>답변 비율</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.sources.map((s) => (
                        <TableRow key={s.domain}>
                          <TableCell className="text-sm">
                            {s.domain}
                            {s.sampleTitle && (
                              <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-foreground">
                                {s.sampleTitle}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{s.responseCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">{s.citationCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(s.responseRatePct)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">노출이 약한 질문</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  반복 측정에서 내 업체 노출이 관찰되지 않았거나 일부만 관찰된 질문입니다.
                  원인 분석이 아니라 우선 확인해 볼 약한 영역입니다.
                </p>
                {d.priorityAreas.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    노출이 약한 질문이 없습니다.
                  </p>
                ) : (
                  d.priorityAreas.map((p) => (
                    <div key={p.questionId} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{p.questionText}</p>
                        <Badge variant={p.status === "missing" ? "destructive" : "secondary"}>
                          {STATUS_LABEL[p.status]}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {intentLabel(p.intentType)} · 측정 {p.measurementCount}회 · 노출{" "}
                        {p.mentionCount}회 · 노출률 {pct(p.visibilityRatePct)}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">노출률 변화 추적</CardTitle>
            </CardHeader>
            <CardContent>
              {payload.trend.length >= 2 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={payload.trend.map((t) => ({
                        시점: formatSeoul(t.measuredAt),
                        노출률: t.visibilityRatePct,
                        Top3: t.top3RatePct,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="시점" fontSize={11} />
                      <YAxis unit="%" domain={[0, 100]} fontSize={12} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="노출률"
                        stroke="var(--color-chart-1)"
                        strokeWidth={2}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="Top3"
                        stroke="var(--color-chart-2)"
                        strokeWidth={2}
                        dot
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    비교할 이전 측정 시점이 아직 없습니다. 현재 1개 시점 상태만 표시합니다.
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {pct(payload.trend[0]?.visibilityRatePct ?? d.overview.visibilityRatePct)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatSeoul(payload.trend[0]?.measuredAt ?? d.scope.measuredAt)} 기준 · 유효
                    측정 {payload.trend[0]?.validCount ?? d.overview.validCount}회
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            변화 추적은 비교 가능한 동일 질문 세트에서의 관찰값 비교일 뿐, 특정 작업의 개선
            효과를 의미하지 않습니다. 표시된 모든 값은 반복 측정된 AI 검색 결과에서 관찰된
            상태이며, 모든 사용자가 같은 답변을 보게 된다는 뜻은 아니고 개선 효과를 보장하지도
            않습니다.
          </p>
        </>
      )}

      <CompetitorDetailDialog
        orgId={activeOrgId ?? null}
        businessId={businessId ?? null}
        competitorName={selectedCompetitor}
        onClose={() => setSelectedCompetitor(null)}
      />
    </div>

  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}
