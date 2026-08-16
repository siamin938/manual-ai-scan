import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

const EMPTY = {
  id: "",
  name: "",
  aliases: "",
  category: "",
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

function BusinessesPage() {
  const { activeOrgId, canWrite } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

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

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        org_id: activeOrgId!,
        name: form.name.trim(),
        aliases: form.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        category: form.category.trim() || "기타",
        website_url: form.website_url.trim() || null,
        naver_place_url: form.naver_place_url.trim() || null,
        google_maps_url: form.google_maps_url.trim() || null,
        address: form.address.trim() || null,
        country_code: form.country_code.trim() || "KR",
        region: form.region.trim() || null,
        city: form.city.trim() || null,
        is_client_business: form.is_client_business,
        active: form.active,
      };
      let businessId = form.id;
      if (form.id) {
        const { error } = await supabase.from("businesses").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("businesses").insert(payload).select("id").single();
        if (error) throw error;
        businessId = data!.id;
      }

      // 경쟁업체로 등록하면 대상 업체와의 관계를 business_competitors에 저장
      const targetId = form.is_client_business ? "" : form.competitor_of || autoTargetId;
      if (!form.is_client_business && targetId) {
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
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
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
    setOpen(true);
  }

  function openEdit(b: Business) {
    setForm({
      id: b.id,
      name: b.name,
      aliases: (b.aliases ?? []).join(", "),
      category: b.category ?? "",
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
    setOpen(true);
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
                <TableHead>별칭</TableHead>
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
            <DialogDescription>공식 업체명과 별칭을 정확히 입력하면 언급 판별이 쉬워집니다.</DialogDescription>
          </DialogHeader>
          <form
            id="biz-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-name">공식 업체명</Label>
              <Input id="b-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-alias">별칭 (쉼표로 구분)</Label>
              <Input
                id="b-alias"
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="예: 강남모터스, 강남 모터스 정비소"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-cat">업종</Label>
              <Input id="b-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-web">홈페이지</Label>
              <Input id="b-web" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-naver">네이버 플레이스</Label>
              <Input
                id="b-naver"
                value={form.naver_place_url}
                onChange={(e) => setForm({ ...form, naver_place_url: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-gmap">구글 지도</Label>
              <Input
                id="b-gmap"
                value={form.google_maps_url}
                onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="b-addr">주소</Label>
              <Input id="b-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-country">국가 코드</Label>
              <Input
                id="b-country"
                value={form.country_code}
                onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-region">지역(시/도)</Label>
              <Input id="b-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-city">도시(시/군/구)</Label>
              <Input id="b-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
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
              <div className="space-y-2 sm:col-span-2">
                <Label>어느 대상 업체의 경쟁업체인가요?</Label>
                <Select
                  value={form.competitor_of || autoTargetId}
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
                  선택한 대상 업체와의 관계가 business_competitors에 저장되어 보고서 분석에 반영됩니다.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <p className="text-sm font-medium">활성 상태</p>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="biz-form" disabled={save.isPending}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
