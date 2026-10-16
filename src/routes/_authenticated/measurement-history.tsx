import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { fetchMemberHistoryCatalog } from "@/lib/measurement-history.member-catalog";
import { listMeasurementHistory, getMeasurementHistoryDetail } from "@/lib/measurement-history.functions";
import {
  canDisplayHistoryDetail,
  isMatchingHistoryCatalog,
  enrichMemberHistoryCatalog,
  getHistorySearchScopes,
  type MeasurementHistoryRunItem,
} from "@/lib/measurement-history.model";
import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "@/lib/entity-facts-v2-read-gateway.types";
import { ownerSearchContextLabel } from "@/lib/dashboard-compact-insights";

export const Route = createFileRoute("/_authenticated/measurement-history")({
  component: MeasurementHistoryPage,
  head: () => ({
    meta: [
      { title: "측정 기록 · 차보임 CHABOIM" },
      { name: "description", content: "완료된 AI 노출 측정 결과를 날짜별로 다시 확인합니다." },
    ],
  }),
});

function MeasureCard({ label, count, hint }: { label: string; count: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AnswerStatus({ area }: { area: EntityFactsV2ReadQuestionAreaDTO }) {
  if (area.confirmedMentionCount > 0) {
    return <Badge variant="default">확정 등장 {area.confirmedMentionCount}건</Badge>;
  }
  if (area.unresolvedTargetCount > 0) {
    return <Badge variant="secondary">추가 확인 필요</Badge>;
  }
  return <Badge variant="outline">확정 등장 없음</Badge>;
}

function ArchivedReport({ report }: { report: EntityFactsV2ReadGatewayDTO }) {
  const scope = getHistorySearchScopes(report);
  const verified = report.verifiedTargetCitationPageStatus;
  const pages = report.verifiedTargetCitationPages ?? [];
  const citations = report.citationSources ?? [];
  const observed = report.observedSources;
  return (
    <div className="space-y-5" aria-label="선택한 과거 측정의 결과">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">저장된 측정 결과</Badge>
            <span className="text-xs text-muted-foreground">읽기 전용 · 새 측정 없음</span>
          </div>
          <CardTitle className="text-lg">{formatSeoul(report.scope.measuredAt)} 측정</CardTitle>
          <p className="text-sm text-muted-foreground">{report.business.name} · {report.scope.runName}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            이 수치는 선택한 날짜의 답변만 사용합니다. 다른 날짜의 결과를 합산하지 않습니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MeasureCard label="확정 노출" count={`${report.overview.confirmedMentionCount}/${report.overview.validCount}`} />
            <MeasureCard label="상위 3곳 확정" count={`${report.overview.confirmedTop3Count}/${report.overview.validCount}`} />
            <MeasureCard label="관찰된 다른 업체" count={`${report.competitors.length}곳`} hint="업체명 검증을 통과한 결과" />
          </div>
          {scope && (
            <div className="grid gap-3 sm:grid-cols-2">
              <MeasureCard label="넓은 범위 검색" count={`${scope.core.confirmed}/${scope.core.valid}`} />
              <MeasureCard label="상세 조건 검색" count={`${scope.custom.confirmed}/${scope.custom.valid}`} />
            </div>
          )}
          {!scope && (
            <p className="text-sm text-muted-foreground">
              이 측정은 8개 넓은 범위·16개 상세 조건 검색으로 구분할 수 있는 기록이 확인되지 않아, 구분별 수치를 표시하지 않습니다.
            </p>
          )}
          {report.overview.unresolvedTargetCount > 0 && (
            <p className="text-sm text-muted-foreground">
              추가 확인이 필요한 답변 {report.overview.unresolvedTargetCount}건은 확정 노출에 포함하지 않았습니다.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">어떤 질문에서 내 업체가 관찰됐나요?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">이 측정에 저장된 질문 {report.questionAreas.length}개를 모두 표시합니다.</p>
          <div className="divide-y rounded-lg border">
            {report.questionAreas.map((area) => (
              <div key={area.questionId} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium leading-6">{area.questionText}</p>
                  <p className="text-xs text-muted-foreground">
                    {ownerSearchContextLabel(area.intentType)} · {area.validCount}개 유효 답변 · 상위 3곳 {area.confirmedTop3Count}건
                  </p>
                </div>
                <AnswerStatus area={area} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">당시 관찰된 다른 업체 · {report.competitors.length}곳</CardTitle>
          </CardHeader>
          <CardContent>
            {report.competitors.length ? (
              <div className="divide-y">
                {report.competitors.map((row, index) => (
                  <div key={row.name + index} className="flex justify-between gap-3 py-3">
                    <span className="min-w-0 break-words text-sm font-medium">{row.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {row.responseCount}/{report.overview.validCount}개 답변
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">당시 측정에서 업체명이 확정된 다른 업체가 없습니다.</p>
            )}
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              이전에 등장했던 업체가 최근 측정에 없더라도 검색 전체에서 사라졌다고 단정할 수 없습니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">당시 관찰된 출처</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-semibold">실제 답변에 인용된 출처</p>
              {citations.length ? citations.map((source) => (
                <a
                  key={source.domain}
                  href={source.sampleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start justify-between gap-2 border-b py-2 text-sm text-primary hover:underline"
                >
                  <span className="min-w-0 break-all">{source.domain} <ExternalLink className="inline h-3 w-3" /></span>
                  <span className="shrink-0 text-muted-foreground">{source.responseCount}개 답변</span>
                </a>
              )) : (
                <p className="text-sm text-muted-foreground">열람 가능한 인용 출처 요약을 확인하지 못했습니다.</p>
              )}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                인용 여부는 확인할 수 있지만 해당 출처가 내 업체 노출의 원인이라는 뜻은 아닙니다.
              </p>
            </div>
            {observed.length > 0 && (
              <details className="rounded-lg border px-3 py-3">
                <summary className="cursor-pointer text-sm font-semibold">업체와 함께 관찰된 출처 {observed.length}개 보기</summary>
                <div className="mt-3 divide-y">
                  {observed.map((row) => (
                    <div key={row.domain} className="py-2 text-sm">
                      <p className="font-medium">{row.domain} · {row.responseCount}개 답변</p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {row.linkedEntities.map((entity) => entity.name).join(", ") || "연결 업체명 없음"}
                        {row.evidence !== "confirmed" ? " · 일부 연결은 참고 단서" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내 업체 관련성 확인된 인용 페이지</CardTitle>
        </CardHeader>
        <CardContent>
          {verified === "complete" ? (
            <>
              <p className="text-sm font-semibold">당시 검증 완료 · {pages.length}개</p>
              {pages.length > 0 ? (
                <div className="mt-3 divide-y">
                  {pages.map((page) => (
                    <a key={page.sampleUrl} href={page.sampleUrl} target="_blank" rel="noopener noreferrer"
                      className="block break-all py-3 text-sm text-primary underline underline-offset-2">
                      {page.title || page.domain} ↗
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">검증 완료된 이 측정에서 내 업체 관련성을 확정한 인용 페이지는 0개입니다.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {verified === "pending" ? "당시 인용 페이지의 관련성 검증 상태를 완전히 확인하지 못했습니다." :
                "이 과거 측정에는 완료된 인용 페이지 관련성 검증 기록이 없습니다."}
              확인되지 않은 페이지를 관련성 확정 0개로 표시하지 않습니다.
            </p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs leading-5 text-muted-foreground">
        모든 결과는 선택한 Run에서 관찰된 답변과 당시 저장된 검증 기록을 기준으로 합니다.
        관찰 수치만으로 업체의 우수성이나 AI 노출의 원인을 판단할 수 없습니다.
      </p>
    </div>
  );
}

function HistoryRunButton({ item, selected, onSelect }: {
  item: MeasurementHistoryRunItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const available = item.status === "available";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(item.runId)}
      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${selected
        ? "border-primary bg-primary/5"
        : "hover:border-primary/50 hover:bg-muted/50"}`}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{formatSeoul(item.measuredAt)}</span>
        <Badge variant={available ? "outline" : "secondary"}>
          {available ? "열람 가능" : "상세 확인 필요"}
        </Badge>
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {available ? `확정 노출 ${item.confirmedCount}/${item.validCount} · 상위 3곳 ${item.top3Count}/${item.validCount}` :
          "측정 날짜는 보존되어 있습니다. 선택하면 상세 결과를 다시 확인합니다."}
      </span>
    </button>
  );
}

function MeasurementHistoryPage() {
  const { activeOrgId, session } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const businessId = businesses.selectedBusinessId;
  const [pageState, setPageState] = useState<{ orgId: string; businessId: string; page: number } | null>(null);
  const [choice, setChoice] = useState<{ orgId: string; businessId: string; runId: string } | null>(null);
  const page = pageState?.orgId === activeOrgId && pageState.businessId === businessId
    ? pageState.page : 0;
  // List dates using the signed-in user's own session and the existing RLS
  // policy. A failed server-function transport must never hide paid history.
  const catalogQuery = useQuery({
    queryKey: ["measurement-history-member-dates", session?.user.id, activeOrgId, businessId, page],
    enabled: !!session?.user.id && !!activeOrgId && !!businessId,
    retry: 1,
    queryFn: () => fetchMemberHistoryCatalog({
      orgId: activeOrgId as string, businessId: businessId as string, page,
    }),
  });

  // A server-only query can enrich those SAME Run IDs with confirmed counts,
  // but is deliberately not part of the date index's availability gate.
  const fetchCatalog = useServerFn(listMeasurementHistory);
  const serverCatalogQuery = useQuery({
    queryKey: ["measurement-history-snapshot-enrichment", session?.user.id, activeOrgId, businessId, page],
    enabled: isMatchingHistoryCatalog({
      orgId: activeOrgId, businessId, page, response: catalogQuery.data,
    }) && catalogQuery.data?.ok === true && catalogQuery.data.data.runs.length > 0,
    retry: false,
    queryFn: () => fetchCatalog({ data: {
      orgId: activeOrgId as string, businessId: businessId as string, page,
    } }),
  });
  const mergedCatalog = enrichMemberHistoryCatalog(catalogQuery.data, serverCatalogQuery.data);
  const catalog = isMatchingHistoryCatalog({
    orgId: activeOrgId,
    businessId,
    page,
    response: mergedCatalog,
  }) && mergedCatalog?.ok
    ? mergedCatalog.data : null;

  // Don't run a privileged historical-detail request until the user chooses
  // an archived Run. The index is still useful when the server is unavailable.
  const selectedRunId = choice?.orgId === activeOrgId &&
    choice.businessId === businessId &&
    catalog?.runs.some((item) => item.runId === choice.runId)
    ? choice.runId
    : null;
  const fetchDetail = useServerFn(getMeasurementHistoryDetail);
  const detailQuery = useQuery({
    queryKey: ["measurement-history-detail", session?.user.id, activeOrgId, businessId, selectedRunId],
    enabled: !!session?.user.id && !!activeOrgId && !!businessId && !!selectedRunId,
    retry: 1,
    queryFn: () => fetchDetail({ data: {
      orgId: activeOrgId as string, businessId: businessId as string,
      runId: selectedRunId as string,
    } }),
  });
  const detail = detailQuery.data;
  const report = canDisplayHistoryDetail({
    orgId: activeOrgId, businessId, runId: selectedRunId, response: detail,
  }) && detail?.ok ? detail.data.report : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="space-y-3">
        <Button asChild variant="link" className="h-auto px-0">
          <Link to="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> 최신 AI 진단으로 돌아가기</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <CalendarDays className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">측정 기록</h1>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          완료된 AI 진단을 날짜별로 다시 볼 수 있습니다. 새로운 측정을 해도 이전에 관찰된 질문, 다른 업체, 인용 출처 기록은 이곳에서 확인합니다.
        </p>
        <BusinessSelector
          options={businesses.options}
          value={businessId}
          onChange={businesses.select}
          isLoading={businesses.isLoading}
          isError={businesses.isError}
        />
      </header>

      {!businessId ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground">
          {businesses.isLoading ? "업체 목록을 불러오는 중입니다." : "측정 기록을 확인할 업체를 선택해 주세요."}
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">측정 날짜 선택</CardTitle>
              <p className="text-xs text-muted-foreground">같은 날 여러 번 측정했다면 완료 시간으로 구분합니다.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {catalogQuery.isPending || catalogQuery.isFetching ? (
                <p className="text-sm text-muted-foreground">측정 기록을 불러오는 중입니다.</p>
              ) : !catalog ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground" role="alert">
                    {catalogQuery.isError
                      ? "측정 기록 요청에 실패했습니다. 서버 연결 상태를 확인한 뒤 다시 시도해 주세요."
                      : catalogQuery.data?.ok === false && catalogQuery.data.error === "FORBIDDEN"
                        ? "현재 계정은 선택한 조직의 측정 기록을 볼 권한이 없습니다."
                        : catalogQuery.data?.ok === false && catalogQuery.data.error === "NOT_AVAILABLE"
                          ? "선택한 업체의 측정 기록을 조회할 수 없습니다."
                          : "측정 기록을 일시적으로 불러오지 못했습니다. 다시 시도해 주세요."}
                  </p>
                  <Button type="button" variant="outline" size="sm" disabled={catalogQuery.isFetching}
                    onClick={() => void catalogQuery.refetch()}>
                    측정 기록 다시 불러오기
                  </Button>
                </div>
              ) : !catalog.runs.length ? (
                <p className="text-sm text-muted-foreground">
                  {page === 0 ? "현재 업체에 완료된 고객 측정 기록이 없습니다." : "이 페이지에는 측정 기록이 없습니다."}
                </p>
              ) : (
                <div className="space-y-3">
                  {catalog.snapshotStatus === "temporarily_unavailable" && (
                    <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground" role="status">
                      완료된 측정 날짜는 확인됐습니다.
                      {serverCatalogQuery.isFetching
                        ? " 저장된 상세 수치를 추가로 확인 중입니다."
                        : " 저장된 상세 수치는 날짜를 선택하여 확인할 수 있습니다."}
                    </p>
                  )}
                  <div className="grid gap-2 md:grid-cols-2">
                  {catalog.runs.map((item) => (
                    <HistoryRunButton
                      key={item.runId}
                      item={item}
                      selected={selectedRunId === item.runId}
                      onSelect={(runId) => setChoice({
                        orgId: activeOrgId as string,
                        businessId, runId,
                      })}
                    />
                  ))}
                  </div>
                </div>
              )}
              <div className="flex justify-between gap-2 pt-2">
                <Button variant="outline" size="sm" disabled={page === 0 || catalogQuery.isFetching}
                  onClick={() => {
                    setPageState({ orgId: activeOrgId as string, businessId, page: page - 1 });
                    setChoice(null);
                  }}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> 최신 기록
                </Button>
                <span className="self-center text-xs text-muted-foreground">{page + 1}페이지</span>
                <Button variant="outline" size="sm" disabled={!catalog?.hasNextPage || catalogQuery.isFetching}
                  onClick={() => {
                    setPageState({ orgId: activeOrgId as string, businessId, page: page + 1 });
                    setChoice(null);
                  }}>
                  이전 기록 <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {selectedRunId && (detailQuery.isPending || detailQuery.isFetching) && (
            <Card><CardContent className="py-8 text-sm text-muted-foreground">선택한 측정의 저장된 결과를 확인 중입니다.</CardContent></Card>
          )}
          {selectedRunId && !detailQuery.isPending && !detailQuery.isFetching && !report && (
            <Card><CardContent className="space-y-3 py-8 text-sm text-muted-foreground">
              <p role="alert">
                선택한 날짜의 상세 결과를 아직 열람할 수 없습니다.
                기록을 임의로 생성하거나 다른 회차의 데이터를 대신 보여주지 않습니다.
              </p>
              <Button type="button" variant="outline" size="sm"
                onClick={() => void detailQuery.refetch()}>
                상세 결과 다시 확인
              </Button>
            </CardContent></Card>
          )}
          {selectedRunId && !detailQuery.isFetching && report && <ArchivedReport report={report} />}
        </>
      )}
    </div>
  );
}
