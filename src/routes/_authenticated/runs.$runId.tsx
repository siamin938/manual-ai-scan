import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
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
        content: "OpenAI Web Search API 벤치마크 실행의 작업 진행 상태와 비용을 확인합니다.",
      },
      { property: "og:title", content: "자동 측정 상세 · AI Visibility Lab" },
      { property: "og:description", content: "자동 측정 실행 상세 및 작업 목록" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunDetailPage,
});

const usd = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "대기",
  processing: "진행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled"]);

function RunDetailPage() {
  const { runId } = Route.useParams();
  const { activeOrgId } = useOrg();

  const { data, isLoading, error } = useQuery({
    queryKey: ["run-detail", runId, activeOrgId],
    enabled: !!activeOrgId,
    refetchInterval: (q) => {
      const s = (q.state.data as { run?: { status: string } } | undefined)?.run?.status;
      return s && TERMINAL.has(s) ? false : 5000;
    },
    queryFn: async () => {
      const [run, jobs] = await Promise.all([
        supabase
          .from("measurement_runs")
          .select("*")
          .eq("id", runId)
          .eq("org_id", activeOrgId!)
          .maybeSingle(),
        supabase
          .from("measurement_jobs")
          .select("id, question_id, provider_model, repetition_no, status, error_code, error_message, created_at")
          .eq("run_id", runId)
          .order("repetition_no", { ascending: true }),
      ]);
      if (run.error) throw run.error;
      if (jobs.error) throw jobs.error;

      const ids = Array.from(new Set((jobs.data ?? []).map((j) => j.question_id)));
      let prompts = new Map<string, string>();
      if (ids.length > 0) {
        const { data: qs } = await supabase.from("questions").select("id, prompt_text").in("id", ids);
        prompts = new Map((qs ?? []).map((q) => [q.id, q.prompt_text]));
      }

      let businessName = "-";
      let questionCount = 0;
      if (run.data) {
        const [b, q] = await Promise.all([
          supabase.from("businesses").select("name").eq("id", run.data.business_id).maybeSingle(),
          supabase
            .from("questions")
            .select("id", { count: "exact", head: true })
            .eq("question_set_id", run.data.question_set_id)
            .eq("active", true),
        ]);
        businessName = b.data?.name ?? "-";
        questionCount = q.count ?? 0;
      }

      return { run: run.data, jobs: jobs.data ?? [], prompts, businessName, questionCount };
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="완료 작업 / 전체 작업" value={`${run.completed_jobs} / ${run.total_jobs}`} />
        <Stat label="실패 작업" value={String(run.failed_jobs)} />
        <Stat label="예상 비용" value={usd(run.estimated_cost_usd)} />
        <Stat label="실제 기록 비용" value={usd(run.actual_cost_usd)} />
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
                    <TableHead>오류 코드</TableHead>
                    <TableHead>오류 메시지</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="max-w-[380px] text-sm">
                        {data.prompts.get(j.question_id) ?? j.question_id}
                      </TableCell>
                      <TableCell className="text-right">{j.repetition_no}</TableCell>
                      <TableCell>
                        <Badge variant={j.status === "failed" ? "destructive" : "secondary"}>
                          {JOB_STATUS_LABELS[j.status] ?? j.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{j.error_code ?? "-"}</TableCell>
                      <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                        {j.error_message ?? "-"}
                      </TableCell>
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
