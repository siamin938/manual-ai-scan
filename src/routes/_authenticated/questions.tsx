import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { DATA_CLASS_LABELS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
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
  mapSuggestError,
  toCandidates,
  type SuggestionCandidate,
} from "@/lib/question-suggestions";


export const Route = createFileRoute("/_authenticated/questions")({
  head: () => ({
    meta: [
      { title: "질문 관리 · AI Visibility Lab" },
      { name: "description", content: "업체별 질문 세트와 점검용 질문을 등록하고 관리합니다." },
      { property: "og:title", content: "질문 관리 · AI Visibility Lab" },
      { property: "og:description", content: "질문 세트와 질문 등록 관리" },
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

function QuestionsPage() {
  const { activeOrgId, canWrite } = useOrg();
  const qc = useQueryClient();
  const [businessId, setBusinessId] = useState("");
  const [setId, setSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [openSet, setOpenSet] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_Q });
  // --- AI 질문 추천 v0.1 상태 ---
  const [openConfirmAi, setOpenConfirmAi] = useState(false);
  const [aiCount, setAiCount] = useState("10");
  const [openReview, setOpenReview] = useState(false);
  const [candidates, setCandidates] = useState<SuggestionCandidate[]>([]);
  const [aiMeta, setAiMeta] = useState<{
    model: string | null;
    costStatus: string | null;
    usage: { inputTokens?: number; outputTokens?: number } | null;
    estimatedCostUsd: number | null;
  }>({
    model: null,
    costStatus: null,
    usage: null,
    estimatedCostUsd: null,
  });
  const [targetSetMode, setTargetSetMode] = useState<"existing" | "new">("new");
  const [targetSetId, setTargetSetId] = useState("");
  const [newSetName, setNewSetName] = useState("");


  const { data: businesses = [] } = useQuery({
    queryKey: ["client-businesses-min", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name, region, city")
        .eq("org_id", activeOrgId!)
        .eq("active", true)
        .eq("is_client_business", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedBusiness = businesses.find((b) => b.id === businessId) ?? null;


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
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });

  const toggleActive = useMutation({
    mutationFn: async (q: Question) => {
      const { error } = await supabase.from("questions").update({ active: !q.active }).eq("id", q.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions", activeOrgId, setId] }),
    onError: (e: Error) => toast.error(`변경 실패: ${e.message}`),
  });

  const suggestAi = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("suggest-questions", {
        body: { orgId: activeOrgId, businessId, count: Number(aiCount) || 10 },
      });
      if (error) throw new Error(error.message);
      return data as {
        suggestions?: unknown;
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
      if (list.length === 0) {
        toast.error("사용할 수 있는 질문 후보가 없습니다. 다시 시도해 주세요.");
        return;
      }
      setCandidates(list);
      setAiMeta({
        model: typeof data?.model === "string" ? data.model : null,
        costStatus: typeof data?.costStatus === "string" ? data.costStatus : null,
        usage:
          data?.usage && typeof data.usage === "object"
            ? {
                inputTokens: typeof data.usage.inputTokens === "number" ? data.usage.inputTokens : undefined,
                outputTokens: typeof data.usage.outputTokens === "number" ? data.usage.outputTokens : undefined,
              }
            : null,
        estimatedCostUsd: typeof data?.estimatedCostUsd === "number" ? data.estimatedCostUsd : null,
      });
      setTargetSetMode(setId ? "existing" : "new");
      setTargetSetId(setId);
      setNewSetName(`${selectedBusiness?.name ?? "업체"} AI 추천 v1`);
      setOpenConfirmAi(false);
      setOpenReview(true);
    },
    onError: (e: Error) => toast.error(mapSuggestError(e.message)),
  });

  const saveSuggestions = useMutation({
    mutationFn: async () => {
      const selected = candidates.filter((c) => c.selected);
      if (selected.length === 0) throw new Error("NO_SELECTION");

      let destSetId = targetSetMode === "existing" ? targetSetId : "";
      if (targetSetMode === "new") {
        const { data, error } = await supabase
          .from("question_sets")
          .insert({ org_id: activeOrgId!, business_id: businessId, name: newSetName.trim() })
          .select("id")
          .single();
        if (error) throw error;
        destSetId = data.id as string;
      }
      if (!destSetId) throw new Error("NO_SET");

      const { data: existing, error: exErr } = await supabase
        .from("questions")
        .select("prompt_text")
        .eq("question_set_id", destSetId);
      if (exErr) throw exErr;

      const { kept, skipped } = dedupeForSave(
        selected,
        (existing ?? []).map((q) => q.prompt_text as string),
      );
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
      toast.success(`${res.inserted}개 질문을 등록했습니다.`);
      if (res.skipped > 0) toast.message(`중복 ${res.skipped}개는 제외했습니다.`);
      setOpenReview(false);
      setCandidates([]);
      setSetId(res.destSetId);
      qc.invalidateQueries({ queryKey: ["question-sets", activeOrgId, businessId] });
      qc.invalidateQueries({ queryKey: ["questions", activeOrgId, res.destSetId] });
    },
    onError: (e: Error) => {
      if (e.message === "ALL_DUPLICATE") {
        toast.error("선택한 질문이 모두 기존 질문과 중복되어 등록하지 않았습니다.");
        return;
      }
      if (e.message === "NO_SELECTION") {
        toast.error("등록할 질문을 선택해 주세요.");
        return;
      }
      toast.error(`등록 실패: ${e.message}`);
    },
  });

  const selectedCount = candidates.filter((c) => c.selected).length;
  const nonPublic = questions.filter((q) => q.data_class !== "public");


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">질문 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">업체별 질문 세트를 만들고 점검 질문을 등록합니다.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-2">
            <Label>업체</Label>
            <Select
              value={businessId}
              onValueChange={(v) => {
                setBusinessId(v);
                setSetId("");
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="업체 선택" />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
              <Button variant="outline" disabled={!businessId} onClick={() => setOpenConfirmAi(true)}>
                AI 질문 추천
              </Button>

              <Button
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">질문 {questions.length}건</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>질문 문구</TableHead>
                <TableHead>의도</TableHead>
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
                  <TableCell className="text-sm">{q.intent_type}</TableCell>
                  <TableCell className="text-sm">
                    {q.language}/{q.country_code}
                  </TableCell>
                  <TableCell className="text-sm">{[q.region, q.city].filter(Boolean).join(" ") || "-"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{q.weight}</TableCell>
                  <TableCell>
                    {q.data_class === "public" ? (
                      <Badge variant="secondary">{DATA_CLASS_LABELS[q.data_class]}</Badge>
                    ) : (
                      <Badge variant="destructive">{DATA_CLASS_LABELS[q.data_class]}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={q.active ? "secondary" : "outline"}>{q.active ? "활성" : "비활성"}</Badge>
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
                    업체와 질문 세트를 선택한 뒤 질문을 추가하세요.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
              <Label htmlFor="q-intent">의도 유형</Label>
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
            <DialogTitle>AI로 질문 후보를 만들까요?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              대상 업체의 공개 기본 정보(업체명·업종·지역·도시)만 사용합니다. 내부 측정·분석 데이터는 AI에 보내지
              않습니다.
            </p>
            <p className="font-medium text-foreground">AI 추천 생성 시 소액 API 비용이 발생합니다.</p>
            <div className="space-y-2">
              <Label htmlFor="ai-count">추천 개수</Label>
              <Select value={aiCount} onValueChange={setAiCount}>
                <SelectTrigger id="ai-count" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}개
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpenConfirmAi(false)}
              disabled={suggestAi.isPending}
            >
              취소
            </Button>
            <Button onClick={() => suggestAi.mutate()} disabled={suggestAi.isPending || !businessId}>
              {suggestAi.isPending ? "생성 중…" : "질문 후보 생성"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openReview} onOpenChange={(v) => !saveSuggestions.isPending && setOpenReview(v)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>AI 추천 질문 검토</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            {aiMeta.model ? `모델 ${aiMeta.model} · ` : ""}후보 {candidates.length}개
            {aiMeta.estimatedCostUsd !== null ? ` · 예상 비용 $${aiMeta.estimatedCostUsd.toFixed(4)}` : ""}
          </p>

          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="space-y-2">
              <Label>저장 대상</Label>
              <Select
                value={targetSetMode}
                onValueChange={(v) => setTargetSetMode(v as "existing" | "new")}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">새 질문 세트 생성</SelectItem>
                  <SelectItem value="existing" disabled={sets.length === 0}>
                    기존 질문 세트에 추가
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetSetMode === "new" ? (
              <div className="space-y-2">
                <Label htmlFor="ai-set-name">새 세트 이름</Label>
                <Input
                  id="ai-set-name"
                  className="w-[260px]"
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>질문 세트</Label>
                <Select value={targetSetId} onValueChange={setTargetSetId}>
                  <SelectTrigger className="w-[260px]">
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
            )}
            <div className="ml-auto space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCandidates((cs) => cs.map((c) => ({ ...c, selected: true })))}
              >
                전체 선택
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCandidates((cs) => cs.map((c) => ({ ...c, selected: false })))}
              >
                전체 해제
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {candidates.map((c, i) => (
              <div key={c.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={c.selected}
                    onCheckedChange={(v) =>
                      setCandidates((cs) =>
                        cs.map((x, xi) => (xi === i ? { ...x, selected: v === true } : x)),
                      )
                    }
                  />
                  <div className="flex-1 space-y-2">
                    <Textarea
                      rows={2}
                      value={c.promptText}
                      onChange={(e) =>
                        setCandidates((cs) =>
                          cs.map((x, xi) => (xi === i ? { ...x, promptText: e.target.value } : x)),
                        )
                      }
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={c.intentType}
                        onValueChange={(v) =>
                          setCandidates((cs) =>
                            cs.map((x, xi) =>
                              xi === i ? { ...x, intentType: v as SuggestionCandidate["intentType"] } : x,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALLOWED_INTENTS.map((it) => (
                            <SelectItem key={it} value={it}>
                              {INTENT_LABELS[it]} ({it})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {c.containsBusinessName && (
                        <Badge variant="destructive">업체명 포함 · 수정 권장</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              onClick={() => saveSuggestions.mutate()}
              disabled={
                saveSuggestions.isPending ||
                selectedCount === 0 ||
                (targetSetMode === "new" ? !newSetName.trim() : !targetSetId)
              }
            >
              {saveSuggestions.isPending ? "등록 중…" : `선택 질문 등록 (${selectedCount})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}
