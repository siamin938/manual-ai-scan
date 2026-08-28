import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  getCustomerReport,
  type ReportExperimentDTO,
  type ReportCoverageDTO,
  type ReportInsightDTO,
} from "@/lib/customer-report.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports/customer")({
  head: () => ({
    meta: [
      { title: "고객 보고서 · AI Visibility Lab" },
      {
        name: "description",
        content:
          "AI 노출 상태, 핵심 관찰, 보완 영역, 권장 행동, 실험 전후 결과를 한 화면에 정리한 고객용 자동 보고서입니다.",
      },
      { property: "og:title", content: "고객 보고서 · AI Visibility Lab" },
      {
        property: "og:description",
        content: "AI 노출 상태와 개선 실험 결과를 정리한 고객용 자동 보고서.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerReportPage,
});

const SOURCE_LABELS: Record<string, string> = {
  profile_coverage_item: "프로필 커버리지",
  insight_action: "AI 인사이트",
  unknown: "기타",
};

const OUTCOME_LABELS: Record<string, string> = {
  directional_improvement: "개선 방향성 관찰",
  directional_decline: "악화 방향성 관찰",
  improved_signal: "개선 방향성 관찰",
  worsened_signal: "악화 방향성 관찰",
  no_clear_change: "뚜렷한 변화 없음",
};

const GRADE_LABELS: Record<string, string> = {
  insufficient: "근거 부족",
  directional: "방향성 관찰",
  supported: "근거 있음",
  strong: "근거 충분",
};

const COVERAGE_STATUS_LABELS: Record<string, string> = {
  missing: "미노출",
  partial: "일부 노출",
  covered: "전회 노출",
};

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function stageLabel(e: ReportExperimentDTO): string {
  const b = e.baseline;
  const f = e.followup;
  if (e.evaluatedAt || e.status === "completed") return "완료";

  if (f.finalized) return "결과 비교 대기";
  if (f.runId) {
    if (f.runStatus === "completed" && !f.finalized) return "Follow-up 확정 필요";
    if (f.runStatus === "draft") return "Follow-up 준비";
    if (f.runStatus === "queued" || f.runStatus === "running") return "Follow-up 측정 중";
    return "Follow-up 확인 필요";
  }
  if (e.interventionAt) return "Follow-up 대기";

  if (b.finalized) return "변경 적용 대기";
  if (b.runId) {
    if (b.runStatus === "completed" && !b.finalized) return "Baseline 확정 필요";
    if (b.runStatus === "draft") return "Baseline 준비";
    if (b.runStatus === "queued" || b.runStatus === "running") return "Baseline 측정 중";
    return "Baseline 확인 필요";
  }
  return "초안";
}


type HeadlineBlock = { label: string; value: string; sub?: string | undefined };

function buildHeadline(
  coverage: ReportCoverageDTO | null,
  insight: ReportInsightDTO | null,
  experiments: ReportExperimentDTO[],
): {
  badge: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  sentence: string;
  blocks: HeadlineBlock[];
} {
  let badge = "측정 데이터 준비 필요";
  let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
  let sentence = "아직 자동 커버리지 측정 결과가 없어 현재 노출 상태를 요약할 수 없습니다.";

  if (coverage) {
    if (coverage.missingQuestionCount > 0) {
      badge = "공개 정보 보강 우선";
      badgeVariant = "destructive";
    } else if (coverage.partialQuestionCount > 0) {
      badge = "노출 안정화 필요";
      badgeVariant = "secondary";
    } else {
      badge = "기본 커버리지 확보";
      badgeVariant = "default";
    }
    sentence = `현재 ${coverage.questionCount}개 질문 중 ${coverage.missingQuestionCount}개가 미노출, ${coverage.partialQuestionCount}개가 일부 노출이며 실제 답변 포함률은 ${pct(coverage.measurementCoverageRate)}입니다.`;
  }

  const firstGap = coverage?.gaps[0];
  const waitingIntervention = experiments.filter(
    (e) =>
      !["cancelled", "completed"].includes(e.status) &&
      e.baseline.finalized &&
      !e.interventionAt,
  ).length;
  const waitingFollowup = experiments.filter(
    (e) =>
      !["cancelled", "completed"].includes(e.status) &&
      !!e.interventionAt &&
      !e.followup.runId,
  ).length;

  const firstAction = insight?.actions[0];

  let nextStep = "—";
  if (waitingIntervention > 0) {
    nextStep = `${waitingIntervention}개 실험이 실제 변경 적용을 기다리고 있습니다.`;
  } else if (waitingFollowup > 0) {
    nextStep = `${waitingFollowup}개 실험이 Follow-up 측정을 기다리고 있습니다.`;
  } else if (firstAction) {
    nextStep = `우선 제안: ${firstAction.title}`;
  }

  const evaluatedCount = experiments.filter((e) => e.evaluatedAt).length;

  return {
    badge,
    badgeVariant,
    sentence,
    blocks: [
      {
        label: "가장 먼저 보완할 영역",
        value: firstGap?.title ?? "—",
        sub: firstGap?.questionText ?? undefined,
      },
      { label: "다음 실행 단계", value: nextStep },
      {
        label: "검증 진행",
        value: `실험 ${experiments.length}건 · 결과 확정 ${evaluatedCount}건`,
      },
    ],
  };
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}


function CustomerReportPage() {
  const { activeOrgId } = useOrg();
  const shared = useActiveTargetBusiness();
  const businessId = shared.getSelectedId(activeOrgId);
  const fetchReport = useServerFn(getCustomerReport);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["customer-report", activeOrgId, businessId],
    enabled: !!activeOrgId,
    queryFn: () => fetchReport({ data: { orgId: activeOrgId!, businessId } }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>보고서를 불러오지 못했습니다</AlertTitle>
        <AlertDescription>잠시 후 다시 시도해 주세요.</AlertDescription>
      </Alert>
    );
  }

  const { business, coverage, insight, experiments } = data;
  const headline = buildHeadline(coverage, insight, experiments);



  return (
    <div className="print-page print-report space-y-6">
      <div className="no-print flex flex-wrap items-center gap-2">
        {data.businesses.length > 0 && (
          <Select
            value={business?.id ?? ""}
            onValueChange={(v) => setBusinessId(v)}
          >
            <SelectTrigger className="h-9 w-[240px] text-sm">
              <SelectValue placeholder="고객 업체 선택" />
            </SelectTrigger>
            <SelectContent>
              {data.businesses.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" onClick={() => window.print()}>
          인쇄 / PDF 저장
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/reports/manual">수동 점검 보고서</Link>
        </Button>
      </div>

      <header className="border-b pb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          AI Visibility Lab · 고객 보고서
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {business?.name ?? "고객 업체 없음"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[business?.category, business?.region, business?.city].filter(Boolean).join(" · ") ||
            "업종/지역 정보 없음"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          생성 시각(KST): {formatSeoul(data.generatedAt)}
        </p>
      </header>

      {!business && (
        <Alert>
          <AlertTitle>등록된 고객 업체가 없습니다</AlertTitle>
          <AlertDescription>
            업체 관리 화면에서 고객 업체를 먼저 등록해 주세요.
          </AlertDescription>
        </Alert>
      )}

      {business && (
        <>
          {/* 한눈에 보는 결론 */}
          <section className="print-section space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">한눈에 보는 결론</h2>
              <Badge variant={headline.badgeVariant}>{headline.badge}</Badge>
            </div>
            <Card className="print-avoid-break">
              <CardContent className="space-y-4 p-4">
                <p className="text-sm leading-relaxed">{headline.sentence}</p>
                <div className="grid gap-3 md:grid-cols-3">
                  {headline.blocks.map((b) => (
                    <div key={b.label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{b.label}</p>
                      <p className="mt-1 text-sm font-medium">{b.value}</p>
                      {b.sub && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{b.sub}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ① 현재 AI 노출 상태 */}
          <section className="print-section space-y-3">
            <h2 className="text-lg font-semibold">① 현재 AI 노출 상태</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Kpi
                label="이번 측정 AI 커버리지"
                value={
                  coverage?.coverageScore === null || coverage?.coverageScore === undefined
                    ? "—"
                    : `${coverage.coverageScore.toFixed(0)}/100`
                }
                sub="현재 질문군·측정 조건 기준"
              />

              <Kpi label="노출된 질문 비율" value={pct(coverage?.questionCoverageRate)} />
              <Kpi label="실제 답변 포함률" value={pct(coverage?.measurementCoverageRate)} />
              <Kpi label="Top3 노출률" value={pct(coverage?.top3CoverageRate)} />
              <Kpi
                label="자사 도메인 인용률"
                value={
                  business?.hasOfficialDomain
                    ? pct(coverage?.clientDomainCitationRate)
                    : "미등록"
                }
              />
              <Kpi
                label="First-party 출처 인용률"
                value={
                  coverage?.firstPartyClassifierVersion === null ||
                  coverage?.firstPartyClassifierVersion === undefined ||
                  coverage?.clientFirstPartyCitationRate === null ||
                  coverage?.clientFirstPartyCitationRate === undefined
                    ? "미집계"
                    : pct(coverage.clientFirstPartyCitationRate)
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              노출된 질문 비율은 전체 질문 중 AI 답변에 한 번 이상 업체가 포함된 질문의 비율입니다.
              자사 도메인 인용률은 등록된 공식 도메인이 인용된 측정 비율입니다.
              First-party 출처 인용률은 검증된 자사 관리 출처(공식 도메인·네이버 플레이스·네이버 블로그 등)
              중 하나 이상이 출처로 인용된 측정 비율입니다. 두 인용률은 서로 다른 지표이며, 인과적 보장을
              의미하지 않습니다.
            </p>
            {coverage?.completedAt && (
              <p className="text-xs text-muted-foreground">
                측정 기준 시각(KST): {formatSeoul(coverage.completedAt)}
              </p>
            )}
          </section>

          {/* ② 현재 진단 요약 */}
          <section className="print-section print-first-page-end space-y-3">
            <h2 className="text-lg font-semibold">② 현재 진단 요약</h2>
            {coverage ? (
              <Card className="print-avoid-break">

                <CardContent className="space-y-2 p-4 text-sm">
                  <p>
                    측정한 질문 총 {coverage.questionCount}개 중{" "}
                    <strong>{coverage.coveredQuestionCount}개</strong>는 모든 답변에 노출,{" "}
                    <strong>{coverage.partialQuestionCount}개</strong>는 일부만 노출,{" "}
                    <strong>{coverage.missingQuestionCount}개</strong>는 노출되지 않았습니다.
                  </p>
                  {coverage.evidenceGrade && (
                    <p className="text-xs text-muted-foreground">
                      근거 수준: {GRADE_LABELS[coverage.evidenceGrade] ?? coverage.evidenceGrade}
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">아직 커버리지 분석 결과가 없습니다.</p>
            )}
            {coverage?.evidenceGrade === "directional" && (
              <Alert>
                <AlertTitle>해석 주의</AlertTitle>
                <AlertDescription>
                  현재 결과는 방향성 관찰이며 확정적 인과 결론이 아닙니다.
                </AlertDescription>
              </Alert>
            )}
          </section>

          {/* ③ 핵심 관찰 */}
          <section className="print-section space-y-3">
            <h2 className="text-lg font-semibold">③ 핵심 관찰</h2>
            {insight && insight.findings.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {insight.findings.map((f) => (
                  <Card key={f.id} className="print-avoid-break">

                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{f.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p className="text-muted-foreground">{f.summary}</p>
                      {f.questionText && (
                        <p className="text-xs text-muted-foreground">관련 질문: {f.questionText}</p>
                      )}
                      {f.competitorName && (
                        <p className="text-xs text-muted-foreground">
                          비교 업체: {f.competitorName}
                        </p>
                      )}
                      <Badge variant="secondary">
                        근거 수준: {GRADE_LABELS[f.evidenceGrade] ?? f.evidenceGrade}
                      </Badge>

                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">아직 정리된 관찰 결과가 없습니다.</p>
            )}
          </section>

          {/* ④ 우선 보완 영역 */}
          <section className="print-section space-y-3">
            <h2 className="text-lg font-semibold">④ 우선 보완 영역</h2>
            {coverage && coverage.gaps.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {coverage.gaps.map((g) => (
                  <Card key={g.id} className="print-avoid-break">

                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{g.title}</CardTitle>
                        <Badge
                          variant={g.coverageStatus === "missing" ? "destructive" : "secondary"}
                        >
                          {COVERAGE_STATUS_LABELS[g.coverageStatus] ?? g.coverageStatus}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {g.questionText && (
                        <p className="text-muted-foreground">질문: {g.questionText}</p>
                      )}
                      <div>
                        <p className="text-xs font-medium">우선 점검할 공개 정보 후보</p>
                        <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                          {g.profileFields.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                        <p className="mt-1 text-xs text-muted-foreground">
                          현재 측정에서 노출이 약한 질문이 요구하는 정보 후보입니다. 실제 공개정보의
                          누락 여부를 확인한 뒤 사실 기반으로 보완합니다.
                        </p>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        현재 관찰: {g.measurementCount}회 측정 중 {g.mentionedCount}회 노출 (
                        {pct(g.mentionRate)})
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">현재 우선 보완 영역이 없습니다.</p>
            )}
          </section>

          {/* ⑤ 권장 다음 행동 */}
          <section className="print-section space-y-3">
            <h2 className="text-lg font-semibold">⑤ 권장 다음 행동</h2>
            {insight && insight.actions.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {insight.actions.map((a) => (
                  <Card key={a.id} className="print-avoid-break">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{a.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">실행</p>
                        <p className="mt-0.5">{a.recommendedAction}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">이유</p>
                        <p className="mt-0.5 text-muted-foreground">{a.rationale}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">검증</p>
                        <p className="mt-0.5 text-muted-foreground">{a.validationPlan}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary">
                          근거 수준: {GRADE_LABELS[a.evidenceGrade] ?? a.evidenceGrade}
                        </Badge>
                        {a.recommendationMode === "test" && (
                          <Badge variant="outline">검증이 필요한 테스트 제안</Badge>
                        )}
                      </div>

                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">아직 권장 행동이 없습니다.</p>
            )}
          </section>

          {/* ⑥ 실험 진행 현황 */}
          <section className="print-section space-y-3">
            <h2 className="text-lg font-semibold">⑥ 실험 진행 현황</h2>

            {experiments.length > 0 ? (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>실험</TableHead>
                        <TableHead>단계</TableHead>
                        <TableHead>변경 전 노출</TableHead>
                        <TableHead>변경 후 노출</TableHead>
                        <TableHead>변화</TableHead>
                        <TableHead>결과</TableHead>
                        <TableHead className="no-print" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {experiments.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="align-top">
                            <div className="font-medium">{e.name}</div>
                            <Badge variant="secondary" className="mt-1">
                              {SOURCE_LABELS[e.sourceType] ?? e.sourceType}
                            </Badge>
                            {e.interventionDescription && (
                              <p className="mt-1 max-w-[320px] text-xs text-muted-foreground">
                                적용 변경: {e.interventionDescription}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="align-top">{stageLabel(e)}</TableCell>
                          <TableCell className="align-top tabular-nums">
                            {e.baseline.inclusionRate === null
                              ? "—"
                              : `${pct(e.baseline.inclusionRate)} (${e.baseline.inclusionCount}/${e.baseline.validCount})`}
                          </TableCell>
                          <TableCell className="align-top tabular-nums">
                            {e.followup.inclusionRate === null
                              ? "—"
                              : `${pct(e.followup.inclusionRate)} (${e.followup.inclusionCount}/${e.followup.validCount})`}
                          </TableCell>
                          <TableCell className="align-top tabular-nums">
                            {e.inclusionDeltaPoints === null
                              ? "—"
                              : `${e.inclusionDeltaPoints > 0 ? "+" : ""}${e.inclusionDeltaPoints.toFixed(1)}%p`}
                          </TableCell>
                          <TableCell className="align-top">
                            {e.resultClassification
                              ? (OUTCOME_LABELS[e.resultClassification] ?? e.resultClassification)
                              : "—"}
                            {e.evidenceGrade && (
                              <div className="text-xs text-muted-foreground">
                                {GRADE_LABELS[e.evidenceGrade] ?? e.evidenceGrade}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="no-print align-top">
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to="/experiments/$experimentId"
                                params={{ experimentId: e.id }}
                              >
                                실험 상세
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">아직 진행 중인 실험이 없습니다.</p>
            )}
          </section>

          {/* ⑦ 면책 */}
          <section className="print-section print-avoid-break space-y-2 border-t pt-4 text-xs text-muted-foreground">

            <h2 className="text-sm font-semibold text-foreground">보고서 해석 안내</h2>
            <p>
              본 보고서는 자동 API 측정, 인사이트 분석, 프로필 커버리지, 실험 데이터를 기반으로
              작성되었으며 측정 시점, 모델 버전, 검색 결과에 따라 값이 달라질 수 있습니다.
            </p>
            <p>표본이 작은 결과는 확정된 수치가 아니라 방향성으로 해석해야 합니다.</p>
            <p>AI 노출을 보장하지 않으며 변경의 인과효과를 확정하지 않습니다.</p>
          </section>
        </>
      )}
    </div>
  );
}
