import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { DATA_CLASS_LABELS } from "@/lib/format";
import {
  BusinessSelector,
  useClientBusinessSelection,
} from "@/components/business-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  ALLOWED_INTENTS,
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
      { title: "질문 인벤토리 · 차보임 CHABOIM" },
      {
        name: "description",
        content: "업체별로 실제 고객이 AI에 물을 법한 질문 인벤토리를 생성하고 검토합니다.",
      },
      { property: "og:title", content: "질문 인벤토리 · 차보임 CHABOIM" },
      { property: "og:description", content: "AI 질문 인벤토리 생성과 검토" },
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
  language: string;
  country_code: string;
  region: string | null;
  city: string | null;
  weight: number;
  data_class: string;
  active: boolean;
  question_set_id: string;
};

const EMPTY_Q = {
  id: "",
  prompt_text: "",
  intent_type: "recommendation",
  language: "ko",
  country_code: "KR",
  region: "",
  city: "",
  weight: "1",
  data_class: "public",
  active: true,
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
  const [setName, setSetName] = useState("");
  const [openSet, setOpenSet] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_Q });

  // --- AI 질문 인벤토리 생성 상태 ---
  const [openConfirmAi, setOpenConfirmAi] = useState(false);
  const [openReview, setOpenReview] = useState(false);
  const [candidates, setCandidates] = useState<SuggestionCandidate[]>([]);
  const [aiMeta, setAiMeta] = useState<{
    model: string | null;
    costStatus: string | null;
    usage: { inputTokens?: number; outputTokens?: number } | null;
    estimatedCostUsd: number | null;
    requestedCount: number | null;
    suggestionCount: number | null;
    batchCount: number | null;
    mode: string | null;
  }>({
    model: null,
    costStatus: null,
    usage: null,
    estimatedCostUsd: null,
    requestedCount: null,
    suggestionCount: null,
    batchCount: null,
    mode: null,
  });
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [targetSetMode, setTargetSetMode] = useState<"existing" | "new">("new");
  const [targetSetId, setTargetSetId] = useState("");
  const [newSetName, setNewSetName] = useState("");

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

  const { data: questions = [] } = useQuery({
    queryKey: ["questions", activeOrgId, setId],
    enabled: !!activeOrgId && !!setId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "id, prompt_text, intent_type, language, country_code, region, city, weight, data_class, active, question_set_id",
        )
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

  const createSet = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("question_sets")
        .insert({ org_id: activeOrgId!, business_id: businessId, name: setName.trim() })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("질문 세트를 만들었습니다.");
      setOpenSet(false);
      setSetName("");
      setSetId(id);
      qc.invalidateQueries({ queryKey: ["question-sets", activeOrgId, businessId] });
    },
    onError: (e: Error) => toast.error(`생성 실패: ${e.message}`),
  });

  const saveQuestion = useMutation({
    mutationFn: async () => {
      const payload = {
        org_id: activeOrgId!,
        question_set_id: setId,
        prompt_text: form.prompt_text.trim(),
        intent_type: form.intent_type.trim() || "recommendation",
        language: form.language.trim() || "ko",
        country_code: form.country_code.trim() || "KR",
        region: form.region.trim() || null,
        city: form.city.trim() || null,
        weight: Number(form.weight) || 1,
        data_class: form.data_class as "public" | "restricted" | "confidential",
        active: form.active,
      };
      if (form.id) {
        const { error } = await supabase.from("questions").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("questions").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("저장되었습니다.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["questions", activeOrgId, setId] });
      qc.invalidateQueries({ queryKey: ["questions-inventory", activeOrgId, businessId] });
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });

  const toggleActive = useMutation({
    mutationFn: async (q: Question) => {
      const { error } = await supabase.from("questions").update({ active: !q.active }).eq("id", q.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questions", activeOrgId, setId] });
      qc.invalidateQueries({ queryKey: ["questions-inventory", activeOrgId, businessId] });
    },
    onError: (e: Error) => toast.error(`변경 실패: ${e.message}`),
  });

  const suggestAi = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("suggest-questions", {
        body: { orgId: activeOrgId, businessId, count: 24 },
      });
      if (error) throw new Error(error.message);
      return data as {
        suggestions?: unknown;
        mode?: string;
        requestedCount?: number;
        suggestionCount?: number;
        batchCount?: number;
        intentCounts?: Record<string, number>;
        model?: string;
        costStatus?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
        estimatedCostUsd?: number;
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
      setNewSetName(`${selectedBusiness?.name ?? "업체"} AI 검색 질문 ${today}`);
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
  const nonPublic = allQuestions.filter((q) => q.data_class !== "public");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">검색 질문</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          고객이 AI에 실제로 물어볼 만한 질문을 만들고, 측정에 사용할 질문을 관리합니다.
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
              <Button disabled={!businessId} onClick={() => setOpenConfirmAi(true)}>
                추천 검색 질문 만들기
              </Button>
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
              아직 질문이 없습니다. AI 질문 인벤토리를 생성해 시작하세요.
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

      {nonPublic.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>공개(public) 이외 데이터 등급 질문 {nonPublic.length}건</AlertTitle>
          <AlertDescription>
            제한·기밀 등급 질문은 외부 공유와 고객 보고서 노출에 주의해야 합니다.
          </AlertDescription>
        </Alert>
      )}

      <Collapsible>
        <Card>
          <CardHeader className="pb-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0 text-sm font-medium">
                고급 관리 (질문 직접 편집)
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
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
                {canWrite && (
                  <>
                    <Button variant="outline" disabled={!businessId} onClick={() => setOpenSet(true)}>
                      질문 세트 추가
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!setId}
                      onClick={() => {
                        setForm({ ...EMPTY_Q });
                        setOpen(true);
                      }}
                    >
                      질문 추가
                    </Button>
                  </>
                )}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>질문</TableHead>
                      <TableHead>질문군</TableHead>
                      <TableHead>언어/국가</TableHead>
                      <TableHead>지역</TableHead>
                      <TableHead>가중치</TableHead>
                      <TableHead>데이터 등급</TableHead>
                      <TableHead>상태</TableHead>
                      {canWrite && <TableHead className="text-right">작업</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questions.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="max-w-[360px] text-sm">{q.prompt_text}</TableCell>
                        <TableCell className="text-sm">{intentLabel(q.intent_type)}</TableCell>
                        <TableCell className="text-sm">
                          {q.language}/{q.country_code}
                        </TableCell>
                        <TableCell className="text-sm">
                          {[q.region, q.city].filter(Boolean).join(" ") || "-"}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{q.weight}</TableCell>
                        <TableCell>
                          {q.data_class === "public" ? (
                            <Badge variant="secondary">{DATA_CLASS_LABELS[q.data_class]}</Badge>
                          ) : (
                            <Badge variant="destructive">{DATA_CLASS_LABELS[q.data_class]}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={q.active ? "secondary" : "outline"}>
                            {q.active ? "활성" : "비활성"}
                          </Badge>
                        </TableCell>
                        {canWrite && (
                          <TableCell className="space-x-2 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setForm({
                                  id: q.id,
                                  prompt_text: q.prompt_text,
                                  intent_type: q.intent_type,
                                  language: q.language,
                                  country_code: q.country_code,
                                  region: q.region ?? "",
                                  city: q.city ?? "",
                                  weight: String(q.weight),
                                  data_class: q.data_class,
                                  active: q.active,
                                });
                                setOpen(true);
                              }}
                            >
                              수정
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(q)}>
                              {q.active ? "비활성화" : "활성화"}
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {questions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          질문 세트를 선택하면 질문 목록이 표시됩니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog open={openSet} onOpenChange={setOpenSet}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>질문 세트 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="set-name">세트 이름</Label>
            <Input id="set-name" value={setName} onChange={(e) => setSetName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={() => createSet.mutate()} disabled={!setName.trim() || createSet.isPending}>
              생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "질문 수정" : "질문 추가"}</DialogTitle>
          </DialogHeader>
          <form
            id="q-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveQuestion.mutate();
            }}
          >
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="q-text">질문 문구</Label>
              <Textarea
                id="q-text"
                required
                rows={3}
                value={form.prompt_text}
                onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-intent">질문군(intent)</Label>
              <Input
                id="q-intent"
                value={form.intent_type}
                onChange={(e) => setForm({ ...form, intent_type: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-lang">언어</Label>
              <Input id="q-lang" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-country">국가</Label>
              <Input
                id="q-country"
                value={form.country_code}
                onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-weight">가중치</Label>
              <Input
                id="q-weight"
                type="number"
                step="0.1"
                min="0"
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-region">지역</Label>
              <Input id="q-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-city">도시</Label>
              <Input id="q-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>데이터 등급</Label>
              <Select value={form.data_class} onValueChange={(v) => setForm({ ...form, data_class: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DATA_CLASS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.data_class !== "public" && (
                <p className="text-sm font-medium text-destructive">
                  ⚠ 공개(public)가 아닌 데이터 등급입니다. 외부 공유 시 주의하세요.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <p className="text-sm font-medium">활성 상태</p>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="q-form" disabled={saveQuestion.isPending}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openConfirmAi} onOpenChange={(v) => !suggestAi.isPending && setOpenConfirmAi(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>AI 검색 질문을 만들까요?</DialogTitle>
            <DialogDescription>
              등록한 업체의 업종과 지역을 바탕으로, 실제 고객이 AI에 물어볼 만한 검색 질문 24개를 만듭니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-xs">
              만들어진 질문은 측정 전에 확인할 수 있습니다. 첫 측정을 시작하면 정확한 반복 비교를 위해 질문이
              고정됩니다.
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
              disabled={saveSuggestions.isPending || !newSetName.trim()}
            >
              {saveSuggestions.isPending ? "저장 중…" : "24개 질문 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
