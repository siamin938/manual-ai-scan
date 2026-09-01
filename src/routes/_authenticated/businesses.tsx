import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      { title: "업체 관리 · 차보임 CHABOIM" },
      { name: "description", content: "내 업체 정보를 등록하고 관리합니다." },
      { property: "og:title", content: "업체 관리 · 차보임 CHABOIM" },
      { property: "og:description", content: "내 업체 정보 등록 및 관리" },
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
  "자동차 정비/엔진오일",
  "자동차 디테일링/세차",
  "썬팅/신차패키지",
  "PPF/랩핑",
  "자동차 용품/전장",
  "타이어/휠",
  "렌터카/자동차 서비스",
  "기타 자동차 서비스",
] as const;

/** 기존에 저장된 비표준 업종 값을 수정 화면에서 유지하기 위한 legacy 선택 상태. */
const LEGACY_CATEGORY = "기존 업종 직접 입력";

type FormState = {
  id: string;
  name: string;
  existingAliases: string[];
  categorySelect: string;
  categoryCustom: string;
  website_url: string;
  naver_place_url: string;
  google_maps_url: string;
  address: string;
  country_code: string;
  region: string;
  city: string;
  active: boolean;
};

const EMPTY: FormState = {
  id: "",
  name: "",
  existingAliases: [],
  categorySelect: "",
  categoryCustom: "",
  website_url: "",
  naver_place_url: "",
  google_maps_url: "",
  address: "",
  country_code: "KR",
  region: "",
  city: "",
  active: true,
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
  const { formRef, resolveLatest, compositionProps, isComposing } = useImeSafeForm(IME_TEXT_FIELDS);

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

  const clientBusinesses = businesses.filter((b) => b.is_client_business);

  const normalizedName = normalizeBusinessName(form.name);
  const duplicateBusiness = useMemo(() => {
    const key = businessNameIdentityKey(form.name);
    if (!key) return null;
    return businesses.find((b) => b.id !== form.id && businessNameIdentityKey(b.name) === key) ?? null;
  }, [businesses, form.id, form.name]);

  function resolveCategoryOf(f: FormState): string {
    return f.categorySelect === LEGACY_CATEGORY ? f.categoryCustom.trim() : f.categorySelect.trim();
  }

  /** 기존 별칭은 보존하고, 매우 보수적인 안전 후보만 자동 포함한다. */
  function buildAliases(f: FormState, canonicalName: string): string[] {
    return normalizeAliasList([
      ...f.existingAliases,
      ...generateSafeAliasCandidates(f.name),
    ]).filter((a) => a !== canonicalName);
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
        is_client_business: true,
        active: f.id ? f.active : true,
      };
      if (f.id) {
        const { error } = await supabase.from("businesses").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("businesses").insert(payload);
        if (error) throw error;
      }
    },

    onSuccess: () => {
      toast.success("저장되었습니다.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["businesses", activeOrgId] });
      if (activeOrgId) {
        qc.invalidateQueries({ queryKey: ["client-business-options", activeOrgId] });
      }
    },
    onError: (e: unknown) => toast.error(getBusinessSaveErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (b: Business) => {
      const { error } = await supabase.from("businesses").update({ active: !b.active }).eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["businesses", activeOrgId] });
      if (activeOrgId) {
        qc.invalidateQueries({ queryKey: ["client-business-options", activeOrgId] });
      }
    },
    onError: (e: Error) => toast.error(`변경 실패: ${e.message}`),
  });

  function openNew() {
    setForm({ ...EMPTY });
    setOpen(true);
  }

  function openEdit(b: Business) {
    const category = b.category ?? "";
    const isKnown = (CATEGORY_OPTIONS as readonly string[]).includes(category);
    setForm({
      id: b.id,
      name: b.name,
      existingAliases: normalizeAliasList(b.aliases ?? []),
      categorySelect: category ? (isKnown ? category : LEGACY_CATEGORY) : "",
      categoryCustom: category && !isKnown ? category : "",
      website_url: b.website_url ?? "",
      naver_place_url: b.naver_place_url ?? "",
      google_maps_url: b.google_maps_url ?? "",
      address: b.address ?? "",
      country_code: b.country_code ?? "KR",
      region: b.region ?? "",
      city: b.city ?? "",
      active: b.active,
    });
    setOpen(true);
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
    if (latest.categorySelect === LEGACY_CATEGORY && !latest.categoryCustom.trim()) {
      toast.error("업종을 입력해 주세요.");
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
          <h1 className="text-2xl font-semibold tracking-tight">내 업체</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI에서 확인할 내 업체 정보를 등록하고 관리합니다.</p>
        </div>
        {canWrite && <Button onClick={openNew}>내 업체 추가</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">등록된 업체 {clientBusinesses.length}곳</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>업체명</TableHead>
                <TableHead>업종</TableHead>
                <TableHead>지역</TableHead>
                <TableHead>상태</TableHead>
                {canWrite && <TableHead className="text-right">작업</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientBusinesses.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="text-sm">{b.category}</TableCell>
                  <TableCell className="text-sm">
                    {[b.region, b.city].filter(Boolean).join(" ") || "-"}
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
              {!isLoading && clientBusinesses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canWrite ? 5 : 4} className="py-8 text-center text-sm text-muted-foreground">
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
              업체 기본 정보와 공개 정보를 등록하면 질문 추천과 AI 측정을 시작할 수 있습니다.
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
                    {form.categorySelect === LEGACY_CATEGORY && (
                      <SelectItem value={LEGACY_CATEGORY}>{LEGACY_CATEGORY}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {form.categorySelect === LEGACY_CATEGORY && (
                  <Input
                    aria-label="기존 업종"
                    name="categoryCustom"
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
