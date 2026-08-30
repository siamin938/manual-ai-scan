import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getBusinessSaveErrorMessage,
  normalizeBusinessName,
} from "@/lib/business-registration.helpers";

const AUTO_CATEGORY_OPTIONS = [
  "자동차 튜닝",
  "자동차 정비",
  "자동차 디테일링/세차",
  "썬팅/신차패키지",
  "자동차 용품/전장",
  "타이어/휠",
  "렌터카/자동차 서비스",
] as const;

const SETUP_ERROR_MESSAGE = "업체 등록 중 오류가 발생했습니다. 다시 시도해 주세요.";

function generateInternalSlug(): string {
  return `biz-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function OrgOnboarding() {
  const { refetch } = useOrg();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  const normalizedName = normalizeBusinessName(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizedName || !category) return;
    setBusy(true);

    let orgId = createdOrgId;

    if (!orgId) {
      const { data, error } = await supabase.rpc("create_organization_with_owner", {
        p_name: normalizedName,
        p_slug: generateInternalSlug(),
      });
      if (error || !data) {
        setBusy(false);
        toast.error(SETUP_ERROR_MESSAGE);
        return;
      }
      orgId = data as unknown as string;
      setCreatedOrgId(orgId);
    }

    const { error: insertError } = await supabase.from("businesses").insert({
      org_id: orgId,
      name: normalizedName,
      aliases: [],
      category,
      address: address.trim() || null,
      country_code: "KR",
      region: null,
      city: null,
      website_url: null,
      naver_place_url: null,
      google_maps_url: null,
      is_client_business: true,
      active: true,
    });

    setBusy(false);

    if (insertError) {
      toast.error(getBusinessSaveErrorMessage(insertError));
      return;
    }

    toast.success("내 업체가 등록되었습니다.");
    refetch();
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle>분석할 내 업체를 등록해주세요</CardTitle>
          <CardDescription>
            업체 기본 정보를 등록하면 검색 질문을 만들고 AI 노출 측정을 시작할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="biz-name">업체명</Label>
              <Input
                id="biz-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 현대엑스티어 판교점"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-category">업종</Label>
              <Select
                {...(category ? { value: category } : {})}
                onValueChange={setCategory}
              >
                <SelectTrigger id="biz-category">
                  <SelectValue placeholder="업종을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {AUTO_CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                엔진오일·윤활유 전문점은 「자동차 정비」를 선택해 주세요.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-address">주소 (권장)</Label>
              <Input
                id="biz-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="예: 경기도 성남시 분당구 …"
              />
              <p className="text-xs text-muted-foreground">
                주소를 입력하면 지역 기반 검색 질문을 더 정확하게 만들 수 있습니다.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={busy || !normalizedName || !category}
            >
              내 업체 등록하고 시작하기
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
