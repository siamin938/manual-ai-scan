import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatSeoul } from "@/lib/format";
import { buildVerifiedTargetCitationPageSummary } from "@/lib/verified-target-citation-page-summary";
import { useOrg } from "@/lib/org";
import { useActiveTargetBusiness } from "@/lib/active-business";
import {
  getPilotOpsAdminOverview,
  type PilotOpsBusinessDTO,
  type PilotOpsStage,
} from "@/lib/pilot-ops-admin.functions";
import {
  getPilotOpsAdminResult,
  getPilotOpsAdminRunDetail,
} from "@/lib/pilot-ops-admin-detail.functions";

export const Route = createFileRoute("/_authenticated/pilot-ops")({
  component: PilotOpsPage,
  head: () => ({
    meta: [
      { title: "파일럿 운영 | 차보임" },
      {
        name: "description",
        content: "차보임 내부 운영자가 파일럿 고객의 질문 준비, 측정 상태, 측정권과 다음 작업을 확인합니다.",
      },
    ],
  }),
});

const STAGE_LABELS: Record<PilotOpsStage, string> = {
  inactive: "비활성",
  questions_needed: "질문 준비 필요",
  questions_review: "질문 확인 필요",
  first_measurement_needed: "첫 측정 필요",
  measurement_in_progress: "측정 진행 중",
  result_ready: "결과 전달 가능",
  measurement_review: "측정 확인 필요",
};

function stageVariant(stage: PilotOpsStage): "default" | "secondary" | "outline" | "destructive" {
  if (stage === "result_ready") return "default";
  if (stage === "measurement_in_progress") return "secondary";
  if (stage === "measurement_review" || stage === "questions_review") return "destructive";
  return "outline";
}

function runStatusLabel(status: string | null): string {
  switch (status) {
    case "draft":
      return "대기 준비";
    case "queued":
      return "대기열";
    case "running":
      return "측정 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
    default:
      return status ?? "측정 없음";
  }
}

function locationText(row: PilotOpsBusinessDTO): string {
  return [row.region, row.city].filter(Boolean).join(" ") || "-";
}

function metricCountText(confirmed: number, valid: number, lowerPct: number | null, upperPct: number | null): string {
  if (valid <= 0 || lowerPct === null || upperPct === null) return `${confirmed}/${valid}`;
  const pctText =
    lowerPct === upperPct
      ? `${Math.round(lowerPct * 100) / 100}%`
      : `${Math.round(lowerPct * 100) / 100}~${Math.round(upperPct * 100) / 100}%`;
  return `${confirmed}/${valid} · ${pctText}`;
}

function PilotOpsPage() {
  const fetchOverview = useServerFn(getPilotOpsAdminOverview);
  const fetchAdminResult = useServerFn(getPilotOpsAdminResult);
  const fetchAdminRunDetail = useServerFn(getPilotOpsAdminRunDetail);
  const navigate = useNavigate();
  const { activeOrgId, memberships, setActiveOrgId } = useOrg();
  const activeBusiness = useActiveTargetBusiness();
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<{
    orgId: string;
    businessId: string;
    target: "/questions" | "/runs";
  } | null>(null);
  const [resultTarget, setResultTarget] = useState<PilotOpsBusinessDTO | null>(null);
  const [runTarget, setRunTarget] = useState<{
    row: PilotOpsBusinessDTO;
    runId: string;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!pendingNavigation || activeOrgId !== pendingNavigation.orgId) return;

    activeBusiness.select(pendingNavigation.orgId, pendingNavigation.businessId);
    navigate({ to: pendingNavigation.target });
    setPendingNavigation(null);
  }, [pendingNavigation, activeOrgId, activeBusiness, navigate]);

  const overviewQuery = useQuery({
    queryKey: ["pilot-ops-admin-overview", searchQuery],
    queryFn: () => fetchOverview({ data: { query: searchQuery } }),
    placeholderData: (previousData) => previousData,
    retry: false,
  });

  const resultQuery = useQuery({
    queryKey: ["pilot-ops-admin-result", resultTarget?.orgId, resultTarget?.businessId],
    enabled: !!resultTarget,
    retry: false,
    queryFn: () =>
      fetchAdminResult({
        data: {
          orgId: resultTarget!.orgId,
          businessId: resultTarget!.businessId,
        },
      }),
  });

  const verifiedPageSummary = resultQuery.data?.ok
    ? buildVerifiedTargetCitationPageSummary(resultQuery.data.data)
    : null;

  const runDetailQuery = useQuery({
    queryKey: [
      "pilot-ops-admin-run-detail",
      runTarget?.row.orgId,
      runTarget?.row.businessId,
      runTarget?.runId,
    ],
    enabled: !!runTarget,
    retry: false,
    queryFn: () =>
      fetchAdminRunDetail({
        data: {
          orgId: runTarget!.row.orgId,
          businessId: runTarget!.row.businessId,
          runId: runTarget!.runId,
        },
      }),
  });

  const overview = overviewQuery.data?.ok ? overviewQuery.data.overview : null;
  const businesses = overview?.businesses ?? [];

  const summary = useMemo(() => {
    const resultReady = businesses.filter((row) => row.stage === "result_ready").length;
    const inProgress = businesses.filter((row) => row.stage === "measurement_in_progress").length;
    const actionNeeded = businesses.filter((row) =>
      [
        "questions_needed",
        "questions_review",
        "first_measurement_needed",
        "measurement_review",
      ].includes(row.stage),
    ).length;
    const noCredits = businesses.filter((row) => row.creditBalance < 1).length;
    return { resultReady, inProgress, actionNeeded, noCredits };
  }, [businesses]);

  if (overviewQuery.isPending && !overviewQuery.data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>;
  }

  if (!overviewQuery.data || !overviewQuery.data.ok || !overview) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        이 화면을 볼 권한이 없거나 운영 현황을 불러오지 못했습니다.
      </p>
    );
  }

  const canOpenCustomerArea = (row: PilotOpsBusinessDTO) =>
    memberships.some((membership) => membership.org_id === row.orgId);

  const openBusinessPage = (
    row: PilotOpsBusinessDTO,
    target: "/questions" | "/runs",
  ) => {
    if (!canOpenCustomerArea(row)) return;

    if (activeOrgId === row.orgId) {
      activeBusiness.select(row.orgId, row.businessId);
      navigate({ to: target });
      return;
    }

    setPendingNavigation({
      orgId: row.orgId,
      businessId: row.businessId,
      target,
    });
    setActiveOrgId(row.orgId);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">파일럿 운영</h1>
          <Badge variant="secondary">내부 운영자 전용</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          기존 고객 데이터에서 질문 준비, 최근 측정, 측정권 상태를 자동으로 모아 다음 작업을 확인합니다.
          별도의 고객 상태를 저장하지 않는 읽기 전용 화면입니다.
        </p>
        <p className="text-xs text-muted-foreground">
          기준 시각 {formatSeoul(overview.generatedAt)}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">파일럿 업체</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{overview.totalMatches}곳</p>
            <p className="mt-1 text-xs text-muted-foreground">고객 측정 조직의 등록 업체</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">결과 전달 가능</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{summary.resultReady}곳</p>
            <p className="mt-1 text-xs text-muted-foreground">24/24 완료 · 실패 0</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">운영 작업 필요</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{summary.actionNeeded}곳</p>
            <p className="mt-1 text-xs text-muted-foreground">질문 준비·첫 측정·상태 확인</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">측정권 0회</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{summary.noCredits}곳</p>
            <p className="mt-1 text-xs text-muted-foreground">
              측정 진행 중 {summary.inProgress}곳
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">고객 운영 현황</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              위험·미완료 상태를 먼저 보여주고, 결과 전달 가능한 업체는 그다음에 표시합니다.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-80 sm:flex-row">
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="업체명·조직명·대표 계정 검색"
            />
            <Button asChild variant="outline" className="shrink-0">
              <Link to="/measurement-credits">측정권 관리</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overviewQuery.isFetching && searchQuery && (
            <p className="mb-3 text-xs text-muted-foreground">검색 결과 갱신 중…</p>
          )}
          {businesses.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {searchQuery ? "검색 결과가 없습니다." : "표시할 파일럿 업체가 없습니다."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>업체</TableHead>
                  <TableHead>현재 단계</TableHead>
                  <TableHead>질문</TableHead>
                  <TableHead>최근 측정</TableHead>
                  <TableHead>측정권</TableHead>
                  <TableHead>다음 작업</TableHead>
                  <TableHead className="sticky right-0 z-20 min-w-44 bg-card text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                    바로가기
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {businesses.map((row) => (
                  <TableRow key={row.businessId}>
                    <TableCell className="min-w-40 align-top">
                      <p className="font-medium">{row.businessName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.category} · {locationText(row)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        조직 · {row.orgName}
                      </p>
                      {(row.ownerName || row.ownerEmail) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          대표 · {[row.ownerName, row.ownerEmail].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="min-w-28 align-top">
                      <Badge variant={stageVariant(row.stage)}>{STAGE_LABELS[row.stage]}</Badge>
                    </TableCell>
                    <TableCell className="min-w-32 align-top">
                      {row.questionSetId ? (
                        <>
                          <p className="text-sm font-medium tabular-nums">
                            {row.activeQuestionCount}/24문항
                          </p>
                          <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground">
                            {row.questionSetName}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">통합 질문 세트 없음</p>
                      )}
                    </TableCell>
                    <TableCell className="min-w-40 align-top">
                      {row.latestRunId ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{runStatusLabel(row.latestRunStatus)}</span>
                            {row.totalJobs !== null && row.completedJobs !== null && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {row.completedJobs}/{row.totalJobs}
                                {row.failedJobs ? " · 실패 " + row.failedJobs : ""}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatSeoul(row.latestRunCompletedAt ?? row.latestRunCreatedAt)}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">측정 이력 없음</p>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant={row.creditBalance > 0 ? "secondary" : "outline"}>
                        {row.creditBalance}회
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-36 align-top">
                      <p className="text-sm font-medium">{row.nextAction}</p>
                      {row.stage === "result_ready" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          PDF 전달 후 재측정 시점 안내
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 min-w-44 bg-card align-top text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {row.stage === "result_ready" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResultTarget(row)}
                          >
                            결과 보기
                          </Button>
                        )}
                        {row.latestRunId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRunTarget({ row, runId: row.latestRunId as string })}
                          >
                            측정 보기
                          </Button>
                        )}
                        {canOpenCustomerArea(row) &&
                          (row.stage === "questions_needed" || row.stage === "questions_review") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openBusinessPage(row, "/questions")}
                            >
                              질문 관리
                            </Button>
                          )}
                        {canOpenCustomerArea(row) && row.stage === "first_measurement_needed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openBusinessPage(row, "/runs")}
                          >
                            측정 시작
                          </Button>
                        )}
                        {row.creditBalance < 1 && (
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              to="/measurement-credits"
                              search={{ org: row.orgId }}
                            >
                              측정권 지급
                            </Link>
                          </Button>
                        )}
                      </div>
                      {!canOpenCustomerArea(row) &&
                        (row.stage === "questions_needed" ||
                          row.stage === "questions_review" ||
                          row.stage === "first_measurement_needed") && (
                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            질문 관리·측정 시작은 고객 조직 멤버십이 있어야 합니다.
                          </p>
                        )}
                      {pendingNavigation?.businessId === row.businessId && (
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                          조직 전환 중…
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resultTarget} onOpenChange={(open) => !open && setResultTarget(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              내부 결과 보기{resultTarget ? ` · ${resultTarget.businessName}` : ""}
            </DialogTitle>
            <DialogDescription>
              고객 조직 멤버십과 별개로 내부 운영자 권한에서 기존 Entity Facts v2 결과를 읽기 전용으로 확인합니다.
            </DialogDescription>
          </DialogHeader>
          {resultQuery.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">결과를 불러오는 중…</p>
          ) : !resultQuery.data || !resultQuery.data.ok ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              결과를 불러올 수 없습니다. 최신 대표 진단과 v2 데이터 상태를 확인해 주세요.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">확정 노출</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {metricCountText(
                      resultQuery.data.data.overview.confirmedMentionCount,
                      resultQuery.data.data.overview.validCount,
                      resultQuery.data.data.overview.visibilityLowerBoundPct,
                      resultQuery.data.data.overview.visibilityUpperBoundPct,
                    )}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">상위 3곳</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {metricCountText(
                      resultQuery.data.data.overview.confirmedTop3Count,
                      resultQuery.data.data.overview.validCount,
                      resultQuery.data.data.overview.top3LowerBoundPct,
                      resultQuery.data.data.overview.top3UpperBoundPct,
                    )}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">관찰 업체</p>
                  <p className="mt-2 text-lg font-semibold">
                    {resultQuery.data.data.competitors.length}곳
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">내 업체 관련 페이지</p>
                  <p className="mt-2 text-lg font-semibold">
                    {verifiedPageSummary?.label ?? "미검증"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{resultQuery.data.data.scope.runName}</p>
                  <Badge variant="outline">
                    {resultQuery.data.data.scope.completedJobs}/{resultQuery.data.data.scope.totalJobs}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatSeoul(resultQuery.data.data.scope.measuredAt)} · 질문 세트{" "}
                  {resultQuery.data.data.scope.questionSetName ?? "-"}
                </p>
              </div>

              {resultQuery.data.data.broadSearchObservation && (
                <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
                  <p className="text-xs font-semibold text-primary">기준 검색 관찰</p>
                  <p className="mt-2 text-sm font-medium">
                    내 업체 {resultQuery.data.data.broadSearchObservation.targetConfirmedCount}/
                    {resultQuery.data.data.broadSearchObservation.validCount}
                  </p>
                  {resultQuery.data.data.broadSearchObservation.repeatedCompetitors.length > 0 && (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      반복 관찰 업체 ·{" "}
                      {resultQuery.data.data.broadSearchObservation.repeatedCompetitors
                        .slice(0, 3)
                        .map((item) => `${item.name} ${item.responseCount}회`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">검색 상황</p>
                  <div className="mt-3 space-y-2">
                    {resultQuery.data.data.questionGroups.map((group) => (
                      <div key={group.intentType} className="flex items-center justify-between gap-3 text-sm">
                        <span>{group.intentType}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {group.confirmedMentionCount}/{group.validCount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">함께 관찰된 업체</p>
                  <div className="mt-3 space-y-2">
                    {resultQuery.data.data.competitors.slice(0, 5).map((competitor) => (
                      <div key={competitor.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{competitor.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {competitor.responseCount}회
                        </span>
                      </div>
                    ))}
                    {resultQuery.data.data.competitors.length === 0 && (
                      <p className="text-sm text-muted-foreground">확정 관찰 업체가 없습니다.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold">내 업체 관련 인용 페이지</p>
                <div className="mt-3 space-y-2">
                  {verifiedPageSummary?.status === "complete" ? (
                    (resultQuery.data.data.verifiedTargetCitationPages?.length ?? 0) > 0 ? (
                      (resultQuery.data.data.verifiedTargetCitationPages ?? []).slice(0, 5).map((page) => (
                        <div key={page.sampleUrl} className="text-sm">
                          <p className="font-medium">{page.title ?? page.domain}</p>
                          <p className="text-xs text-muted-foreground">
                            {page.domain} · {page.responseCount}개 응답 · {page.basisLabel}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        페이지 검증은 완료됐지만 현재 업체 관련성이 확정된 인용 페이지는 0개입니다.
                      </p>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {verifiedPageSummary?.status === "pending"
                        ? "현재 대표 측정의 인용 페이지 관련성을 확인 중입니다."
                        : "현재 대표 측정의 인용 페이지 관련성은 미검증 상태입니다."}
                    </p>
                  )}
                </div>
                {resultQuery.data.data.targetSources.length > 0 && (
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      별도 관찰: 업체 연결 출처 (페이지 내용 검증과 다름)
                    </p>
                    {resultQuery.data.data.targetSources.slice(0, 5).map((source) => (
                      <div key={source.domain} className="flex justify-between gap-3 text-sm">
                        <span>{source.domain}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {source.responseCount}개 응답
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                이 화면은 내부 운영 확인용입니다. 관찰 업체와 출처 연결은 인과관계를 의미하지 않습니다.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!runTarget} onOpenChange={(open) => !open && setRunTarget(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              내부 측정 보기{runTarget ? ` · ${runTarget.row.businessName}` : ""}
            </DialogTitle>
            <DialogDescription>
              원문 응답을 노출하지 않고 측정 실행 상태와 운영 오류만 확인합니다.
            </DialogDescription>
          </DialogHeader>
          {runDetailQuery.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">측정 정보를 불러오는 중…</p>
          ) : !runDetailQuery.data || !runDetailQuery.data.ok ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              측정 정보를 불러올 수 없습니다.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{runDetailQuery.data.detail.runName}</p>
                  <Badge variant="outline">
                    {runStatusLabel(runDetailQuery.data.detail.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  질문 세트 · {runDetailQuery.data.detail.questionSetName ?? "-"}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">진행</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {runDetailQuery.data.detail.completedJobs}/{runDetailQuery.data.detail.totalJobs}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">실패</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {runDetailQuery.data.detail.failedJobs}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">반복</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {runDetailQuery.data.detail.repetitions}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold">실행 정보</p>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    생성 · <span className="text-muted-foreground">{formatSeoul(runDetailQuery.data.detail.createdAt)}</span>
                  </p>
                  <p>
                    시작 · <span className="text-muted-foreground">{formatSeoul(runDetailQuery.data.detail.startedAt)}</span>
                  </p>
                  <p>
                    완료 · <span className="text-muted-foreground">{formatSeoul(runDetailQuery.data.detail.completedAt)}</span>
                  </p>
                  <p>
                    Provider ·{" "}
                    <span className="text-muted-foreground">
                      {runDetailQuery.data.detail.selectedProviders.join(", ") || "-"}
                    </span>
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold">Job 상태</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(runDetailQuery.data.detail.jobStatusCounts).map(([status, count]) => (
                    <Badge key={status} variant="secondary">
                      {status} {count}
                    </Badge>
                  ))}
                </div>
              </div>

              {runDetailQuery.data.detail.failedJobSamples.length > 0 && (
                <div className="rounded-lg border border-destructive/30 p-4">
                  <p className="text-sm font-semibold">실패 샘플</p>
                  <div className="mt-3 space-y-2">
                    {runDetailQuery.data.detail.failedJobSamples.map((sample, index) => (
                      <div key={`${sample.errorCode ?? "error"}-${index}`} className="text-xs">
                        <p className="font-medium">{sample.errorCode ?? "오류"}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {sample.errorMessage ?? "상세 메시지 없음"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
