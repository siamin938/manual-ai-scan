import { Fragment, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  aggregateBusinessShare,
  isConfirmedBusinessMention,
  type MentionFact,
} from "@/lib/mention-business-filter";
import { runPostprocess } from "@/lib/run-postprocess.functions";
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
import { ENGINE_LABEL, RUN_STATUS_LABELS, runStatusVariant } from "./runs.index";


export const Route = createFileRoute("/_authenticated/runs/$runId")({
  head: () => ({
    meta: [
      { title: "자동 측정 상세 · AI Visibility Lab" },
      {
        name: "description",
        content: "OpenAI Web Search API 벤치마크 실행의 측정 결과, 감지된 업체, 출처를 확인합니다.",
      },
      { property: "og:title", content: "자동 측정 상세 · AI Visibility Lab" },
      { property: "og:description", content: "자동 측정 실행 상세 및 측정 결과" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunDetailPage,
});

const usd = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
const pct = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "-" : `${Number(n).toFixed(1)}%`;

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "대기",
  processing: "진행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

type Mention = MentionFact & {
  id: string;
  matched_alias: string | null;
  position: number;
  explicit_rank: boolean;
  confidence: string;
  resolution_confidence: string | null;
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
  const { activeOrgId } = useOrg();
  const [openJob, setOpenJob] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["run-detail", runId, activeOrgId],
    enabled: !!activeOrgId,
    refetchInterval: (q) => {
      const s = (q.state.data as { run?: { status: string } } | undefined)?.run?.status;
      return s && TERMINAL.has(s) ? false : 5000;
    },
    queryFn: async () => {
      const [run, jobs, measurements, overall, byProvider, qMetrics, share] = await Promise.all([
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
        supabase.from("run_business_share").select("*").eq("run_id", runId),
      ]);
      if (run.error) throw run.error;
      if (jobs.error) throw jobs.error;
      if (measurements.error) throw measurements.error;

      const measurementList = measurements.data ?? [];
      const mIds = measurementList.map((m) => m.id);

      let mentions: Mention[] = [];
      let sources: Source[] = [];
      if (mIds.length > 0) {
        const [mn, sr] = await Promise.all([
          supabase
            .from("measurement_mentions")
            .select(
              "id, measurement_id, matched_business_id, display_name, matched_alias, position, explicit_rank, confidence",
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
        sources,
        overall: overall.data,
        byProvider: byProvider.data ?? [],
        questionMetrics: qMetrics.data ?? [],
        share: share.data ?? [],
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
  const model = data.jobs[0]?.provider_model ?? "-";
  const measurementByJob = new Map(data.measurements.map((m) => [m.job_id, m]));
  const domainCitedRate =
    data.byProvider.length > 0 ? data.byProvider[0]!.domain_citation_rate_pct : null;
  const reviewCount = data.measurements.filter(
    (m) => m.manual_review_required || m.parse_confidence === "low",
  ).length;
  const confidenceSummary = (() => {
    const counts: Record<string, number> = {};
    for (const m of data.measurements) counts[m.parse_confidence] = (counts[m.parse_confidence] ?? 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return "-";
    return entries.map(([k, v]) => `${CONFIDENCE_LABELS[k] ?? k} ${v}건`).join(" · ");
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{run.name}</h1>
          <p className="text-sm text-muted-foreground">
            {ENGINE_LABEL} · 대상 업체 {data.businessName}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={runStatusVariant(run.status)}>
            {RUN_STATUS_LABELS[run.status] ?? run.status}
          </Badge>
          <Button asChild variant="outline" size="sm">
            <Link to="/runs">목록으로</Link>
          </Button>
        </div>
      </div>

      {/* 측정 결과 요약 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">측정 결과 요약</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="유효 측정 수" value={`${data.overall?.valid_n ?? 0}건`} />
            <Stat label="대상 업체 노출 횟수" value={`${data.overall?.mention_n ?? 0}건`} />
            <Stat label="대상 업체 노출률" value={pct(data.overall?.inclusion_rate_pct)} />
            <Stat label="1위 언급률" value={pct(data.overall?.first_mention_rate_pct)} />
            <Stat label="상위 3위 언급률" value={pct(data.overall?.top3_rate_pct)} />
            <Stat label="대상 업체 도메인 인용률" value={pct(domainCitedRate)} />
            <Stat
              label="수동 검토 필요 건수"
              value={
                <span className={reviewCount > 0 ? "text-destructive" : undefined}>
                  {reviewCount}건
                </span>
              }
            />
            <Stat label="분석 신뢰도 분포" value={confidenceSummary} />
            <Stat label="기록된 실제 비용" value={usd(run.actual_cost_usd)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="완료 작업 / 전체 작업" value={`${run.completed_jobs} / ${run.total_jobs}`} />
        <Stat label="실패 작업" value={String(run.failed_jobs)} />
        <Stat label="예상 비용" value={usd(run.estimated_cost_usd)} />
        <Stat label="질문 수" value={`${data.questionCount}개`} />
        <Stat label="반복 횟수" value={`${run.repetitions}회`} />
        <Stat label="모델명" value={model} />
        <Stat
          label="생성 · 시작 · 완료 시각"
          value={
            <span className="block space-y-0.5 text-xs">
              <span className="block">생성 {formatSeoul(run.created_at)}</span>
              <span className="block">시작 {formatSeoul(run.started_at)}</span>
              <span className="block">완료 {formatSeoul(run.completed_at)}</span>
            </span>
          }
        />
      </div>

      {/* 작업 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">작업 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {data.jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              자동 측정 작업을 기다리고 있습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>질문</TableHead>
                    <TableHead className="text-right">반복 번호</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>대상 업체 노출</TableHead>
                    <TableHead>검토</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((j) => {
                    const m = measurementByJob.get(j.id);
                    const needsReview = !!m && (m.manual_review_required || m.parse_confidence === "low");
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
                          <TableCell className="text-right">{j.repetition_no}</TableCell>
                          <TableCell>
                            <Badge variant={j.status === "failed" ? "destructive" : "secondary"}>
                              {JOB_STATUS_LABELS[j.status] ?? j.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {m ? (m.was_client_mentioned ? `예 (${m.client_position ?? "-"}위)` : "아니오") : "-"}
                          </TableCell>
                          <TableCell>
                            {needsReview ? <Badge variant="destructive">검토 필요</Badge> : null}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {open ? "접기 ▲" : "상세 ▼"}
                          </TableCell>
                        </TableRow>
                        {open ? (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-muted/40">
                              <JobDetail
                                job={j}
                                prompt={data.prompts.get(j.question_id) ?? j.question_id}
                                measurement={m ?? null}
                                mentions={data.mentions.filter((x) => x.measurement_id === m?.id)}
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

      {/* 질문별 집계 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">질문별 집계</CardTitle>
        </CardHeader>
        <CardContent>
          {data.questionMetrics.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">집계할 결과가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>질문</TableHead>
                    <TableHead className="text-right">유효 표본 수</TableHead>
                    <TableHead className="text-right">대상 업체 노출 횟수</TableHead>
                    <TableHead className="text-right">노출률</TableHead>
                    <TableHead className="text-right">최고 순위</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.questionMetrics.map((q) => (
                    <TableRow key={`${q.question_id}-${q.provider}`}>
                      <TableCell className="max-w-[420px] text-sm">{q.prompt_text}</TableCell>
                      <TableCell className="text-right">{q.valid_n ?? 0}</TableCell>
                      <TableCell className="text-right">{q.mention_n ?? 0}</TableCell>
                      <TableCell className="text-right">{pct(q.inclusion_rate_pct)}</TableCell>
                      <TableCell className="text-right">
                        {q.best_position ? `${q.best_position}위` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 언급 업체 비교 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">경쟁업체 · 언급 업체 비교</CardTitle>
        </CardHeader>
        <CardContent>
          {data.share.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">언급된 업체가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>업체명</TableHead>
                    <TableHead className="text-right">언급 횟수</TableHead>
                    <TableHead className="text-right">등장한 응답 수</TableHead>
                    <TableHead className="text-right">응답 점유율</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.share.map((s, i) => (
                    <TableRow key={`${s.matched_business_id ?? s.display_name}-${i}`}>
                      <TableCell className="text-sm">
                        <span className="font-medium">{s.display_name}</span>
                        {s.matched_business_id && s.matched_business_id === data.targetBusinessId ? (
                          <Badge className="ml-2">대상 업체</Badge>
                        ) : s.matched_business_id && data.competitorIds.has(s.matched_business_id) ? (
                          <Badge variant="secondary" className="ml-2">
                            등록 경쟁업체
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{s.mention_count ?? 0}</TableCell>
                      <TableCell className="text-right">{s.response_count ?? 0}</TableCell>
                      <TableCell className="text-right">{pct(s.answer_share_pct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        본 결과는 {ENGINE_LABEL} 결과이며, 사람이 직접 확인한 수동 UI 점검 결과와 합산되지 않습니다.
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
  mentions: Mention[];
  sources: Source[];
  targetBusinessId: string | null;
}) {
  const [showText, setShowText] = useState(false);
  const needsReview =
    !!measurement && (measurement.manual_review_required || measurement.parse_confidence === "low");

  return (
    <div className="space-y-4 py-3">
      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Field label="질문" value={prompt} />
        <Field label="반복 번호" value={String(job.repetition_no)} />
        <Field label="제공자" value={job.provider} />
        <Field label="모델" value={job.provider_model} />
        <Field label="측정 시각" value={measurement ? formatSeoul(measurement.observed_at) : "-"} />
        <Field label="상태" value={JOB_STATUS_LABELS[job.status] ?? job.status} />
        <Field label="실제 비용" value={usd(measurement?.actual_cost_usd ?? job.actual_cost_usd)} />
        {job.error_code ? <Field label="오류" value={`${job.error_code} ${job.error_message ?? ""}`} /> : null}
      </div>

      {!measurement ? (
        <p className="text-xs text-muted-foreground">저장된 측정 결과가 없습니다.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={measurement.was_client_mentioned ? "default" : "outline"}>
              대상 업체 노출: {measurement.was_client_mentioned ? "예" : "아니오"}
            </Badge>
            <Badge variant="secondary">
              추천/언급 순위: {measurement.client_position ? `${measurement.client_position}위` : "-"}
            </Badge>
            <Badge variant="secondary">
              공식 도메인 인용: {measurement.client_domain_cited ? "예" : "아니오"}
            </Badge>
            <Badge variant="secondary">
              분석 신뢰도: {CONFIDENCE_LABELS[measurement.parse_confidence] ?? measurement.parse_confidence}
            </Badge>
            {needsReview ? <Badge variant="destructive">검토 필요</Badge> : null}
            {!measurement.valid ? (
              <Badge variant="destructive">무효 {measurement.invalid_reason ?? ""}</Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">파서 {measurement.parser_version}</span>
          </div>

          <div>
            <Button variant="outline" size="sm" onClick={() => setShowText((v) => !v)}>
              {showText ? "원문 답변 접기" : "원문 답변 보기"}
            </Button>
            {showText ? (
              <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs leading-relaxed">
                {measurement.response_text}
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold">감지된 업체 ({mentions.length})</p>
            {mentions.length === 0 ? (
              <p className="text-xs text-muted-foreground">감지된 업체가 없습니다.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {mentions
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.position}위 {m.display_name}</span>
                      {m.matched_business_id === targetBusinessId && targetBusinessId ? (
                        <Badge>대상 업체</Badge>
                      ) : m.matched_business_id ? (
                        <Badge variant="secondary">등록 업체</Badge>
                      ) : (
                        <Badge variant="outline">미등록</Badge>
                      )}
                      {m.matched_alias ? (
                        <span className="text-muted-foreground">별칭 {m.matched_alias}</span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {m.explicit_rank ? "명시적 순위" : "추정 순위"} · 신뢰도{" "}
                        {CONFIDENCE_LABELS[m.confidence] ?? m.confidence}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

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
