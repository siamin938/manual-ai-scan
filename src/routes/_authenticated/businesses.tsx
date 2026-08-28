import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { useImeSafeForm } from "@/hooks/use-ime-safe-form";

import {
  businessNameIdentityKey,
  generateSafeAliasCandidates,
  getBusinessSaveErrorMessage,
  normalizeAliasList,
  normalizeBusinessName,
} from "@/lib/business-registration.helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/businesses")({
  head: () => ({
    meta: [
      { title: "업체 관리 · AI Visibility Lab" },
      { name: "description", content: "대상 업체와 경쟁업체 정보를 등록하고 관리합니다." },
      { property: "og:title", content: "업체 관리 · AI Visibility Lab" },
      { property: "og:description", content: "대상 업체와 경쟁업체 등록 및 관리" },
    ],
  }),
  component: BusinessesPage,
});

type Business = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  website_url: string | null;
  naver_place_url: string | null;
  google_maps_url: string | null;
  address: string | null;
  country_code: string;
  region: string | null;
  city: string | null;
  is_client_business: boolean;
  active: boolean;
};

const CATEGORY_OPTIONS = [
  "자동차 튜닝",
  "자동차 정비",
  "자동차 디테일링/세차",
  "썬팅/신차패키지",
  "자동차 용품/전장",
  "타이어/휠",
  "렌터카/자동차 서비스",
  "음식점",
  "카페/베이커리",
  "병원/의료",
  "미용/뷰티",
  "교육",
  "숙박/여행",
  "전문 서비스",
] as const;

const CUSTOM_CATEGORY = "기타/직접 입력";

type FormState = {
  id: string;
  name: string;
  existingAliases: string[];
  manualAliases: string[];
  acceptedCandidates: string[];
  categorySelect: string;
  categoryCustom: string;
  website_url: string;
  naver_place_url: string;
  google_maps_url: string;
  address: string;
  country_code: string;
  region: string;
  city: string;
  is_client_business: boolean;
  active: boolean;
  competitor_of: string;
};

const EMPTY: FormState = {
  id: "",
  name: "",
  existingAliases: [],
  manualAliases: [],
  acceptedCandidates: [],
  categorySelect: "",
  categoryCustom: "",
  website_url: "",
  naver_place_url: "",
  google_maps_url: "",
  address: "",
  country_code: "KR",
  region: "",
  city: "",
  is_client_business: true,
  active: true,
  competitor_of: "",
};

const IME_TEXT_FIELDS = [
  "name",
  "categoryCustom",
  "address",
  "region",
  "city",
  "naver_place_url",
  "website_url",
  "google_maps_url",
] as const;

function BusinessesPage() {
  const { activeOrgId, canWrite } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [manualInput, setManualInput] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { formRef, resolveLatest, compositionProps, isComposing } = useImeSafeForm(IME_TEXT_FIELDS);
  const manualInputRef = useRef<HTMLInputElement | null>(null);


  const { data: businesses = [], isLoading } = useQuery({
    queryKey: ["businesses", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select(
          "id, name, aliases, category, website_url, naver_place_url, google_maps_url, address, country_code, region, city, is_client_business, active",
        )
        .eq("org_id", activeOrgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Business[];
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: ["business-competitor-links", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_competitors")
        .select("target_business_id, competitor_business_id, active")
        .eq("org_id", activeOrgId!)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientBusinesses = businesses.filter((b) => b.is_client_business);
  const autoTargetId = clientBusinesses.length === 1 ? clientBusinesses[0]!.id : "";

  const normalizedName = normalizeBusinessName(form.name);
  const duplicateBusiness = useMemo(() => {
    const key = businessNameIdentityKey(form.name);
    if (!key) return null;
    return businesses.find((b) => b.id !== form.id && businessNameIdentityKey(b.name) === key) ?? null;
  }, [businesses, form.id, form.name]);
  const aliasCandidates = useMemo(() => {
    const existing = new Set([
      ...normalizeAliasList(form.existingAliases),
      ...normalizeAliasList(form.manualAliases),
    ]);
    return generateSafeAliasCandidates(form.name).filter((c) => !existing.has(c));
  }, [form.name, form.existingAliases, form.manualAliases]);

  const resolvedCategory =
    form.categorySelect === CUSTOM_CATEGORY
      ? form.categoryCustom.trim()
      : form.categorySelect.trim();

  function resolveCategoryOf(f: FormState): string {
    return f.categorySelect === CUSTOM_CATEGORY ? f.categoryCustom.trim() : f.categorySelect.trim();
  }

  function buildAliases(f: FormState, canonicalName: string): string[] {
    const existing = new Set([
      ...normalizeAliasList(f.existingAliases),
      ...normalizeAliasList(f.manualAliases),
    ]);
    const accepted = generateSafeAliasCandidates(f.name)
      .filter((c) => !existing.has(c))
      .filter((c) => f.acceptedCandidates.includes(c));
    return normalizeAliasList([...f.existingAliases, ...f.manualAliases, ...accepted]).filter(
      (a) => a !== canonicalName,
    );
  }

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const canonicalName = normalizeBusinessName(f.name);
      const payload = {
        org_id: activeOrgId!,
        name: canonicalName,
        aliases: buildAliases(f, canonicalName),
        category: resolveCategoryOf(f),
        website_url: f.website_url.trim() || null,
        naver_place_url: f.naver_place_url.trim() || null,
        google_maps_url: f.google_maps_url.trim() || null,
        address: f.address.trim() || null,
        country_code: f.id ? f.country_code || "KR" : "KR",
        region: f.region.trim() || null,
        city: f.city.trim() || null,
        is_client_business: f.is_client_business,
        active: f.active,
      };
      let businessId = f.id;
      if (f.id) {
        const { error } = await supabase.from("businesses").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("businesses").insert(payload).select("id").single();
        if (error) throw error;
        businessId = data!.id;
      }

      // 경쟁업체로 등록하면 대상 업체와의 관계를 business_competitors에 저장
      const targetId = f.is_client_business ? "" : f.competitor_of || autoTargetId;
      if (!f.is_client_business && targetId) {
        const { error } = await supabase.from("business_competitors").upsert(
          {
            org_id: activeOrgId!,
            target_business_id: targetId,
            competitor_business_id: businessId,
            active: true,
          },
          { onConflict: "target_business_id,competitor_business_id" },
        );
        if (error) throw error;
      }
    },

    onSuccess: () => {
      toast.success("저장되었습니다.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["businesses", activeOrgId] });
      qc.invalidateQueries({ queryKey: ["business-competitor-links", activeOrgId] });
    },
    onError: (e: unknown) => toast.error(getBusinessSaveErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (b: Business) => {
      const { error } = await supabase.from("businesses").update({ active: !b.active }).eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["businesses", activeOrgId] }),
    onError: (e: Error) => toast.error(`변경 실패: ${e.message}`),
  });

  function openNew() {
    setForm({ ...EMPTY });
    setManualInput("");
    setAdvancedOpen(false);
    setOpen(true);
  }

  function openEdit(b: Business) {
    const category = b.category ?? "";
    const isKnown = (CATEGORY_OPTIONS as readonly string[]).includes(category);
    setForm({
      id: b.id,
      name: b.name,
      existingAliases: normalizeAliasList(b.aliases ?? []),
      manualAliases: [],
      acceptedCandidates: [],
      categorySelect: category ? (isKnown ? category : CUSTOM_CATEGORY) : "",
      categoryCustom: category && !isKnown ? category : "",
      website_url: b.website_url ?? "",
      naver_place_url: b.naver_place_url ?? "",
      google_maps_url: b.google_maps_url ?? "",
      address: b.address ?? "",
      country_code: b.country_code ?? "KR",
      region: b.region ?? "",
      city: b.city ?? "",
      is_client_business: b.is_client_business,
      active: b.active,
      competitor_of:
        links.find((l) => l.competitor_business_id === b.id)?.target_business_id ?? "",
    });
    setManualInput("");
    setAdvancedOpen(false);
    setOpen(true);
  }

  function addManualAlias() {
    // 조합 중 마지막 글자가 state에 반영되지 않았을 수 있으므로 DOM 최신값을 우선 사용한다.
    const raw = manualInputRef.current?.value ?? manualInput;
    const value = normalizeBusinessName(raw);
    if (!value) {
      toast.error("추가할 이름을 입력해 주세요.");
      return;
    }
    if (value === normalizeBusinessName(resolveLatest(form).name)) {
      toast.error("공식 업체명과 같은 이름은 추가할 필요가 없습니다.");
      return;
    }
    const already = new Set([
      ...normalizeAliasList(form.existingAliases),
      ...normalizeAliasList(form.manualAliases),
    ]);
    if (already.has(value)) {
      toast.error("이미 등록된 이름입니다.");
      return;
    }
    setForm((f) => ({ ...f, manualAliases: [...f.manualAliases, value] }));
    setManualInput("");
    if (manualInputRef.current) manualInputRef.current.value = "";
  }

  function submit() {
    // 저장 직전 폼 DOM의 최신 값을 확정해 IME 조합 중 마지막 글자 누락을 방지한다.
    const latest = resolveLatest(form);
    setForm(latest);

    const latestName = normalizeBusinessName(latest.name);
    if (!latestName) {
      toast.error("공식 업체명을 입력해 주세요.");
      return;
    }
    if (!latest.categorySelect) {
      toast.error("업종을 선택해 주세요.");
      return;
    }
    if (latest.categorySelect === CUSTOM_CATEGORY && !latest.categoryCustom.trim()) {
      toast.error("업종을 직접 입력해 주세요.");
      return;
    }
    const latestKey = businessNameIdentityKey(latestName);
    const latestDuplicate =
      businesses.find((b) => b.id !== latest.id && businessNameIdentityKey(b.name) === latestKey) ?? null;
    if (latestDuplicate) {
      toast.error(
        "이미 등록된 업체명입니다. 지점이 다른 업체라면 공식 업체명에 지점명을 포함해 주세요.",
      );
      return;
    }
    save.mutate(latest);
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">업체 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">대상 업체와 경쟁업체를 등록하고 관리합니다.</p>
        </div>
        {canWrite && <Button onClick={openNew}>업체 추가</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">등록 업체 {businesses.length}곳</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>업체명</TableHead>
                <TableHead>구분</TableHead>
                <TableHead>업종</TableHead>
                <TableHead>지역</TableHead>
                <TableHead>다른 이름</TableHead>
                <TableHead>상태</TableHead>
                {canWrite && <TableHead className="text-right">작업</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {businesses.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>
                    <Badge variant={b.is_client_business ? "default" : "outline"}>
                      {b.is_client_business ? "대상 업체" : "경쟁업체"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{b.category}</TableCell>
                  <TableCell className="text-sm">
                    {[b.region, b.city].filter(Boolean).join(" ") || "-"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {(b.aliases ?? []).join(", ") || "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={b.active ? "secondary" : "outline"}>{b.active ? "활성" : "비활성"}</Badge>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="space-x-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(b)}>
                        수정
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(b)}>
                        {b.active ? "비활성화" : "활성화"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!isLoading && businesses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    등록된 업체가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "업체 수정" : "업체 추가"}</DialogTitle>
            <DialogDescription>
              업체 기본 정보를 등록하면 질문 추천과 AI 측정을 시작할 수 있습니다. 이름 인식 후보는 시스템이 안전한
              범위에서만 제안합니다.
            </DialogDescription>
          </DialogHeader>

          <form
            id="biz-form"
            ref={formRef}
            className="space-y-6"
            onKeyDown={(e) => {
              // 조합 중 Enter로 폼이 먼저 제출되지 않도록 막는다.
              if (e.key === "Enter" && isComposing(e)) e.preventDefault();
            }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {/* 기본 정보 */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">기본 정보</h3>
              <div className="space-y-2">
                <Label htmlFor="b-name">공식 업체명</Label>
                <Input
                  id="b-name"
                  name="name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  {...compositionProps((v) => setForm((f) => ({ ...f, name: v })))}
                />
                {duplicateBusiness && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
                    <p className="font-medium">이미 등록된 업체입니다: {duplicateBusiness.name}</p>
                    <p className="mt-1 text-muted-foreground">
                      같은 업체라면 기존 업체를 수정하고, 지점이 다른 업체라면 공식 업체명에 지점명을 포함해 주세요.
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">대한민국 기준으로 등록됩니다.</p>
              </div>

              <div className="space-y-2">
                <Label>업종 선택</Label>
                <Select
                  {...(form.categorySelect ? { value: form.categorySelect } : {})}
                  onValueChange={(v) => setForm({ ...form, categorySelect: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="업종을 선택해 주세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_CATEGORY}>{CUSTOM_CATEGORY}</SelectItem>
                  </SelectContent>
                </Select>
                {form.categorySelect === CUSTOM_CATEGORY && (
                  <Input
                    aria-label="업종 직접 입력"
                    name="categoryCustom"
                    placeholder="업종을 직접 입력해 주세요"
                    value={form.categoryCustom}
                    onChange={(e) => setForm({ ...form, categoryCustom: e.target.value })}
                    {...compositionProps((v) => setForm((f) => ({ ...f, categoryCustom: v })))}
                  />
                )}
                {!form.categorySelect && (
                  <p className="text-xs text-muted-foreground">업종을 선택해 주세요.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="b-addr">주소</Label>
                <Input
                  id="b-addr"
                  name="address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  {...compositionProps((v) => setForm((f) => ({ ...f, address: v })))}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="b-region">지역(시/도)</Label>
                  <Input
                    id="b-region"
                    name="region"
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    {...compositionProps((v) => setForm((f) => ({ ...f, region: v })))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-city">도시(시/군/구)</Label>
                  <Input
                    id="b-city"
                    name="city"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    {...compositionProps((v) => setForm((f) => ({ ...f, city: v })))}
                  />
                </div>
              </div>
            </section>

            {/* 공개 정보 */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">공개 정보 (권장)</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="b-naver">네이버 플레이스</Label>
                  <Input
                    id="b-naver"
                    name="naver_place_url"
                    value={form.naver_place_url}
                    onChange={(e) => setForm({ ...form, naver_place_url: e.target.value })}
                    {...compositionProps((v) => setForm((f) => ({ ...f, naver_place_url: v })))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-web">홈페이지</Label>
                  <Input
                    id="b-web"
                    name="website_url"
                    value={form.website_url}
                    onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                    {...compositionProps((v) => setForm((f) => ({ ...f, website_url: v })))}
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="b-gmap">구글 지도</Label>
                  <Input
                    id="b-gmap"
                    name="google_maps_url"
                    value={form.google_maps_url}
                    onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })}
                    {...compositionProps((v) => setForm((f) => ({ ...f, google_maps_url: v })))}
                  />

                </div>
              </div>
            </section>

            {/* 업체 이름 인식 */}
            <section className="space-y-4 rounded-md border p-4">
              <div>
                <h3 className="text-sm font-semibold">업체 이름 인식</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  AI 답변에서 같은 업체로 볼 수 있는 이름을 확인합니다. 잘못된 이름을 추가하면 다른 업체를 내 업체로
                  오인할 수 있습니다.
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">공식 업체명</p>
                <p className="text-sm font-medium">{normalizedName || "-"}</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">안전한 자동 후보</p>
                {aliasCandidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">추가로 필요한 안전한 표기 변형이 없습니다.</p>
                ) : (
                  aliasCandidates.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.acceptedCandidates.includes(c)}
                        onCheckedChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            acceptedCandidates: v
                              ? [...f.acceptedCandidates, c]
                              : f.acceptedCandidates.filter((x) => x !== c),
                          }))
                        }
                      />
                      <span>{c}</span>
                    </label>
                  ))
                )}
              </div>

              {(form.existingAliases.length > 0 || form.manualAliases.length > 0) && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">등록된 다른 이름</p>
                  <div className="flex flex-wrap gap-2">
                    {form.existingAliases.map((a) => (
                      <Badge key={`e-${a}`} variant="secondary" className="gap-2">
                        {a}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              existingAliases: f.existingAliases.filter((x) => x !== a),
                            }))
                          }
                        >
                          삭제
                        </button>
                      </Badge>
                    ))}
                    {form.manualAliases.map((a) => (
                      <Badge key={`m-${a}`} variant="outline" className="gap-2">
                        {a}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              manualAliases: f.manualAliases.filter((x) => x !== a),
                            }))
                          }
                        >
                          삭제
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    다른 이름 직접 추가
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    공식적으로 실제 사용되는 다른 이름만 추가하세요. 지점명·지역명을 임의로 빼면 다른 업체와 혼동될 수
                    있습니다.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      aria-label="다른 이름 입력"
                      ref={manualInputRef}
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      {...compositionProps((v) => setManualInput(v))}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        // 조합 중 Enter는 조합 확정용이므로 별칭 추가를 실행하지 않는다.
                        if (isComposing(e)) return;
                        addManualAlias();
                      }}
                      placeholder="한 번에 한 개씩 입력"
                    />

                    <Button type="button" variant="outline" onClick={addManualAlias}>
                      추가
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </section>

            {/* 고급 설정 */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  고급 설정
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-3">
                <p className="text-xs text-muted-foreground">
                  일반적인 첫 등록에서는 변경할 필요가 없습니다. 경쟁업체는 측정 결과에서 자동 발견됩니다.
                </p>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">대상 업체</p>
                    <p className="text-xs text-muted-foreground">끄면 경쟁업체로 등록됩니다.</p>
                  </div>
                  <Switch
                    checked={form.is_client_business}
                    onCheckedChange={(v) => setForm({ ...form, is_client_business: v })}
                  />
                </div>
                {!form.is_client_business && (
                  <div className="space-y-2">
                    <Label>어느 대상 업체의 경쟁업체인가요?</Label>
                    <Select
                      {...(form.competitor_of || autoTargetId
                        ? { value: form.competitor_of || autoTargetId }
                        : {})}
                      onValueChange={(v) => setForm({ ...form, competitor_of: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="대상 업체 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {clientBusinesses.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      선택한 대상 업체와의 관계가 저장되어 보고서 분석에 반영됩니다.
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-md border p-3">
                  <p className="text-sm font-medium">활성 상태</p>
                  <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </form>

          <DialogFooter>
            <Button
              type="submit"
              form="biz-form"
              disabled={save.isPending || !normalizedName || !form.categorySelect || !!duplicateBusiness}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
