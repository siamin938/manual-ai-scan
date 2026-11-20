import { repeatedPeerEvidence, siteDisplayName } from "@/lib/diagnostic-source-links";
import { RepeatedPeerEvidence } from "@/components/repeated-peer-evidence";
import { DiagnosticEvidenceWorkspace, EvidenceArchive } from "@/components/diagnostic-evidence-workspace";
import { QuestionResults } from "@/components/diagnostic-question-results";
import type { PriorityEvidence } from "@/components/diagnostic-priority-evidence";
import { DiagnosticSummaryLayout, DiagnosticTopicTabs, DiagnosticQuestions, DiagnosticHistory } from "@/components/diagnostic-layout";
import { BroadCompetitorEvidence, BenchmarkSourceEvidence } from "@/components/dashboard-evidence-panels";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  createFileRoute,
  Link,
  useNavigate,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, CalendarDays, Printer, Search, Users, ChevronDown } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { canViewDataAssetAdmin } from "@/lib/data-asset-admin.functions";
import { getActionOpportunityV1DashboardPrivatePreview } from "@/lib/action-opportunity-v1.dashboard-private.functions";
import { canRenderDashboardPrivateV1Preview } from "@/lib/action-opportunity-v1.dashboard-private-scope";
import { ActionOpportunityV1CustomerPreview } from "@/components/action-opportunity-v1-customer-preview";
import { ActionOpportunityV1AdminOwnerDrilldown } from "@/components/action-opportunity-v1-admin-owner-drilldown";
import { isCustomerEvidenceInsightId } from "@/lib/action-opportunity-v1.customer-read";
import type { V1CustomerQaScope } from "@/lib/action-opportunity-v1.customer-dashboard-qa-scope";
import { v1RuleForOwnerSummaryInsight } from "@/lib/action-opportunity-v1.owner-summary-bridge";
import { formatSeoul } from "@/lib/format";
import { INTENT_LABELS, normalizeQuestion } from "@/lib/question-suggestions";
import {
  buildSearchContextQuestionEvidence,
  searchContextQuestionEvidenceLabel,
} from "@/lib/search-context-question-evidence";
import type { EntityFactsV2ReadQuestionAreaDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import { getEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.functions";
import { buildEntityFactsV2DashboardCutoverModel } from "@/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import {
  buildEntityFactsV2DashboardSummaryViewModel,
  type EntityFactsV2DashboardSummaryViewModel,
} from "@/lib/entity-facts-v2-dashboard-summary.viewmodel";
import { getEntityFactsV2Comparison } from "@/lib/entity-facts-v2-comparison.functions";
import { buildEntityFactsV2ComparisonViewModel } from "@/lib/entity-facts-v2-comparison.viewmodel";
import { buildActionOpportunityEngineV01 } from "@/lib/action-opportunity-engine-v01";
import { getActionOpportunityEvidence } from "@/lib/action-opportunity-evidence.functions";
import { getVerifiedFirstPartySourceTypes } from "@/lib/first-party-source-registry.functions";
import { getVisibilityBenchmark } from "@/lib/visibility-benchmark.functions";
import { getCustomDiagnostic } from "@/lib/custom-diagnostic.functions";
import type {
  CustomDiagnosticDTO,
  CustomDiagnosticQuestionDTO,
} from "@/lib/custom-diagnostic.helpers";
import {
  UNIFIED_DIAGNOSTIC_SET_PREFIX,
  isUnifiedDiagnosticSetName,
  naturalizeQuestionLocation,
} from "@/lib/custom-question-suggestions";
import {
  buildUnifiedDiagnosticLayerSummary,
  confirmedRatePct,
  type UnifiedDiagnosticLayerMetric,
  type UnifiedDiagnosticLayerSummary,
} from "@/lib/unified-diagnostic-layer-summary";
import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  buildCompactSummaryInsights,
  type CompactSummaryInsight,
  ownerSearchContextLabel,
  ownerSearchContextAnswerText,
} from "@/lib/dashboard-compact-insights";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DashboardSearch = { view?: "detail" };
type DashboardSearchInput = SearchSchemaInput & { view?: string };

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: DashboardSearchInput): DashboardSearch =>
    search["view"] === "detail" ? { view: "detail" } : {},
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

function questionUsesDetailedLocation(
  questionText: string,
  detailLocation: string | null | undefined,
): boolean {
  const detailSurface = naturalizeQuestionLocation(detailLocation ?? "");
  const detailKey = normalizeQuestion(detailSurface);
  if (detailKey.length < 2) return false;
  return normalizeQuestion(questionText).includes(detailKey);
}

function unifiedWeakQuestionPriority(
  questionText: string,
  detailLocation: string | null | undefined,
): number {
  return questionUsesDetailedLocation(questionText, detailLocation) ? 0 : 1;
}

function layerMetricText(metric: UnifiedDiagnosticLayerMetric): string {
  const rate = confirmedRatePct(metric);
  const rateText = rate === null ? "–" : pctRange(rate, rate);
  return `${metric.confirmedCount}/${metric.validCount} · ${rateText}`;
}

function unifiedLayerSummarySentence(summary: UnifiedDiagnosticLayerSummary): string {
  const customConfirmed = summary.custom.confirmedCount;
  const coreConfirmed = summary.core.confirmedCount;

  if (customConfirmed > 0 && coreConfirmed === 0) {
    return "상세 조건 검색에서는 확인됐지만, 넓은 범위 검색에서는 확인되지 않았습니다.";
  }
  if (customConfirmed === 0 && coreConfirmed > 0) {
    return "넓은 범위 검색에서는 확인됐지만, 상세 조건 검색에서는 확인되지 않았습니다.";
  }
  if (customConfirmed > 0 && coreConfirmed > 0) {
    return "상세 조건 검색과 넓은 범위 검색 모두에서 확정 노출이 확인됐습니다.";
  }
  return "이번 측정에서는 상세 조건 검색과 넓은 범위 검색 모두에서 확정 노출이 확인되지 않았습니다.";
}

function UnifiedDiagnosticLayerSummaryCard({
  summary,
  broadSearchObservation,
  hasVerifiedOwnedDomain,
  broadQuestionExample,
}: {
  summary: UnifiedDiagnosticLayerSummary;
  broadSearchObservation:
    | import("@/lib/entity-facts-v2-read-gateway.types").EntityFactsV2ReadBroadSearchObservationDTO
    | undefined;
  hasVerifiedOwnedDomain: boolean;
  broadQuestionExample: string | null;
}) {
  const hasUnresolved =
    summary.overall.unresolvedCount > 0 ||
    summary.custom.unresolvedCount > 0 ||
    summary.core.unresolvedCount > 0;

  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <p className="report-kicker">SEARCH SCOPE</p>
        <CardTitle className="text-xl">검색 범위별 확정 노출</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          같은 24개 질문을 넓은 지역·주력 서비스 중심의 검색과 상세 지역·선택 조건 검색으로 나눠 보여드립니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid overflow-hidden rounded-lg border bg-border sm:grid-cols-3 sm:gap-px">
          {[
            {
              label: "전체 확정 노출",
              metric: summary.overall,
              note: "통합 24문항 전체",
            },
            {
              label: "상세 조건 검색 확정 노출",
              metric: summary.custom,
              note: "상세 지역 · 선택 조건",
            },
            {
              label: "넓은 범위 검색 확정 노출",
              metric: summary.core,
              note: "넓은 지역 · 주력 서비스",
            },
          ].map((item) => (
            <div key={item.label} className="bg-card px-4 py-4">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {layerMetricText(item.metric)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            </div>
          ))}
        </div>
        <p className="rounded-md bg-muted/40 px-3 py-2 text-sm leading-6">
          {unifiedLayerSummarySentence(summary)}
        </p>

        {broadSearchObservation && (
          <div className="space-y-3 border-t border-border pt-4">
            <div>
              <p className="text-base font-semibold">넓은 범위 검색에서도 반복 확인된 업체</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                넓은 범위 검색은 상세 지역을 좁히기 전에 광역 지역과 주력 서비스를 묻는
                질문입니다. 이번 측정의 {broadSearchObservation.validCount}개 유효 답변에서
                2회 이상 관찰된 다른 업체를 보여드립니다.
              </p>
              {broadQuestionExample && (
                <p className="mt-2 text-sm leading-6">
                  <span className="font-semibold">이번 측정의 질문 예시 · </span>
                  “{broadQuestionExample}”
                </p>
              )}
              {broadSearchObservation.repeatedCompetitors.length > 0 && (
                <div className="mt-3 rounded-lg border bg-muted/20 px-3 py-3 text-sm leading-6">
                  <p className="font-semibold">왜 눈여겨볼 만할까요?</p>
                  <p className="mt-1 text-muted-foreground">
                    상세 지역 조건을 좁히지 않은 질문에서도 여러 번 등장했기 때문에
                    이번 측정에서 비교해 볼 만한 관찰 사례입니다. 다만 더 잘하는 업체이거나
                    전체 AI 추천에서 우위에 있다는 의미는 아닙니다.
                  </p>
                </div>
              )}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                표에는 같은 넓은 범위 검색 답변에서 업체와 연결된 독립 웹 출처만 표시합니다.
              </p>
            </div>

            <div className="space-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs leading-5">
              <div>
                <span className="font-medium">내 업체</span>
                <span className="ml-2 tabular-nums">
                  넓은 범위 검색 {broadSearchObservation.targetConfirmedCount}/
                  {broadSearchObservation.validCount}
                </span>
                <span className="mx-1 text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  독립 웹 출처 연결{" "}
                  {broadSearchObservation.targetIndependentSourceResponseCount}/
                  {broadSearchObservation.validCount}
                </span>
              </div>
              {hasVerifiedOwnedDomain &&
                broadSearchObservation.targetIndependentSourceResponseCount === 0 && (
                  <p className="text-muted-foreground">
                    공식 홈페이지는 등록돼 있지만, 이번 넓은 범위 검색 답변에서는 내 업체와 독립 웹
                    출처 연결이 확인되지 않았습니다.
                  </p>
                )}
              {!hasVerifiedOwnedDomain &&
                broadSearchObservation.targetIndependentSourceResponseCount === 0 && (
                  <p className="text-muted-foreground">
                    차보임에 등록된 공식 홈페이지가 없고, 이번 넓은 범위 검색에서도 내 업체와 독립 웹
                    출처 연결이 확인되지 않았습니다.
                  </p>
                )}
            </div>

            {broadSearchObservation.repeatedCompetitors.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>업체</TableHead>
                      <TableHead className="text-right">관찰</TableHead>
                      <TableHead className="text-right">Top3</TableHead>
                      <TableHead className="text-right">검색 상황</TableHead>
                      <TableHead>함께 확인된 독립 웹 출처</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {broadSearchObservation.repeatedCompetitors.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.responseCount}/{broadSearchObservation.validCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.top3ResponseCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.intentCount}종
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.strongestIndependentSource ? (
                            <>
                              <span>{row.strongestIndependentSource.domain}</span>
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {row.strongestIndependentSource.responseCount}개 답변
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">
                              반복 독립 출처 없음
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
                넓은 범위 검색에서 2회 이상 반복 관찰된 다른 업체가 없습니다.
              </p>
            )}

            {broadSearchObservation.singleObservationCompetitors.length > 0 && (
              <details className="rounded-md border bg-muted/10">
                <summary className="cursor-pointer px-3 py-3 text-sm font-medium">
                  넓은 범위 검색에서 추가로 한 번 확인된 업체{" "}
                  {broadSearchObservation.singleObservationCompetitors.length}곳
                </summary>
                <div className="border-t px-3 py-3">
                  <p className="mb-3 text-xs leading-5 text-muted-foreground">
                    1회 관찰은 반복 패턴이 아니라 참고 신호입니다.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {broadSearchObservation.singleObservationCompetitors
                      .slice(0, 8)
                      .map((row) => (
                        <div key={row.name} className="rounded-md border bg-card px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{row.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              1/{broadSearchObservation.validCount}
                              {row.top3ResponseCount > 0 ? " · Top3" : ""}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.strongestIndependentSource
                              ? "독립 웹 출처: " + row.strongestIndependentSource.domain
                              : "반복 독립 웹 출처는 확인되지 않음"}
                          </p>
                        </div>
                      ))}
                  </div>
                  {broadSearchObservation.singleObservationCompetitors.length > 8 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      그 외{" "}
                      {broadSearchObservation.singleObservationCompetitors.length - 8}곳이
                      추가로 한 번씩 관찰됐습니다.
                    </p>
                  )}
                </div>
              </details>
            )}

            {broadSearchObservation.observedCompetitorCount > 0 && (
              <div className="space-y-2 rounded-md border px-3 py-3">
                <p className="text-sm font-semibold">이번 넓은 범위 검색에서 확인된 공개 근거 패턴</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  넓은 범위 검색에서 확인된 타업체 {broadSearchObservation.observedCompetitorCount}곳 중{" "}
                  {broadSearchObservation.independentWebLinkedCompetitorCount}곳에서 독립 웹
                  출처가 함께 연결됐습니다.
                  {broadSearchObservation.repeatedCompetitors.length > 0 && (
                    <>
                      {" "}
                      2회 이상 반복된 업체 {broadSearchObservation.repeatedCompetitors.length}곳 중{" "}
                      {broadSearchObservation.repeatedIndependentWebLinkedCompetitorCount}곳에서
                      독립 웹 출처가 확인됐습니다.
                    </>
                  )}
                </p>
                {broadSearchObservation.sourcePatterns.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {broadSearchObservation.sourcePatterns.slice(0, 6).map((item) => (
                        <Badge key={item.key} variant="secondary">
                          {item.label} {item.competitorCount}곳
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      한 업체가 여러 출처 유형에 동시에 포함될 수 있습니다.
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="text-xs leading-5 text-muted-foreground">
              이 표는 이번 측정에서 함께 관찰된 차이를 보여줍니다. 특정 출처나 정보가 AI
              노출을 발생시켰다는 인과관계를 의미하지 않습니다.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          이번 통합 24문항 측정에서 확정된 응답 기준입니다.
        </p>
        {hasUnresolved && (
          <p className="text-xs text-muted-foreground">
            추가 확인이 필요한 응답은 위 확정 노출 수치에 포함하지 않았습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const UNIFIED_V2_RETRY_DELAYS_MS = [1500, 2500, 4000] as const;

function isTransientV2ReadError(result: {
  ok: boolean;
  error?: string;
} | null | undefined): boolean {
  return (
    !!result &&
    !result.ok &&
    (result.error === "NO_V2_DATA" || result.error === "INVALID_V2_DATA")
  );
}

function waitForDashboardRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChartTooltipPayload = {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { label?: string; connected?: boolean; validCount?: number };
};

function MeasurementTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const validCount = payload[0]?.payload?.validCount;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {typeof validCount === "number" && (
        <p className="mb-1 border-b pb-1 text-muted-foreground">총 {validCount}문항</p>
      )}
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
  questions,
}: {
  groups: Array<QuestionGroupCounts & { intentType: string; questionCount: number }>;
  questions: readonly EntityFactsV2ReadQuestionAreaDTO[];
}) {
  const questionEvidence = buildSearchContextQuestionEvidence(groups, questions);
  const data = groups.map((group) => ({
    label: intentLabel(group.intentType),
    confirmed: group.confirmedMentionCount,
    unresolved: group.unresolvedTargetCount,
    validCount: group.validCount,
    missing: Math.max(
      0,
      group.validCount - group.confirmedMentionCount - group.unresolvedTargetCount,
    ),
    confirmedRatio: `${group.confirmedMentionCount}/${group.validCount}`,
  }));
  const maximum = Math.max(1, ...groups.map((group) => group.validCount));

  return (
    <div>
      <div
        className="h-[26rem] min-w-[560px] sm:h-[24rem]"
        role="img"
        aria-label="검색 상황별 확정 노출, 추가 확인, 노출 미확인 건수 비교"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 48, bottom: 8, left: 8 }}
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
              width={118}
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
            >
              <LabelList
                dataKey="confirmedRatio"
                position="right"
                className="fill-foreground text-[11px] font-semibold"
              />
            </Bar>
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
      <details className="diagnostic-questions mt-4 border-t pt-4" open>
        <summary className="cursor-pointer text-sm font-semibold">
          검색 상황별 실제 질문 {groups.reduce((sum, group) => sum + group.questionCount, 0)}개 확인
        </summary>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          이 검색 유형은 질문 생성 시 지정한 검색 목적입니다.
          질문 표현이 비슷해도 다른 유형에 포함될 수 있으며, 기존 분류나 노출 판정은 바꾸지 않습니다.
        </p>
        <div className="mt-3 divide-y">
          {questionEvidence.map((group) => (
            <details key={group.intentType} className="py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {intentLabel(group.intentType)} · 확정 노출 {group.confirmedMentionCount}/{group.validCount}
              </summary>
              {group.questions === null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  이 측정에 저장된 분류별 질문 수치가 일치하지 않아 개별 질문 목록은 표시하지 않습니다.
                </p>
              ) : (
                <QuestionResults questions={group.questions}/>
              )}
            </details>
          ))}
        </div>
      </details>
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

const LOW_VALUE_COMPARISON_SOURCE_PATTERNS = [
  /(^|\.)saramin\.co\.kr$/u,
  /(^|\.)jobkorea\.co\.kr$/u,
  /(^|\.)albamon\.com$/u,
  /(^|\.)alba\.co\.kr$/u,
  /(^|\.)career\.co\.kr$/u,
  /(^|\.)jobplanet\.co\.kr$/u,
  /(^|\.)work24\.go\.kr$/u,
  /(^|\.)govjob\.co\.kr$/u,
  /(^|\.)easylaw\.go\.kr$/u,
  /(^|\.)news\.nate\.com$/u,
  /(^|\.)n\.news\.naver\.com$/u,
  /(^|\.)yna\.co\.kr$/u,
  /(^|\.)newsis\.com$/u,
  /(^|\.)wowtv\.co\.kr$/u,
  /(^|\.)v\.daum\.net$/u,
] as const;

function lowValueComparisonSourceDomain(value: string): boolean {
  const domain = value.trim().toLowerCase().replace(/^www\./u, "");
  return (
    !domain ||
    domain.endsWith(".go.kr") ||
    LOW_VALUE_COMPARISON_SOURCE_PATTERNS.some((pattern) => pattern.test(domain))
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

function printableReportNamePart(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 60);
}

function seoulDateSlug(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜미확인";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : "날짜미확인";
}

function dashboardPrintTitle(args: {
  businessName: string;
  measuredAt: string;
  view: "summary" | "detail";
}): string {
  const business = printableReportNamePart(args.businessName) || "업체";
  const viewLabel = args.view === "summary" ? "요약" : "상세";
  return `차보임 AI 노출 진단 - ${business} - ${seoulDateSlug(args.measuredAt)} - ${viewLabel}`;
}

function copyPrintElementAttributes(source: Element, target: Element): void {
  for (const attribute of Array.from(source.attributes)) {
    target.setAttribute(attribute.name, attribute.value);
  }
}

async function waitForPrintableAssets(printWindow: Window): Promise<void> {
  const stylesheetLinks = Array.from(
    printWindow.document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );

  await Promise.all(
    stylesheetLinks.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };

          link.addEventListener("load", finish, { once: true });
          link.addEventListener("error", finish, { once: true });
          printWindow.setTimeout(finish, 3000);
        }),
    ),
  );

  try {
    await printWindow.document.fonts?.ready;
  } catch {
    // Font loading is best effort; stylesheets are the critical print asset.
  }

  const images = Array.from(printWindow.document.images);
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );

  await new Promise((resolve) => printWindow.setTimeout(resolve, 180));
}

function openPrintableSnapshot(title: string): boolean {
  const source = document.querySelector<HTMLElement>(".print-report");
  if (!source) return false;

  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.style.position = "fixed";
  printFrame.style.left = "-10000px";
  printFrame.style.top = "0";
  printFrame.style.width = "1280px";
  printFrame.style.height = "1px";
  printFrame.style.border = "0";
  document.body.appendChild(printFrame);

  const printWindow = printFrame.contentWindow;
  if (!printWindow) {
    printFrame.remove();
    return false;
  }

  const report = source.cloneNode(true) as HTMLElement;
  report.querySelectorAll(".no-print").forEach((node) => node.remove());
  report.querySelectorAll("details").forEach((node) => node.setAttribute("open", ""));

  const styles = Array.from(
    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
      'link[rel="stylesheet"], style',
    ),
  )
    .map((node) =>
      node.tagName === "LINK"
        ? `<link rel="stylesheet" href="${(node as HTMLLinkElement).href}">`
        : node.outerHTML,
    )
    .join("\n");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title></title>
  ${styles}
</head>
<body>
  <main class="mx-auto max-w-7xl px-4 py-7 lg:px-6 lg:py-10">
    ${report.outerHTML}
  </main>
</body>
</html>`);
  printWindow.document.close();

  copyPrintElementAttributes(document.documentElement, printWindow.document.documentElement);
  copyPrintElementAttributes(document.body, printWindow.document.body);
  printWindow.document.title = title;

  const originalRootStyle = getComputedStyle(document.documentElement);
  for (const property of Array.from(originalRootStyle)) {
    if (!property.startsWith("--")) continue;
    const value = originalRootStyle.getPropertyValue(property);
    if (value) {
      printWindow.document.documentElement.style.setProperty(property, value);
    }
  }

  try {
    printWindow.history.replaceState(null, "", `${window.location.origin}/report`);
  } catch {
    // The report title still controls the suggested PDF filename.
  }

  const printWhenReady = async () => {
    await waitForPrintableAssets(printWindow);

    const originalParentTitle = document.title;
    document.title = title;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.title = originalParentTitle;
      printWindow.removeEventListener("afterprint", cleanup);
      printFrame.remove();
    };

    printWindow.addEventListener("afterprint", cleanup, { once: true });
    printWindow.focus();
    printWindow.print();

    // Safety cleanup for browsers that do not fire afterprint reliably.
    printWindow.setTimeout(cleanup, 60000);
  };

  void printWhenReady();
  return true;
}

function DashboardPage() {
  const [qaSelection, setQaSelection] = useState<string | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const { view: requestedView } = Route.useSearch();
  const view = requestedView ?? "summary";
  const [detailTopic, setDetailTopic] = useState("questions");
  const [printExpanded, setPrintExpanded] = useState(false);
  const [evidenceEntry, setEvidenceEntry] = useState({ topic: "questions", version: 0 });
  useEffect(() => {
    const beforePrint = () => flushSync(() => setPrintExpanded(true));
    const afterPrint = () => setPrintExpanded(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);
  const navigate = useNavigate({ from: "/dashboard" });
  const { activeOrgId, session } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const businessId = businesses.selectedBusinessId;
  const [privatePreviewSelection, setPrivatePreviewSelection] = useState<{
    orgId: string;
    businessId: string;
    runId: string;
  } | null>(null);
  const [privateV1Focus, setPrivateV1Focus] = useState<CompactSummaryInsight | null>(null);
  const checkPrivateV1Admin = useServerFn(canViewDataAssetAdmin);
  const privateV1AdminQuery = useQuery({
    queryKey: ["can-view-data-asset-admin", session?.user.id],
    enabled: !!session?.user.id,
    retry: false,
    staleTime: 0,
    queryFn: () => checkPrivateV1Admin({ data: undefined }),
  });
  const [expandedCompetitorBusinessId, setExpandedCompetitorBusinessId] = useState<string | null>(
    null,
  );
  const [expandedWeakQuestionBusinessId, setExpandedWeakQuestionBusinessId] = useState<
    string | null
  >(null);
  const [expandedCitationSourceBusinessId, setExpandedCitationSourceBusinessId] = useState<
    string | null
  >(null);
  const [expandedLinkedClueBusinessId, setExpandedLinkedClueBusinessId] = useState<
    string | null
  >(null);
  const [expandedTargetReferenceBusinessId, setExpandedTargetReferenceBusinessId] = useState<
    string | null
  >(null);
  const [
    expandedTargetExposureCitationBusinessId,
    setExpandedTargetExposureCitationBusinessId,
  ] = useState<string | null>(null);
  const [
    expandedAllTargetExposureCitationBusinessId,
    setExpandedAllTargetExposureCitationBusinessId,
  ] = useState<string | null>(null);
  const [
    expandedVerifiedTargetCitationBusinessId,
    setExpandedVerifiedTargetCitationBusinessId,
  ] = useState<string | null>(null);
  const [expandedOtherConfirmedSourceBusinessId, setExpandedOtherConfirmedSourceBusinessId] =
    useState<string | null>(null);
  const showAllCompetitors = expandedCompetitorBusinessId === businessId;
  const showAllWeakQuestions = expandedWeakQuestionBusinessId === businessId;
  const showAllCitationSources = expandedCitationSourceBusinessId === businessId;
  const showLinkedClues = expandedLinkedClueBusinessId === businessId;
  const showTargetReferenceSources = expandedTargetReferenceBusinessId === businessId;
  const showTargetExposureCitationSources =
    expandedTargetExposureCitationBusinessId === businessId;
  const showAllTargetExposureCitationSources =
    expandedAllTargetExposureCitationBusinessId === businessId;
  const showAllVerifiedTargetCitationPages =
    expandedVerifiedTargetCitationBusinessId === businessId;
  const showOtherConfirmedSources = expandedOtherConfirmedSourceBusinessId === businessId;

  const unifiedSetQuery = useQuery({
    queryKey: ["active-unified-diagnostic-set", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data: set, error: setError } = await supabase
        .from("question_sets")
        .select("id, name")
        .eq("org_id", activeOrgId as string)
        .eq("business_id", businessId as string)
        .eq("active", true)
        .like("name", `${UNIFIED_DIAGNOSTIC_SET_PREFIX}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (setError) throw setError;
      if (!set) return { set: null, completedRunId: null };

      const { data: completedRun, error: runError } = await supabase
        .from("measurement_runs")
        .select("id")
        .eq("org_id", activeOrgId as string)
        .eq("business_id", businessId as string)
        .eq("question_set_id", set.id)
        .eq("run_type", "audit")
        .eq("phase", "standalone")
        .eq("diagnostic_scope", "customer")
        .eq("status", "completed")
        .is("experiment_id", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runError) throw runError;

      return { set, completedRunId: completedRun?.id ?? null };
    },
  });
  const hasUnifiedDiagnosticSet = !!unifiedSetQuery.data?.set;
  const hasCompletedUnifiedRun = !!unifiedSetQuery.data?.completedRunId;
  const unifiedTransitionPending =
    hasUnifiedDiagnosticSet && !hasCompletedUnifiedRun;

  const fetchV2 = useServerFn(getEntityFactsV2ReadGateway);
  const query = useQuery({
    queryKey: [
      "entity-facts-v2-dashboard",
      activeOrgId,
      businessId,
      hasUnifiedDiagnosticSet,
      hasCompletedUnifiedRun,
    ],
    enabled:
      !!activeOrgId &&
      !!businessId &&
      !unifiedSetQuery.isLoading &&
      !unifiedSetQuery.isError,
    queryFn: async () => {
      const request = () =>
        fetchV2({
          data: {
            orgId: activeOrgId as string,
            businessId: businessId as string,
          },
        });

      let response = await request();
      if (!hasCompletedUnifiedRun) return response;

      for (const delayMs of UNIFIED_V2_RETRY_DELAYS_MS) {
        if (!isTransientV2ReadError(response)) break;
        await waitForDashboardRetry(delayMs);
        response = await request();
      }
      return response;
    },
  });

  const result = query.data;
  const dto = result && result.ok ? result.data : null;
  const evidenceRunId = dto?.scope.runId;
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
    queryKey: ["action-opportunity-evidence", activeOrgId, businessId, evidenceRunId, benchmark?.thresholdPct],
    enabled: !!activeOrgId && !!businessId && !!evidenceRunId,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetchActionOpportunityEvidence({
          data: {
            orgId: activeOrgId as string,
            businessId: businessId as string,
            highVisibilityThresholdPct: benchmark?.thresholdPct ?? 20,
            ...(evidenceRunId ? { expectedRunId: evidenceRunId } : {}),
          },
        });
        return response && response.ok
          ? {
              highVisibilityExamples: response.highVisibilityExamples,
              currentRunReferences: response.currentRunReferences,
              peerPageReferences: response.peerPageReferences,
            }
          : { highVisibilityExamples: [], currentRunReferences: [], peerPageReferences: [] };
      } catch {
        return { highVisibilityExamples: [], currentRunReferences: [], peerPageReferences: [] };
      }
    },
  });
  const actionEvidenceExamples = actionEvidenceQuery.data?.highVisibilityExamples ?? [];
  const currentRunReferences = actionEvidenceQuery.data?.currentRunReferences ?? [];

  const fetchCustom = useServerFn(getCustomDiagnostic);
  const customQuery = useQuery({
    queryKey: ["custom-diagnostic", activeOrgId, businessId],
    enabled:
      !!activeOrgId &&
      !!businessId &&
      !unifiedSetQuery.isLoading &&
      !hasCompletedUnifiedRun,
    retry: false,
    queryFn: () =>
      fetchCustom({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });

  const model = dto ? buildEntityFactsV2DashboardCutoverModel(dto) : null;
  const privateV1AdminAllowed = privateV1AdminQuery.data?.allowed === true;
  const privateV1Selected =
    privatePreviewSelection !== null &&
    privatePreviewSelection.orgId === activeOrgId &&
    privatePreviewSelection.businessId === businessId &&
    privatePreviewSelection.runId === dto?.scope.runId;
  const fetchPrivateV1Preview = useServerFn(getActionOpportunityV1DashboardPrivatePreview);
  const privateV1PreviewQuery = useQuery({
    queryKey: [
      "action-opportunity-v1-dashboard-private",
      session?.user.id,
      activeOrgId,
      businessId,
      dto?.scope.runId,
    ],
    enabled:
      privateV1AdminAllowed &&
      privateV1Selected &&
      !!activeOrgId &&
      !!businessId &&
      !!dto?.scope.runId,
    retry: false,
    queryFn: () =>
      fetchPrivateV1Preview({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });
  const privateV1PreviewCurrent = canRenderDashboardPrivateV1Preview({
    adminAllowed: privateV1AdminAllowed,
    selected: privatePreviewSelection,
    current: {
      orgId: activeOrgId,
      businessId,
      runId: dto?.scope.runId ?? null,
    },
    preview:
      privateV1PreviewQuery.data?.ok === true
        ? privateV1PreviewQuery.data
        : null,
  });
  const isUnifiedDiagnostic =
    hasCompletedUnifiedRun ||
    (!!dto?.scope.questionSetName && isUnifiedDiagnosticSetName(dto.scope.questionSetName));
  const showLegacyDiagnosticSection =
    !isUnifiedDiagnostic && (!unifiedTransitionPending || !!dto);
  const detailBasisLabel = isUnifiedDiagnostic ? "AI 진단 기준" : "기본 진단 기준";
  const unifiedLayerSummary =
    dto && isUnifiedDiagnostic && dto.questionLocations
      ? buildUnifiedDiagnosticLayerSummary({
          questionAreas: dto.questionAreas,
          questionLocations: dto.questionLocations,
          overview: dto.overview,
        })
      : null;
  // Reuse an actual broad-scope question from the current representative Run.
  const broadQuestionIds = new Set(
    dto?.questionLocations
      ?.filter((question) => question.city === null)
      .map((question) => question.questionId) ?? [],
  );
  const broadQuestionExample =
    dto?.questionAreas.find(
      (question) => broadQuestionIds.has(question.questionId) && question.validCount > 0,
    )?.questionText ?? null;

  const linkedTargetSources =
    model?.sources.rows.filter(
      (source) => source.evidence !== "clue" && source.targetResponseCount > 0,
    ) ?? [];
  const linkedCompetitorConfirmedSources =
    model?.sources.rows.filter(
      (source) =>
        source.evidence !== "clue" &&
        source.targetResponseCount === 0 &&
        source.competitorResponseCount > 0,
    ) ?? [];
  const usefulCompetitorSources = linkedCompetitorConfirmedSources.filter(
    (source) => !lowValueComparisonSourceDomain(source.domain),
  );
  const otherConfirmedSources = linkedCompetitorConfirmedSources.filter((source) =>
    lowValueComparisonSourceDomain(source.domain),
  );
  const linkedClueSources =
    model?.sources.rows.filter((source) => source.evidence === "clue") ?? [];
  const targetReferenceSources = model?.targetReferenceSources.rows ?? [];
  const targetExposureCitationSources =
    model?.targetExposureCitationSources.rows ?? [];
  const verifiedTargetCitationPages =
    model?.verifiedTargetCitationPages.rows ?? [];
  const linkedTargetSourceCount = linkedTargetSources.length;
  const linkedCompetitorSourceCount = usefulCompetitorSources.length;
  const linkedClueSourceCount = linkedClueSources.length;
  const targetExposureCitationSourceCount = targetExposureCitationSources.length;
  const verifiedTargetCitationPageCount = verifiedTargetCitationPages.length;
  const weakQuestionRows =
    model && isUnifiedDiagnostic
      ? model.weakQuestions.rows
          .map((item, index) => ({ item, index }))
          .sort(
            (a, b) =>
              unifiedWeakQuestionPriority(a.item.questionText, dto?.business.city) -
                unifiedWeakQuestionPriority(b.item.questionText, dto?.business.city) ||
              a.index - b.index,
          )
          .map(({ item }) => item)
      : (model?.weakQuestions.rows ?? []);
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
  const summaryModel = model
    ? buildEntityFactsV2DashboardSummaryViewModel({
        model,
        unifiedLayerSummary,
        actionOpportunityModel,
        hasVerifiedOwnedDomain: verifiedFirstPartySourceTypes.includes("owned_domain"),
        broadSearchObservation: dto?.broadSearchObservation ?? null,
      })
    : null;
  const firstPriority = actionOpportunityModel?.items[0];
  const peerPages = actionEvidenceQuery.data?.peerPageReferences ?? [];
  const repeatedPeers = dto ? repeatedPeerEvidence(dto, peerPages) : [];
  const ownChannel = { profile_directory: "naver_place", owned_web_presence: "owned_domain", blog_presence: "naver_blog" } as const;
  const ownType = firstPriority && Object.prototype.hasOwnProperty.call(ownChannel, firstPriority.kind)
    ? ownChannel[firstPriority.kind as keyof typeof ownChannel] : null;
  const ownPage = firstPartyResult?.ok && ownType
    ? firstPartyResult.publicPages?.find(page => page.sourceType === ownType) : undefined;
  const matchingDomains = new Set(peerPages.filter(group => group.sourceGroupKey === firstPriority?.sourceGroupKey).map(group => group.domain));
  const comparableSources = repeatedPeers.flatMap(peer => peer.sources.filter(source => source.url && matchingDomains.has(source.domain))
    .map(source => ({ name: peer.name, appearances: peer.responseCount, ...source })))
    .sort((a, b) => b.count - a.count || b.appearances - a.appearances || a.name.localeCompare(b.name, "ko"));
  const distinctSites = new Set<string>();
  const priorityEvidence: PriorityEvidence | null = firstPriority ? {
    kind: firstPriority.kind, evidenceScope: firstPriority.evidenceScope, ...(benchmark ? {windowDays: benchmark.windowDays} : {}),
    title: firstPriority.title, sourceGroupLabel: firstPriority.sourceGroupLabel,
    highEntityCount: firstPriority.highEntityCount, highVisibilityEntityCount: firstPriority.highVisibilityEntityCount,
    highEntitySharePct: firstPriority.highEntitySharePct,
    targetConnected: benchmark?.sourceGroups.find(group => group.key === firstPriority.sourceGroupKey)?.targetConnected ?? null,
    sites: firstPriority.sites,
    ...(ownPage ? { ownPage } : {}),
    peerExamples: comparableSources.filter(source => {
      if (distinctSites.has(source.domain)) return false;
      distinctSites.add(source.domain);
      return true;
    }).slice(0, 2),
  } : null;
  const setDashboardView = (nextView: "summary" | "detail", topic = "questions") => {
    setDetailTopic(["questions", "businesses", "sources", "comparison"].includes(topic) ? topic : "questions");
    setEvidenceEntry(previous => ({ topic, version: previous.version + 1 }));
    void navigate({ search: nextView === "detail" ? { view: "detail" } : {}, replace: true });
  };
  const printDashboardReport = () => {
    if (!model) return;

    const title = dashboardPrintTitle({
      businessName: model.businessName,
      measuredAt: model.measuredAt,
      view,
    });

    flushSync(() => setPrintExpanded(true));
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (openPrintableSnapshot(title)) {
          setPrintExpanded(false);
          return;
        }
        // Popup blocking fallback: print the current document.
        const originalTitle = document.title;
        document.title = title;
        window.print();
        window.setTimeout(() => {
          document.title = originalTitle;
          setPrintExpanded(false);
        }, 1500);
      });
    });
  };

  return (
    <div
      className={
        "print-page print-report diagnostic-page"
      }
    >
      <header className="dashboard-toolbar diagnostic-header">
        <div className="diagnostic-heading"><p>AI 노출 진단</p><h1>{model?.businessName ?? "업체 선택"}</h1><p className="diagnostic-measured"><CalendarDays aria-hidden="true"/>{model ? `측정일 ${formatSeoul(model.measuredAt)}` : "최근 완료된 진단을 확인합니다"}</p></div>
        <div className="diagnostic-header-actions no-print">
          <Popover>
            <PopoverTrigger asChild>
              <Button ref={toolsTriggerRef} type="button" variant="ghost" className="diagnostic-tools-trigger">
                업체 및 도구<ChevronDown aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="diagnostic-popup diagnostic-tools-popover no-print" aria-label="업체 및 도구" onCloseAutoFocus={(event) => {
              event.preventDefault();
              toolsTriggerRef.current?.focus();
            }}>
            <BusinessSelector
              options={businesses.options}
              value={businesses.selectedBusinessId}
              onChange={businesses.select}
              isLoading={businesses.isLoading}
              isError={businesses.isError}
            />
          <div className="no-print flex flex-wrap items-center gap-2">
            {dto && model && (
              <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={printDashboardReport}>
                <Printer aria-hidden="true" />인쇄·PDF 저장
              </Button>
            )}
          {privateV1AdminAllowed && dto && model && activeOrgId && businessId && (
            <Button
              type="button"
              variant={privateV1Selected ? "secondary" : "outline"}
              className="w-full justify-center sm:w-auto"
              aria-expanded={privateV1Selected}
              aria-controls="dashboard-action-v1-private-preview"
              onClick={() => {
                setPrivateV1Focus(null);
                setPrivatePreviewSelection(
                  privateV1Selected
                    ? null
                    : {
                        orgId: activeOrgId,
                        businessId,
                        runId: dto.scope.runId,
                      },
                );
              }}
            >
              {privateV1Selected
                ? "관리자 도구 닫기"
                : "관리자 도구"}
            </Button>
          )}

          {privateV1AdminAllowed && dto && model && <Button variant="outline" aria-expanded={qaSelection === `${dto.business.id}:${dto.scope.runId}`} onClick={() => { setQaSelection(qaSelection === `${dto.business.id}:${dto.scope.runId}` ? null : `${dto.business.id}:${dto.scope.runId}`); if (view !== "summary") setDashboardView("summary"); toolsTriggerRef.current?.click(); window.setTimeout(() => { const qa = document.getElementById("diagnostic-operator-qa"); qa?.scrollIntoView({block:"start"}); qa?.focus(); }, 150); }}>요약 관찰 및 QA 원자료</Button>}
          </div>
            </PopoverContent>
          </Popover>
        <div className="no-print diagnostic-view-segment" aria-label="진단 보기 방식">
          <Button type="button" variant={view === "summary" ? "default" : "ghost"} aria-pressed={view === "summary"} className="min-h-12 text-base shadow-none" onClick={() => setDashboardView("summary")}>
            핵심 요약
          </Button>
          <Button type="button" variant={view === "detail" ? "default" : "ghost"} aria-pressed={view === "detail"} className="min-h-12 text-base shadow-none" onClick={() => setDashboardView("detail")}>
            상세 분석
          </Button>
        </div>
        </div>
      </header>

      <Dialog
        open={privateV1AdminAllowed && privateV1Selected}
        onOpenChange={(open) => {
          if (!open) {
            setPrivatePreviewSelection(null);
            setPrivateV1Focus(null);
          }
        }}
      >
        <DialogContent
          id="dashboard-action-v1-private-preview"
          className="no-print max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>관리자 전용 · v1.0 고객 화면 구성 검수</DialogTitle>
            <DialogDescription>
              현재 선택한 업체의 고객용 카드 배치를 검수합니다.
              정식 고객 대시보드와 인쇄·PDF에는 표시되지 않습니다.
            </DialogDescription>
          </DialogHeader>
          {privateV1PreviewQuery.isPending || privateV1PreviewQuery.isFetching ? (
            <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
              현재 대표 측정의 비공개 미리보기를 불러오는 중입니다.
            </p>
          ) : privateV1PreviewCurrent && privateV1PreviewQuery.data?.ok ? (
            <ActionOpportunityV1CustomerPreview
              model={privateV1PreviewQuery.data.model}
              focusedInsight={privateV1Focus}
              citedPages={privateV1PreviewQuery.data.citedPages}
              citedPagesLoading={false}
            />
          ) : (
            <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
              현재 업체·대표 측정에 맞는 비공개 검수 자료를 불러올 수 없습니다.
              권한이나 대표 Run이 변경됐다면 다시 확인해 주세요.
            </p>
          )}
        </DialogContent>
      </Dialog>

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

      {result &&
        !result.ok &&
        !(unifiedTransitionPending && result.error === "NO_V2_DATA") && (
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

      {dto && model && summaryModel && view === "summary" && (
        <DashboardSummary
          key={`${dto.business.id}:${dto.scope.runId}`}
          summary={summaryModel}
          actionDto={dto}
          printExpanded={printExpanded}
          showQa={privateV1AdminAllowed && (printExpanded || qaSelection === `${dto.business.id}:${dto.scope.runId}`)}
          priority={priorityEvidence}
          questionAreas={dto.questionAreas}
          intentOrder={dto.questionGroups.map(group => group.intentType)}
          questionLocations={dto.questionLocations ?? []}
          scopeEvidenceAvailable={!!unifiedLayerSummary}
          broadObservation={dto.broadSearchObservation ?? null}
          benchmark={benchmark}
          customerEvidenceQaScope={
            privateV1AdminAllowed &&
            session?.user.id &&
            activeOrgId &&
            businessId &&
            dto.business.id === businessId
              ? {
                  userId: session.user.id,
                  orgId: activeOrgId,
                  businessId,
                  runId: dto.scope.runId,
                }
              : undefined
          }
          onShowDetail={(topic) => setDashboardView("detail", topic)}
          onReviewEvidence={
            privateV1AdminAllowed && activeOrgId && businessId && dto
              ? (insight) => {
                  setPrivateV1Focus(insight);
                  setPrivatePreviewSelection({
                    orgId: activeOrgId,
                    businessId,
                    runId: dto.scope.runId,
                  });
                }
              : undefined
          }
        />
      )}

      {dto && model && (
        <>
          {(view === "detail" || printExpanded) && <>
          <DiagnosticTopicTabs topic={detailTopic} onChange={setDetailTopic} />
          <div className="diagnostic-main-topic">
            {(detailTopic === "questions" || printExpanded) && <DiagnosticQuestions key={`${dto.business.id}:${dto.scope.runId}`} groups={dto.questionGroups} questions={dto.questionAreas} />}
            {(detailTopic === "businesses" || printExpanded) && <RepeatedPeerEvidence rows={repeatedPeers} validCount={dto.overview.validCount} targetCount={dto.overview.confirmedMentionCount} printExpanded={printExpanded} />}
            {(detailTopic === "businesses" || printExpanded) && (dto.broadSearchObservation ? <BroadCompetitorEvidence key={`${dto.business.id}:${dto.scope.runId}`} observation={dto.broadSearchObservation} printExpanded={printExpanded} /> : <p>이 측정은 넓은 지역 업체 분류 자료가 없습니다. 추가 근거에서 기존 관찰 업체를 확인하세요.</p>)}
            {(detailTopic === "sources" || printExpanded) && (benchmark ? <BenchmarkSourceEvidence key={`${dto.business.id}:${dto.scope.runId}`} benchmark={benchmark} printExpanded={printExpanded} /> : <p>시장 표본 출처 자료를 아직 확인할 수 없습니다.</p>)}
            {(detailTopic === "comparison" || printExpanded) && <><DiagnosticHistory comparison={comparisonResult?.ok ? comparisonResult.data : null} measuredAt={model.measuredAt} {...(comparisonModel ? { reason: comparisonModel.description } : {})} error={comparisonQuery.isError || !!(comparisonResult && !comparisonResult.ok)} loading={comparisonQuery.isPending} />{comparisonModel?.comparisonAvailable && <ComparisonCard model={comparisonModel} basisLabel={detailBasisLabel} />}</>}
          </div>
          </>}
          <div className={view === "detail" || printExpanded ? "" : "hidden"}><DiagnosticEvidenceWorkspace key={`${dto.business.id}:${dto.scope.runId}`} dto={dto} model={model} summary={summaryModel} comparison={comparisonModel} comparisonError={comparisonQuery.isError || !!(comparisonResult && !comparisonResult.ok)} printExpanded={printExpanded} entryTopic={evidenceEntry.topic} entryVersion={evidenceEntry.version}
            priority={priorityEvidence}>
          <EvidenceArchive topic="method">
      {view === "detail" && businessId && unifiedTransitionPending && (
        <Card className="border-primary/40 bg-primary/[0.03]">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">새 통합 AI 진단 질문이 준비되었습니다.</p>
                <Badge variant="outline">첫 측정 필요</Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {dto
                  ? "첫 통합 24문항 측정을 완료하기 전까지는 기존 대표 진단 결과를 계속 보여드립니다. 측정이 완료되면 새 통합 진단으로 자동 전환됩니다."
                  : "저장된 통합 24문항으로 첫 측정을 진행해 주세요. 측정이 완료되면 대표 진단 결과가 표시됩니다."}
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link to="/runs">첫 통합 진단 측정하기</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {view === "detail" && businessId && !isUnifiedDiagnostic && (
        <CustomDiagnosticSection
          isLoading={customQuery.isLoading}
          isError={customQuery.isError || (!!customQuery.data && !customQuery.data.ok)}
          data={customQuery.data && customQuery.data.ok ? customQuery.data.data : null}
          loaded={!!customQuery.data && customQuery.data.ok}
          questionsReady={unifiedTransitionPending}
        />
      )}

      {view === "detail" && businessId && showLegacyDiagnosticSection && (
        <section className="space-y-2 border-t border-border pt-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold">
              {isUnifiedDiagnostic ? "내 업체 AI 진단" : "기본 AI 노출 진단"}
            </h2>
            <Badge variant={isUnifiedDiagnostic ? "default" : "outline"}>
              {isUnifiedDiagnostic ? "대표 진단" : "비교 기준"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {isUnifiedDiagnostic
              ? "지역·주력 서비스·중요 브랜드/차종을 반영한 24개 질문으로 내 업체의 AI 노출을 진단합니다."
              : "같은 24개 질문으로 전체 노출 상태와 장기 변화를 보는 기준선입니다."}
          </p>
          <p className="text-xs text-muted-foreground">
            {isUnifiedDiagnostic
              ? "아래 상세 분석·관찰 업체·출처·검색 상황·기간 비교는 모두 이 24문항 측정을 기준으로 합니다."
              : "맞춤 진단과 질문 구성이 다르므로 두 노출률을 상승·하락으로 직접 비교하지 않습니다."}
          </p>
          {!isUnifiedDiagnostic && (
            <p className="text-xs text-muted-foreground">
              아래 상세 분석과 벤치마크는 기본 24문항 측정을 기준으로 합니다.
            </p>
          )}
        </section>
      )}

          </EvidenceArchive>
          <EvidenceArchive topic="questions">
            <div className="diagnostic-topic-content space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">{buildSearchContextQuestionEvidence(model.questionGroups, dto.questionAreas).map((group) => <details key={group.intentType} className="rounded-lg border bg-card p-4" open={printExpanded}>
            <summary className="flex min-h-11 cursor-pointer items-center gap-3 text-base font-semibold"><Search className="size-5 shrink-0 text-primary" aria-hidden="true" />{intentLabel(group.intentType)}<span className="ml-auto text-sm tabular-nums">{group.confirmedMentionCount}/{group.validCount}</span></summary>
            {group.questions ? <QuestionResults questions={group.questions}/> : <p className="mt-3">질문별 저장 근거를 확인할 수 없습니다.</p>}
          </details>)}</div>
          <Card className="report-section print-avoid-break">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">SEARCH CONTEXT</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                어떤 검색 상황에서 보였나요?
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs text-muted-foreground">
                이번 측정에서 질문을 만들 때 지정한 검색 목적별로 확정 노출을 비교합니다.
                예를 들어 1/3은 해당 유형의 유효 AI 답변 3개 중 내 업체가 확정 등장한 답변이 1개라는 뜻입니다.
                아래에서 각 유형의 실제 질문을 확인할 수 있습니다.
              </p>
              {model.questionGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  질문군 요약이 아직 없습니다.
                </p>
              ) : (
                <SearchContextChart groups={model.questionGroups} questions={dto.questionAreas} />
              )}
            </CardContent>
          </Card>

          {unifiedLayerSummary && (
            <UnifiedDiagnosticLayerSummaryCard
              summary={unifiedLayerSummary}
              broadSearchObservation={dto?.broadSearchObservation}
              broadQuestionExample={broadQuestionExample}
              hasVerifiedOwnedDomain={verifiedFirstPartySourceTypes.includes("owned_domain")}
            />
          )}

            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  {model.weakQuestions.heading}
                  <BaselineBadge label={detailBasisLabel} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {isUnifiedDiagnostic
                    ? "상세 지역과 선택 조건이 반영된 상세 조건 검색을 먼저 보여드리고, 넓은 범위 검색은 그다음에 표시합니다."
                    : "노출이 확정되지 않았거나, 일부만 확인됐거나, 대상 동일성 확인이 더 필요한 질문입니다."}
                </p>
                {weakQuestionRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    현재 우선 확인할 질문이 없습니다.
                  </p>
                ) : (
                  <QuestionResults questions={dto.questionAreas.filter(q => weakQuestionRows
                    .slice(0, (showAllWeakQuestions || printExpanded) ? weakQuestionRows.length : 6)
                    .some(row => row.questionId === q.questionId))}/>
                )}
                {weakQuestionRows.length > 6 && (
                  <div className="flex justify-center pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedWeakQuestionBusinessId((showAllWeakQuestions || printExpanded) ? null : businessId)
                      }
                    >
                      {showAllWeakQuestions
                        ? "접기"
                        : `전체 ${weakQuestionRows.length}개 질문 보기`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button asChild variant="outline" className="no-print min-h-11"><Link to="/runs/$runId" params={{ runId: dto.scope.runId }}>질문별 실제 답변과 인용 보기<ArrowRight aria-hidden="true" /></Link></Button>
            </div>
          </EvidenceArchive>
          <EvidenceArchive topic="businesses">
            {dto.broadSearchObservation && <BroadCompetitorEvidence observation={dto.broadSearchObservation} printExpanded={printExpanded} />}
            <div className="diagnostic-topic-content space-y-6">

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">OBSERVED BUSINESSES</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                {model.competitors.heading}
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
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
                      .slice(0, (showAllCompetitors || printExpanded) ? model.competitors.rows.length : 6)
                      .map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="text-sm font-medium">
                            {c.name}
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
                      setExpandedCompetitorBusinessId((showAllCompetitors || printExpanded) ? null : businessId)
                    }
                  >
                    {(showAllCompetitors || printExpanded) ? "접기" : `전체 ${model.competitors.rows.length}곳 보기`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>


            </div>
          </EvidenceArchive>
          <EvidenceArchive topic="sources">
            <div className="diagnostic-topic-content space-y-6">
          {benchmark && <BenchmarkCard benchmark={benchmark} basisLabel={detailBasisLabel} printExpanded={printExpanded} />}
            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  {model.sources.heading}
                  <BaselineBadge label={detailBasisLabel} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 overflow-x-auto">
                <p className="text-xs leading-5 text-muted-foreground">
                  먼저 인용 페이지 자체에서 내 업체 관련성이 확인된 출처를 보여드립니다.
                  AI 답변 안에서의 직접 연결·근접 단서는 별도 기준으로 구분하고, 같은 답변에 함께
                  인용됐을 뿐인 전체 출처는 참고용으로 접어둡니다.
                </p>

                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge
                    variant={verifiedTargetCitationPageCount > 0 ? "default" : "outline"}
                  >
                    페이지 내용 기준 관련 확인 {verifiedTargetCitationPageCount}개
                  </Badge>
                  <Badge variant={linkedTargetSourceCount > 0 ? "default" : "outline"}>
                    AI 답변 내 직접 연결 {linkedTargetSourceCount}개
                  </Badge>
                  <Badge variant="secondary">
                    AI 답변 내 근접 단서 {targetReferenceSources.length}개
                  </Badge>
                  <Badge
                    variant={targetExposureCitationSourceCount > 0 ? "secondary" : "outline"}
                  >
                    함께 인용된 전체 출처 {targetExposureCitationSourceCount}개 · 참고
                  </Badge>
                  <Badge variant="outline">
                    비교해볼 타업체 출처 {linkedCompetitorSourceCount}개
                  </Badge>
                </div>

                {!model.sources.available ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    이번 측정의 출처 진단 데이터가 아직 준비되지 않았습니다.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div>
                        <h3 className="text-sm font-semibold">
                          {model.verifiedTargetCitationPages.heading}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          AI가 실제 인용한 페이지 자체에서 내 업체의 업체명·지점·지역 또는
                          검증된 공식 출처 근거를 확인한 페이지입니다. 같은 답변에 함께 인용됐다는
                          이유만으로는 포함하지 않습니다.
                        </p>
                      </div>
                      {model.verifiedTargetCitationPages.status === "not_verified" ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이 측정에서는 인용 페이지 관련성 검증이 실행되지 않았습니다. 최근 측정은
                          측정 완료 후 자동으로 검증합니다.
                        </p>
                      ) : model.verifiedTargetCitationPages.status === "pending" ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          인용 페이지의 내 업체 관련성을 확인 중입니다. 기존 노출률과 출처 판정에는
                          영향이 없습니다.
                        </p>
                      ) : verifiedTargetCitationPages.length === 0 ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이번 측정에서는 페이지 자체에서 내 업체 관련성을 확정한 인용 출처가
                          확인되지 않았습니다.
                        </p>
                      ) : (
                        <>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>출처</TableHead>
                                <TableHead>확인된 페이지</TableHead>
                                <TableHead>확인 근거</TableHead>
                                <TableHead>노출 답변</TableHead>
                                <TableHead className="text-right">페이지</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {verifiedTargetCitationPages
                                .slice(
                                  0,
                                  (showAllVerifiedTargetCitationPages || printExpanded)
                                    ? verifiedTargetCitationPages.length
                                    : 6,
                                )
                                .map((source) => (
                                  <TableRow key={`verified-target-page:${source.sampleUrl}`}>
                                    <TableCell className="text-sm font-medium">
                                      {siteDisplayName(source.domain)}
                                      {siteDisplayName(source.domain) !== source.domain && (
                                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                          {source.domain}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="max-w-[280px] text-sm">
                                      <span className="line-clamp-2">
                                        {source.title ?? "페이지 제목 미확인"}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      <Badge
                                        variant={source.confidence === "high" ? "default" : "secondary"}
                                      >
                                        {source.basisLabel}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm tabular-nums">
                                      {source.responseCount}/
                                      {model.metricCards.visibility.confirmedCount}건
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <a
                                        href={source.sampleUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm text-primary underline-offset-4 hover:underline"
                                      >
                                        관련 페이지 보기 ↗
                                      </a>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                          {verifiedTargetCitationPages.length > 6 && (
                            <div className="flex justify-center pt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setExpandedVerifiedTargetCitationBusinessId(
                                    showAllVerifiedTargetCitationPages
                                      ? null
                                      : businessId,
                                  )
                                }
                              >
                                {showAllVerifiedTargetCitationPages
                                  ? "접기"
                                  : `전체 ${verifiedTargetCitationPages.length}개 관련 출처 보기`}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <div>
                        <h3 className="text-sm font-semibold">AI 답변 내 직접 연결된 출처</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          AI 답변 구조에서 내 업체와 citation의 직접·반복 연결 기준을 통과한 출처입니다.
                          여기에 포함합니다.
                        </p>
                      </div>
                      {linkedTargetSources.length === 0 ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이번 측정에서는 AI 답변 안에서 내 업체와 직접 연결된 출처가 확인되지 않았습니다.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>출처</TableHead>
                              <TableHead>확인된 답변</TableHead>
                              <TableHead>연결</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {linkedTargetSources.map((source) => (
                              <TableRow key={`target:${source.domain}`}>
                                <TableCell className="text-sm font-medium">
                                  {siteDisplayName(source.domain)}
                                  {siteDisplayName(source.domain) !== source.domain && (
                                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                      {source.domain}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                  {source.targetResponseCount}건
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="default">내 업체</Badge>
                                    {source.linkedEntities
                                      .filter((entity) => !entity.isTarget)
                                      .map((entity) => (
                                        <Badge
                                          key={`${source.domain}:${entity.name}:target-row`}
                                          variant="outline"
                                        >
                                          {entity.name} · {entity.responseCount}건
                                        </Badge>
                                      ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    {targetReferenceSources.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedTargetReferenceBusinessId(
                              showTargetReferenceSources ? null : businessId,
                            )
                          }
                        >
                          {showTargetReferenceSources
                            ? "AI 답변 내 근접 단서 접기"
                            : `AI 답변 내 근접 단서 ${targetReferenceSources.length}개 보기`}
                        </Button>
                        {(showTargetReferenceSources || printExpanded) && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                              AI 답변에서 내 업체명과 citation이 가까운 위치에서 관찰됐지만 반복 기준을 충족하지
                              않아 확정 연결에는 포함하지 않은 보조 증거입니다.
                            </p>
                            <div className="divide-y">
                              {targetReferenceSources.map((source) => (
                                <div
                                  key={`target-clue:${source.domain}`}
                                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                                >
                                  <div className="min-w-0">
                                    <span className="font-medium">
                                      {siteDisplayName(source.domain)}
                                    </span>
                                    {siteDisplayName(source.domain) !== source.domain && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {source.domain}
                                      </span>
                                    )}
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      AI 답변 {source.responseCount}건에서 단서
                                    </span>
                                  </div>
                                  <a
                                    href={source.sampleUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-primary underline-offset-4 hover:underline"
                                  >
                                    단서 페이지 예시 보기 ↗
                                  </a>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-2 border-t pt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const nextOpen = !showTargetExposureCitationSources;
                          setExpandedTargetExposureCitationBusinessId(
                            nextOpen ? businessId : null,
                          );
                          if (!nextOpen) {
                            setExpandedAllTargetExposureCitationBusinessId(null);
                          }
                        }}
                      >
                        {showTargetExposureCitationSources
                          ? "함께 인용된 전체 출처 접기"
                          : `함께 인용된 전체 출처 ${targetExposureCitationSourceCount}개 보기 · 참고`}
                      </Button>

                      {(showTargetExposureCitationSources || printExpanded) && (
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold">
                              함께 인용된 전체 출처
                            </h3>
                            <Badge variant="outline">
                              참고용 · 내 업체 노출 답변 기준
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            내 업체가 확정 노출된 {model.metricCards.visibility.confirmedCount}건의 답변에 실제
                            citation으로 함께 등장한 전체 출처입니다. 페이지 자체가 내 업체와 관련됐다는
                            뜻은 아니며 참고용 원본 관찰 자료입니다.
                          </p>

                          {!model.targetExposureCitationSources.available ? (
                            <p className="mt-3 rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                              내 업체 노출 답변의 인용 출처 집계를 불러오지 못했습니다. 확정 연결
                              판정에는 영향이 없습니다.
                            </p>
                          ) : targetExposureCitationSources.length === 0 ? (
                            <p className="mt-3 rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                              확정 노출된 답변에서는 실제 citation이 확인되지 않았습니다.
                            </p>
                          ) : (
                            <>
                              <Table className="mt-3">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>출처</TableHead>
                                    <TableHead>내 업체 노출 답변</TableHead>
                                    <TableHead>인용 횟수</TableHead>
                                    <TableHead className="text-right">예시</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {targetExposureCitationSources
                                    .slice(
                                      0,
                                      (showAllTargetExposureCitationSources || printExpanded)
                                        ? targetExposureCitationSources.length
                                        : 5,
                                    )
                                    .map((source) => (
                                      <TableRow key={`target-exposure:${source.domain}`}>
                                        <TableCell className="text-sm font-medium">
                                          {siteDisplayName(source.domain)}
                                          {siteDisplayName(source.domain) !== source.domain && (
                                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                              {source.domain}
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-sm tabular-nums">
                                          {source.responseCount}/
                                          {model.metricCards.visibility.confirmedCount}건
                                        </TableCell>
                                        <TableCell className="text-sm tabular-nums">
                                          {source.citationCount}회
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <a
                                            href={source.sampleUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-sm text-primary underline-offset-4 hover:underline"
                                          >
                                            인용 페이지 예시 보기 ↗
                                          </a>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>

                              {targetExposureCitationSources.length > 5 && (
                                <div className="flex justify-center pt-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setExpandedAllTargetExposureCitationBusinessId(
                                        showAllTargetExposureCitationSources
                                          ? null
                                          : businessId,
                                      )
                                    }
                                  >
                                    {showAllTargetExposureCitationSources
                                      ? "상위 5개만 보기"
                                      : `나머지 ${targetExposureCitationSources.length - 5}개 더 보기`}
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <div>
                        <h3 className="text-sm font-semibold">비교해볼 타업체 출처</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          홈페이지·업체 프로필·자동차 플랫폼처럼 실제 업체 비교에 활용하기 쉬운
                          확정 연결만 기본으로 보여드립니다.
                        </p>
                      </div>
                      {usefulCompetitorSources.length === 0 ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이번 측정에서는 기본 화면에 보여줄 타업체 비교 출처가 없습니다.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>출처</TableHead>
                              <TableHead>확인된 답변</TableHead>
                              <TableHead>연결된 업체</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {usefulCompetitorSources.map((source) => (
                              <TableRow key={`competitor:${source.domain}`}>
                                <TableCell className="text-sm font-medium">
                                  {siteDisplayName(source.domain)}
                                  {siteDisplayName(source.domain) !== source.domain && (
                                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                      {source.domain}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                  {source.competitorResponseCount}건
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div className="flex flex-wrap gap-1.5">
                                    {source.linkedEntities
                                      .filter((entity) => !entity.isTarget)
                                      .map((entity) => (
                                        <Badge
                                          key={`${source.domain}:${entity.name}:competitor-row`}
                                          variant="outline"
                                        >
                                          {entity.name} · {entity.responseCount}건
                                        </Badge>
                                      ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    {otherConfirmedSources.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedOtherConfirmedSourceBusinessId(
                              showOtherConfirmedSources ? null : businessId,
                            )
                          }
                        >
                          {showOtherConfirmedSources
                            ? "기타 확정 연결 접기"
                            : `기타 확정 연결 ${otherConfirmedSources.length}개 보기`}
                        </Button>
                        {(showOtherConfirmedSources || printExpanded) && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                              채용·공공·뉴스처럼 연결 자체는 확인됐지만 업체 비교에는 상대적으로
                              덜 유용한 출처입니다. 데이터에서는 유지하되 기본 화면에서는 강조하지
                              않습니다.
                            </p>
                            <div className="divide-y">
                              {otherConfirmedSources.map((source) => (
                                <div key={`other:${source.domain}`} className="py-2 text-sm">
                                  <span className="font-medium">{source.domain}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {source.competitorResponseCount}개 답변 ·{" "}
                                    {source.linkedEntities
                                      .filter((entity) => !entity.isTarget)
                                      .map((entity) => entity.name)
                                      .join(", ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {linkedClueSources.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedLinkedClueBusinessId(showLinkedClues ? null : businessId)
                          }
                        >
                          {showLinkedClues
                            ? "타업체 연결 단서 접기"
                            : `타업체 연결 단서 ${linkedClueSources.length}개 보기`}
                        </Button>
                        {(showLinkedClues || printExpanded) && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                              확정 연결 기준을 통과하지 않은 타업체 보조 단서입니다.
                            </p>
                            <div className="divide-y">
                              {linkedClueSources.map((source) => (
                                <div key={`competitor-clue:${source.domain}`} className="py-2 text-sm">
                                  <span className="font-medium">{source.domain}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    AI 답변 {source.clueResponseCount}건 ·{" "}
                                    {source.linkedEntities.map((entity) => entity.name).join(", ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">CITED SOURCES</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                {model.citationSources.heading}
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                이번 측정의 최종 AI 답변에 실제 citation으로 남은 출처를 도메인별로 묶었습니다.
                검색 과정에서만 참고된 후보 출처는 포함하지 않습니다. 위쪽일수록 더 많은 서로 다른
                AI 답변에서 반복 인용된 출처입니다. 특정 업체와 연결됐다는 뜻은 아니며, 아래
                ‘업체 연결까지 확인된 출처’에서 별도로 확인합니다.
              </p>
              <p className="mb-3 rounded-md bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground">
                ‘인용된 답변 수’는 이 출처가 한 번 이상 인용된 AI 답변 수이고, ‘전체 인용 횟수’는
                답변 안에서 확인된 citation의 합계입니다.
              </p>
              {model.citationSources.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  이번 측정의 최종 AI 답변에서 인용된 출처가 확인되지 않았습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>출처</TableHead>
                      <TableHead>인용된 답변 수</TableHead>
                      <TableHead>전체 인용 횟수</TableHead>
                      <TableHead className="text-right">예시</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.citationSources.rows
                      .slice(0, (showAllCitationSources || printExpanded) ? model.citationSources.rows.length : 8)
                      .map((source) => (
                        <TableRow key={source.domain}>
                          <TableCell className="text-sm font-medium">
                            {siteDisplayName(source.domain)}
                            {siteDisplayName(source.domain) !== source.domain && (
                              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                {source.domain}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {source.responseCount}개 답변
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {source.citationCount}회
                          </TableCell>
                          <TableCell className="text-right">
                            <a
                              href={source.sampleUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-primary underline-offset-4 hover:underline"
                            >
                              인용 페이지 예시 보기 ↗
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
              {model.citationSources.rows.length > 8 && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedCitationSourceBusinessId(
                        (showAllCitationSources || printExpanded) ? null : businessId,
                      )
                    }
                  >
                    {showAllCitationSources
                      ? "접기"
                      : `전체 ${model.citationSources.rows.length}개 출처 보기`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>


            </div>
          </EvidenceArchive>
          <EvidenceArchive topic="comparison">
            <div className="diagnostic-topic-content space-y-6">
          {comparisonModel && (
            <ComparisonCard model={comparisonModel} basisLabel={detailBasisLabel} />
          )}
          {(comparisonQuery.isError || (comparisonResult && !comparisonResult.ok)) && (
            <Card className="report-section">
              <CardContent className="py-5 text-sm text-muted-foreground">
                이전 측정 비교 정보를 불러오지 못했습니다. 최근 측정 결과에는 영향이 없습니다.
              </CardContent>
            </Card>
          )}


            </div>
          </EvidenceArchive>
          <EvidenceArchive topic="priorities">
            <div className="diagnostic-topic-content space-y-6">
          {actionOpportunityModel && (
            <ActionOpportunitySection
              model={actionOpportunityModel}
              evidenceExamples={actionEvidenceExamples}
              currentRunReferences={currentRunReferences}
              basisLabel={detailBasisLabel}
            />
          )}




            </div>
          </EvidenceArchive>
          <EvidenceArchive topic="method">
            <div className="diagnostic-topic-content space-y-6">
          <p className="border-b border-border pb-5 text-sm text-muted-foreground">
            분석에 사용한 유효 AI 답변 {model.recentSummary.validCount}건 · 최근 측정{" "}
            {formatSeoul(model.measuredAt)}
            {model.recentSummary.invalidCount > 0
              ? ` · 제외 ${model.recentSummary.invalidCount}건`
              : ""}
          </p>

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
              label="실제 인용 출처"
              value={
                dto.citationSources ? `${model.metricCards.citationSourceCount}개` : "준비 중"
              }
              note="이번 24개 AI 답변 전체의 인용 출처 수 · 내 업체 성과 점수는 아닙니다"
            />
          </div>

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">METHODOLOGY</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                분석 방법과 신뢰도
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
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

            </div>
          </EvidenceArchive>
          </DiagnosticEvidenceWorkspace></div>
        </>
      )}
    </div>
  );
}

function DashboardSummary({
  summary,
  actionDto,
  showQa,
  printExpanded,
  priority,
  questionAreas,
  intentOrder,
  questionLocations,
  scopeEvidenceAvailable,
  broadObservation,
  benchmark,
  customerEvidenceQaScope,
  onShowDetail,
  onReviewEvidence,
}: {
  summary: EntityFactsV2DashboardSummaryViewModel;
  actionDto: import("@/lib/entity-facts-v2-read-gateway.types").EntityFactsV2ReadGatewayDTO;
  showQa: boolean;
  printExpanded: boolean;
  priority: PriorityEvidence | null;
  questionAreas: readonly EntityFactsV2ReadQuestionAreaDTO[];
  intentOrder: readonly string[];
  questionLocations: readonly import("@/lib/entity-facts-v2-read-gateway.types").EntityFactsV2ReadQuestionLocationDTO[];
  scopeEvidenceAvailable: boolean;
  broadObservation: import("@/lib/entity-facts-v2-read-gateway.types").EntityFactsV2ReadBroadSearchObservationDTO | null;
  benchmark: import("@/lib/visibility-benchmark.types").VisibilityBenchmarkDTO | null;
  customerEvidenceQaScope?: V1CustomerQaScope | undefined;
  onShowDetail: (topic?: string) => void;
  onReviewEvidence?: ((insight: CompactSummaryInsight) => void) | undefined;
}) {

  const observations = buildCompactSummaryInsights(summary);
  const pageLabel =
    summary.verifiedPageStatus === "pending"
      ? "확인 중"
      : summary.verifiedPageStatus === "not_verified"
        ? "미검증"
        : summary.verifiedPageCount === null
          ? "확인 불가"
          : String(summary.verifiedPageCount) + "개";

  return (
    <section className="space-y-4" aria-label="사장님용 10초 요약">
      <DiagnosticSummaryLayout actionDto={actionDto} printExpanded={printExpanded} priority={priority} summary={summary} questions={questionAreas} intentOrder={intentOrder} locations={questionLocations} enabled={scopeEvidenceAvailable} observation={broadObservation} benchmark={benchmark}
        actionTitle={priority?.title ?? summary.opportunities[0]?.title ?? observations[0]?.title ?? "저장된 질문과 답변 확인"}
        actionEvidence={summary.opportunities[0]?.observation ?? observations[0]?.recommendedCheck ?? "현재 자료에서는 우선 확인할 대상을 정하기 어렵습니다."}
        onAction={() => onShowDetail(summary.opportunities.length > 0 ? "priorities" : observations[0]?.id === "repeated_competitor" ? "businesses" : observations[0]?.id.startsWith("verified_page") ? "sources" : "questions")}
        onTopic={onShowDetail} />
      {showQa && <details id="diagnostic-operator-qa" tabIndex={-1} className="diagnostic-topic" open>
        <summary><h2>요약 관찰·QA 원자료</h2><span className="text-base font-normal text-muted-foreground">전용 근거와 검토 도구</span></summary>
        <div className="diagnostic-topic-content space-y-5">
      <div className="grid gap-3 md:grid-cols-2" aria-label="이번 측정의 검색 상황과 관찰 업체">
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">어떤 종류의 질문에서 내 업체가 나왔나요?</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            질문 종류별 AI 답변에서 내 업체가 등장한 횟수입니다.
          </p>
          {summary.searchContexts.length > 0 ? (
            <dl className="mt-3 space-y-3">
              {summary.searchContexts.slice(0, 3).map((context) => (
                <div key={context.intentType}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">
                      {ownerSearchContextLabel(context.intentType)}
                    </dt>
                    <dd className="text-xs font-medium tabular-nums text-foreground/85">
                      {ownerSearchContextAnswerText(context.confirmedCount, context.validCount)}
                    </dd>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={
                      ownerSearchContextLabel(context.intentType) + ": " +
                      ownerSearchContextAnswerText(context.confirmedCount, context.validCount)
                    }
                    aria-valuemin={0}
                    aria-valuemax={context.validCount}
                    aria-valuenow={context.confirmedCount}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: (
                          context.validCount > 0
                            ? Math.max(0, Math.min(100, 100 * context.confirmedCount / context.validCount))
                            : 0
                        ) + "%",
                      }}
                    />
                  </div>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {summary.visibility.count === 0
                ? "이번 측정에서 확정 노출된 질문 유형이 없습니다."
                : "질문 유형별 확정 결과를 확인할 수 없습니다."}
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            업체가 등장한 질문 유형 중 최대 3개만 표시합니다. 전체 결과는 상세 분석에서 볼 수 있습니다.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-base font-semibold">이번 측정에서 관찰된 다른 업체</h3>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <p className="text-3xl font-bold tabular-nums sm:text-4xl">
              {summary.competitorCount}곳
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              이번 AI 답변에서 확인된 다른 업체 수
            </p>
          </div>
          {summary.topCompetitors.length > 0 ? (
            <div className="mt-4 border-t pt-3">
              <p className="text-sm font-semibold">답변에서 자주 관찰된 업체</p>
              <ol className="mt-3 space-y-3">
                {summary.topCompetitors.map((competitor) => (
                  <li key={competitor.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-sm font-medium">
                        {competitor.name}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {competitor.responseCount}
                        {summary.visibility.total !== null
                          ? "/" + summary.visibility.total
                          : "개 답변"}
                      </span>
                    </div>
                    {summary.visibility.total !== null && summary.visibility.total > 0 && (
                      <div
                        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label={
                          competitor.name + ": " + competitor.responseCount +
                          "/" + summary.visibility.total + "개 답변에서 관찰"
                        }
                        aria-valuemin={0}
                        aria-valuemax={summary.visibility.total}
                        aria-valuenow={competitor.responseCount}
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: percentOf(competitor.responseCount, summary.visibility.total) + "%",
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                관찰 횟수 기준 최대 3곳입니다. 업체의 실제 경쟁력이나
                AI 추천 순위를 뜻하지 않습니다.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {summary.competitorCount === 0
                ? "이번 측정에서 별도로 확인된 다른 업체가 없습니다."
                : "업체별 관찰 횟수를 확인할 수 없습니다. 상세 분석에서 확인해 주세요."}
            </p>
          )}
        </div>
      </div>

      {summary.heroVariant !== "not_visible" && <div
        className="rounded-lg border bg-card px-4 py-4 sm:px-5"
        aria-label="이번 측정의 인용 페이지 검증"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">내 업체 관련성이 확인된 인용 페이지</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {summary.verifiedPageStatus === "complete" && summary.verifiedPageCount !== null
                ? "이번 측정에서 인용된 페이지 중 업체·지점 관련성이 확인된 페이지입니다. 인터넷 전체의 업체 페이지 수는 아닙니다."
                : summary.verifiedPageStatus === "pending"
                  ? "이번 측정에서 인용된 페이지의 업체 관련성을 확인 중입니다."
                  : summary.verifiedPageStatus === "not_verified"
                    ? "이번 측정에서는 인용 페이지 관련성 검증이 실행되지 않았습니다."
                    : "현재 인용 페이지 관련성 결과를 확인할 수 없습니다."}
            </p>
          </div>
          <p className="shrink-0 text-2xl font-semibold tabular-nums">{pageLabel}</p>
        </div>
      </div>}

      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <h3 className="font-semibold">
          {observations.length > 0
            ? "이번 측정에서 확인할 " + observations.length + "가지"
            : "이번 측정에서 확인할 내용"}
        </h3>
        {observations.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            지금 확인 가능한 결과에는 별도로 강조할 관찰 항목이 없습니다.
            자세한 데이터와 확인 항목은 상세 분석에서 확인할 수 있습니다.
          </p>
        ) : (
          <div className="mt-3 divide-y">
            {observations.map((item) => (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold leading-6">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {item.recommendedCheck}
                </p>
                {customerEvidenceQaScope && isCustomerEvidenceInsightId(item.id) && (
                  <ActionOpportunityV1AdminOwnerDrilldown
                    key={`${customerEvidenceQaScope.userId}:${customerEvidenceQaScope.orgId}:${customerEvidenceQaScope.businessId}:${customerEvidenceQaScope.runId}:${item.id}`}
                    scope={customerEvidenceQaScope}
                    insightId={item.id}
                    adminAllowed={true}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {onReviewEvidence && observations.some((item) => v1RuleForOwnerSummaryInsight(item.id)) && (
          <details className="no-print mt-3 border-t pt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              관리자 상세 검수 도구
            </summary>
            <div className="mt-2 flex flex-col items-start gap-1">
              {observations
                .filter((item) => v1RuleForOwnerSummaryInsight(item.id))
                .map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto whitespace-normal px-0 py-1 text-left text-xs"
                    onClick={() => onReviewEvidence(item)}
                  >
                    {item.title} · 내부 근거 검수
                  </Button>
                ))}
            </div>
          </details>
        )}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          관찰 결과의 차이는 특정 업체·출처가 노출에 영향을 준 원인이나 개선 효과를 의미하지 않습니다.
        </p>
      </div>

        </div>
      </details>}
      <div className="no-print flex flex-col items-center gap-2 pt-2 text-center">
        <Button type="button" size="lg" onClick={() => onShowDetail("questions")}>
          상세 분석 보기
          <ArrowRight aria-hidden="true" />
        </Button>
        <p className="text-xs text-muted-foreground">
          검색 상황·인용 페이지·경쟁업체·재측정 비교를 자세히 확인할 수 있습니다.
        </p>
      </div>
    </section>
  );
}

function BaselineBadge({ label = "기본 진단 기준" }: { label?: string }) {
  return (
    <Badge
      variant="outline"
      className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
    >
      {label}
    </Badge>
  );
}

function ActionOpportunitySection({
  model,
  evidenceExamples,
  currentRunReferences,
  basisLabel,
}: {
  model: ReturnType<typeof buildActionOpportunityEngineV01>;
  basisLabel: string;
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
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {model.heading}
          <BaselineBadge label={basisLabel} />
        </CardTitle>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{model.description}</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {model.items.length === 0 ? (
          <p className="rounded-md border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
            현재 데이터에서는 근거가 충분한 출처 연결 차이를 찾지 못했습니다. 의미가 약한 차이는
            억지로 보여주지 않습니다.
          </p>
        ) : (
          <div
            className={
              model.items.length === 1
                ? "grid gap-4"
                : model.items.length === 2
                  ? "grid gap-4 lg:grid-cols-2"
                  : "grid gap-4 lg:grid-cols-3"
            }
          >
            {model.items.map((item) => {
              const sameChannelExamples = item.sites.flatMap((site) => {
                const normalizedDomain = site.domain?.toLowerCase().replace(/^www\./, "");
                const currentReference = currentRunReferences.find(
                  (reference) =>
                    normalizedDomain &&
                    reference.domain === normalizedDomain &&
                    reference.entities.length > 0,
                );
                if (!currentReference?.entities[0]) return [];
                return [
                  {
                    siteLabel: site.label,
                    entityName: currentReference.entities[0].entityName,
                    url: currentReference.entities[0].url,
                  },
                ];
              });
              const sameChannelEntityKeys = new Set(
                sameChannelExamples.map((example) => normalizeQuestion(example.entityName)),
              );
              const seenEvidenceExamples = new Set<string>();
              const dedupedEvidenceExamples = evidenceExamples
                .filter((example) => example.sourceGroupKey === item.sourceGroupKey)
                .filter((example) => !lowValueComparisonSourceDomain(example.domain))
                .filter((example) => !sameChannelEntityKeys.has(normalizeQuestion(example.entityName)))
                .filter((example) => {
                  const key = `${normalizeQuestion(example.entityName)}|${example.url}`;
                  if (seenEvidenceExamples.has(key)) return false;
                  seenEvidenceExamples.add(key);
                  return true;
                })
                .slice(0, 2);

              return (
              <div key={item.sourceGroupKey} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {item.evidenceScope === "category" ? "같은 업종 관찰" : "전체 자동차 관찰"}
                  </Badge>
                </div>

                <p className="mt-3 text-base font-semibold leading-6">{item.title}</p>

                <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-sm font-semibold leading-6">
                    AI에 자주 관찰된 업체 {item.highVisibilityEntityCount}곳 중 {item.highEntityCount}
                    곳에서 관찰
                    {item.highEntitySharePct !== null
                      ? ` · ${item.highEntitySharePct.toFixed(1)}%`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">내 업체 연결 미확인</p>
                </div>

                <div className="mt-4 space-y-3">
                  {sameChannelExamples.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">실제로 비교할 수 있는 같은 채널 사례</p>
                      <div className="mt-2 space-y-2">
                        {sameChannelExamples.map((example) => (
                          <a
                            key={`${example.siteLabel}:${example.entityName}:${example.url}`}
                            href={example.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                          >
                            <span className="font-medium">{example.siteLabel}</span>
                            <span className="ml-2 text-muted-foreground">
                              {example.entityName} · 실제 페이지 보기 ↗
                            </span>
                          </a>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        이번 측정에서 다른 업체와 확정 연결된 동일 채널만 표시합니다.
                      </p>
                    </div>
                  )}

                  {dedupedEvidenceExamples.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">실제 비교해볼 업체 사례</p>
                      <div className="mt-2 space-y-1.5">
                        {dedupedEvidenceExamples.map((example) => (
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
                        위 동일 채널 사례와 겹치지 않는 다른 업체 사례만 표시합니다. 직접 비교용
                        참고 사례이며, 해당 페이지가 노출의 원인임을 의미하지 않습니다.
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

              </div>
              );
            })}
          </div>
        )}

        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {model.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}

function ComparisonCard({
  model,
  basisLabel,
}: {
  model: ReturnType<typeof buildEntityFactsV2ComparisonViewModel>;
  basisLabel: string;
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
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {model.heading}
          <BaselineBadge label={basisLabel} />
        </CardTitle>
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

        {model.searchScope && (
          <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
            <div>
              <p className="text-sm font-semibold">검색 범위별 변화</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                같은 통합 24문항에서 상세 조건 검색과 넓은 범위 검색의 확정 노출만 따로 비교합니다.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[model.searchScope.custom, model.searchScope.core].map((metric) => (
                <div key={metric.label} className="rounded-md border bg-card p-3">
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-xl font-semibold tabular-nums">
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
                    <p className="mt-2 text-sm leading-6">{metric.comparisonSentence}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-sm">
              새로 확정된 질문{" "}
              <span className="font-semibold tabular-nums">
                {model.searchScope.newlyConfirmedQuestionCount}개
              </span>
              {" · "}
              이전에는 확정됐지만 이번 측정에서 확정되지 않은 질문{" "}
              <span className="font-semibold tabular-nums">
                {model.searchScope.noLongerConfirmedQuestionCount}개
              </span>
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              동일한 질문 세트와 측정 조건이 확인된 두 측정의 확정 여부만 비교합니다. 변화의 원인을
              의미하지 않습니다.
            </p>
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
  basisLabel,
  printExpanded = false,
}: {
  printExpanded?: boolean;
  basisLabel: string;
  benchmark: NonNullable<
    Extract<Awaited<ReturnType<typeof getVisibilityBenchmark>>, { ok: true }>["benchmark"]
  >;
}) {
  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">MARKET BENCHMARK</p>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          AI에 자주 관찰되는 업체들은 어떤 출처와 함께 보일까요?
          <BaselineBadge label={basisLabel} />
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
          <BenchmarkSourceEvidence benchmark={benchmark} printExpanded={printExpanded} />
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

function CustomQuestionRow({ q }: { q: CustomDiagnosticQuestionDTO }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm leading-6">{q.promptText}</p>
        <p className="text-xs text-muted-foreground">{intentLabel(q.intentType)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {q.status === "confirmed" && <Badge>확정 노출</Badge>}
        {q.status === "unresolved" && <Badge variant="secondary">추가 확인</Badge>}
        {q.status === "missing" && <Badge variant="outline">이번 측정에서 확인되지 않음</Badge>}
        {q.position !== null && (
          <span className="text-xs text-muted-foreground">{q.position}번째로 관찰</span>
        )}
      </div>
    </li>
  );
}

function CustomDiagnosticSection({
  isLoading,
  isError,
  loaded,
  data,
  questionsReady,
}: {
  isLoading: boolean;
  isError: boolean;
  loaded: boolean;
  data: CustomDiagnosticDTO | null;
  questionsReady: boolean;
}) {
  const [showAllMissing, setShowAllMissing] = useState(false);
  const confirmed = data?.questions.filter((q) => q.status === "confirmed") ?? [];
  const unresolved = data?.questions.filter((q) => q.status === "unresolved") ?? [];
  const missing = data?.questions.filter((q) => q.status === "missing") ?? [];
  const visibleMissing = showAllMissing ? missing : missing.slice(0, 3);

  return (
    <Card className="border-primary/50 shadow-sm">
      <CardHeader className="space-y-2">
        <p className="report-kicker">CUSTOM DIAGNOSTIC</p>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-2xl">내 업체 맞춤 진단</CardTitle>
          <Badge>대표 진단</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          내가 중요하게 설정한 검색 질문에서 AI가 내 업체를 얼마나 보여주는지 확인합니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && <Skeleton className="h-32" />}
        {!isLoading && isError && (
          <p className="text-sm text-muted-foreground">
            맞춤 진단을 불러오지 못했습니다. 기본 진단에는 영향이 없습니다.
          </p>
        )}
        {!isLoading && !isError && loaded && !data && (
          <div className="space-y-3 py-4 text-center">
            {questionsReady ? (
              <>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <p className="font-medium">통합 AI 진단 질문 24개가 준비되었습니다.</p>
                  <Badge variant="outline">첫 측정 필요</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  질문 생성은 완료되었습니다. 위의 ‘첫 통합 진단 측정하기’에서 첫 측정을 진행하세요.
                </p>
                <Button asChild variant="outline">
                  <Link to="/questions">질문 확인·수정</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">아직 완료된 맞춤 진단이 없습니다.</p>
                <p className="text-sm text-muted-foreground">
                  내 업체에서 중요하게 보는 검색 질문을 먼저 설정해 보세요.
                </p>
                <Button asChild>
                  <Link to="/questions">내 업체 맞춤 진단 만들기</Link>
                </Button>
              </>
            )}
          </div>
        )}
        {data && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">확정 노출</p>
                <p className="text-4xl font-bold tabular-nums">
                  {data.confirmedCount} / {data.validCount}
                  <span className="ml-3 text-2xl text-primary">
                    {data.confirmedPct === null ? "-" : `${data.confirmedPct.toFixed(1)}%`}
                  </span>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  유효 질문 {data.validCount}개 중 확정 노출 {data.confirmedCount}개
                  {data.unresolvedCount > 0 && ` · 추가 확인 ${data.unresolvedCount}개`}
                  {data.missingCount > 0 && ` · 이번 측정에서 미확인 ${data.missingCount}개`}
                </p>
              </div>
              <div className="min-w-0 text-xs text-muted-foreground sm:text-right">
                <p>{formatSeoul(data.measuredAt)}</p>
                <p className="truncate" title={data.questionSetName}>
                  {data.questionSetName}
                </p>
              </div>
            </div>

            {confirmed.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">확인된 질문</h3>
                <ul className="divide-y">
                  {confirmed.map((q) => (
                    <CustomQuestionRow key={q.questionId} q={q} />
                  ))}
                </ul>
              </div>
            )}
            {unresolved.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">추가 확인이 필요한 질문</h3>
                <ul className="divide-y">
                  {unresolved.map((q) => (
                    <CustomQuestionRow key={q.questionId} q={q} />
                  ))}
                </ul>
              </div>
            )}
            {missing.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">
                  이번 측정에서 확인되지 않은 질문 {missing.length}개
                </h3>
                <ul className="divide-y">
                  {visibleMissing.map((q) => (
                    <CustomQuestionRow key={q.questionId} q={q} />
                  ))}
                </ul>
                {missing.length > 3 && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAllMissing((v) => !v)}>
                    {showAllMissing ? "접기" : `전체 ${missing.length}개 보기`}
                  </Button>
                )}
              </div>
            )}
            {data.invalidCount > 0 && (
              <p className="text-xs text-muted-foreground">
                응답을 확인할 수 없었던 질문 {data.invalidCount}개는 집계에서 제외했습니다.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
