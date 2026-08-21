import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  getInsightOverview,
  type InsightActionDTO,
  type InsightFindingDTO,
} from "@/lib/insights.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "AI 인사이트 · AI Visibility Lab" },
      {
        name: "description",
        content: "AI 검색 측정 데이터를 분석해 노출 문제와 우선 테스트 행동을 보여주는 인사이트 대시보드입니다.",
      },
      { property: "og:title", content: "AI 인사이트 · AI Visibility Lab" },
      { property: "og:description", content: "Insight Engine 분석 결과 대시보드" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InsightsPage,
});

const GRADE_LABELS: Record<string, string> = {
  directional: "방향성",
  supported: "근거 있음",
  strong: "강한 근거",
  confirmed: "확인됨",
};

const FINDING_TYPE_LABELS: Record<string, string> = {
  visibility_gap: "노출 공백",
  competitor_substitution: "경쟁업체 대체",
  question_sensitivity: "질문 민감도",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  visibility_gap_test: "노출 공백 테스트",
  competitor_substitution_test: "경쟁업체 대체 테스트",
  question_sensitivity_test: "질문 반응 테스트",
};

function gradeLabel(g?: string | null) {
  if (!g) return "-";
  return GRADE_LABELS[g] ?? g;
}

function priorityLabel(score: number) {
  if (score >= 60) return "높은 우선순위";
  if (score >= 40) return "중간 우선순위";
  return "관찰 필요";
}

function priorityVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 60) return "default";
  if (score >= 40) return "secondary";
  return "outline";
}

function pct(n: number | null) {
  if (n === null) return null;
  return `${Math.round(n * 1000) / 10}%`;
}

function InsightsPage() {
  const { activeOrgId } = useOrg();
  const fetchOverview = useServerFn(getInsightOverview);
  const [openFinding, setOpenFinding] = useState<InsightFindingDTO | null>(null);
  const [openAction, setOpenAction] = useState<InsightActionDTO | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["insight-overview", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: () => fetchOverview({ data: { orgId: activeOrgId as string } }),
  });

  const run = data?.run ?? null;
  const findings = data?.findings ?? [];
  const actions = data?.actions ?? [];
  const topPriority = Math.max(0, ...findings.map((f) => f.priority_score), ...actions.map((a) => a.priority_score));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI 인사이트</h1>
        <p className="text-sm text-muted-foreground">
          AI 검색 측정 데이터를 분석해 현재 노출 문제와 우선적으로 테스트해야 할 행동을 보여줍니다.
        </p>
      </header>

      {isLoading || (isFetching && !data) ? (
        <LoadingState />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTitle>인사이트를 불러오지 못했습니다.</AlertTitle>
          <AlertDescription className="mt-3">
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : !run ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            아직 생성된 AI 인사이트가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <>
          {data?.evidence_grade === "directional" && (
            <Alert>
              <AlertTitle>방향성 결과 안내</AlertTitle>
              <AlertDescription>
                현재 결과는 제한된 측정 데이터를 기반으로 발견된 방향성입니다. 확정적인 결론이 아니라 추가 실험을 위한
                우선순위로 활용하세요.
              </AlertDescription>
            </Alert>
          )}

          {/* 분석 상태 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">분석 상태</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <Meta label="분석 시점" value={formatSeoul(run.completed_at)} />
              <Meta label="Insight Engine 버전" value={`v${run.engine_version}`} />
              <Meta
                label="분석 사용 measurement 수"
                value={`${run.eligible_measurement_count} / ${run.input_measurement_count}건`}
              />
              <Meta label="Evidence Grade" value={gradeLabel(data?.evidence_grade)} />
              <Meta
                label="Recommendation Mode"
                value={data?.recommendation_mode === "test" ? "테스트 권장" : (data?.recommendation_mode ?? "-")}
              />
            </CardContent>
          </Card>

          {/* 요약 카드 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="발견된 인사이트" value={`${findings.length}건`} />
            <StatCard label="추천 액션" value={`${actions.length}건`} />
            <StatCard
              label="가장 높은 Priority"
              value={findings.length + actions.length ? `${topPriority}` : "-"}
              sub={findings.length + actions.length ? priorityLabel(topPriority) : undefined}
            />
            <StatCard label="데이터 신뢰 수준" value={gradeLabel(data?.evidence_grade)} sub={run.business_name ?? undefined} />
          </div>

          {/* 핵심 인사이트 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">핵심 인사이트</h2>
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">표시할 인사이트가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {findings.map((f) => (
                  <button key={f.id} type="button" onClick={() => setOpenFinding(f)} className="text-left">
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardHeader className="pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{FINDING_TYPE_LABELS[f.finding_type] ?? f.finding_type}</Badge>
                          <Badge variant="secondary">{gradeLabel(f.evidence_grade)}</Badge>
                          <Badge variant={priorityVariant(f.priority_score)}>
                            {priorityLabel(f.priority_score)} · {f.priority_score}
                          </Badge>
                        </div>
                        <CardTitle className="pt-2 text-base leading-snug">{f.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <p className="text-muted-foreground">{f.summary}</p>
                        {(f.question_text || f.competitor_name) && (
                          <p className="text-xs text-muted-foreground">
                            {f.question_text ? `관련 질문: ${f.question_text}` : `관련 경쟁업체: ${f.competitor_name}`}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          관찰된 근거: 표본 {f.sample_size}건
                          {f.numerator !== null && f.denominator !== null ? ` · ${f.numerator}/${f.denominator}` : ""}
                          {f.metric_value !== null ? ` · ${f.metric_name} ${pct(f.metric_value)}` : ""}
                        </p>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 추천 테스트 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">추천 테스트</h2>
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">표시할 추천 액션이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {actions.map((a) => (
                  <button key={a.id} type="button" onClick={() => setOpenAction(a)} className="text-left">
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardHeader className="pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{ACTION_TYPE_LABELS[a.action_type] ?? a.action_type}</Badge>
                          <Badge variant="secondary">{gradeLabel(a.evidence_grade)}</Badge>
                          <Badge variant={priorityVariant(a.priority_score)}>
                            {priorityLabel(a.priority_score)} · {a.priority_score}
                          </Badge>
                          {a.recommendation_mode === "test" && <Badge>테스트 권장</Badge>}
                        </div>
                        <CardTitle className="pt-2 text-base leading-snug">{a.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <p>{a.recommended_action}</p>
                        <p className="text-xs text-muted-foreground">{a.rationale}</p>
                        {a.recommendation_mode === "test" && (
                          <p className="text-xs text-muted-foreground">
                            효과가 확정된 행동이 아니라 검증이 필요한 실험입니다.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">연결된 인사이트 {a.source_finding_count}건</p>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <Dialog open={!!openFinding} onOpenChange={(o) => !o && setOpenFinding(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {openFinding && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">{openFinding.title}</DialogTitle>
                <DialogDescription>
                  {FINDING_TYPE_LABELS[openFinding.finding_type] ?? openFinding.finding_type} ·{" "}
                  {gradeLabel(openFinding.evidence_grade)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>{openFinding.summary}</p>
                <Separator />
                <Meta label="우선순위" value={`${openFinding.priority_score} (${priorityLabel(openFinding.priority_score)})`} />
                <Meta label="신뢰도 점수" value={`${openFinding.confidence_score}`} />
                <Meta label="주장 유형" value={openFinding.claim_type} />
                <Meta
                  label="관찰된 근거"
                  value={`표본 ${openFinding.sample_size}건${
                    openFinding.numerator !== null && openFinding.denominator !== null
                      ? ` · ${openFinding.numerator}/${openFinding.denominator}`
                      : ""
                  }${openFinding.metric_value !== null ? ` · ${openFinding.metric_name} ${pct(openFinding.metric_value)}` : ""}`}
                />
                {openFinding.question_text && <Meta label="관련 질문" value={openFinding.question_text} />}
                {openFinding.competitor_name && <Meta label="관련 경쟁업체" value={openFinding.competitor_name} />}
                {openFinding.small_sample && (
                  <Alert>
                    <AlertDescription>표본이 적어 결과가 쉽게 흔들릴 수 있습니다.</AlertDescription>
                  </Alert>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!openAction} onOpenChange={(o) => !o && setOpenAction(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {openAction && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">{openAction.title}</DialogTitle>
                <DialogDescription>
                  {ACTION_TYPE_LABELS[openAction.action_type] ?? openAction.action_type} ·{" "}
                  {gradeLabel(openAction.evidence_grade)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <Meta label="추천 행동" value={openAction.recommended_action} />
                <Meta label="추천 이유" value={openAction.rationale} />
                <Meta label="검증 방법" value={openAction.validation_plan} />
                <Separator />
                <Meta label="우선순위" value={`${openAction.priority_score} (${priorityLabel(openAction.priority_score)})`} />
                <Meta label="신뢰도 점수" value={`${openAction.confidence_score}`} />
                <Meta
                  label="Recommendation Mode"
                  value={openAction.recommendation_mode === "test" ? "테스트 권장" : openAction.recommendation_mode}
                />
                <Meta label="연결된 인사이트" value={`${openAction.source_finding_count}건`} />
                {openAction.recommendation_mode === "test" && (
                  <Alert>
                    <AlertDescription>효과가 확정된 행동이 아니라 검증이 필요한 실험입니다.</AlertDescription>
                  </Alert>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value}</p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
