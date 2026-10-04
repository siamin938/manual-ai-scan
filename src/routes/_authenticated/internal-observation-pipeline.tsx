import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  AUTOMOTIVE_CATEGORY_OPTIONS,
  INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION,
  INTERNAL_OBSERVATION_SERVICE_OPTIONS,
} from "@/lib/automotive-service-options";
import { INTENT_LABELS, isAllowedIntent } from "@/lib/question-suggestions";
import {
  enqueueInternalObservationCandidate,
  getInternalObservationPipelineOverview,
  prepareInternalObservationCandidate,
  previewInternalObservationCandidate,
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

function intentLabel(intent: string): string {
  return isAllowedIntent(intent) ? INTENT_LABELS[intent] : intent;
}

function previewBusinessAction(action: "create" | "reuse" | "blocked"): string {
  if (action === "create") return "새 업체 생성";
  if (action === "reuse") return "기존 업체 재사용";
  return "업체 상태 확인 필요";
}

function previewQuestionAction(action: "create" | "reuse" | "blocked"): string {
  if (action === "create") return "새 통합 24문항 생성";
  if (action === "reuse") return "기존 통합 24문항 재사용";
  return "기존 질문 세트 확인 필요";
}

function previewBlockerLabel(code: string | null): string {
  if (code === "EXISTING_BUSINESS_INACTIVE") {
    return "동일 업체가 비활성 상태입니다. 자동으로 재활성화하지 않습니다.";
  }
  if (code === "EXISTING_UNIFIED_SET_INVALID") {
    return "기존 통합 질문 세트가 24문항 계약과 일치하지 않습니다. 자동으로 수정하지 않습니다.";
  }
  return code ? "기존 데이터 상태를 확인해 주세요." : "";
}

function InternalObservationPipelinePage() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getInternalObservationPipelineOverview);
  const enqueueCandidate = useServerFn(enqueueInternalObservationCandidate);
  const previewCandidate = useServerFn(previewInternalObservationCandidate);
  const prepareCandidate = useServerFn(prepareInternalObservationCandidate);

  const [orgId, setOrgId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [serviceSelect, setServiceSelect] = useState("");
  const [serviceCustom, setServiceCustom] = useState("");
  const [brandModel, setBrandModel] = useState("");
  const [customerNeed, setCustomerNeed] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [naverPlaceUrl, setNaverPlaceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);

  const service =
    serviceSelect === INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION
      ? serviceCustom.trim()
      : serviceSelect;

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
        setServiceSelect("");
        setServiceCustom("");
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

  const previewMutation = useMutation({
    mutationFn: (itemId: string) => previewCandidate({ data: { itemId } }),
    onError: () => toast.error("준비 미리보기를 불러오지 못했습니다."),
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
      setPreviewOpen(false);
      setPreviewItemId(null);
      previewMutation.reset();
      qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
    },
    onError: () => toast.error("후보 준비 중 오류가 발생했습니다."),
  });

  const openPreview = (itemId: string) => {
    setPreviewItemId(itemId);
    setPreviewOpen(true);
    previewMutation.reset();
    previewMutation.mutate(itemId);
  };

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

  const preview =
    previewMutation.data?.ok && previewItemId === previewMutation.data.preview.itemId
      ? previewMutation.data.preview
      : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">내부 데이터 수집</h1>
          <Badge variant="secondary">내부 운영자 전용</Badge>
          <Badge variant="outline">Pipeline v0.1.1</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          후보를 등록하고 준비 미리보기를 확인한 뒤 내부 관찰용 업체와 통합 AI 진단 24문항까지 준비합니다.
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
              미리보기 확인 후 업체 등록·24문항 준비까지만 수행하며 Run 생성과 AI 호출은 하지 않습니다.
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
            업종과 주력 서비스는 표준 목록을 사용하고, 서비스가 목록에 없을 때만 직접 입력합니다.
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
                    {org.name} · 측정권 {org.creditBalance}회
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
            <Label>업종</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="업종 선택" />
              </SelectTrigger>
              <SelectContent>
                {AUTOMOTIVE_CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>주력 서비스</Label>
            <Select
              value={serviceSelect}
              onValueChange={(value) => {
                setServiceSelect(value);
                if (value !== INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION) {
                  setServiceCustom("");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="서비스 선택" />
              </SelectTrigger>
              <SelectContent>
                {INTERNAL_OBSERVATION_SERVICE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {serviceSelect === INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION && (
              <Input
                value={serviceCustom}
                onChange={(event) => setServiceCustom(event.target.value)}
                placeholder="서비스를 직접 입력해 주세요"
              />
            )}
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
        <CardHeader>
          <CardTitle className="text-base">수집 파이프라인</CardTitle>
          <p className="text-xs text-muted-foreground">
            안전을 위해 일괄 준비는 사용하지 않습니다. 각 후보의 미리보기를 확인한 뒤 개별 준비합니다.
          </p>
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
                          disabled={previewMutation.isPending || prepareMutation.isPending}
                          onClick={() => openPreview(item.id)}
                        >
                          준비 미리보기
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

      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (prepareMutation.isPending) return;
          setPreviewOpen(open);
          if (!open) {
            setPreviewItemId(null);
            previewMutation.reset();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>준비 미리보기{preview ? ` · ${preview.businessName}` : ""}</DialogTitle>
            <DialogDescription>
              아직 업체나 질문을 생성하지 않습니다. 아래 내용을 확인한 뒤 준비를 실행하세요.
            </DialogDescription>
          </DialogHeader>

          {previewMutation.isPending ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              기존 업체·질문 세트와 생성될 24문항을 확인하는 중…
            </p>
          ) : !previewMutation.data || !previewMutation.data.ok || !preview ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              미리보기를 만들 수 없습니다. 후보 입력과 기존 데이터 상태를 확인해 주세요.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">업체 처리</p>
                  <p className="mt-2 font-semibold">{previewBusinessAction(preview.businessAction)}</p>
                  {preview.existingBusinessName && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {preview.existingBusinessName}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">질문 처리</p>
                  <p className="mt-2 font-semibold">{previewQuestionAction(preview.questionSetAction)}</p>
                  {preview.existingQuestionSetName && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {preview.existingQuestionSetName}
                      {preview.existingQuestionCount !== null
                        ? ` · ${preview.existingQuestionCount}문항`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">측정 준비</p>
                  <p className="mt-2 font-semibold">
                    {preview.readiness.providerReady ? "Provider 준비됨" : "Provider 확인 필요"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    측정권 {preview.readiness.creditBalance}회 · 자동 측정{" "}
                    {preview.readiness.executionEnabled ? "ON" : "OFF"}
                  </p>
                </div>
              </div>

              {preview.blockerCode && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-semibold">자동 준비 중단</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {previewBlockerLabel(preview.blockerCode)}
                  </p>
                </div>
              )}

              {!preview.readiness.providerReady || preview.readiness.creditBalance < 1 ? (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="text-sm font-semibold">측정 준비 조건</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    업체와 질문 준비는 가능하지만 실제 측정을 시작하려면{" "}
                    {!preview.readiness.providerReady ? "Provider 설정" : ""}
                    {!preview.readiness.providerReady && preview.readiness.creditBalance < 1 ? "과 " : ""}
                    {preview.readiness.creditBalance < 1 ? "측정권" : ""}을 먼저 확인해야 합니다.
                  </p>
                </div>
              ) : null}

              <div className="rounded-lg border">
                <div className="border-b px-4 py-3">
                  <p className="font-semibold">생성 기준 24문항</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    기존 유효 질문 세트를 재사용하는 경우에도 현재 입력 기준으로 생성될 문항을 비교용으로 보여줍니다.
                  </p>
                </div>
                <div className="max-h-[42vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead className="w-28">검색 상황</TableHead>
                        <TableHead>질문</TableHead>
                        <TableHead className="w-36">측정 지역</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.questions.map((question) => (
                        <TableRow key={question.index}>
                          <TableCell className="text-xs tabular-nums">{question.index}</TableCell>
                          <TableCell className="text-xs">
                            {intentLabel(question.intentType)}
                          </TableCell>
                          <TableCell className="text-sm">{question.promptText}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {[question.region, question.city].filter(Boolean).join(" ") || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={prepareMutation.isPending}
              onClick={() => setPreviewOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={!preview?.canPrepare || prepareMutation.isPending}
              onClick={() => {
                if (!preview?.canPrepare) return;
                prepareMutation.mutate(preview.itemId);
              }}
            >
              {prepareMutation.isPending ? "준비 중…" : "확인하고 준비"}
            </Button>
          </DialogFooter>
          <p className="text-center text-[11px] text-muted-foreground">
            이 단계에서는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
