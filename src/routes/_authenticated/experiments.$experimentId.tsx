import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  getExperimentDetail,
  type ExperimentDetailDTO,
} from "@/lib/experiments.detail.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/experiments/$experimentId")({
  head: () => ({
    meta: [
      { title: "실험 상세 · AI Visibility Lab" },
      {
        name: "description",
        content: "변경 전·후 측정 결과를 같은 조건에서 비교해 방향성을 확인하는 실험 상세 화면입니다.",
      },
      { property: "og:title", content: "실험 상세 · AI Visibility Lab" },
      {
        property: "og:description",
        content: "변경 전·후 측정 결과를 같은 조건에서 비교해 방향성을 확인합니다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExperimentDetailPage,
});

const SOURCE_LABELS: Record<string, string> = {
  profile_coverage_item: "프로필 커버리지",
  insight_action: "AI 인사이트",
  unknown: "기타",
};

const OUTCOME_LABELS: Record<string, string> = {
  improved_signal: "개선 방향성 관찰",
  worsened_signal: "악화 방향성 관찰",
  no_clear_change: "뚜렷한 변화 없음",
  directional_improvement: "개선 방향성 관찰",
  directional_decline: "악화 방향성 관찰",
};

function stageLabel(d: ExperimentDetailDTO): string {
  if (d.evaluatedAt || d.status === "completed") return "실험 완료";
  if (d.followup.finalized) return "결과 비교 대기";
  if (d.followup.runId && d.followup.runStatus === "completed") return "Follow-up 확정 필요";
  if (d.followup.runId) return "Follow-up 측정 중";
  if (d.actionAppliedAt) return "Follow-up 대기";
  if (d.baseline.finalized) return "변경 적용 대기";
  if (d.baseline.runId && d.baseline.runStatus === "completed") return "Baseline 확정 필요";
  if (d.baseline.runId) return "Baseline 측정 중";
  return "초안";
}

const DASH = "—";

function pct(v: number | null): string {
  return v === null ? DASH : `${(v * 100).toFixed(1)}%`;
}
function pp(v: number | null): string {
  return v === null ? DASH : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%p`;
}
function num(v: number | null, digits = 2): string {
  return v === null ? DASH : v.toFixed(digits);
}
function signedNum(v: number | null, digits = 2): string {
  return v === null ? DASH : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function ExperimentDetailPage() {
  const { experimentId } = Route.useParams();
  const { activeOrgId } = useOrg();
  const fetchDetail = useServerFn(getExperimentDetail);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["experiment-detail", activeOrgId, experimentId],
    enabled: !!activeOrgId,
    queryFn: () => fetchDetail({ data: { orgId: activeOrgId!, experimentId } }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || (data && !data.ok)) {
    const notFound = data && !data.ok && data.error === "NOT_FOUND";
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>{notFound ? "실험을 찾을 수 없습니다" : "불러오지 못했습니다"}</AlertTitle>
          <AlertDescription>
            {notFound
              ? "삭제되었거나 접근 권한이 없는 실험입니다."
              : "잠시 후 다시 시도해주세요."}
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to="/experiments">실험 목록으로</Link>
        </Button>
      </div>
    );
  }

  if (!data || !data.ok) return null;
  const d = data.detail;
  const b = d.baselineMetrics;
  const f = d.followupMetrics;
  const delta = d.delta;

  const rows: { label: string; base: string; follow: string; change: string }[] = [
    {
      label: "AI 답변 포함률",
      base: b ? `${pct(b.inclusionRate)} (${b.inclusionCount}/${b.validCount})` : DASH,
      follow: f ? `${pct(f.inclusionRate)} (${f.inclusionCount}/${f.validCount})` : DASH,
      change: pp(delta?.inclusionPp ?? null),
    },
    {
      label: "상위 3순위 노출률",
      base: b ? `${pct(b.top3Rate)} (${b.top3Count})` : DASH,
      follow: f ? `${pct(f.top3Rate)} (${f.top3Count})` : DASH,
      change: pp(delta?.top3Pp ?? null),
    },
    {
      label: "경쟁사 대체 노출률",
      base: b ? `${pct(b.substitutionRate)} (${b.substitutionCount})` : DASH,
      follow: f ? `${pct(f.substitutionRate)} (${f.substitutionCount})` : DASH,
      change: pp(delta?.substitutionPp ?? null),
    },
    {
      label: "자사 도메인 인용률",
      base: b ? `${pct(b.domainCitedRate)} (${b.domainCitedCount})` : DASH,
      follow: f ? `${pct(f.domainCitedRate)} (${f.domainCitedCount})` : DASH,
      change: pp(delta?.domainCitationPp ?? null),
    },
    {
      label: "평균 노출 순위 (낮을수록 좋음)",
      base: b ? num(b.averagePosition) : DASH,
      follow: f ? num(f.averagePosition) : DASH,
      change: signedNum(delta?.averagePositionDelta ?? null),
    },
  ];

  const timeline = [
    { label: "Baseline 확정", at: d.baseline.finalized ? d.baseline.endAt : null },
    { label: "변경 적용", at: d.actionAppliedAt },
    { label: "Follow-up 확정", at: d.followup.finalized ? d.followup.endAt : null },
    { label: "결과 확정", at: d.evaluatedAt },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{d.name}</h1>
          <Badge variant="secondary">{SOURCE_LABELS[d.sourceType] ?? "기타"}</Badge>
          <Badge>{stageLabel(d)}</Badge>
          <span className="text-xs text-muted-foreground">{d.businessName ?? "업체 미상"}</span>
        </div>
        {d.sourceTitle && <p className="text-sm text-muted-foreground">원본: {d.sourceTitle}</p>}
        <Alert>
          <AlertTitle>해석 주의</AlertTitle>
          <AlertDescription>
            이 결과는 동일한 측정 조건에서 변경 전후에 관찰된 방향성이며, 인과관계를 확정하지
            않습니다.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to="/experiments">실험 목록으로</Link>
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">진행 타임라인</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {timeline.map((t) => (
              <li key={t.label} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className="text-sm">{t.at ? formatSeoul(t.at) : "대기"}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {(d.evaluatedAt || d.resultClassification) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">확정 결과</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">결과</p>
              <p>
                {OUTCOME_LABELS[d.resultClassification ?? ""] ?? d.resultClassification ?? DASH}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">증거 등급</p>
              <p>{d.evidenceGrade ?? DASH}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">확정 시각</p>
              <p>{d.evaluatedAt ? formatSeoul(d.evaluatedAt) : DASH}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">변경 전·후 비교</CardTitle>
        </CardHeader>
        <CardContent>
          {!b ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 집계할 Baseline 측정 데이터가 없습니다.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>지표</TableHead>
                  <TableHead>변경 전(Baseline)</TableHead>
                  <TableHead>변경 후(Follow-up)</TableHead>
                  <TableHead>변화</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>{r.base}</TableCell>
                    <TableCell>{r.follow}</TableCell>
                    <TableCell>{r.change}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[
          { title: "Baseline 데이터 품질", m: b },
          { title: "Follow-up 데이터 품질", m: f },
        ].map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {card.m ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">유효 측정 수</dt>
                    <dd>{card.m.validCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">수동 검토 필요</dt>
                    <dd>{card.m.manualReviewCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">파서 버전</dt>
                    <dd>{card.m.parserVersion ?? "혼재"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">모델</dt>
                    <dd>{card.m.providerModel ?? "혼재"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{DASH}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {d.questionRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">질문별 포함 횟수</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>질문</TableHead>
                  <TableHead>변경 전 포함</TableHead>
                  <TableHead>변경 후 포함</TableHead>
                  <TableHead>변화</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.questionRows.map((q) => (
                  <TableRow key={q.questionId}>
                    <TableCell className="max-w-[420px] text-sm">{q.promptSnippet}</TableCell>
                    <TableCell>
                      {q.baselineInclusionCount}/{q.baselineValidCount}
                    </TableCell>
                    <TableCell>
                      {q.followupValidCount === null
                        ? DASH
                        : `${q.followupInclusionCount}/${q.followupValidCount}`}
                    </TableCell>
                    <TableCell>
                      {q.deltaCount === null
                        ? DASH
                        : `${q.deltaCount > 0 ? "+" : ""}${q.deltaCount}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {d.interventionDescription && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">적용 변경 내용</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {d.interventionDescription}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
