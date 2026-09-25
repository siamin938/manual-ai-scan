import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canViewDataAssetAdmin } from "@/lib/data-asset-admin.functions";
import { useOrg } from "@/lib/org";

import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";
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
import {
  buildCustomQuestionCandidates,
  validateCustomQuestionInput,
} from "@/lib/custom-question-suggestions";

export const Route = createFileRoute("/_authenticated/questions")({
  head: () => ({
    meta: [
      { title: "검색 질문 · 차보임 CHABOIM" },
      {
        name: "description",
        content: "AI 측정에 사용할 표준 검색 질문을 만들고 확인합니다.",
      },
      { property: "og:title", content: "검색 질문 · 차보임 CHABOIM" },
      {
        property: "og:description",
        content: "AI 측정에 사용할 표준 검색 질문을 만들고 확인합니다.",
      },
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
  const [form, setForm] = useState<{ id: string; prompt_text: string }>({
    id: "",
    prompt_text: "",
  });

  // --- AI 질문 인벤토리 생성 상태 ---
  const [openConfirmAi, setOpenConfirmAi] = useState(false);
  const [openReview, setOpenReview] = useState(false);
  const [candidates, setCandidates] = useState<SuggestionCandidate[]>([]);
  const [newSetName, setNewSetName] = useState("");
  const [genMode, setGenMode] = useState<"default" | "internal_remeasurement">("default");

  // --- 맞춤 질문 v0.1: 사용자 확인 입력만 사용, LLM 추론 없음 ---
  const [openCustom, setOpenCustom] = useState(false);
  const [openCustomReview, setOpenCustomReview] = useState(false);
  const [customLocationMode, setCustomLocationMode] = useState<"city" | "region">("city");
  const [customForm, setCustomForm] = useState({
    service: "",
    brandModel: "",
    customerNeed: "",
  });
  const [customCandidates, setCustomCandidates] = useState<SuggestionCandidate[]>([]);
  const [customSetName, setCustomSetName] = useState("");

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

  const customLocation =
    customLocationMode === "city"
      ? (selectedBusiness?.city ?? selectedBusiness?.region ?? "")
      : (selectedBusiness?.region ?? selectedBusiness?.city ?? "");

  const openCustomBuilder = () => {
    if (!selectedBusiness) {
      toast.error("업체 정보를 먼저 불러와 주세요.");
      return;
    }
    const hasCity = !!selectedBusiness.city?.trim();
    const hasRegion = !!selectedBusiness.region?.trim();
    if (!hasCity && !hasRegion) {
      toast.error("등록된 지역 정보가 없어 맞춤 질문을 만들 수 없습니다.");
      return;
    }
    setCustomLocationMode(hasCity ? "city" : "region");
    setCustomForm({ service: "", brandModel: "", customerNeed: "" });
    setCustomCandidates([]);
    setOpenCustom(true);
  };

  const createCustomCandidates = () => {
    const businessName = selectedBusiness?.name ?? "";
    const validation = validateCustomQuestionInput(
      {
        location: customLocation,
        service: customForm.service,
        brandModel: customForm.brandModel,
        customerNeed: customForm.customerNeed,
      },
      businessName,
    );

    if (!validation.ok) {
      const message =
        validation.error === "SERVICE_REQUIRED"
          ? "주력 서비스를 입력해 주세요."
          : validation.error === "LOCATION_REQUIRED"
            ? "측정 지역을 확인해 주세요."
            : validation.error === "BUSINESS_NAME_INCLUDED"
              ? "맞춤 입력에는 내 업체명을 넣지 말아 주세요."
              : "입력값이 너무 깁니다. 각 항목은 80자 이내로 입력해 주세요.";
      toast.error(message);
      return;
    }

    const list = buildCustomQuestionCandidates(validation.value, businessName);
    if (list.length !== 8) {
      toast.error("맞춤 질문 8개를 완성하지 못했습니다. 입력값을 확인해 주세요.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setCustomCandidates(list);
    setCustomSetName(`맞춤 질문 · ${businessName || "업체"} · ${today}`);
    setOpenCustom(false);
    setOpenCustomReview(true);
  };

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
    if (!setIds.includes(setId)) setSetId(setIds[0] ?? "");
  }, [setId, setIds]);

  const selectedSet = sets.find((set) => set.id === setId) ?? null;
  const activeQuestions = questions.filter((q) => q.active);
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
        city: customLocationMode === "region" ? null : (selectedBusiness?.city ?? null),
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

  const saveCustomSuggestions = useMutation({
    mutationFn: async () => {
      const selected = customCandidates.filter((candidate) => candidate.selected);
      if (selected.length === 0) throw new Error("NO_SELECTION");
      if (!customSetName.trim()) throw new Error("NO_SET_NAME");

      const { data, error: setErr } = await supabase
        .from("question_sets")
        .insert({
          org_id: activeOrgId!,
          business_id: businessId,
          name: customSetName.trim(),
        })
        .select("id")
        .single();
      if (setErr) throw setErr;
      const destSetId = data.id as string;

      const { kept } = dedupeForSave(selected, []);
      if (kept.length === 0) throw new Error("ALL_DUPLICATE");

      const payloads = buildInsertPayloads(kept, {
        orgId: activeOrgId!,
        questionSetId: destSetId,
        region: selectedBusiness?.region ?? null,
        city: selectedBusiness?.city ?? null,
      });
      const { error } = await supabase.from("questions").insert(payloads);
      if (error) throw error;

      return { destSetId, inserted: kept.length };
    },
    onSuccess: (res) => {
      toast.success(`맞춤 질문 ${res.inserted}개를 별도 세트로 저장했습니다.`);
      setOpenCustomReview(false);
      setCustomCandidates([]);
      setSetId(res.destSetId);
      qc.invalidateQueries({ queryKey: ["question-sets", activeOrgId, businessId] });
      qc.invalidateQueries({ queryKey: ["questions-inventory", activeOrgId, businessId] });
      qc.invalidateQueries({ queryKey: ["questions", activeOrgId, res.destSetId] });
    },
    onError: (e: Error) => {
      if (e.message === "NO_SELECTION") {
        toast.error("저장할 맞춤 질문을 한 개 이상 선택해 주세요.");
        return;
      }
      if (e.message === "NO_SET_NAME") {
        toast.error("질문 세트 이름을 입력해 주세요.");
        return;
      }
      if (e.message === "ALL_DUPLICATE") {
        toast.error("저장할 맞춤 질문이 없습니다.");
        return;
      }
      toast.error(`맞춤 질문 저장 실패: ${e.message}`);
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
          내 업체에서 실제로 중요하게 보는 AI 검색을 먼저 설정하고, 기본 진단 질문은 비교 기준으로
          함께 관리합니다.
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
          {!canWrite && (
            <div className="ml-auto">
              <Badge variant="secondary">조회 전용 권한</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* A. 메인 — 내 업체 맞춤 진단 */}
          <Card className="border-primary/50 shadow-sm">
            <CardHeader className="space-y-1.5 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">내 업체 맞춤 진단</CardTitle>
                <Badge>추천</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                지역 · 주력 서비스 · 중요 브랜드/차종을 기준으로 내 업체에 중요한 검색 질문을
                만듭니다.
              </p>
              <p className="text-xs text-muted-foreground">
                사장님이 직접 확인한 정보만 사용하며, 맞춤 진단 결과는 기본 진단과 구분해서 확인할
                수 있습니다.
              </p>
            </CardHeader>
            <CardContent>
              <Button disabled={!businessId} onClick={openCustomBuilder}>
                내 업체 맞춤 진단 만들기
              </Button>
              {!businessId && (
                <p className="mt-2 text-xs text-muted-foreground">먼저 업체를 선택해 주세요.</p>
              )}
            </CardContent>
          </Card>

          {/* B. 보조 — 기본 AI 노출 진단 */}
          <Card>
            <CardHeader className="space-y-1.5 pb-3">
              <CardTitle className="text-base">기본 AI 노출 진단</CardTitle>
              <p className="text-sm text-muted-foreground">
                업종과 지역을 기준으로 동일한 24개 질문을 사용해 전체 노출 상태와 장기 변화를
                확인합니다.
              </p>
              <p className="text-xs text-muted-foreground">
                업체 간/기간 비교를 위한 기준선입니다.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                disabled={!businessId}
                onClick={() => {
                  setGenMode("default");
                  setOpenConfirmAi(true);
                }}
              >
                기본 진단 24문항 만들기
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {isInternalOperator && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">운영자 도구</p>
          <Button
            variant="outline"
            size="sm"
            disabled={!businessId}
            onClick={() => {
              setGenMode("internal_remeasurement");
              setOpenConfirmAi(true);
            }}
          >
            최신 Market 질문 새 세트 만들기
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">현재 질문 세트</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="truncate text-base font-semibold" title={selectedSet?.name ?? undefined}>
              {selectedSet?.name ?? "선택된 세트 없음"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">질문 수</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {activeQuestions.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">검색 상황</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {intentCounts.length}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">검색 상황별 질문 수</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {intentCounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              질문 세트를 선택하면 검색 상황별 질문 수가 표시됩니다.
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
                    <TableCell
                      colSpan={canWrite ? 5 : 4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
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

      <Dialog open={openCustom} onOpenChange={setOpenCustom}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>내 업체 맞춤 진단 만들기</DialogTitle>
            <DialogDescription>
              AI가 업체 특징을 추측하지 않습니다. 사장님이 확인한 정보만 조합해 8개 질문 후보를
              만듭니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>측정 지역 범위</Label>
              <Select
                value={customLocationMode}
                onValueChange={(value) => setCustomLocationMode(value as "city" | "region")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedBusiness?.city && (
                    <SelectItem value="city">상세 지역 · {selectedBusiness.city}</SelectItem>
                  )}
                  {selectedBusiness?.region && (
                    <SelectItem value="region">광역 지역 · {selectedBusiness.region}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                등록된 지역만 사용해 질문 문구와 측정 위치가 어긋나지 않게 합니다.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-service">주력 서비스</Label>
              <Input
                id="custom-service"
                placeholder="예: 신차패키지, 타이어 교체, 엔진오일"
                value={customForm.service}
                onChange={(e) => setCustomForm({ ...customForm, service: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                실제로 제공하고 있고 이번에 확인하고 싶은 서비스만 입력해 주세요.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-brand">중요 브랜드·차종 (선택)</Label>
              <Input
                id="custom-brand"
                placeholder="예: 테슬라, 테슬라 모델Y, 테슬라 모델3"
                value={customForm.brandModel}
                onChange={(e) => setCustomForm({ ...customForm, brandModel: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                여러 개라면 쉼표로 구분해 주세요. 최대 4개까지 질문에 나눠 반영합니다.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-need">중요 고객 니즈 (선택)</Label>
              <Input
                id="custom-need"
                placeholder="예: 출고 후 한 번에 시공, 주말 상담"
                value={customForm.customerNeed}
                onChange={(e) => setCustomForm({ ...customForm, customerNeed: e.target.value })}
              />
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              기본 24문항은 변경하지 않습니다. 맞춤 질문은 별도 질문 세트로 저장되며, 내 업체명이
              포함된 입력은 차단합니다.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCustom(false)}>
              취소
            </Button>
            <Button onClick={createCustomCandidates}>8개 질문 후보 보기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openCustomReview}
        onOpenChange={(value) => !saveCustomSuggestions.isPending && setOpenCustomReview(value)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              맞춤 질문 검토 ({customCandidates.filter((candidate) => candidate.selected).length}/
              {customCandidates.length}개 선택)
            </DialogTitle>
            <DialogDescription>
              실제로 중요하게 보는 질문만 체크해 별도 세트로 저장하세요. 기본 24문항과 섞지
              않습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            <p>지역: {customLocation}</p>
            <p>서비스: {customForm.service || "-"}</p>
            {customForm.brandModel && <p>브랜드·차종: {customForm.brandModel}</p>}
            {customForm.customerNeed && <p>고객 니즈: {customForm.customerNeed}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-set-name">질문 세트 이름</Label>
            <Input
              id="custom-set-name"
              value={customSetName}
              onChange={(e) => setCustomSetName(e.target.value)}
            />
          </div>

          <div className="divide-y rounded-md border">
            {customCandidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/30"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={candidate.selected}
                  onChange={(e) =>
                    setCustomCandidates((current) =>
                      current.map((item) =>
                        item.id === candidate.id ? { ...item, selected: e.target.checked } : item,
                      ),
                    )
                  }
                />
                <div className="flex-1 space-y-1">
                  <p className="text-sm">{candidate.promptText}</p>
                  <span className="text-xs text-muted-foreground">
                    {intentLabel(candidate.intentType)}
                  </span>
                </div>
              </label>
            ))}
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            맞춤 세트는 별도 측정용입니다. 첫 측정을 시작하면 기존 질문 세트와 동일하게 질문 문구가
            고정됩니다.
          </p>

          <DialogFooter>
            <Button
              onClick={() => saveCustomSuggestions.mutate()}
              disabled={
                saveCustomSuggestions.isPending ||
                !customSetName.trim() ||
                customCandidates.every((candidate) => !candidate.selected)
              }
            >
              {saveCustomSuggestions.isPending
                ? "저장 중…"
                : `선택한 ${customCandidates.filter((candidate) => candidate.selected).length}개 저장`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openConfirmAi}
        onOpenChange={(v) => !suggestAi.isPending && setOpenConfirmAi(v)}
      >
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
            <Button
              variant="outline"
              onClick={() => setOpenConfirmAi(false)}
              disabled={suggestAi.isPending}
            >
              취소
            </Button>
            <Button
              onClick={() => suggestAi.mutate()}
              disabled={suggestAi.isPending || !businessId}
            >
              {suggestAi.isPending ? "질문 만드는 중..." : "24개 질문 만들기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openReview}
        onOpenChange={(v) => !saveSuggestions.isPending && setOpenReview(v)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>생성된 질문 검토 ({candidates.length}개)</DialogTitle>
            <DialogDescription>
              24개 질문은 하나의 표준 질문 세트로 저장됩니다. 문구 수정은 첫 측정 전에 할 수
              있습니다.
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
                    <span className="text-xs text-muted-foreground">
                      {intentLabel(c.intentType)}
                    </span>
                    {c.containsBusinessName && (
                      <Badge variant="destructive">업체명 포함 · 수정 권장</Badge>
                    )}
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
