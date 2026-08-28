import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { useActiveTargetBusiness } from "@/lib/active-business";
import { formatSeoul } from "@/lib/format";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export const Route = createFileRoute("/_authenticated/runs/")({
  head: () => ({
    meta: [
      { title: "측정 · AI Visibility Lab" },
      {
        name: "description",
        content: "관찰된 노출 상태를 확인하기 위한 측정 실행을 생성하고 진행 상태를 확인합니다.",
      },
      { property: "og:title", content: "측정 · AI Visibility Lab" },
      { property: "og:description", content: "AI 노출 측정 실행 목록" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunsPage,
});

export const ENGINE_LABEL = "AI 경쟁 분석 측정";

export const RUN_STATUS_LABELS: Record<string, string> = {
  draft: "준비",
  queued: "대기",
  running: "진행 중",
  completed: "완료",
  partial: "일부 실패",
  failed: "실패",
  cancelled: "취소",
};

export function runStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "cancelled") return "destructive";
  if (status === "partial") return "outline";
  return "secondary";
}


type RunRow = {
  id: string;
  name: string;
  run_type: string;
  phase: string;
  business_id: string;
  status: string;
  selected_providers: string[];
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  created_at: string;
};

function RunsPage() {
  const { activeOrgId, session, canWrite } = useOrg();

  const runsQuery = useQuery({
    queryKey: ["runs", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const [runs, biz] = await Promise.all([
        supabase
          .from("measurement_runs")
          .select(
            "id, name, business_id, status, selected_providers, run_type, phase, total_jobs, completed_jobs, failed_jobs, estimated_cost_usd, actual_cost_usd, created_at",
          )
          .eq("org_id", activeOrgId!)
          .eq("run_type", "audit")
          .eq("phase", "standalone")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("businesses").select("id, name").eq("org_id", activeOrgId!),
      ]);
      if (runs.error) throw runs.error;
      if (biz.error) throw biz.error;
      const names = new Map((biz.data ?? []).map((b) => [b.id, b.name]));
      return { runs: (runs.data ?? []) as unknown as RunRow[], names };
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">측정</h1>
          <p className="text-sm text-muted-foreground">
            관찰된 노출 상태를 확인하기 위한 측정 실행 목록입니다. Change Impact용 baseline·follow-up 실행은 별도
            화면에서 관리합니다.
          </p>
        </div>
        <div className="ml-auto">
          {canWrite ? (
            <NewRunDialog onCreated={() => runsQuery.refetch()} />
          ) : (
            <Badge variant="secondary">조회 전용 권한</Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">실행 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : (runsQuery.data?.runs.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              측정 실행이 아직 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>실행명</TableHead>
                    <TableHead>대상 업체</TableHead>
                    <TableHead>엔진</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">총 작업</TableHead>
                    <TableHead className="text-right">완료</TableHead>
                    <TableHead className="text-right">실패</TableHead>
                    <TableHead className="text-right">예상 비용</TableHead>
                    <TableHead className="text-right">실제 기록 비용</TableHead>
                    <TableHead>생성 시각</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsQuery.data!.runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to="/runs/$runId"
                          params={{ runId: r.id }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell>{runsQuery.data!.names.get(r.business_id) ?? "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.selected_providers?.includes("openai") ? ENGINE_LABEL : r.selected_providers?.join(", ")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={runStatusVariant(r.status)}>
                          {RUN_STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.total_jobs}</TableCell>
                      <TableCell className="text-right">{r.completed_jobs}</TableCell>
                      <TableCell className="text-right">{r.failed_jobs}</TableCell>
                      <TableCell className="text-right">{usd(r.estimated_cost_usd)}</TableCell>
                      <TableCell className="text-right">{usd(r.actual_cost_usd)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatSeoul(r.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewRunDialog({ onCreated }: { onCreated: () => void }) {
  const { activeOrgId, session } = useOrg();
  const shared = useActiveTargetBusiness();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [questionSetId, setQuestionSetId] = useState("");
  const [repetitions, setRepetitions] = useState("1");
  const [maxCost, setMaxCost] = useState("0.50");
  const [submitting, setSubmitting] = useState(false);
  const [draftRunId, setDraftRunId] = useState<string | null>(null);

  const meta = useQuery({
    queryKey: ["run-form-meta", activeOrgId],
    enabled: !!activeOrgId && open,
    queryFn: async () => {
      const [biz, sets, settings] = await Promise.all([
        supabase
          .from("businesses")
          .select("id, name")
          .eq("org_id", activeOrgId!)
          .eq("is_client_business", true)
          .eq("active", true)
          .order("name"),
        supabase
          .from("question_sets")
          .select("id, name, business_id")
          .eq("org_id", activeOrgId!)
          .eq("active", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("provider_settings")
          .select(
            "provider, enabled, model_name, estimated_cost_per_request_usd, paid_account_confirmed, terms_reviewed, automated_benchmark_approved",
          )
          .eq("org_id", activeOrgId!)
          .eq("provider", "openai")
          .maybeSingle(),
      ]);
      if (biz.error) throw biz.error;
      if (sets.error) throw sets.error;
      if (settings.error) throw settings.error;
      return { businesses: biz.data ?? [], sets: sets.data ?? [], openai: settings.data };
    },
  });

  /** 공유된 대상 업체 선택을 현재 org의 유효 목록과 대조한 뒤에만 폼에 반영한다. */
  const metaBusinesses = meta.data?.businesses;
  useEffect(() => {
    if (!open || !metaBusinesses) return;
    const sharedId = shared.getSelectedId(activeOrgId);
    if (!sharedId || !metaBusinesses.some((b) => b.id === sharedId)) return;
    setBusinessId((prev) => (prev ? prev : sharedId));
  }, [open, metaBusinesses, shared, activeOrgId]);



  const questions = useQuery({
    queryKey: ["run-form-questions", questionSetId],
    enabled: !!questionSetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, data_class")
        .eq("question_set_id", questionSetId)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const sets = (meta.data?.sets ?? []).filter((s) => s.business_id === businessId);
  const selectedBusinessName = (meta.data?.businesses ?? []).find((b) => b.id === businessId)?.name ?? "";

  /** 실행명 기본값 제안: 업체명 + 날짜. 사용자가 직접 수정할 수 있다. */
  useEffect(() => {
    if (!selectedBusinessName) return;
    const suggestion = `${selectedBusinessName} 측정 ${new Date().toISOString().slice(0, 10)}`;
    setName((prev) => (prev.trim() ? prev : suggestion));
  }, [selectedBusinessName]);
  const activeCount = questions.data?.length ?? 0;
  const nonPublicCount = (questions.data ?? []).filter((q) => q.data_class !== "public").length;
  const reps = Number(repetitions);
  const maxCostValue = Number(maxCost);
  const plannedJobs = activeCount * (Number.isFinite(reps) ? reps : 0) * 1;
  const perRequest = Number(meta.data?.openai?.estimated_cost_per_request_usd ?? 0);
  const estimatedCost = perRequest * plannedJobs;

  const blockers = useMemo(() => {
    const s = meta.data?.openai;
    const list: string[] = [];
    if (!session) list.push("로그인 세션이 없습니다.");
    if (meta.data && !s) list.push("OpenAI 엔진 설정(provider_settings)이 없습니다.");
    if (s && !s.enabled) list.push("OpenAI 엔진이 비활성화되어 있습니다.");
    if (s && !s.paid_account_confirmed) list.push("유료 계정 확인이 완료되지 않았습니다.");
    if (s && !s.terms_reviewed) list.push("이용약관 검토가 완료되지 않았습니다.");
    if (s && !s.automated_benchmark_approved) list.push("자동 벤치마크 승인이 완료되지 않았습니다.");
    if (!name.trim()) list.push("실행명을 입력하세요.");
    if (!businessId) list.push("대상 업체를 선택하세요.");
    if (!questionSetId) list.push("질문 세트를 선택하세요.");
    if (questionSetId && activeCount === 0) list.push("활성 질문이 0개입니다.");
    if (nonPublicCount > 0)
      list.push(`data_class가 public이 아닌 활성 질문이 ${nonPublicCount}개 있어 실행할 수 없습니다.`);
    if (!Number.isInteger(reps) || reps < 1 || reps > 3) list.push("반복 횟수는 1~3회 중에서 선택하세요.");
    if (!Number.isFinite(maxCostValue) || maxCostValue <= 0)
      list.push("실행 최대 비용은 0보다 커야 합니다.");
    if (Number.isFinite(maxCostValue) && maxCostValue > MAX_ALLOWED_COST_USD)
      list.push(`실행 최대 비용은 ${usd(MAX_ALLOWED_COST_USD)}를 초과할 수 없습니다.`);
    if (plannedJobs > 0 && estimatedCost > maxCostValue)
      list.push(
        `예상 비용 ${usd(estimatedCost)}이 실행 최대 비용 ${usd(maxCostValue)}을 초과합니다. 고급 설정에서 실행 최대 비용을 직접 조정하세요.`,
      );

    return list;
  }, [
    meta.data,
    session,
    name,
    businessId,
    questionSetId,
    activeCount,
    nonPublicCount,
    reps,
    maxCostValue,
    plannedJobs,
    estimatedCost,
  ]);

  async function submit() {
    if (blockers.length > 0 || submitting) return;
    // fail-closed: 클라이언트 상태가 조작되어도 허용 범위를 벗어나면 실행하지 않는다.
    if (!Number.isInteger(reps) || reps < 1 || reps > 3) {
      toast.error("반복 횟수는 1~3회만 실행할 수 있습니다.");
      return;
    }
    if (!Number.isFinite(maxCostValue) || maxCostValue <= 0 || maxCostValue > MAX_ALLOWED_COST_USD) {
      toast.error(`실행 최대 비용은 ${usd(MAX_ALLOWED_COST_USD)}를 초과할 수 없습니다.`);
      return;
    }
    if (plannedJobs > 0 && estimatedCost > maxCostValue) {
      toast.error(
        `예상 비용 ${usd(estimatedCost)}이 실행 최대 비용 ${usd(maxCostValue)}을 초과합니다.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      let runId = draftRunId;
      if (!runId) {
        const { data, error } = await supabase
          .from("measurement_runs")
          .insert({
            org_id: activeOrgId!,
            business_id: businessId,
            question_set_id: questionSetId,
            name: name.trim(),
            run_type: "audit",
            phase: "standalone",
            status: "draft",
            selected_providers: ["openai"],
            repetitions: reps,
            max_cost_usd: maxCostValue,
            scheduled_at: new Date().toISOString(),
            created_by: session?.user.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        runId = data.id;
        setDraftRunId(runId);
      }

      const { error: fnError } = await supabase.functions.invoke("enqueue-run", {
        body: { runId },
      });
      if (fnError) throw fnError;

      toast.success("측정 실행을 대기열에 등록했습니다.");
      setOpen(false);
      onCreated();
      navigate({ to: "/runs/$runId", params: { runId: runId! } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "실행 등록에 실패했습니다.";
      toast.error(`실행 등록 실패: ${message}`, {
        description: "같은 실행으로 다시 시도할 수 있습니다. 동일 실행을 다시 등록해도 중복 작업은 생성되지 않습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDraftRunId(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">새 측정</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 측정</DialogTitle>
          <DialogDescription>{ENGINE_LABEL}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="run-name">실행명</Label>
            <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026-08 판교 벤치마크" />
          </div>

          <div className="space-y-1.5">
            <Label>대상 업체</Label>
            <Select
              value={businessId}
              onValueChange={(v) => {
                setBusinessId(v);
                setQuestionSetId("");
                if (activeOrgId) shared.select(activeOrgId, v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="대상 업체 선택" />
              </SelectTrigger>
              <SelectContent>
                {(meta.data?.businesses ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>질문 세트</Label>
            <Select value={questionSetId} onValueChange={setQuestionSetId} disabled={!businessId}>
              <SelectTrigger>
                <SelectValue placeholder={businessId ? "질문 세트 선택" : "먼저 대상 업체를 선택하세요"} />
              </SelectTrigger>
              <SelectContent>
                {sets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {questionSetId && (
              <p className="text-xs text-muted-foreground">
                활성 질문 수: {activeCount}개
                {nonPublicCount > 0 && ` · public이 아닌 활성 질문 ${nonPublicCount}개`}
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            엔진: {ENGINE_LABEL} (고정) · 모델 {meta.data?.openai?.model_name ?? "-"}
          </p>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0 text-xs text-muted-foreground">
                고급 설정
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reps">반복 횟수</Label>
                  <Select value={repetitions} onValueChange={setRepetitions}>
                    <SelectTrigger id="reps">
                      <SelectValue placeholder="반복 횟수 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1회</SelectItem>
                      <SelectItem value="2">2회</SelectItem>
                      <SelectItem value="3">3회</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maxcost">실행 최대 비용 (USD)</Label>
                  <Input
                    id="maxcost"
                    type="number"
                    min={0.01}
                    max={MAX_ALLOWED_COST_USD}
                    step={0.01}
                    value={maxCost}
                    onChange={(e) => setMaxCost(e.target.value)}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">예정 작업 수</span>
              <span className="font-medium">{plannedJobs}건</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">예상 비용</span>
              <span className="font-medium">{usd(estimatedCost)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              활성 public 질문 {activeCount}개 × 반복 {Number.isFinite(reps) ? reps : 0}회 × 엔진 1개
            </p>
          </div>

          {blockers.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {blockers.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            동일 실행을 다시 등록해도 중복 작업은 생성되지 않습니다.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            취소
          </Button>
          <Button onClick={submit} disabled={blockers.length > 0 || submitting}>
            {submitting ? "등록 중…" : draftRunId ? "다시 시도" : "실행"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
