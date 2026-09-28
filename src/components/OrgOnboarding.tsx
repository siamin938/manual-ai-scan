import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { useImeSafeForm } from "@/hooks/use-ime-safe-form";
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
  "자동차 정비/엔진오일",
  "자동차 디테일링/세차",
  "썬팅/신차패키지",
  "PPF/랩핑",
  "자동차 용품/전장",
  "타이어/휠",
  "렌터카/자동차 서비스",
  "기타 자동차 서비스",
] as const;

const ONBOARDING_IME_FIELDS = ["name", "address", "region", "city"] as const;

const SETUP_ERROR_MESSAGE = "업체 등록 중 오류가 발생했습니다. 다시 시도해 주세요.";

function generateInternalSlug(): string {
  return `biz-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function readCreatedOrgId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  return row["ok"] === true && typeof row["orgId"] === "string" ? row["orgId"] : null;
}

export function OrgOnboarding() {
  const { refetch } = useOrg();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [address, setAddress] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const { formRef, snapshot, compositionProps, isComposing } =
    useImeSafeForm(ONBOARDING_IME_FIELDS);

  const normalizedName = normalizeBusinessName(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const latest = snapshot();
    const latestName = normalizeBusinessName(latest.name ?? name);
    const latestAddress = (latest.address ?? address).trim();
    const latestRegion = (latest.region ?? region).trim();
    const latestCity = (latest.city ?? city).trim();

    if (!latestName || !category || !latestRegion || !latestCity) {
      toast.error("업체명, 업종, 지역(시/도), 도시(시/군/구)를 모두 입력해 주세요.");
      return;
    }

    setName(latestName);
    setAddress(latestAddress);
    setRegion(latestRegion);
    setCity(latestCity);
    setBusy(true);

    let orgId = createdOrgId;

    if (!orgId) {
      const { data, error } = await supabase.functions.invoke("create-organization-with-owner", {
        body: {
          name: latestName,
          slug: generateInternalSlug(),
        },
      });
      const created = readCreatedOrgId(data);
      if (error || !created) {
        setBusy(false);
        toast.error(SETUP_ERROR_MESSAGE);
        return;
      }
      orgId = created;
      setCreatedOrgId(orgId);
    }

    const { error: insertError } = await supabase.from("businesses").insert({
      org_id: orgId,
      name: latestName,
      aliases: [],
      category,
      address: latestAddress || null,
      country_code: "KR",
      region: latestRegion,
      city: latestCity,
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
          <form ref={formRef} className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="biz-name">업체명</Label>
              <Input
                id="biz-name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                {...compositionProps(setName)}
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
                엔진오일·윤활유 전문점은 「자동차 정비/엔진오일」을 선택해 주세요.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="biz-region">지역(시/도)</Label>
                <Input
                  id="biz-region"
                  name="region"
                  required
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  {...compositionProps(setRegion)}
                  placeholder="예: 경기도"
                />
                <p className="text-xs text-muted-foreground">
                  넓은 기준 검색에 사용됩니다. 예: 서울특별시, 경기도
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="biz-city">도시(시/군/구)</Label>
                <Input
                  id="biz-city"
                  name="city"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  {...compositionProps(setCity)}
                  placeholder="예: 성남시 분당구"
                />
                <p className="text-xs text-muted-foreground">
                  상세 검색에 사용됩니다. 예: 남양주시, 성남시 분당구
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-address">주소 (권장)</Label>
              <Input
                id="biz-address"
                name="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                {...compositionProps(setAddress)}
                placeholder="예: 경기도 성남시 분당구 …"
              />
              <p className="text-xs text-muted-foreground">
                주소는 업체 식별과 지역 정보 확인에 참고합니다.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                isComposing() ||
                !normalizedName ||
                !category ||
                !region.trim() ||
                !city.trim()
              }
            >
              내 업체 등록하고 시작하기
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
