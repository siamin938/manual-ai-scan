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
import { isUnifiedDiagnosticSetName } from "@/lib/custom-question-suggestions";
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

type RunQuestionSet = { id: string; name: string };
export type RunQuestionSetKind = "unified" | "custom" | "baseline" | "other";

/** v0.1 naming convention: 이 접두사로 생성된 세트만 맞춤 질문으로 구분한다. */
const CUSTOM_QUESTION_SET_PREFIX = "맞춤 질문 · ";

export function isCustomRunQuestionSet(name: string): boolean {
  return name.startsWith(CUSTOM_QUESTION_SET_PREFIX);
}

export function choosePreferredRunQuestionSetId(sets: RunQuestionSet[]): string {
  return (
    sets.find((set) => isUnifiedDiagnosticSetName(set.name))?.id ??
    sets.find((set) => isCustomRunQuestionSet(set.name))?.id ??
    sets[0]?.id ??
    ""
  );
}

export function selectCustomerRunQuestionSets<T extends RunQuestionSet>(sets: readonly T[]): T[] {
  const newestUnifiedSet = sets.find((set) => isUnifiedDiagnosticSetName(set.name));
  return newestUnifiedSet ? [newestUnifiedSet] : [...sets];
}

export function getRunQuestionSetKind(name: string, activeCount: number): RunQuestionSetKind {
  if (isUnifiedDiagnosticSetName(name) && activeCount === 24) return "unified";
  if (isCustomRunQuestionSet(name)) return "custom";
  if (activeCount === 24) return "baseline";
  return "other";
}

/** 진단 유형별 자동 측정명 접미사. 신규 unified가 기본 고객 경로다. */
export function formatAutoRunName(
  businessName: string,
  kind: RunQuestionSetKind,
  date: string,
): string {
  const label =
    kind === "unified"
      ? "AI 진단"
      : kind === "custom"
        ? "맞춤 진단"
        : kind === "baseline"
          ? "기본 진단"
          : "측정";
  return `${businessName} ${label} ${date}`;
}

type RunRow = {
  id: string;
  name: string;
  run_type: string;
  phase: string;
  business_id: string;
  question_set_id: string;
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
      const [runs, biz, questionSets] = await Promise.all([
        supabase
          .from("measurement_runs")
          .select(
            "id, name, business_id, question_set_id, status, run_type, phase, total_jobs, completed_jobs, failed_jobs, created_at",
          )
          .eq("org_id", activeOrgId!)
          .eq("run_type", "audit")
          .eq("phase", "standalone")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("businesses").select("id, name").eq("org_id", activeOrgId!),
        supabase.from("question_sets").select("id, name").eq("org_id", activeOrgId!),
      ]);
      if (runs.error) throw runs.error;
      if (biz.error) throw biz.error;
      if (questionSets.error) throw questionSets.error;
      const names = new Map((biz.data ?? []).map((b) => [b.id, b.name]));
      const questionSetNames = new Map(
        (questionSets.data ?? []).map((set) => [set.id, set.name]),
      );
      return { runs: (runs.data ?? []) as unknown as RunRow[], names, questionSetNames };
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
                  {runsQuery.data!.runs.map((r) => {
                    const questionSetName = runsQuery.data!.questionSetNames.get(r.question_set_id);
                    const kind = getRunQuestionSetKind(questionSetName ?? "", r.total_jobs);
                    return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to="/runs/$runId"
                          params={{ runId: r.id }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant={
                              kind === "unified"
                                ? "default"
                                : kind === "baseline"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {kind === "unified"
                              ? "AI 진단"
                              : kind === "custom"
                                ? "이전 맞춤 진단"
                                : kind === "baseline"
                                  ? "이전 기본 진단"
                                  : "일반 측정"}
                          </Badge>
                          {kind === "unified" ? (
                            <span className="text-xs text-muted-foreground">대표 진단</span>
                          ) : kind === "baseline" ? (
                            <span className="text-xs text-muted-foreground">이전 비교 기준</span>
                          ) : null}
                        </div>
                        {questionSetName ? (
                          <p className="mt-1 text-xs text-muted-foreground">질문 세트 · {questionSetName}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{runsQuery.data!.names.get(r.business_id) ?? "-"}</TableCell>
                      <TableCell>
                        <Badge variant={runStatusVariant(r.status)}>
                          {RUN_STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.total_jobs}문항</TableCell>
                      <TableCell className="text-right">{r.completed_jobs}</TableCell>
                      <TableCell className="text-right">{r.failed_jobs}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatSeoul(r.created_at)}
                      </TableCell>
                    </TableRow>
                    );
                  })}
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
  /** 사용자가 측정명을 직접 수정했는지 여부. true면 세트/업체 변경 시 자동 이름으로 덮어쓰지 않는다. */
  const [nameTouched, setNameTouched] = useState(false);

  /** Dialog를 새로 열 때 자동 이름 상태를 초기화한다. */
  useEffect(() => {
    if (open) setNameTouched(false);
  }, [open]);

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

  const businessSets = useMemo(
    () => (meta.data?.sets ?? []).filter((s) => s.business_id === businessId),
    [meta.data?.sets, businessId],
  );
  /**
   * 통합 24문항 세트가 생긴 업체는 고객 측정 경로를 그 세트 하나로 수렴시킨다.
   * 과거 맞춤/기본 세트는 측정 이력에서만 보존한다.
   */
  const sets = useMemo(
    () => selectCustomerRunQuestionSets(businessSets),
    [businessSets],
  );
  const selectedBusinessName = (meta.data?.businesses ?? []).find((b) => b.id === businessId)?.name ?? "";

  /** 조회 결과는 최신순이다. 같은 업체의 수동 선택은 유지하고, 새 업체는 통합 AI 진단 세트를 최우선한다. */
  useEffect(() => {
    if (!open || !businessId || sets.length === 0) return;
    setQuestionSetId((current) =>
      sets.some((set) => set.id === current) ? current : choosePreferredRunQuestionSetId(sets),
    );
  }, [open, businessId, sets]);

  /** 업체가 바뀌면 새 업체 기준 자동 이름으로 다시 제안할 수 있도록 수동 수정 상태를 초기화한다. */
  useEffect(() => {
    setNameTouched(false);
  }, [businessId]);

  const activeCount = questions.data?.length ?? 0;
  const selectedSet = sets.find((set) => set.id === questionSetId);
  const selectedSetKind = selectedSet
    ? getRunQuestionSetKind(selectedSet.name, activeCount)
    : "other";
  const selectedSetPresentation =
    selectedSetKind === "unified"
      ? {
          badge: "대표 진단",
          description: "내 업체에 맞춘 24개 AI 진단 질문으로 측정합니다.",
          type: "내 업체 AI 진단",
        }
      : selectedSetKind === "custom"
        ? {
            badge: "이전 방식",
            description: "이전에 만든 맞춤 8문항 세트로 측정합니다.",
            type: "이전 맞춤 진단",
          }
        : selectedSetKind === "baseline"
          ? {
              badge: "이전 방식",
              description: "이전에 만든 기본 24문항 세트로 측정합니다.",
              type: "이전 기본 진단",
            }
          : {
              badge: "질문 세트",
              description: "선택한 질문 세트로 측정합니다.",
              type: "선택 질문 세트",
            };

  /** 자동 측정명 제안: 사용자가 직접 수정하기 전까지 선택한 진단 유형에 맞춰 갱신한다. */
  useEffect(() => {
    if (nameTouched || !selectedBusinessName) return;
    setName(formatAutoRunName(selectedBusinessName, selectedSetKind, new Date().toISOString().slice(0, 10)));
  }, [nameTouched, selectedBusinessName, selectedSetKind]);

  /** 측정권 잔여 조회. 로딩/조회 실패는 0회로 오인하지 않도록 null로 둔다. */
  const credit = useQuery({
    queryKey: ["measurement-credit-balance", activeOrgId],
    enabled: !!activeOrgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurement_credit_accounts")
        .select("balance")
        .eq("org_id", activeOrgId!)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.balance ?? 0);
    },
  });
  const creditBalance = credit.isSuccess ? credit.data : null;

  const blockers = useMemo(() => {
    const list: string[] = [];
    if (!session) list.push("로그인 세션이 없습니다.");
    if (!businessId) list.push("대상 업체를 선택하세요.");
    if (!questionSetId) list.push("질문 세트를 선택하세요.");
    if (questionSetId && !questions.isLoading && activeCount === 0)
      list.push("측정할 활성 질문이 없습니다.");
    if (creditBalance !== null && creditBalance < 1) list.push("AI 노출 측정권이 없습니다.");
    return list;
  }, [session, businessId, questionSetId, activeCount, questions.isLoading, creditBalance]);


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
            선택한 질문 세트로 AI 노출을 측정합니다. 새 통합 24문항 세트가 대표 진단 기준입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="run-name">측정명</Label>
            <Input
              id="run-name"
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
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
                    {s.name}{" "}
                    {isUnifiedDiagnosticSetName(s.name)
                      ? "(대표 진단)"
                      : isCustomRunQuestionSet(s.name)
                        ? "(이전 맞춤)"
                        : "(이전 기본/기타)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {questionSetId && (
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
                <Badge variant={selectedSetKind === "unified" ? "default" : "outline"}>
                  {selectedSetPresentation.badge}
                </Badge>
                <p className="text-sm text-foreground">{selectedSetPresentation.description}</p>
                <p className="text-xs text-muted-foreground">활성 질문 {activeCount}개</p>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">측정 질문</span>
              <span className="font-medium">{activeCount}개</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">진단 유형</span>
              <span className="font-medium">{selectedSetPresentation.type}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">차감 예정 측정권</span>
              <span className="font-medium">{questionSetId && activeCount > 0 ? "1회" : "-"}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">측정 후 남는 측정권</span>
              <span className="font-medium">
                {creditBalance === null
                  ? "확인 중"
                  : questionSetId && activeCount > 0
                    ? `${Math.max(creditBalance - 1, 0)}회`
                    : `${creditBalance}회`}
              </span>
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
            같은 조건의 최근 측정이 이미 준비·진행 중이면 해당 측정을 이어서 사용합니다.
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