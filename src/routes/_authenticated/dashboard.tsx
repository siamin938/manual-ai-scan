import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { getVisibilityDiagnostic } from "@/lib/visibility-diagnostic.functions";
import { getVisibilityRepeatAggregate } from "@/lib/visibility-repeat-aggregate.functions";
import { getVisibilityRepeatContext } from "@/lib/visibility-repeat-context.functions";
import {
  SOURCE_SIDE_LABEL,
  normalizeDomain,
  repeatQuestionLabel,
} from "@/lib/visibility-repeat-context.helpers";
import { getVisibilityBenchmark } from "@/lib/visibility-benchmark.functions";
import type { VisibilityDiagnosticDTO } from "@/lib/visibility-diagnostic.types";
import { CompetitorDetailDialog } from "@/components/competitor-detail-dialog";
import { ActionRecommendationsSection } from "@/components/action-recommendations-section";

import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
      { title: "AI 노출 진단 · 차보임 CHABOIM" },
      {
        name: "description",
        content:
          "여러 고객 질문에서 업체가 AI 답변에 관찰된 노출 상태, 질문군별 수치, 대신 등장한 경쟁업체와 인용 출처를 확인하는 진단 대시보드.",
      },
      { property: "og:title", content: "AI 노출 진단 · 차보임 CHABOIM" },
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
  missing: "이번 측정 미추천",
  partial: "가끔 추천",
};

type CompetitorDisplayCategory = "repeated" | "notable" | "additional";

/** 행 badge와 동일한 표시 규칙으로 분류한다(판정/점수는 서버 DTO 그대로). */
function classifyCompetitorDisplay(c: {
  tier: "core" | "notable" | "watch";
  responseCount: number;
  priorRunPresenceCount: number;
}): CompetitorDisplayCategory {
  if (c.priorRunPresenceCount > 0) return "repeated";
  if (c.responseCount === 1 && c.priorRunPresenceCount === 0) return "additional";
  return "notable";
}


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

  // 반복 측정 보조 컨텍스트: 실패하면 기존 화면으로 안전하게 fallback한다.
  const fetchRepeatContext = useServerFn(getVisibilityRepeatContext);
  const repeatContextQuery = useQuery({
    queryKey: ["visibility-repeat-context", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchRepeatContext({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });
  const repeatContextResult = repeatContextQuery.data;
  const repeatContext =
    repeatContextResult && repeatContextResult.ok ? repeatContextResult.context : null;
  const sourceSideByDomain = new Map(
    (repeatContext?.sources ?? []).map((s) => [s.domain, s.side] as const),
  );
  const useRepeatQuestions = !!repeatContext && repeatContext.compatibleRunCount >= 2;
  const repeatQuestions = useRepeatQuestions ? (repeatContext?.questions ?? []) : [];
  const repeatQuestionsHead = repeatQuestions.slice(0, 8);
  const repeatQuestionsRest = repeatQuestions.slice(8);



  const result = query.data;
  const payload: VisibilityDiagnosticDTO | null = result && result.ok ? result.diagnostic : null;
  const d = payload?.diagnostic ?? null;

  // 표시용 분류일 뿐, 새로운 판정/점수 계산이 아니다.
  const mentionedGroupLabels = (d?.questionGroups ?? [])
    .filter((g) => g.mentionCount > 0)
    .map((g) => intentLabel(g.intentType));
  const unmentionedGroupLabels = (d?.questionGroups ?? [])
    .filter((g) => g.mentionCount === 0)
    .map((g) => intentLabel(g.intentType));
  const topCompetitor = (d?.competitors ?? []).reduce<
    NonNullable<typeof d>["competitors"][number] | null
  >((best, c) => (best === null || c.responseCount > best.responseCount ? c : best), null);

  // 카드에 실제로 표시되는 competitor 목록 기준, badge와 동일한 규칙으로 표시용 개수를 계산한다.
  const competitorDisplayCounts = (d?.competitors ?? []).reduce<{
    repeated: number;
    notable: number;
    additional: number;
  }>(
    (acc, c) => {
      const category = classifyCompetitorDisplay(c);
      acc[category] += 1;
      return acc;
    },
    { repeated: 0, notable: 0, additional: 0 },
  );

  // 표시 문구만: 동일조건 측정이 1회뿐이면 '반복'이라고 단정하지 않는다.
  const coreObservationLabel =
    (repeatContext?.compatibleRunCount ?? 0) >= 2 ? "반복 측정에서도 관찰" : "자주 관찰";






  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">내 AI 노출 진단</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            고객이 실제로 물을 법한 질문으로 AI 답변을 측정해, 내 업체의 노출과 함께 관찰된 업체·인용
            출처를 확인합니다.
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">최근 측정 결과</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p>
                내 업체는 AI 답변 {d.overview.validCount}개 중 {d.overview.mentionCount}개에서
                추천됐습니다({pct(d.overview.visibilityRatePct)}).
              </p>
              {mentionedGroupLabels.length > 0 && (
                <p>추천이 확인된 검색 상황: {mentionedGroupLabels.join(", ")}</p>
              )}
              {unmentionedGroupLabels.length > 0 && (
                <p className="text-muted-foreground">
                  아직 추천이 확인되지 않은 검색 상황: {unmentionedGroupLabels.join(", ")}
                </p>
              )}
              {topCompetitor && (
                <p>
                  가장 자주 함께 등장한 업체: {topCompetitor.name} · {topCompetitor.responseCount}개
                  답변에서 확인
                </p>
              )}
              {aggregate && aggregate.compatibleRunCount >= 2 && (
                <div className="border-t pt-3">
                  <p className="font-medium">동일 조건 반복 종합</p>
                  <p className="text-muted-foreground">
                    동일 조건으로 총 {aggregate.compatibleRunCount}회 측정한 {aggregate.validCount}개
                    답변을 함께 확인했습니다.
                  </p>
                  <p className="text-muted-foreground">
                    종합 노출률 {pct(aggregate.visibilityRatePct)} · 상위 3곳 노출률{" "}
                    {pct(aggregate.top3RatePct)}
                  </p>
                  <p className="text-muted-foreground">
                    질문 안정성: {aggregate.compatibleRunCount}회 모두 추천{" "}
                    {aggregate.alwaysVisibleQuestionCount}개 · 일부 회차 추천{" "}
                    {aggregate.sometimesVisibleQuestionCount}개 · {aggregate.compatibleRunCount}회 모두
                    미추천 {aggregate.neverVisibleQuestionCount}개
                  </p>
                </div>
              )}
            </CardContent>

          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="최근 측정 · AI에서 추천된 비율"
              value={pct(d.overview.visibilityRatePct)}
              note={`AI 답변 ${d.overview.validCount}건 중 ${d.overview.mentionCount}건에서 추천`}
            />
            <MetricCard
              label="최근 측정 · 상위 3곳 안에 추천"
              value={`${d.overview.top3Count}건`}
              note={`AI 답변 ${d.overview.validCount}건 중 상위 3곳 안에 추천`}
            />
            <MetricCard
              label="AI 답변에서 함께 관찰된 업체"
              value={`${d.competitors.length}곳`}
              note="자주 등장한 곳과 추가 관찰 업체 포함"
            />
            <MetricCard
              label="AI 답변에 연결된 주요 출처"
              value={`${d.sources.length}곳`}
              note="직접 연결되거나 여러 답변에서 반복 관찰"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            분석에 사용한 AI 답변 {d.overview.validCount}건 · 최근 측정{" "}
            {formatSeoul(d.scope.measuredAt)}
            {d.overview.invalidCount > 0 ? ` · 제외 ${d.overview.invalidCount}건` : ""}
          </p>

          {(d.dataQuality.measurementRowsCapped || d.dataQuality.sourceRowsCapped) && (
            <p className="text-xs text-muted-foreground">
              이번 진단은 조회 상한에 도달해 일부 기록만 사용했습니다.
            </p>
          )}

          <ActionRecommendationsSection orgId={activeOrgId ?? null} businessId={businessId ?? null} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI 답변에서 함께 관찰된 업체</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-1 text-xs text-muted-foreground">
                같은 질문의 AI 답변에서 내 업체와 비교해볼 수 있도록 관찰된 업체입니다. 업체를 누르면
                어떤 질문과 출처에서 등장했는지 확인할 수 있습니다.
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                한 번만 확인된 확정 업체도 추가 관찰로 함께 표시합니다.
              </p>
              {d.competitors.length > 0 ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  현재 표시: {coreObservationLabel} {competitorDisplayCounts.repeated}곳 · 주목 관찰{" "}
                  {competitorDisplayCounts.notable}곳 · 추가 관찰{" "}
                  {competitorDisplayCounts.additional}곳
                </p>
              ) : null}
              {d.competitors.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  함께 관찰된 다른 업체가 없습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>업체</TableHead>
                      <TableHead>AI 답변에 등장</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.competitors.map((c) => {
                      const category = classifyCompetitorDisplay(c);
                      let badgeVariant: "default" | "secondary" | "outline" = "secondary";
                      let badgeLabel = "주목 관찰 업체";
                      if (category === "repeated") {
                        badgeVariant = "default";
                        badgeLabel = "반복 측정에서도 관찰";
                      } else if (category === "additional") {
                        badgeVariant = "outline";
                        badgeLabel = "추가 관찰";
                      }
                      return (
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
                                variant={badgeVariant}
                                className="text-[10px] px-1.5 py-0"
                              >
                                {badgeLabel}
                              </Badge>
                              {c.isNew && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  신규
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="tabular-nums">{c.responseCount}건</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              전체 {d.overview.validCount}건 중 {pct(c.responseRatePct)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">내 업체가 잘 보이지 않는 검색 질문</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {useRepeatQuestions
                    ? `동일 조건으로 반복한 ${repeatContext?.compatibleRunCount ?? 0}회 측정에서 내 업체가 전혀 보이지 않았거나 일부 회차에만 보인 질문입니다. 먼저 확인해 볼 영역입니다.`
                    : "측정에서 내 업체가 전혀 보이지 않았거나 가끔만 보인 질문입니다. 먼저 확인해 볼 영역입니다."}
                </p>
                {useRepeatQuestions ? (
                  repeatQuestions.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      반복 측정에서 노출이 약한 질문이 없습니다.
                    </p>
                  ) : (
                    <>
                      {repeatQuestionsHead.map((q) => (
                        <div key={q.questionId} className="rounded-md border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium">{q.questionText}</p>
                            <Badge
                              variant={q.state === "never_visible" ? "destructive" : "secondary"}
                            >
                              {repeatQuestionLabel(q.validCount, q.mentionCount)}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {intentLabel(q.intentType)}
                          </p>
                        </div>
                      ))}
                      {repeatQuestionsRest.length > 0 && (
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <Button variant="outline" size="sm">
                              추가 {repeatQuestionsRest.length}개 질문 보기
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-3 space-y-3">
                            {repeatQuestionsRest.map((q) => (
                              <div key={q.questionId} className="rounded-md border p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium">{q.questionText}</p>
                                  <Badge
                                    variant={
                                      q.state === "never_visible" ? "destructive" : "secondary"
                                    }
                                  >
                                    {repeatQuestionLabel(q.validCount, q.mentionCount)}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {intentLabel(q.intentType)}
                                </p>
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </>
                  )
                ) : d.priorityAreas.length === 0 ? (
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
                        {p.status === "missing"
                          ? `${intentLabel(p.intentType)} · 이번 측정에서 추천되지 않음`
                          : `${intentLabel(p.intentType)} · ${p.measurementCount}번 중 ${p.mentionCount}번 추천`}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>

            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI 답변에 연결된 주요 출처</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <p className="mb-3 text-xs text-muted-foreground">
                  실제 AI 답변에 연결됐고, 업체 정보와 직접 연결되거나 여러 답변에서 반복해서 관찰된
                  출처입니다. 출처의 신뢰도나 AI가 추천한 이유를 뜻하지는 않습니다.
                </p>
                {d.sources.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    주요 출처로 확인된 정보가 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>출처</TableHead>
                        <TableHead>AI 답변에 연결</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.sources.map((s) => {
                        const side = sourceSideByDomain.get(normalizeDomain(s.domain) ?? "");
                        return (
                          <TableRow key={s.domain}>
                            <TableCell className="text-sm">
                              <span className="flex flex-wrap items-center gap-2">
                                {s.domain}
                                {side && (
                                  <Badge
                                    variant={side === "client" ? "default" : "secondary"}
                                    className="font-normal"
                                  >
                                    {SOURCE_SIDE_LABEL[side]}
                                  </Badge>
                                )}
                              </span>
                              {s.sampleTitle && (
                                <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-foreground">
                                  {s.sampleTitle}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              <span className="tabular-nums">{s.responseCount}건</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                총 {s.citationCount}회 연결
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                )}

                {sourceSideByDomain.size > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    출처 목록은 최근 측정의 연결 횟수이며, 배지는 동일 조건 반복 측정에서 내 업체와
                    함께 관찰된 업체 중 어느 쪽과 연결됐는지 보여줍니다.
                  </p>
                )}


                {d.referenceSources.length > 0 && (
                  <Collapsible className="mt-4">
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm">
                        추가 참고 출처 보기 ({d.referenceSources.length})
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3">
                      <p className="mb-3 text-xs text-muted-foreground">
                        답변 속 업체 이름 주변에서 함께 확인됐지만 반복 근거가 부족해 주요 출처에서는 제외했습니다. 해당 업체 정보를 뒷받침하거나 AI 추천 이유라는 뜻은 아닙니다.
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>출처</TableHead>
                            <TableHead>AI 답변에 연결</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.referenceSources.map((s) => (
                            <TableRow key={s.domain}>
                              <TableCell className="text-sm">{s.domain}</TableCell>
                              <TableCell className="text-sm">
                                <span className="tabular-nums">{s.responseCount}건</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  총 {s.citationCount}회 연결
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </CardContent>
            </Card>
          </div>

          {benchmark && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex flex-wrap items-center gap-2">
                  AI에 자주 추천되는 업체들은 어디에서 많이 보일까요?
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    데이터 축적 중
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  {benchmark.eligibleTargetBusinessCount !== undefined
                    ? `최근 ${benchmark.windowDays}일 동안 측정 대상 자동차 업체 ${benchmark.eligibleTargetBusinessCount}곳의 AI 답변에서 함께 등장한 업체들을 익명 집계했습니다.`
                    : `최근 ${benchmark.windowDays}일 동안 측정 대상 자동차 업체의 AI 답변에서 함께 등장한 업체들을 익명 집계했습니다.`}
                </p>
                <p className="text-sm">
                  그 답변에서 관찰된 업체 중 현재 고노출 기준에 해당하는 {benchmark.highVisibilityEntityCount}곳의 출처 패턴입니다.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    최근 {benchmark.windowDays}일
                  </Badge>
                  {benchmark.dataStatus === "early" && (
                    <span className="text-xs text-muted-foreground">
                      현재는 초기 표본으로 참고용 집계입니다. 데이터가 쌓이면 기준과 패턴이 자동으로
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
                    {benchmark.sourceGroups.slice(0, 6).map((g) => {
                      const siteLabels = (g.sites ?? [])
                        .slice(0, 4)
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
                              고노출 업체 {benchmark.highVisibilityEntityCount}곳 중{" "}
                              {g.highEntityCount}곳에서 관찰
                              {g.highEntitySharePct !== null
                                ? ` (${g.highEntitySharePct.toFixed(1)}%)`
                                : ""}
                              {g.patternStrength !== "early" ? " · 반복 관찰" : ""}
                            </p>
                          </div>
                          <Badge variant={g.targetConnected ? "default" : "secondary"}>
                            {g.targetConnected ? "내 업체에서도 관찰" : "내 업체에서는 미관찰"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
                {benchmark.categoryContext?.available === true && (
                  <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                    <p className="text-sm font-medium">같은 업종에서 특히 자주 보인 출처</p>
                    <p className="text-xs text-muted-foreground">
                      {benchmark.categoryContext.category ?? "동일"} 업종의 비교 가능한 업체{" "}
                      {benchmark.categoryContext.eligibleTargetBusinessCount}곳에서 별도로 관찰된
                      참고 패턴입니다.
                    </p>
                    <div className="space-y-1">
                      {benchmark.categoryContext.sourceGroups.slice(0, 3).map((g) => {
                        const labels = (g.sites ?? [])
                          .slice(0, 4)
                          .map((s) => s.label)
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
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">어떤 검색 상황에서 보였나요?</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs text-muted-foreground">
                비슷한 상황끼리 질문을 묶어, 어떤 상황에서 내 업체가 더 자주 추천됐는지 비교한
                표입니다.
              </p>
              {d.questionGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  질문군 요약이 아직 없습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>검색 상황</TableHead>
                      <TableHead>추천된 답변</TableHead>
                      <TableHead>이번 측정 결과</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.questionGroups.map((g) => (
                      <TableRow key={g.intentType}>
                        <TableCell className="text-sm">{intentLabel(g.intentType)}</TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {g.measurementCount}개 중 {g.mentionCount}개
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant={g.mentionCount > 0 ? "secondary" : "outline"}>
                            {g.mentionCount > 0 ? "추천 확인" : "아직 미추천"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

            </CardContent>
          </Card>

          <Collapsible>
            <Card>
              <CardHeader className="pb-2">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="px-0 text-sm font-medium">
                    분석 방법과 신뢰도 자세히 보기
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    기준 측정: {d.scope.runName} · 반복 {d.scope.repetitions}회 · 완료{" "}
                    {d.scope.completedJobs}/{d.scope.totalJobs}
                  </p>


                  {aggregate && (
                    <div className="space-y-3 rounded-md border p-3">
                      <p className="text-sm font-medium">같은 조건으로 다시 확인한 결과</p>
                      <p className="text-xs text-muted-foreground">
                        최신 상태 진단과 별개이며, 동일 조건 반복 측정의 표본을 합친 신뢰도
                        참고값입니다.
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
                    </div>
                  )}


                  <div className="space-y-3 rounded-md border p-3">
                    <p className="text-sm font-medium">시간에 따른 AI 노출 변화</p>
                    {payload.trend.length === 1 ? (
                      <p className="text-sm text-muted-foreground">
                        반복 측정이 더 쌓이면 시간에 따른 변화를 비교할 수 있습니다.
                      </p>
                    ) : payload.trend.length === 2 ? (
                      <TwoPointTrend trend={payload.trend} />
                    ) : (
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
                    )}

                  </div>

                  <p className="text-xs text-muted-foreground">
                    변화 추적은 비교 가능한 동일 질문 세트에서의 관찰값 비교일 뿐, 특정 작업의 개선
                    효과를 의미하지 않습니다. 표시된 모든 값은 반복 측정된 AI 검색 결과에서 관찰된
                    상태이며, 모든 사용자가 같은 답변을 보게 된다는 뜻은 아니고 개선 효과를
                    보장하지도 않습니다.
                  </p>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
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

/** 2회 측정일 때만 쓰는 단순 표시용 차이입니다. 평가/추세/원인 판단에는 사용하지 않습니다. */
function TwoPointTrend({
  trend,
}: {
  trend: NonNullable<VisibilityDiagnosticDTO["trend"]>;
}) {
  if (trend.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        반복 측정이 더 쌓이면 시간에 따른 변화를 비교할 수 있습니다.
      </p>
    );
  }
  const first = trend[0]!;
  const second = trend[1]!;
  const diff =
    first.visibilityRatePct !== null && second.visibilityRatePct !== null
      ? second.visibilityRatePct - first.visibilityRatePct
      : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">1차 측정</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {pct(first.visibilityRatePct)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">2차 측정</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {pct(second.visibilityRatePct)}
          </p>
        </div>
      </div>
      {diff !== null && (
        <p className="text-sm font-medium">
          관찰 변화 {diff >= 0 ? "+" : ""}
          {diff.toFixed(1)}%p
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        2회 측정의 관찰 변화이며 추세로 판단하지 않습니다.
      </p>
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
