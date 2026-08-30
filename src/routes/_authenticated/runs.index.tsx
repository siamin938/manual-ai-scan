import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { useActiveTargetBusiness } from "@/lib/active-business";
import { formatSeoul } from "@/lib/format";
import { startCustomerMeasurement } from "@/lib/customer-measurement.functions";
import { customerErrorMessage } from "@/lib/customer-measurement.helpers";
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

export const Route = createFileRoute("/_authenticated/runs/")({
  head: () => ({
    meta: [
      { title: "AI 측정 · 차보임 CHABOIM" },
      {
        name: "description",
        content: "AI 답변에서 관찰된 추천·경쟁업체·출처를 확인하기 위한 AI 측정을 시작하고 진행 상태를 확인합니다.",
      },
      { property: "og:title", content: "AI 측정 · 차보임 CHABOIM" },
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
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  created_at: string;
};

function RunsPage() {
  const { activeOrgId, canWrite } = useOrg();

  const runsQuery = useQuery({
    queryKey: ["runs", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const [runs, biz] = await Promise.all([
        supabase
          .from("measurement_runs")
          .select(
            "id, name, business_id, status, run_type, phase, total_jobs, completed_jobs, failed_jobs, created_at",
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
          <h1 className="text-2xl font-semibold tracking-tight">AI 노출 측정</h1>
          <p className="text-sm text-muted-foreground">
선택한 검색 질문으로 AI 답변을 확인하고, 내 업체·경쟁업체·인용 출처가 어떻게 나타나는지 측정합니다.
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
          <CardTitle className="text-base">측정 목록</CardTitle>
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
                    <TableHead>측정명</TableHead>
                    <TableHead>대상 업체</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">측정 질문</TableHead>
                    <TableHead className="text-right">완료</TableHead>
                    <TableHead className="text-right">실패</TableHead>
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
                      <TableCell>
                        <Badge variant={runStatusVariant(r.status)}>
                          {RUN_STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.total_jobs}</TableCell>
                      <TableCell className="text-right">{r.completed_jobs}</TableCell>
                      <TableCell className="text-right">{r.failed_jobs}</TableCell>
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
  const startMeasurement = useServerFn(startCustomerMeasurement);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [questionSetId, setQuestionSetId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const meta = useQuery({
    queryKey: ["run-form-meta", activeOrgId],
    enabled: !!activeOrgId && open,
    queryFn: async () => {
      const [biz, sets] = await Promise.all([
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
      ]);
      if (biz.error) throw biz.error;
      if (sets.error) throw sets.error;
      return { businesses: biz.data ?? [], sets: sets.data ?? [] };
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
        .select("id")
        .eq("question_set_id", questionSetId)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const sets = (meta.data?.sets ?? []).filter((s) => s.business_id === businessId);
  const selectedBusinessName = (meta.data?.businesses ?? []).find((b) => b.id === businessId)?.name ?? "";

  /** 측정명 기본값 제안: 업체명 + 날짜. 사용자가 직접 수정할 수 있다. */
  useEffect(() => {
    if (!selectedBusinessName) return;
    const suggestion = `${selectedBusinessName} 측정 ${new Date().toISOString().slice(0, 10)}`;
    setName((prev) => (prev.trim() ? prev : suggestion));
  }, [selectedBusinessName]);

  const activeCount = questions.data?.length ?? 0;

  const blockers = useMemo(() => {
    const list: string[] = [];
    if (!session) list.push("로그인 세션이 없습니다.");
    if (!businessId) list.push("대상 업체를 선택하세요.");
    if (!questionSetId) list.push("질문 세트를 선택하세요.");
    if (questionSetId && !questions.isLoading && activeCount === 0)
      list.push("측정할 활성 질문이 없습니다.");
    return list;
  }, [session, businessId, questionSetId, activeCount, questions.isLoading]);

  async function submit() {
    if (blockers.length > 0 || submitting || !activeOrgId) return;
    setSubmitting(true);
    try {
      const result = await startMeasurement({
        data: {
          orgId: activeOrgId,
          businessId,
          questionSetId,
          name: name.trim(),
        },
      });
      if (!result.ok) {
        toast.error(customerErrorMessage(result.error));
        return;
      }
      toast.success("AI 경쟁 분석을 시작했습니다.");
      setOpen(false);
      onCreated();
      navigate({ to: "/runs/$runId", params: { runId: result.runId } });
    } catch {
      toast.error("AI 측정을 준비할 수 없습니다. 잠시 후 다시 시도해 주세요.", {
        description: "같은 조건으로 다시 시도해도 중복 측정은 생성되지 않습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">새 측정 시작</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 측정 시작</DialogTitle>
          <DialogDescription>
            AI가 같은 질문으로 시장의 추천·경쟁업체·출처를 확인합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="run-name">측정명</Label>
            <Input
              id="run-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 판교 매장 8월 측정"
            />
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
              <p className="text-xs text-muted-foreground">활성 질문 {activeCount}개</p>
            )}
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">측정 질문</span>
              <span className="font-medium">{activeCount}개</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">측정 방식</span>
              <span className="font-medium">기본 측정</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">예상 사용량</span>
              <span className="font-medium">{activeCount}회</span>
            </div>
          </div>

          {blockers.length > 0 && (
            <ul className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              {blockers.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            같은 조건으로 다시 시작해도 중복 측정은 생성되지 않습니다.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            취소
          </Button>
          <Button onClick={submit} disabled={blockers.length > 0 || submitting}>
            {submitting ? "시작하는 중…" : "AI 노출 측정 시작"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
