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
          "여러 고객 질문에서 업체가 AI 답변에 관찰된 노출 상태, 질문군별 강약, 대신 등장한 경쟁업체와 인용 출처를 확인하는 진단 대시보드.",
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

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : `${value.toFixed(1)}%`;
}

const STANDING_LABEL: Record<string, string> = {
  strong: "상대적 강점",
  weak: "우선 점검",
  mixed: "혼합",
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
  const diagnostic: VisibilityDiagnosticDTO | null =
    result && result.ok ? result.diagnostic : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI 노출 진단</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            동일 조건으로 반복 측정한 AI 검색 결과에서 관찰된 노출 상태를 요약합니다. 특정 작업이
            노출을 올린다는 의미는 아니며, 관찰된 값과 우선 점검 영역만 보여줍니다.
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

      {diagnostic && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="전체 AI 노출률"
              value={pct(diagnostic.summary.exposure_rate_pct)}
              note={
                diagnostic.summary.exposed_measurement_count !== null
                  ? `노출 ${diagnostic.summary.exposed_measurement_count}회 / 유효 ${diagnostic.summary.valid_measurement_count}회`
                  : null
              }
            />
            <MetricCard label="Top3 노출률" value={pct(diagnostic.summary.top3_rate_pct)} note="답변 상위 3순위 내 관찰" />
            <MetricCard
              label="노출 질문 비율"
              value={pct(diagnostic.summary.exposed_question_rate_pct)}
              note={
                diagnostic.summary.question_count !== null
                  ? `질문 ${diagnostic.summary.exposed_question_count ?? 0} / ${diagnostic.summary.question_count}개`
                  : null
              }
            />
            <MetricCard
              label="유효 측정 수"
              value={String(diagnostic.summary.valid_measurement_count)}
              note={
                diagnostic.latest_observed_at
                  ? `최근 측정 ${formatSeoul(diagnostic.latest_observed_at)}`
                  : null
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">질문군별 노출 상태</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {diagnostic.clusters.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    질문군 요약이 아직 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>질문군</TableHead>
                        <TableHead>질문 수</TableHead>
                        <TableHead>노출률</TableHead>
                        <TableHead>상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diagnostic.clusters.map((c) => (
                        <TableRow key={c.label}>
                          <TableCell className="text-sm">{c.label}</TableCell>
                          <TableCell className="text-sm tabular-nums">{c.question_count}</TableCell>
                          <TableCell className="text-sm tabular-nums">{pct(c.exposure_rate_pct)}</TableCell>
                          <TableCell>
                            {c.standing ? (
                              <Badge variant={c.standing === "weak" ? "destructive" : "secondary"}>
                                {STANDING_LABEL[c.standing]}
                              </Badge>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
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
                {diagnostic.competitors.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    확정된 경쟁업체 언급이 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>업체</TableHead>
                        <TableHead>등장 답변 수</TableHead>
                        <TableHead>답변 점유율</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diagnostic.competitors.map((c) => (
                        <TableRow key={c.display_name}>
                          <TableCell className="text-sm">{c.display_name}</TableCell>
                          <TableCell className="text-sm tabular-nums">{c.response_count}</TableCell>
                          <TableCell className="text-sm tabular-nums">{pct(c.share_pct)}</TableCell>
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
                {diagnostic.sources.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    인용 출처 정보가 없습니다.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>도메인</TableHead>
                        <TableHead>구분</TableHead>
                        <TableHead>인용 수</TableHead>
                        <TableHead>비중</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diagnostic.sources.map((s) => (
                        <TableRow key={s.domain}>
                          <TableCell className="text-sm">{s.domain}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {s.source_type ?? "-"}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{s.citation_count}</TableCell>
                          <TableCell className="text-sm tabular-nums">{pct(s.share_pct)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">우선 점검 질문·영역</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {diagnostic.priorities.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    우선 점검 항목이 없습니다.
                  </p>
                ) : (
                  diagnostic.priorities.map((p, i) => (
                    <div key={`${p.title}-${i}`} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{p.title}</p>
                        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {pct(p.exposure_rate_pct)}
                        </span>
                      </div>
                      {p.cluster_label && (
                        <p className="mt-1 text-xs text-muted-foreground">{p.cluster_label}</p>
                      )}
                      {p.detail && <p className="mt-2 text-sm text-muted-foreground">{p.detail}</p>}
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
              {diagnostic.trend.length >= 2 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={diagnostic.trend.map((t) => ({
                        시점: formatSeoul(t.observed_at),
                        노출률: t.exposure_rate_pct ?? 0,
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
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    비교할 이전 측정 시점이 아직 없습니다. 현재 1개 시점 상태만 표시합니다.
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {pct(
                      diagnostic.trend[0]?.exposure_rate_pct ??
                        diagnostic.summary.exposure_rate_pct,
                    )}
                  </p>
                  {diagnostic.latest_observed_at && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatSeoul(diagnostic.latest_observed_at)} 기준
                    </p>
                  )}
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
