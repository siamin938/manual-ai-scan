import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  getExperimentsOverview,
  type ExperimentOverviewRowDTO,
} from "@/lib/experiments.overview.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/experiments")({
  head: () => ({
    meta: [
      { title: "실험 관리 · AI Visibility Lab" },
      {
        name: "description",
        content: "변경 전·후 측정을 누적해 실제 노출 변화의 방향성을 확인하는 실험 관리 화면입니다.",
      },
      { property: "og:title", content: "실험 관리 · AI Visibility Lab" },
      {
        property: "og:description",
        content: "변경 전·후 측정을 누적해 실제 노출 변화의 방향성을 확인합니다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExperimentsPage,
});

const SOURCE_LABELS: Record<string, string> = {
  profile_coverage_item: "프로필 커버리지",
  insight_action: "AI 인사이트",
  unknown: "기타",
};

const OUTCOME_LABELS: Record<string, string> = {
  directional_improvement: "개선 방향성 관찰",
  directional_decline: "악화 방향성 관찰",
  no_clear_change: "뚜렷한 변화 없음",
};

function stageLabel(e: ExperimentOverviewRowDTO): string {
  const b = e.baseline;
  const f = e.followup;
  if (e.evaluation.recorded || e.status === "completed") return "실험 완료";
  if (f.finalized) return "결과 비교 대기";
  if (f.runId && f.runStatus === "completed") return "Follow-up 확정 필요";
  if (f.runId && ["draft", "queued", "running"].includes(f.runStatus ?? "")) return "Follow-up 측정 중";
  if (e.actionAppliedAt && !f.runId) return "Follow-up 대기";
  if (b.finalized && !e.actionAppliedAt) return "변경 적용 대기";
  if (b.runId && b.runStatus === "completed" && !b.finalized) return "Baseline 확정 필요";
  if (b.runId && ["queued", "running"].includes(b.runStatus ?? "")) return "Baseline 측정 중";
  if (b.runId && b.runStatus === "draft") return "Baseline 준비";
  return "초안";
}

function ExperimentsPage() {
  const { activeOrgId } = useOrg();
  const fetchOverview = useServerFn(getExperimentsOverview);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["experiments-overview", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: () => fetchOverview({ data: { orgId: activeOrgId! } }),
  });

  const rows = data?.experiments ?? [];
  const total = rows.length;
  const waitingAction = rows.filter((e) => e.baseline.finalized && !e.actionAppliedAt).length;
  const followupStage = rows.filter((e) => e.actionAppliedAt && !e.evaluation.recorded).length;
  const done = rows.filter((e) => e.evaluation.recorded || e.status === "completed").length;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">실험 관리</h1>
        <p className="text-sm text-muted-foreground">
          변경 전·후 측정을 누적해 실제 노출 변화의 방향성을 확인합니다.
        </p>
        <Alert>
          <AlertTitle>해석 주의</AlertTitle>
          <AlertDescription>
            실험 결과는 인과관계 확정이 아니라 동일 조건 재측정에서 관찰된 방향성입니다.
          </AlertDescription>
        </Alert>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "전체 실험", value: total },
          { label: "변경 적용 대기", value: waitingAction },
          { label: "Follow-up 진행/대기", value: followupStage },
          { label: "완료", value: done },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{isLoading ? "–" : s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTitle>불러오지 못했습니다</AlertTitle>
          <AlertDescription>잠시 후 다시 시도해주세요.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            아직 등록된 실험이 없습니다. 프로필 커버리지 또는 AI 인사이트 화면에서 실험을 시작할 수
            있습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((e) => (
            <Card key={e.experimentId}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{e.name}</CardTitle>
                  <Badge variant="secondary">{SOURCE_LABELS[e.sourceType]}</Badge>
                  <Badge>{stageLabel(e)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {e.businessName ?? "업체 미상"}
                  </span>
                </div>
                {e.sourceTitle && (
                  <p className="text-xs text-muted-foreground">원본: {e.sourceTitle}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Baseline 진행</dt>
                    <dd>
                      {e.baseline.runId
                        ? `${e.baseline.completedJobs ?? 0}/${e.baseline.totalJobs ?? 0} 완료`
                        : "미시작"}
                      {!!e.baseline.failedJobs && (
                        <span className="ml-2 text-destructive">실패 {e.baseline.failedJobs}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">변경 적용 시각</dt>
                    <dd>{e.actionAppliedAt ? formatSeoul(e.actionAppliedAt) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Follow-up 진행</dt>
                    <dd>
                      {e.followup.runId
                        ? `${e.followup.completedJobs ?? 0}/${e.followup.totalJobs ?? 0} 완료`
                        : "—"}
                      {!!e.followup.failedJobs && (
                        <span className="ml-2 text-destructive">실패 {e.followup.failedJobs}</span>
                      )}
                    </dd>
                  </div>
                  {e.evaluation.recorded && (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">결과</dt>
                        <dd>
                          {OUTCOME_LABELS[e.evaluation.resultClassification ?? ""] ??
                            e.evaluation.resultClassification ??
                            "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">증거 등급</dt>
                        <dd>{e.evaluation.evidenceGrade ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">확정 시각</dt>
                        <dd>
                          {e.evaluation.evaluatedAt ? formatSeoul(e.evaluation.evaluatedAt) : "—"}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                {e.interventionDescription && (
                  <p className="text-sm text-muted-foreground">
                    적용 변경: {e.interventionDescription}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">
                    생성일 {formatSeoul(e.createdAt)}
                  </span>
                  {e.sourceType === "profile_coverage_item" ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/profile-coverage">원본 보기</Link>
                    </Button>
                  ) : e.sourceType === "insight_action" ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/insights">원본 보기</Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
