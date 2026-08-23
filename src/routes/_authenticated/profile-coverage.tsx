import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  getProfileCoverageOverview,
  type CoverageGapActionDTO,
  type ProfileCoverageItemDTO,
} from "@/lib/profile-coverage.functions";
import {
  createExperimentFromCoverageItem,
  type CreateCoverageExperimentErrorCode,
} from "@/lib/experiments.functions";
import { useExperimentFlow } from "@/components/experiment-flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** 서버 오류 코드 → 안전한 한글 문구 */
const COVERAGE_EXPERIMENT_ERROR_MESSAGES: Partial<
  Record<CreateCoverageExperimentErrorCode, string>
> = {
  FORBIDDEN: "실험을 생성할 권한이 없습니다.",
  COVERAGE_ITEM_NOT_FOUND: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  COVERAGE_ITEM_SCOPE_MISMATCH: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  COVERAGE_STATUS_NOT_EXPERIMENTABLE: "현재 항목은 실험 대상이 아닙니다.",
  COVERAGE_RUN_NOT_USABLE: "이 분석 결과로는 실험을 시작할 수 없습니다.",
  COVERAGE_SOURCE_RUN_NOT_FOUND: "기준이 되는 측정 실행을 찾을 수 없습니다.",
  QUESTION_SCOPE_MISMATCH: "질문 정보를 확인할 수 없습니다.",
  BUSINESS_SCOPE_MISMATCH: "업체 정보를 확인할 수 없습니다.",
  EXPERIMENT_ALREADY_ACTIVE: "이미 진행 중인 실험이 있습니다.",
  EXPERIMENT_CREATE_FAILED: "실험 생성 중 오류가 발생했습니다.",
  INTERNAL_ERROR: "실험 생성 중 오류가 발생했습니다.",
};


export const Route = createFileRoute("/_authenticated/profile-coverage")({
  head: () => ({
    meta: [
      { title: "프로필 커버리지 · AI Visibility Lab" },
      {
        name: "description",
        content:
          "AI 질문 영역에서 대상 업체가 얼마나 넓고 안정적으로 노출되는지 보여주는 프로필 커버리지 대시보드입니다.",
      },
      { property: "og:title", content: "프로필 커버리지 · AI Visibility Lab" },
      { property: "og:description", content: "Profile Coverage Engine 분석 결과 대시보드" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfileCoveragePage,
});

const GRADE_LABELS: Record<string, string> = {
  directional: "방향성",
  supported: "근거 있음",
  strong: "강한 근거",
  insufficient: "근거 부족",
};

const STATUS_LABELS: Record<string, string> = {
  covered: "전회 노출",
  partial: "일부 노출",
  missing: "미노출",
};

const INTENT_LABELS: Record<string, string> = {
  discovery: "탐색",
  comparison: "비교",
  local: "지역",
  transactional: "구매 의도",
  informational: "정보 탐색",
  branded: "브랜드",
  service: "서비스",
  trust: "신뢰/안심",
  review_quality: "후기 품질",
  recommendation: "추천",
};

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

function statusBadge(status: string) {
  const label = STATUS_LABELS[status] ?? "기타";
  const variant = status === "missing" ? "destructive" : status === "covered" ? "default" : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

const PRIORITY_LABELS: Record<string, string> = {
  high: "높음",
  medium: "중간",
};

function priorityBadge(level: string) {
  const label = PRIORITY_LABELS[level] ?? level;
  const variant = level === "high" ? "default" : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

function ActionCard({
  action,
  cta,
}: {
  action: CoverageGapActionDTO;
  cta: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {priorityBadge(action.priority_level)}
          <Badge variant="outline">테스트 후보</Badge>
        </div>
        <CardTitle className="text-base">{action.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{action.question_text ?? "질문 정보 없음"}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">관찰 근거</p>
          <p className="tabular-nums">
            {action.measurement_count}회 측정 · 노출 {action.mentioned_count}회 · 노출률{" "}
            {pct(action.mention_rate)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">보강해볼 프로필 정보</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
            {action.profile_fields.map((field, idx) => (
              <li key={idx}>{field}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">검증 방법</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{action.validation_plan}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Evidence Grade</p>
          <Badge variant="secondary">
            {action.evidence_grade ? (GRADE_LABELS[action.evidence_grade] ?? "기타") : "-"}
          </Badge>
        </div>
        {action.active_experiment && (
          <p className="text-xs text-muted-foreground">
            실험 상태: {EXPERIMENT_STATUS_LABELS[action.active_experiment.status] ?? "진행 중"}
            {action.active_experiment.evaluation_recorded &&
            action.active_experiment.result_classification
              ? ` · 결과 ${action.active_experiment.result_classification}`
              : ""}
          </p>
        )}
        <div className="mt-auto pt-1">{cta}</div>
      </CardContent>
    </Card>
  );
}

const EXPERIMENT_STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  baseline: "Baseline",
  action_applied: "변경 적용됨",
  followup: "Follow-up",
};


function MetricCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function ProfileCoveragePage() {
  const { activeOrgId } = useOrg();
  const fetchOverview = useServerFn(getProfileCoverageOverview);
  const businessSel = useClientBusinessSelection(activeOrgId);
  const selectedBusinessId = businessSel.selectedBusinessId;

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["profile-coverage", activeOrgId, selectedBusinessId],
    enabled: !!activeOrgId && !!selectedBusinessId,
    queryFn: () =>
      fetchOverview({
        data: { orgId: activeOrgId as string, businessId: selectedBusinessId as string },
      }),
  });

  const run = data?.run ?? null;
  const items: ProfileCoverageItemDTO[] = data?.items ?? [];
  const actions: CoverageGapActionDTO[] = data?.actions ?? [];


  // Experiment 단계 실행 흐름 (비용은 Baseline/Follow-up 최종 확인 버튼에서만 발생)
  const flow = useExperimentFlow(activeOrgId ?? null, () => void refetch());
  const createExperimentFn = useServerFn(createExperimentFromCoverageItem);
  const [createTarget, setCreateTarget] = useState<CoverageGapActionDTO | null>(null);

  const createExperiment = useMutation({
    // 클라이언트는 orgId와 coverage item id만 전달한다. 나머지는 서버가 계보로 결정한다.
    mutationFn: (coverageItemId: string) =>
      createExperimentFn({
        data: { orgId: activeOrgId as string, profileCoverageItemId: coverageItemId },
      }),
    onSuccess: (result) => {
      if (result.ok) toast.success("실험 초안이 생성되었습니다.");
      else toast.error(COVERAGE_EXPERIMENT_ERROR_MESSAGES[result.error] ?? "실험 생성 중 오류가 발생했습니다.");
      setCreateTarget(null);
      void refetch();
    },
    onError: () => {
      toast.error("실험 생성 중 오류가 발생했습니다.");
      setCreateTarget(null);
      void refetch();
    },
  });


  const hasBusinesses = businessSel.options.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">프로필 커버리지</h1>
          <p className="text-sm text-muted-foreground">
            AI 질문 영역에서 대상 업체가 얼마나 넓고 안정적으로 노출되는지 보여줍니다.
          </p>
          {run?.business_name && (
            <p className="text-sm text-foreground">분석 대상 업체: {run.business_name}</p>
          )}
        </div>
        <BusinessSelector
          options={businessSel.options}
          value={selectedBusinessId}
          isLoading={businessSel.isLoading}
          isError={businessSel.isError}
          onChange={(id) => {
            // 업체 전환 시 이전 업체의 다이얼로그가 남지 않도록 닫는다.
            setCreateTarget(null);
            businessSel.select(id);
          }}
        />
      </header>

      {!businessSel.isLoading && !businessSel.isError && !hasBusinesses && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            등록된 대상 업체가 없습니다. 업체 관리에서 대상 업체를 등록해 주세요.
          </CardContent>
        </Card>
      )}

      {hasBusinesses && isLoading && (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>분석 결과를 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>잠시 후 다시 시도해주세요.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {hasBusinesses && !isLoading && !isError && !run && (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              선택한 업체의 프로필 커버리지 분석이 아직 없습니다.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              다시 시도
            </Button>
          </CardContent>
        </Card>
      )}


      {run && (
        <>
          {run.evidence_grade === "directional" && (
            <Alert>
              <AlertTitle>방향성 지표입니다</AlertTitle>
              <AlertDescription>
                현재 표본이 제한적이라 확정된 결론이 아니라 방향성 참고용 지표입니다.
              </AlertDescription>
            </Alert>
          )}

          {/* A. 분석 상태 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">분석 상태</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">분석 시점</p>
                <p className="font-medium">{formatSeoul(run.completed_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">엔진</p>
                <p className="font-medium">Profile Coverage Engine v{run.engine_version}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">측정 수 (입력 / 포함 / 제외)</p>
                <p className="font-medium tabular-nums">
                  {run.input_measurement_count} / {run.eligible_measurement_count} /{" "}
                  {run.excluded_measurement_count}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Evidence Grade</p>
                <p className="font-medium">
                  <Badge variant="secondary">
                    {run.evidence_grade ? (GRADE_LABELS[run.evidence_grade] ?? "기타") : "-"}
                  </Badge>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* B. 핵심 점수 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Coverage Score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-2">
                <span className="text-5xl font-semibold tabular-nums">
                  {run.coverage_score === null ? "-" : run.coverage_score.toFixed(0)}
                </span>
                <span className="pb-2 text-sm text-muted-foreground">/ 100</span>
              </div>
              <Progress value={run.coverage_score ?? 0} />
              <p className="text-xs leading-relaxed text-muted-foreground">
                현재 측정 질문 범위에서의 노출 커버리지를 나타내는 값입니다. 절대적인 품질 점수나 SEO
                점수가 아니며, 질문 구성과 측정 조건이 바뀌면 값도 달라집니다.
              </p>
            </CardContent>
          </Card>

          {/* C. 핵심 지표 */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              title="질문 커버리지"
              value={pct(run.question_coverage_rate)}
              description="측정한 질문 중 대상 업체가 노출된 질문의 비율입니다."
            />
            <MetricCard
              title="전체 측정 노출률"
              value={pct(run.measurement_coverage_rate)}
              description="전체 측정 응답 중 대상 업체가 언급된 비율입니다."
            />
            <MetricCard
              title="Top 3 노출률"
              value={pct(run.top3_coverage_rate)}
              description="측정 응답에서 대상 업체가 상위 3순위 안에 언급된 비율입니다."
            />
            <MetricCard
              title="자사 도메인 인용률"
              value={pct(run.client_domain_citation_rate)}
              description="응답 출처에 자사 공식 도메인이 인용된 비율입니다."
            />
            <MetricCard
              title="First-party 출처 인용률"
              value={
                run.first_party_classifier_version === null ||
                run.client_first_party_citation_rate === null
                  ? "미집계"
                  : pct(run.client_first_party_citation_rate)
              }
              description="응답 출처 중 검증된 자사 채널(자사 도메인, 네이버 플레이스/블로그)이 인용된 측정 비율입니다. 자사 도메인 인용률과는 별도 지표입니다."
            />
            <MetricCard
              title="반복 일관성"
              value={pct(run.repeat_stability_rate)}
              description="노출 또는 미노출 결과가 반복 측정에서 얼마나 일정했는지 나타내며, 높은 값이 좋은 노출을 의미하지 않습니다."
            />
          </section>

          {/* D. 질문 커버리지 요약 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">질문 커버리지 요약</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">전체 질문</p>
                <p className="text-2xl font-semibold tabular-nums">{run.question_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">전회 노출</p>
                <p className="text-2xl font-semibold tabular-nums">{run.covered_question_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">일부 노출</p>
                <p className="text-2xl font-semibold tabular-nums">{run.partial_question_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">미노출</p>
                <p className="text-2xl font-semibold tabular-nums">{run.missing_question_count}</p>
              </div>
            </CardContent>
          </Card>

          {/* 우선 보완 영역 */}
          {actions.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold">우선 보완 영역</h2>
              <p className="text-sm text-muted-foreground">
                현재 커버리지 공백을 바탕으로 만든 테스트 후보입니다. 아래 정보가 노출의 원인이라고
                확인된 것은 아니며, 변경 후 재측정으로 검증해야 합니다.
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {actions.map((action) => (
                  <ActionCard
                    key={action.coverage_item_id}
                    action={action}
                    cta={flow.renderCta({
                      experiment: action.active_experiment,
                      title: action.title,
                      recommendedAction: action.profile_fields.join(", "),
                      onCreate: () => setCreateTarget(action),
                    })}
                  />
                ))}

              </div>
            </section>
          )}

          {/* E. 질문별 상세 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">질문별 상세</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {items.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  표시할 질문별 결과가 없습니다.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[240px]">질문</TableHead>
                        <TableHead>상태</TableHead>
                        <TableHead className="text-right">측정</TableHead>
                        <TableHead className="text-right">노출</TableHead>
                        <TableHead className="text-right">노출률</TableHead>
                        <TableHead className="text-right">Top3</TableHead>
                        <TableHead className="text-right">최고 순위</TableHead>
                        <TableHead className="text-right">평균 순위</TableHead>
                        <TableHead className="text-right">도메인 인용률</TableHead>
                        <TableHead className="text-right">First-party 인용률</TableHead>
                        <TableHead className="text-right">반복 일관성</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="align-top">
                            <p className="text-sm">{it.question_text ?? "질문 정보 없음"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {it.intent_type ? (INTENT_LABELS[it.intent_type] ?? "기타") : "기타"}
                            </p>
                          </TableCell>
                          <TableCell className="align-top">{statusBadge(it.coverage_status)}</TableCell>
                          <TableCell className="text-right tabular-nums">{it.measurement_count}</TableCell>
                          <TableCell className="text-right tabular-nums">{it.mentioned_count}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(it.mention_rate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(it.top3_rate)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.best_position ?? "-"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {num(it.average_position)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct(it.domain_citation_rate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.first_party_classifier_version === null
                              ? "미집계"
                              : pct(it.first_party_citation_rate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct(it.repeat_stability)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="px-6 pt-4 text-xs leading-relaxed text-muted-foreground">
                반복 일관성은 반복 측정 결과가 얼마나 일정했는지를 나타내며, 높은 값이 좋은 노출을
                의미하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* 실험 초안 생성 확인 — 측정/비용 발생 없음 */}
      <Dialog
        open={!!createTarget}
        onOpenChange={(o) => {
          if (!o && !createExperiment.isPending) setCreateTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {createTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">이 항목으로 실험을 시작할까요?</DialogTitle>
                <DialogDescription>{createTarget.title}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {createTarget.question_text ?? "질문 정보 없음"}
                </p>
                <Alert>
                  <AlertDescription className="leading-relaxed">
                    지금은 실험 초안만 생성합니다. AI 측정이 실행되지 않으므로 비용이 발생하지
                    않습니다. 실제 측정은 다음 단계의 Baseline 시작 확인에서만 진행됩니다.
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateTarget(null)}
                  disabled={createExperiment.isPending}
                >
                  취소
                </Button>
                <Button
                  onClick={() => createExperiment.mutate(createTarget.coverage_item_id)}
                  disabled={createExperiment.isPending}
                >
                  {createExperiment.isPending ? "생성 중..." : "실험 초안 생성"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {flow.dialogs}
    </div>

  );
}
