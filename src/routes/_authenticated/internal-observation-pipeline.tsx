import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatSeoul } from "@/lib/format";
import {
  enqueueInternalObservationCandidate,
  getInternalObservationPipelineOverview,
  prepareInternalObservationCandidate,
  preparePendingInternalObservationBatch,
  type InternalObservationPipelineItemDTO,
  type InternalObservationPipelineStatus,
} from "@/lib/internal-observation-pipeline.functions";

export const Route = createFileRoute("/_authenticated/internal-observation-pipeline")({
  component: InternalObservationPipelinePage,
  head: () => ({
    meta: [
      { title: "내부 데이터 수집 | 차보임" },
      {
        name: "description",
        content: "차보임 내부 관찰용 업체 후보를 등록하고 통합 24문항까지 안전하게 준비합니다.",
      },
    ],
  }),
});

const STATUS_LABELS: Record<InternalObservationPipelineStatus, string> = {
  pending: "준비 대기",
  preparing: "준비 중",
  ready_to_measure: "측정 준비 완료",
  blocked: "확인 필요",
  failed: "준비 실패",
  measuring: "측정 중",
  completed: "완료",
  cancelled: "취소",
};

function statusVariant(
  status: InternalObservationPipelineStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ready_to_measure" || status === "completed") return "default";
  if (status === "preparing" || status === "measuring") return "secondary";
  if (status === "blocked" || status === "failed") return "destructive";
  return "outline";
}

function readinessText(item: InternalObservationPipelineItemDTO): string {
  if (!item.readiness) return "-";
  if (!item.readiness.providerReady) return "Provider 확인 필요";
  if (item.readiness.creditBalance < 1) return "측정권 필요";
  return `측정권 ${item.readiness.creditBalance}회 · 자동 실행 ${item.readiness.executionEnabled ? "ON" : "OFF"}`;
}

function errorLabel(code: string | null): string {
  switch (code) {
    case "NO_MEASUREMENT_CREDIT":
      return "측정권 없음";
    case "PROVIDER_NOT_READY":
      return "Provider 준비 필요";
    case "EXISTING_BUSINESS_INACTIVE":
      return "기존 업체 비활성";
    case "EXISTING_UNIFIED_SET_INVALID":
      return "기존 통합 질문 확인 필요";
    case "INVALID_QUESTION_CONTRACT":
      return "24문항 계약 확인 필요";
    default:
      return code ?? "-";
  }
}

function InternalObservationPipelinePage() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getInternalObservationPipelineOverview);
  const enqueueCandidate = useServerFn(enqueueInternalObservationCandidate);
  const prepareCandidate = useServerFn(prepareInternalObservationCandidate);
  const prepareBatch = useServerFn(preparePendingInternalObservationBatch);

  const [orgId, setOrgId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [service, setService] = useState("");
  const [brandModel, setBrandModel] = useState("");
  const [customerNeed, setCustomerNeed] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [naverPlaceUrl, setNaverPlaceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");

  const overviewQuery = useQuery({
    queryKey: ["internal-observation-pipeline-overview"],
    queryFn: () => fetchOverview({ data: undefined }),
    retry: false,
    refetchInterval: 15000,
  });

  const overview = overviewQuery.data?.ok ? overviewQuery.data.overview : null;

  useEffect(() => {
    if (orgId || !overview?.organizations.length) return;
    setOrgId(overview.organizations[0]!.orgId);
  }, [orgId, overview?.organizations]);

  const enqueueMutation = useMutation({
    mutationFn: () =>
      enqueueCandidate({
        data: {
          orgId,
          businessName,
          category,
          region,
          city: city || null,
          service,
          brandModel: brandModel || null,
          customerNeed: customerNeed || null,
          websiteUrl: websiteUrl || null,
          naverPlaceUrl: naverPlaceUrl || null,
          googleMapsUrl: null,
          address: null,
          aliases: [],
          sourceLabel: sourceLabel || "운영자 등록",
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(
          res.error === "INVALID_ORG"
            ? "내부 관찰 조직만 선택할 수 있습니다."
            : res.error === "INVALID_INPUT"
              ? "후보 입력값을 확인해 주세요."
              : "후보를 등록하지 못했습니다.",
        );
        return;
      }
      toast.success(res.idempotent ? "이미 같은 후보가 등록되어 있습니다." : "내부 수집 후보를 등록했습니다.");
      if (!res.idempotent) {
        setBusinessName("");
        setCategory("");
        setRegion("");
        setCity("");
        setService("");
        setBrandModel("");
        setCustomerNeed("");
        setWebsiteUrl("");
        setNaverPlaceUrl("");
        setSourceLabel("");
      }
      qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
    },
    onError: () => toast.error("후보를 등록하지 못했습니다."),
  });

  const prepareMutation = useMutation({
    mutationFn: (itemId: string) => prepareCandidate({ data: { itemId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("후보 준비를 완료하지 못했습니다.");
      } else if (res.status === "ready_to_measure") {
        toast.success("업체와 통합 24문항 준비가 완료되었습니다.");
      } else {
        toast.warning("업체와 질문은 준비됐지만 측정 준비 조건을 확인해야 합니다.");
      }
      qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
    },
    onError: () => toast.error("후보 준비 중 오류가 발생했습니다."),
  });

  const batchMutation = useMutation({
    mutationFn: () => prepareBatch({ data: { limit: 5 } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("대기 후보를 준비하지 못했습니다.");
        return;
      }
      toast.success(
        `대기 후보 ${res.processed}건 처리 · 준비 완료 ${res.ready} · 확인 필요 ${res.blocked} · 실패 ${res.failed}`,
      );
      qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
    },
    onError: () => toast.error("대기 후보 준비 중 오류가 발생했습니다."),
  });

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>;
  }

  if (!overview) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        이 화면을 볼 권한이 없거나 내부 파이프라인을 불러오지 못했습니다.
      </p>
    );
  }

  const selectedOrg = overview.organizations.find((org) => org.orgId === orgId) ?? null;
  const pendingCount = overview.items.filter((item) => item.status === "pending").length;
  const readyCount = overview.items.filter((item) => item.status === "ready_to_measure").length;
  const blockedCount = overview.items.filter(
    (item) => item.status === "blocked" || item.status === "failed",
  ).length;

  const canSubmit =
    !!orgId &&
    businessName.trim().length > 0 &&
    category.trim().length > 0 &&
    region.trim().length > 0 &&
    service.trim().length > 0 &&
    !enqueueMutation.isPending;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">내부 데이터 수집</h1>
          <Badge variant="secondary">내부 운영자 전용</Badge>
          <Badge variant="outline">Pipeline v0.1</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          후보를 등록하면 내부 관찰용 업체와 통합 AI 진단 24문항까지 준비합니다.
          현재 버전은 실제 AI 측정을 자동 실행하지 않습니다.
        </p>
        <p className="text-xs text-muted-foreground">
          기준 시각 {formatSeoul(overview.generatedAt)}
        </p>
      </header>

      <Card className="border-primary/25 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">자동 측정 실행은 잠겨 있습니다.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              업체 등록·24문항 준비까지만 자동화하며 Run 생성과 AI 호출은 수행하지 않습니다.
            </p>
          </div>
          <Badge variant={selectedOrg?.executionEnabled ? "destructive" : "outline"} className="w-fit">
            자동 측정 {selectedOrg?.executionEnabled ? "ON" : "OFF"}
          </Badge>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">준비 대기</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{pendingCount}건</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">측정 준비 완료</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{readyCount}건</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">확인 필요</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{blockedCount}건</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내부 수집 후보 추가</CardTitle>
          <p className="text-xs leading-5 text-muted-foreground">
            v0.1에서는 서비스와 지역을 운영자가 확인해서 넣습니다. 웹 자동 수집은 다음 단계에서 붙입니다.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>내부 관찰 조직</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger>
                <SelectValue placeholder="조직 선택" />
              </SelectTrigger>
              <SelectContent>
                {overview.organizations.map((org) => (
                  <SelectItem key={org.orgId} value={org.orgId}>
                    {org.name} · 측정권 {org.creditBalance}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-business-name">업체명</Label>
            <Input
              id="pipeline-business-name"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="예: 샘플오토 판교점"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-category">업종</Label>
            <Input
              id="pipeline-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="예: PPF/랩핑"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-service">주력 서비스</Label>
            <Input
              id="pipeline-service"
              value={service}
              onChange={(event) => setService(event.target.value)}
              placeholder="예: PPF"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-region">기준 지역</Label>
            <Input
              id="pipeline-region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="예: 경기"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-city">상세 지역</Label>
            <Input
              id="pipeline-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="예: 성남시 분당구"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-brand">브랜드·차종 (선택)</Label>
            <Input
              id="pipeline-brand"
              value={brandModel}
              onChange={(event) => setBrandModel(event.target.value)}
              placeholder="쉼표로 여러 개 입력 가능"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-need">고객 니즈 (선택)</Label>
            <Input
              id="pipeline-need"
              value={customerNeed}
              onChange={(event) => setCustomerNeed(event.target.value)}
              placeholder="예: 보증, 당일 시공"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="pipeline-website">홈페이지 (선택)</Label>
            <Input
              id="pipeline-website"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="pipeline-naver">네이버 플레이스 (선택)</Label>
            <Input
              id="pipeline-naver"
              value={naverPlaceUrl}
              onChange={(event) => setNaverPlaceUrl(event.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label htmlFor="pipeline-source">후보 출처 메모 (선택)</Label>
            <Input
              id="pipeline-source"
              value={sourceLabel}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="예: 운영자 수동 후보 / 향후 Work 조사"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" disabled={!canSubmit} onClick={() => enqueueMutation.mutate()}>
              {enqueueMutation.isPending ? "등록 중…" : "후보 등록"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">수집 파이프라인</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              준비는 업체 등록과 통합 24문항 생성까지만 수행합니다.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={pendingCount === 0 || batchMutation.isPending}
            onClick={() => batchMutation.mutate()}
          >
            {batchMutation.isPending ? "준비 중…" : "대기 후보 5건 준비"}
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overview.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              등록된 내부 수집 후보가 없습니다.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>후보 업체</TableHead>
                  <TableHead>조직</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>질문/측정 준비</TableHead>
                  <TableHead>오류·확인</TableHead>
                  <TableHead>등록 시각</TableHead>
                  <TableHead className="text-right">작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-56 align-top">
                      <p className="font-medium">{item.businessName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.category} · {item.region}
                        {item.city ? ` ${item.city}` : ""} · {item.service}
                      </p>
                      {(item.brandModel || item.customerNeed) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[item.brandModel, item.customerNeed].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="min-w-36 align-top text-sm">{item.orgName}</TableCell>
                    <TableCell className="min-w-32 align-top">
                      <Badge variant={statusVariant(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                    </TableCell>
                    <TableCell className="min-w-52 align-top">
                      <p className="text-sm">{readinessText(item)}</p>
                      {item.questionSetId && (
                        <p className="mt-1 text-xs text-muted-foreground">통합 24문항 준비됨</p>
                      )}
                      {item.readiness && !item.readiness.executionEnabled && (
                        <p className="mt-1 text-xs text-muted-foreground">자동 실행 잠금 유지</p>
                      )}
                    </TableCell>
                    <TableCell className="min-w-40 align-top">
                      <p className="text-sm">{errorLabel(item.errorCode)}</p>
                      {item.errorMessage && (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {item.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                      {formatSeoul(item.createdAt)}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {["pending", "blocked", "failed"].includes(item.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={prepareMutation.isPending}
                          onClick={() => prepareMutation.mutate(item.id)}
                        >
                          준비
                        </Button>
                      )}
                      {item.status === "ready_to_measure" && (
                        <Badge variant="outline">실행 승인 대기</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
