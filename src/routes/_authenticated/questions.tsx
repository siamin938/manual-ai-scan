import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canViewDataAssetAdmin } from "@/lib/data-asset-admin.functions";
import { useOrg } from "@/lib/org";

import {
  BusinessSelector,
  useClientBusinessSelection,
} from "@/components/business-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  INTENT_LABELS,
  buildInsertPayloads,
  dedupeForSave,
  isAllowedIntent,
  mapSuggestError,
  toCandidates,
  type SuggestionCandidate,
} from "@/lib/question-suggestions";

export const Route = createFileRoute("/_authenticated/questions")({
  head: () => ({
    meta: [
      { title: "검색 질문 · 차보임 CHABOIM" },
      {
        name: "description",
        content: "AI 측정에 사용할 표준 검색 질문을 만들고 확인합니다.",
      },
      { property: "og:title", content: "검색 질문 · 차보임 CHABOIM" },
      { property: "og:description", content: "AI 측정에 사용할 표준 검색 질문을 만들고 확인합니다." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuestionsPage,
});

type Question = {
  id: string;
  prompt_text: string;
  intent_type: string;
  region: string | null;
  city: string | null;
  active: boolean;
  question_set_id: string;
};

function intentLabel(intent: string): string {
  if (intent === "informational") return "탐색·발견";
  return isAllowedIntent(intent) ? INTENT_LABELS[intent] : intent;
}

function QuestionsPage() {
  const { activeOrgId, canWrite } = useOrg();
  const qc = useQueryClient();
  const businessSelection = useClientBusinessSelection(activeOrgId);
  const businessId = businessSelection.selectedBusinessId ?? "";

  const [setId, setSetId] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ id: string; prompt_text: string }>({ id: "", prompt_text: "" });

  // --- AI 질문 인벤토리 생성 상태 ---
  const [openConfirmAi, setOpenConfirmAi] = useState(false);
  const [openReview, setOpenReview] = useState(false);
  const [candidates, setCandidates] = useState<SuggestionCandidate[]>([]);
  const [newSetName, setNewSetName] = useState("");
  const [genMode, setGenMode] = useState<"default" | "internal_remeasurement">("default");

  const checkInternalAccess = useServerFn(canViewDataAssetAdmin);
  const { data: internalAccess } = useQuery({
    queryKey: ["questions-internal-access"],
    queryFn: async () => {
      try {
        const res = await checkInternalAccess({ data: undefined });
        return res?.allowed === true;
      } catch {
        return false;
      }
    },
  });
  const isInternalOperator = internalAccess === true;


  const { data: selectedBusiness = null } = useQuery({
    queryKey: ["business-locale", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name, region, city")
        .eq("id", businessId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: sets = [] } = useQuery({
    queryKey: ["question-sets", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("question_sets")
        .select("id, name, active")
        .eq("org_id", activeOrgId!)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const setIds = useMemo(() => sets.map((s) => s.id), [sets]);

  /** 선택 업체의 전체 질문 현황(인벤토리 요약용). */
  const { data: allQuestions = [] } = useQuery({
    queryKey: ["questions-inventory", activeOrgId, businessId, setIds.join(",")],
    enabled: !!activeOrgId && setIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, intent_type, active, data_class, question_set_id")
        .in("question_set_id", setIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  /** 첫 측정이 시작된 질문 세트(UI 잠금 판단용, 읽기 전용). */
  const { data: lockedSetIds = [] } = useQuery({
    queryKey: ["question-set-locks", activeOrgId, businessId, setIds.join(",")],
    enabled: !!activeOrgId && !!businessId && setIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurement_runs")
        .select("question_set_id")
        .eq("org_id", activeOrgId!)
        .eq("business_id", businessId)
        .eq("run_type", "audit")
        .eq("phase", "standalone")
        .is("experiment_id", null)
        .in("question_set_id", setIds);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.question_set_id).filter(Boolean))] as string[];
    },
  });

  const isSetLocked = !!setId && lockedSetIds.includes(setId);

  const { data: questions = [] } = useQuery({
    queryKey: ["questions", activeOrgId, setId],
    enabled: !!activeOrgId && !!setId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, prompt_text, intent_type, region, city, active, question_set_id")
        .eq("question_set_id", setId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Question[];
    },
  });

  useEffect(() => {
    if (setId && !setIds.includes(setId)) setSetId("");
  }, [setId, setIds]);

  const activeQuestions = allQuestions.filter((q) => q.active);
  const intentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of activeQuestions) {
      map.set(q.intent_type, (map.get(q.intent_type) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [activeQuestions]);

  const saveQuestion = useMutation({
    mutationFn: async () => {
      if (isSetLocked) throw new Error("SET_LOCKED");
      if (!form.id) throw new Error("NO_TARGET");
      const { error } = await supabase
        .from("questions")
        .update({ prompt_text: form.prompt_text.trim() })
        .eq("id", form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("저장되었습니다.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["questions", activeOrgId, setId] });
      qc.invalidateQueries({ queryKey: ["questions-inventory", activeOrgId, businessId] });
    },
    onError: (e: Error) => {
      if (e.message === "SET_LOCKED") {
        toast.error("첫 측정이 시작되어 질문을 수정할 수 없습니다.");
        setOpen(false);
        return;
      }
      toast.error(`저장 실패: ${e.message}`);
    },
  });

  const suggestAi = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("suggest-questions-router", {
        body: {
          orgId: activeOrgId,
          businessId,
          count: 24,
          ...(genMode === "internal_remeasurement" ? { mode: "internal_remeasurement" } : {}),
        },
      });
      if (error) throw new Error(error.message);
      return data as {
        suggestions?: unknown;
        error?: string;
      };
    },
    onSuccess: (data) => {
      if (data?.error) {
        toast.error(mapSuggestError(data.error));
        return;
      }
      const list = toCandidates(data?.suggestions, selectedBusiness?.name ?? "");
      if (list.length !== 24) {
        toast.error("표준 질문 24개를 완성하지 못했습니다. 다시 만들어 주세요.");
        return;
      }
      setCandidates(list);
      const today = new Date().toISOString().slice(0, 10);
      const baseName = selectedBusiness?.name ?? "업체";
      setNewSetName(
        genMode === "internal_remeasurement"
          ? `${baseName} 최신 Market 질문 ${today}`
          : `${baseName} AI 검색 질문 ${today}`,
      );
      setOpenConfirmAi(false);
      setOpenReview(true);
    },

    onError: (e: Error) => toast.error(mapSuggestError(e.message)),
  });

  const saveSuggestions = useMutation({
    mutationFn: async () => {
      if (candidates.length === 0) throw new Error("NO_SELECTION");

      const { data, error: setErr } = await supabase
        .from("question_sets")
        .insert({ org_id: activeOrgId!, business_id: businessId, name: newSetName.trim() })
        .select("id")
        .single();
      if (setErr) throw setErr;
      const destSetId = data.id as string;

      const { kept, skipped } = dedupeForSave(candidates, []);
      if (kept.length === 0) throw new Error("ALL_DUPLICATE");

      const payloads = buildInsertPayloads(kept, {
        orgId: activeOrgId!,
        questionSetId: destSetId,
        region: selectedBusiness?.region ?? null,
        city: selectedBusiness?.city ?? null,
      });
      const { error } = await supabase.from("questions").insert(payloads);
      if (error) throw error;
      return { destSetId, inserted: kept.length, skipped };
    },
    onSuccess: (res) => {
      toast.success(`${res.inserted}개 질문을 저장했습니다.`);
      setOpenReview(false);
      setCandidates([]);
      setSetId(res.destSetId);
      qc.invalidateQueries({ queryKey: ["question-sets", activeOrgId, businessId] });
      qc.invalidateQueries({ queryKey: ["questions-inventory", activeOrgId, businessId] });
      qc.invalidateQueries({ queryKey: ["questions", activeOrgId, res.destSetId] });
    },
    onError: (e: Error) => {
      if (e.message === "ALL_DUPLICATE") {
        toast.error("저장할 질문이 없습니다. 다시 만들어 주세요.");
        return;
      }
      if (e.message === "NO_SELECTION") {
        toast.error("저장할 질문이 없습니다.");
        return;
      }
      toast.error(`저장 실패: ${e.message}`);
    },
  });

  const candidateIntentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of candidates) map.set(c.intentType, (map.get(c.intentType) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [candidates]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">검색 질문</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          고객이 AI에 실제로 물어볼 만한 질문을 만들고, 측정에 사용할 질문을 확인합니다.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <BusinessSelector
            options={businessSelection.options}
            value={businessSelection.selectedBusinessId}
            onChange={businessSelection.select}
            isLoading={businessSelection.isLoading}
            isError={businessSelection.isError}
          />
          <div className="ml-auto flex items-center gap-3">
            {canWrite ? (
              <>
                <Button
                  disabled={!businessId}
                  onClick={() => {
                    setGenMode("default");
                    setOpenConfirmAi(true);
                  }}
                >
                  추천 검색 질문 만들기
                </Button>
                {isInternalOperator && (
                  <Button
                    variant="outline"
                    disabled={!businessId}
                    onClick={() => {
                      setGenMode("internal_remeasurement");
                      setOpenConfirmAi(true);
                    }}
                  >
                    최신 Market 질문 새 세트 만들기
                  </Button>
                )}
              </>
            ) : (
              <Badge variant="secondary">조회 전용 권한</Badge>
            )}
          </div>

          <p className="w-full text-xs text-muted-foreground">
            지역·추천·서비스·후기·신뢰·비교·가격·탐색 등 다양한 상황의 검색 질문 24개를 자동으로 만듭니다.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">질문 세트</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{sets.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">활성 질문</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{activeQuestions.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">질문군</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{intentCounts.length}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">검색 상황별 질문 수</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {intentCounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 질문이 없습니다. 추천 검색 질문 만들기로 시작하세요.
            </p>
          ) : (
            intentCounts.map(([intent, count]) => (
              <Badge key={intent} variant="secondary">
                {intentLabel(intent)} {count}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">저장된 질문 확인</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>질문 세트</Label>
              <Select value={setId} onValueChange={setSetId} disabled={!businessId}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="질문 세트 선택" />
                </SelectTrigger>
                <SelectContent>
                  {sets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {setId && isSetLocked && <Badge variant="outline">측정 기준 고정</Badge>}
          </div>

          {setId && (
            <p className="text-xs text-muted-foreground">
              {isSetLocked
                ? "첫 측정이 시작되어 이 질문 세트는 수정할 수 없습니다."
                : "첫 측정 전에는 질문 문구를 수정할 수 있습니다."}
            </p>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>질문</TableHead>
                  <TableHead>질문군</TableHead>
                  <TableHead>지역</TableHead>
                  <TableHead>상태</TableHead>
                  {canWrite && <TableHead className="text-right">작업</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="max-w-[420px] text-sm">{q.prompt_text}</TableCell>
                    <TableCell className="text-sm">{intentLabel(q.intent_type)}</TableCell>
                    <TableCell className="text-sm">
                      {[q.region, q.city].filter(Boolean).join(" ") || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={q.active ? "secondary" : "outline"}>
                        {q.active ? "활성" : "비활성"}
                      </Badge>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        {isSetLocked ? (
                          <span className="text-xs text-muted-foreground">측정 기준 고정</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setForm({ id: q.id, prompt_text: q.prompt_text });
                              setOpen(true);
                            }}
                          >
                            수정
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {questions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canWrite ? 5 : 4} className="py-8 text-center text-sm text-muted-foreground">
                      질문 세트를 선택하면 질문 목록이 표시됩니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>질문 문구 수정</DialogTitle>
            <DialogDescription>질문 문구만 수정할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <form
            id="q-form"
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveQuestion.mutate();
            }}
          >
            <Label htmlFor="q-text">질문 문구</Label>
            <Textarea
              id="q-text"
              required
              rows={3}
              value={form.prompt_text}
              onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
            />
          </form>
          <DialogFooter>
            <Button type="submit" form="q-form" disabled={saveQuestion.isPending || isSetLocked}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openConfirmAi} onOpenChange={(v) => !suggestAi.isPending && setOpenConfirmAi(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {genMode === "internal_remeasurement"
                ? "최신 Market 질문 새 세트를 만들까요?"
                : "AI 검색 질문을 만들까요?"}
            </DialogTitle>
            <DialogDescription>
              {genMode === "internal_remeasurement"
                ? "기존 질문 세트와 기존 측정 결과는 그대로 보존되며, 새 24문항 후보만 만듭니다."
                : "등록한 업체의 업종과 지역을 바탕으로, 실제 고객이 AI에 물어볼 만한 검색 질문 24개를 만듭니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-xs">
              {genMode === "internal_remeasurement"
                ? "이 단계에서는 측정이 시작되지 않고 측정권도 사용되지 않습니다. 저장 후에도 측정은 자동으로 실행되지 않습니다."
                : "만들어진 질문은 측정 전에 확인할 수 있습니다. 첫 측정을 시작하면 정확한 반복 비교를 위해 질문이 고정됩니다."}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenConfirmAi(false)} disabled={suggestAi.isPending}>
              취소
            </Button>
            <Button onClick={() => suggestAi.mutate()} disabled={suggestAi.isPending || !businessId}>
              {suggestAi.isPending ? "질문 만드는 중..." : "24개 질문 만들기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openReview} onOpenChange={(v) => !saveSuggestions.isPending && setOpenReview(v)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>생성된 질문 검토 ({candidates.length}개)</DialogTitle>
            <DialogDescription>
              24개 질문은 하나의 표준 질문 세트로 저장됩니다. 문구 수정은 첫 측정 전에 할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {candidateIntentCounts.map(([intent, count]) => (
              <Badge key={intent} variant="secondary">
                {intentLabel(intent)} {count}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="space-y-2">
              <Label htmlFor="ai-set-name">질문 세트 이름</Label>
              <Input
                id="ai-set-name"
                className="w-[300px]"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
              />
            </div>
          </div>

          <div className="divide-y rounded-md border">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3">
                <div className="flex-1 space-y-1">
                  <p className="text-sm">{c.promptText}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{intentLabel(c.intentType)}</span>
                    {c.containsBusinessName && <Badge variant="destructive">업체명 포함 · 수정 권장</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              onClick={() => saveSuggestions.mutate()}
              disabled={saveSuggestions.isPending || !newSetName.trim() || candidates.length !== 24}
            >
              {saveSuggestions.isPending ? "저장 중…" : "24개 질문 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
