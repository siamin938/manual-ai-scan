import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSeoul } from "@/lib/format";
import {
  getPilotOpsAdminOverview,
  type PilotOpsBusinessDTO,
  type PilotOpsStage,
} from "@/lib/pilot-ops-admin.functions";

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

function PilotOpsPage() {
  const fetchOverview = useServerFn(getPilotOpsAdminOverview);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const overviewQuery = useQuery({
    queryKey: ["pilot-ops-admin-overview", searchQuery],
    queryFn: () => fetchOverview({ data: { query: searchQuery } }),
    placeholderData: (previousData) => previousData,
    retry: false,
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
                  <TableHead>질문 준비</TableHead>
                  <TableHead>최근 측정</TableHead>
                  <TableHead>측정권</TableHead>
                  <TableHead>다음 작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {businesses.map((row) => (
                  <TableRow key={row.businessId}>
                    <TableCell className="min-w-56 align-top">
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
                    <TableCell className="min-w-36 align-top">
                      <Badge variant={stageVariant(row.stage)}>{STAGE_LABELS[row.stage]}</Badge>
                    </TableCell>
                    <TableCell className="min-w-40 align-top">
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
                    <TableCell className="min-w-48 align-top">
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
                    <TableCell className="min-w-48 align-top">
                      <p className="text-sm font-medium">{row.nextAction}</p>
                      {row.stage === "result_ready" && (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          고객 결과 확인 후 PDF 전달 또는 다음 동일 조건 측정을 안내합니다.
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
    </div>
  );
}
