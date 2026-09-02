import { Fragment, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { aggregateBusinessShare } from "@/lib/business-share.helpers";
import { RESOLVER_VERSION } from "@/lib/entity-canonical-resolver";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RUN_STATUS_LABELS, runStatusVariant } from "./runs.index";


export const Route = createFileRoute("/_authenticated/runs/$runId")({
  head: () => ({
    meta: [
      { title: "AI 측정 결과 · 차보임 CHABOIM" },
      {
        name: "description",
        content: "우리 업체가 AI 답변에 얼마나 등장했는지, 함께 등장한 업체와 출처를 확인합니다.",
      },
      { property: "og:title", content: "AI 측정 결과 · 차보임 CHABOIM" },
      { property: "og:description", content: "AI 노출 측정 결과 상세" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),

  component: RunDetailPage,
});



const formatPositionLabel = (position: number | null | undefined) =>
  typeof position === "number" && Number.isInteger(position) && position > 0
    ? `${position}위`
    : "순위 없음";

const formatMentionPosition = (
  mentioned: boolean | null | undefined,
  position: number | null | undefined,
) => (mentioned ? `예 (${formatPositionLabel(position)})` : "아니오");
const pct = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "-" : `${Number(n).toFixed(1)}%`;

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "대기",
  processing: "진행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

const IN_PROGRESS = new Set(["draft", "queued", "running"]);


const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

type Mention = {
  id: string;
  measurement_id: string;
  matched_business_id: string | null;
  display_name: string;
  matched_alias: string | null;
  position: number;
  explicit_rank: boolean;
  confidence: string;
  resolution_confidence: string | null;
};


/** Mention that already passed verification + canonical resolution. */
type ApprovedMention = Mention & {
  canonical_key: string;
  canonical_display_name: string;
};

/**
 * `measurement_entity_verifications` is applied by a separate Supabase migration
 * and is not in the generated Database types yet. Read-only access through a
 * narrowly typed loose view; reason codes are never selected.
 */
type LooseSelect<TRow> = {
  select: (columns: string) => LooseSelect<TRow>;
  eq: (column: string, value: unknown) => LooseSelect<TRow>;
  in: (column: string, values: readonly unknown[]) => LooseSelect<TRow>;
  then: <T>(
    onfulfilled: (value: { data: TRow[] | null; error: unknown }) => T,
  ) => Promise<T>;
};

/** Canonical grouping only: reason codes / confidence are never selected. */
type CanonicalRow = {
  measurement_mention_id: string;
  canonical_key: string;
  canonical_display_name: string;
  resolution_status: string;
};

type Source = {
  id: string;
  measurement_id: string;
  url: string;
  domain: string | null;
  title: string | null;
};

function RunDetailPage() {
  const { runId } = Route.useParams();
  const { activeOrgId, canWrite } = useOrg();
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const queryClient = useQueryClient();

  // 저장된 답변 재분석: 서버(reparse-measurements)가 JWT와 조직 권한을 검증하고
  // 후처리·출처 귀속을 다시 생성한다. 프론트는 호출과 갱신만 담당한다.
  const handleReparse = async () => {
    if (reparsing) return;
    setReparsing(true);
    try {
      const { error } = await supabase.functions.invoke("reparse-measurements", {
        body: { run_id: runId, dry_run: false },
      });
      if (error) {
        toast.error("다시 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      toast.success("저장된 답변을 다시 분석했습니다.");
      await queryClient.invalidateQueries({ queryKey: ["run-detail", runId, activeOrgId] });
      await queryClient.invalidateQueries({ queryKey: ["visibility-actions"] });
    } catch {
      toast.error("다시 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setReparsing(false);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["run-detail", runId, activeOrgId],
    enabled: !!activeOrgId,
    refetchInterval: (q) => {
      const s = (q.state.data as { run?: { status: string } } | undefined)?.run?.status;
      return s && TERMINAL.has(s) ? false : 5000;
    },
    queryFn: async () => {
      const [run, jobs, measurements, overall, byProvider, qMetrics, latestEvent] = await Promise.all([
        supabase
          .from("measurement_runs")
          .select("*")
          .eq("id", runId)
          .eq("org_id", activeOrgId!)
          .maybeSingle(),
        supabase
          .from("measurement_jobs")
          .select(
            "id, question_id, provider, provider_model, repetition_no, status, error_code, error_message, actual_cost_usd, created_at",
          )
          .eq("run_id", runId)
          .order("repetition_no", { ascending: true }),
        supabase
          .from("measurements")
          .select(
            "id, job_id, question_id, provider, provider_model, response_text, was_client_mentioned, client_position, client_domain_cited, valid, invalid_reason, parser_version, parse_confidence, manual_review_required, actual_cost_usd, observed_at",
          )
          .eq("run_id", runId),
        supabase.from("run_metrics_overall").select("*").eq("run_id", runId).maybeSingle(),
        supabase.from("run_metrics").select("*").eq("run_id", runId),
        supabase.from("question_metrics").select("*").eq("run_id", runId),
        supabase
          .from("system_events")
          .select("event_type, created_at, message, severity")
          .eq("org_id", activeOrgId!)
          .eq("run_id", runId)
          .in("event_type", [
            "visibility_postprocess_triggered",
            "visibility_postprocess_started",
            "visibility_postprocess_completed",
            "visibility_postprocess_failed",
          ])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (run.error) throw run.error;
      if (jobs.error) throw jobs.error;
      if (measurements.error) throw measurements.error;

      const measurementList = measurements.data ?? [];
      const mIds = measurementList.map((m) => m.id);

      let mentions: Mention[] = [];
      const canonicals = new Map<string, CanonicalRow>();
      let sources: Source[] = [];
      if (mIds.length > 0) {
        const [mn, sr] = await Promise.all([
          supabase
            .from("measurement_mentions")
            .select(
              "id, measurement_id, matched_business_id, display_name, matched_alias, position, explicit_rank, confidence, entity_kind, specificity, count_as_confirmed_business, resolution_confidence",
            )
            .in("measurement_id", mIds)
            .order("position", { ascending: true }),
          supabase
            .from("measurement_sources")
            .select("id, measurement_id, url, domain, title")
            .in("measurement_id", mIds),
        ]);
        mentions = (mn.data ?? []) as Mention[];
        sources = (sr.data ?? []) as Source[];

        const mentionIds = mentions.map((m) => m.id);
        if (mentionIds.length > 0) {
          const { data: cRows } = await (
            supabase as unknown as { from: (t: string) => LooseSelect<CanonicalRow> }
          )
            .from("measurement_entity_canonicalizations")
            .select(
              "measurement_mention_id, canonical_key, canonical_display_name, resolution_status",
            )
            .eq("resolver_version", RESOLVER_VERSION)
            .in("measurement_mention_id", mentionIds);
          for (const c of cRows ?? []) canonicals.set(c.measurement_mention_id, c);
        }
      }

      const ids = Array.from(new Set((jobs.data ?? []).map((j) => j.question_id)));
      let prompts = new Map<string, string>();
      if (ids.length > 0) {
        const { data: qs } = await supabase.from("questions").select("id, prompt_text").in("id", ids);
        prompts = new Map((qs ?? []).map((q) => [q.id, q.prompt_text]));
      }

      let businessName = "-";
      let questionCount = 0;
      let targetBusinessId: string | null = null;
      let competitorIds = new Set<string>();
      if (run.data) {
        targetBusinessId = run.data.business_id;
        const [b, q, comp] = await Promise.all([
          supabase.from("businesses").select("name").eq("id", run.data.business_id).maybeSingle(),
          supabase
            .from("questions")
            .select("id", { count: "exact", head: true })
            .eq("question_set_id", run.data.question_set_id)
            .eq("active", true),
          supabase
            .from("business_competitors")
            .select("competitor_business_id")
            .eq("target_business_id", run.data.business_id)
            .eq("active", true),
        ]);
        businessName = b.data?.name ?? "-";
        questionCount = q.count ?? 0;
        competitorIds = new Set((comp.data ?? []).map((c) => c.competitor_business_id));
      }

      return {
        run: run.data,
        jobs: jobs.data ?? [],
        measurements: measurementList,
        mentions,
        canonicals,
        sources,
        overall: overall.data,
        byProvider: byProvider.data ?? [],
        questionMetrics: qMetrics.data ?? [],
        latestEvent: latestEvent.data ?? null,
        prompts,
        businessName,
        questionCount,
        targetBusinessId,
        competitorIds,
      };
    },
  });



  if (isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>;
  }
  if (error || !data?.run) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">실행을 찾을 수 없거나 조회 권한이 없습니다.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/runs">목록으로</Link>
        </Button>
      </div>
    );
  }

  const run = data.run;
  const measurementByJob = new Map(data.measurements.map((m) => [m.job_id, m]));
  const domainCitedRate =
    data.byProvider.length > 0 ? data.byProvider[0]!.domain_citation_rate_pct : null;
  const inProgress = IN_PROGRESS.has(run.status);
  const showSummary = run.status === "completed" || run.status === "partial";
  const totalJobs = Number(run.total_jobs ?? 0);
  const completedJobs = Number(run.completed_jobs ?? 0);
  const progressPct = totalJobs > 0 ? Math.min(100, (completedJobs / totalJobs) * 100) : 0;


  const validMeasurementCount =
    data.overall?.valid_n ?? data.measurements.filter((m) => m.valid).length;
  // Business 표시 gate: Entity Verification + Canonical Resolver를 통과해
  // canonicalization row가 저장된 mention만 업체로 표시/집계한다 (fail-closed).
  // 추가 text/entity heuristic은 적용하지 않는다.
  const approvedMentions = data.mentions.flatMap((m) => {
    const c = data.canonicals.get(m.id);
    if (!c) return [];
    return [
      {
        ...m,
        canonical_key: c.canonical_key,
        canonical_display_name: c.canonical_display_name || m.display_name,
      },
    ];
  });
  const shareRows = aggregateBusinessShare({
    mentions: approvedMentions,
    validMeasurementCount: Number(validMeasurementCount ?? 0),
  });


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{run.name}</h1>
          <p className="text-sm text-muted-foreground">
            AI 노출 측정 · 내 업체 {data.businessName}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={runStatusVariant(run.status)}>
            {RUN_STATUS_LABELS[run.status] ?? run.status}
          </Badge>
          {canWrite &&
          run.run_type === "audit" &&
          run.phase === "standalone" &&
          (run.status === "completed" || run.status === "partial") ? (
            <Button variant="outline" size="sm" onClick={handleReparse} disabled={reparsing}>
              {reparsing ? "다시 분석 중…" : "저장된 답변 다시 분석"}
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to="/runs">목록으로</Link>
          </Button>
        </div>
      </div>

      {/* 측정 진행 중 안내 */}
      {inProgress ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 노출 측정 진행 중</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">
              {completedJobs} / {totalJobs} 질문 확인 완료
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              모든 질문 측정이 끝난 뒤 최종 노출률과 경쟁업체·출처 결과를 정리해 보여드립니다.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* 결과 정리 상태 */}
      {(() => {
        const runRow = data.run;
        const eligible =
          runRow.run_type === "audit" &&
          runRow.phase === "standalone" &&
          (runRow.status === "completed" || runRow.status === "partial");
        if (!eligible) return null;
        const event = data.latestEvent;
        if (!event) return null;
        let badge = "분석 완료";
        let variant: "secondary" | "destructive" = "secondary";
        let message = "경쟁업체와 출처까지 정리되었습니다.";
        if (event.event_type === "visibility_postprocess_failed") {
          badge = "결과 정리 확인 필요";
          variant = "destructive";
          message = "결과 정리를 완료하지 못했습니다. 잠시 후 다시 확인해 주세요.";
        } else if (
          event.event_type === "visibility_postprocess_triggered" ||
          event.event_type === "visibility_postprocess_started"
        ) {
          badge = "결과 정리 중";
          message = "경쟁업체와 출처를 정리하고 있습니다.";
        }
        return (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <Badge variant={variant}>{badge}</Badge>
              <span className="text-xs text-muted-foreground">{message}</span>
            </CardContent>
          </Card>
        );
      })()}

      {/* 측정 결과 요약 */}
      {showSummary ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">측정 결과 요약</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat
                  label="분석 완료 질문"
                  value={`${data.overall?.valid_n ?? 0} / ${data.questionCount}`}
                />
                <Stat
                  label="우리 업체가 나온 질문"
                  value={`${data.overall?.mention_n ?? 0}개`}
                />
                <Stat label="AI 노출률" value={pct(data.overall?.inclusion_rate_pct)} />
                <Stat label="1위 노출률" value={pct(data.overall?.first_mention_rate_pct)} />
                <Stat label="상위 3위 노출률" value={pct(data.overall?.top3_rate_pct)} />
                <Stat label="공식 사이트 인용률" value={pct(domainCitedRate)} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="질문 수" value={`${data.questionCount}개`} />
            <Stat label="측정 횟수" value={`${run.repetitions}회`} />
            <Stat label="완료 시각" value={formatSeoul(run.completed_at)} />
          </div>
        </>
      ) : null}



      {/* 질문별 결과 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">질문별 결과</CardTitle>
        </CardHeader>
        <CardContent>
          {data.jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              측정을 준비하고 있습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>질문</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>우리 업체 노출</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((j) => {
                    const m = measurementByJob.get(j.id);
                    const open = openJob === j.id;
                    return (
                      <Fragment key={j.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpenJob(open ? null : j.id)}
                        >
                          <TableCell className="max-w-[380px] text-sm">
                            {data.prompts.get(j.question_id) ?? j.question_id}
                          </TableCell>
                          <TableCell>
                            <Badge variant={j.status === "failed" ? "destructive" : "secondary"}>
                              {JOB_STATUS_LABELS[j.status] ?? j.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {m ? formatMentionPosition(m.was_client_mentioned, m.client_position) : "-"}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {open ? "접기 ▲" : "상세 ▼"}
                          </TableCell>
                        </TableRow>
                        {open ? (
                          <TableRow>
                            <TableCell colSpan={4} className="bg-muted/40">
                              <JobDetail
                                job={j}
                                prompt={data.prompts.get(j.question_id) ?? j.question_id}
                                measurement={m ?? null}
                                mentions={approvedMentions.filter((x) => x.measurement_id === m?.id)}
                                sources={data.sources.filter((x) => x.measurement_id === m?.id)}
                                targetBusinessId={data.targetBusinessId}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI에서 함께 등장한 업체 */}
      {showSummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI에서 함께 등장한 업체</CardTitle>
          </CardHeader>
          <CardContent>
            {shareRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                아직 함께 등장한 업체가 확인되지 않았습니다. 결과 정리가 끝나면 표시됩니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>업체명</TableHead>
                      <TableHead className="text-right">등장한 질문 수</TableHead>
                      <TableHead className="text-right">등장률</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shareRows.map((s) => (
                      <TableRow key={s.key}>
                        <TableCell className="text-sm">
                          <span className="font-medium">{s.display_name}</span>
                          {s.matched_business_id && s.matched_business_id === data.targetBusinessId ? (
                            <Badge className="ml-2">내 업체</Badge>
                          ) : s.matched_business_id && data.competitorIds.has(s.matched_business_id) ? (
                            <Badge variant="secondary" className="ml-2">
                              등록 경쟁업체
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="ml-2">
                              자동 발견
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{s.response_count}</TableCell>
                        <TableCell className="text-right">{pct(s.answer_share_pct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        AI 답변은 측정 시점과 질문에 따라 달라질 수 있습니다. 차보임은 동일한 질문을 반복 관찰해
        나타나는 패턴을 확인합니다.
      </p>

    </div>
  );
}

type JobRow = {
  id: string;
  question_id: string;
  provider: string;
  provider_model: string;
  repetition_no: number;
  status: string;
  error_code: string | null;
  error_message: string | null;
  actual_cost_usd: number | string;
};

type MeasurementRow = {
  id: string;
  response_text: string;
  was_client_mentioned: boolean;
  client_position: number | null;
  client_domain_cited: boolean;
  valid: boolean;
  invalid_reason: string | null;
  parser_version: string;
  parse_confidence: string;
  manual_review_required: boolean;
  actual_cost_usd: number | string;
  observed_at: string;
};

function JobDetail({
  job,
  prompt,
  measurement,
  mentions,
  sources,
  targetBusinessId,
}: {
  job: JobRow;
  prompt: string;
  measurement: MeasurementRow | null;
  mentions: ApprovedMention[];
  sources: Source[];
  targetBusinessId: string | null;
}) {
  const [showText, setShowText] = useState(false);

  return (
    <div className="space-y-4 py-3">
      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Field label="질문" value={prompt} />
        <Field label="측정 시각" value={measurement ? formatSeoul(measurement.observed_at) : "-"} />
        <Field label="상태" value={JOB_STATUS_LABELS[job.status] ?? job.status} />
      </div>

      {!measurement ? (
        <p className="text-xs text-muted-foreground">아직 결과가 준비되지 않았습니다.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={measurement.was_client_mentioned ? "default" : "outline"}>
              우리 업체 노출: {measurement.was_client_mentioned ? "예" : "아니오"}
            </Badge>
            <Badge variant="secondary">
              언급 순위: {formatPositionLabel(measurement.client_position)}
            </Badge>
            <Badge variant="secondary">
              공식 사이트 인용: {measurement.client_domain_cited ? "예" : "아니오"}
            </Badge>
          </div>

          <div>
            <Button variant="outline" size="sm" onClick={() => setShowText((v) => !v)}>
              {showText ? "원문 AI 답변 접기" : "원문 AI 답변 보기"}
            </Button>
            {showText ? (
              <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs leading-relaxed">
                {measurement.response_text}
              </div>
            ) : null}
          </div>

          {(() => {
            const confirmed = mentions
              .slice()
              .sort((a, b) => a.position - b.position);
            return (
              <div>
                <p className="mb-1 text-xs font-semibold">감지된 업체 ({confirmed.length})</p>
                {confirmed.length === 0 ? (
                  <p className="text-xs text-muted-foreground">감지된 업체가 없습니다.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {confirmed.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {m.position}위 {m.canonical_display_name}
                        </span>
                        {m.matched_business_id === targetBusinessId && targetBusinessId ? (
                          <Badge>내 업체</Badge>
                        ) : m.matched_business_id ? (
                          <Badge variant="secondary">등록 경쟁업체</Badge>
                        ) : (
                          <Badge variant="outline">자동 발견</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}



          <div>
            <p className="mb-1 text-xs font-semibold">출처 ({sources.length})</p>
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">저장된 출처가 없습니다.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {sources.map((s) => (
                  <li key={s.id} className="truncate">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {s.title || s.url}
                    </a>
                    {s.domain ? <span className="ml-2 text-muted-foreground">{s.domain}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium break-words">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-1 text-sm font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
