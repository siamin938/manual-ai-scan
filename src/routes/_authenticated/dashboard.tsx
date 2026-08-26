import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { getVisibilityDiagnostic } from "@/lib/visibility-diagnostic.functions";
import type { VisibilityDiagnosticDTO } from "@/lib/visibility-diagnostic.types";
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

const STATUS_LABEL: Record<"missing" | "partial", string> = {
  missing: "미노출",
  partial: "부분 노출",
};

function DashboardPage() {
  const { activeOrgId } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const fetchDiagnostic = useServerFn(getVisibilityDiagnostic);

  const businessId = businesses.selectedBusinessId;

  const query = useQuery({
    queryKey: ["visibility-diagnostic", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchDiagnostic({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });

  const result = query.data;
  const payload: VisibilityDiagnosticDTO | null = result && result.ok ? result.diagnostic : null;
  const d = payload?.diagnostic ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI 노출 진단</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            동일 조건으로 반복 측정한 AI 검색 결과에서 관찰된 노출 상태를 요약합니다. 특정 작업이
            노출을 올린다는 의미는 아니며, 관찰된 값과 우선 점검 대상만 보여줍니다.
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
              note={`노출 ${d.overview.mentionCount}회 / 유효 ${d.overview.validCount}회`}
            />
            <MetricCard
              label="Top3 노출률"
              value={pct(d.overview.top3RatePct)}
              note={`Top3 ${d.overview.top3Count}회`}
            />
            <MetricCard
              label="노출 질문 비율"
              value={pct(d.overview.questionCoverageRatePct)}
              note={`질문 ${d.overview.coveredQuestionCount} / ${d.overview.questionCount}개`}
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

          {(d.dataQuality.measurementRowsCapped || d.dataQuality.sourceRowsCapped) && (
            <p className="text-xs text-muted-foreground">
              이번 진단은 조회 상한에 도달해 일부 기록만 사용했습니다.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">질문군별 노출 상태</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
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
                          <TableCell className="text-sm">{g.intentType}</TableCell>
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
                <CardTitle className="text-base">대신 등장한 경쟁업체</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {d.competitors.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    확정된 경쟁업체 언급이 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>업체</TableHead>
                        <TableHead>등장 답변 수</TableHead>
                        <TableHead>언급 수</TableHead>
                        <TableHead>답변 비율</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.competitors.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="text-sm">{c.name}</TableCell>
                          <TableCell className="text-sm tabular-nums">{c.responseCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">{c.mentionCount}</TableCell>
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
                <CardTitle className="text-base">자주 인용된 출처 도메인</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
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
                <CardTitle className="text-base">우선 점검 질문</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {d.priorityAreas.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    우선 점검 항목이 없습니다.
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
                        {p.intentType} · 측정 {p.measurementCount}회 · 노출 {p.mentionCount}회 ·
                        노출률 {pct(p.visibilityRatePct)}
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
            표시된 값은 반복 측정된 AI 검색 결과에서 관찰된 상태이며, 모든 사용자가 같은 답변을
            보게 된다는 뜻은 아닙니다. 개선 효과를 보장하지 않습니다.
          </p>
        </>
      )}
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
