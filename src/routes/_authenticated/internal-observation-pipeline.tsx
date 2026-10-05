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
import {
  approveInternalObservationExecution,
  previewInternalObservationExecutionPlan,
  type InternalObservationExecutionBlocker,
} from "@/lib/internal-observation-execution.functions";
import { reconcileInternalObservationPipeline } from "@/lib/internal-observation-reconciliation.functions";
import {
  getInternalObservationSchedulerDryRun,
  type InternalObservationSchedulerBlocker,
} from "@/lib/internal-observation-scheduler.functions";
import {
  confirmInternalObservationSchedulerActivation,
  getInternalObservationSchedulerOperations,
  pauseInternalObservationScheduler,
  requestInternalObservationSchedulerActivation,
  stopInternalObservationScheduler,
  type SchedulerActivationBlocker,
} from "@/lib/internal-observation-scheduler-operations.functions";
import { getPilotOpsAdminResult } from "@/lib/pilot-ops-admin-detail.functions";
import {
  getInternalObservationDiscoveryPreview,
  type InternalObservationDiscoveryDuplicateStatus,
} from "@/lib/internal-observation-discovery.functions";

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
  postprocessing: "후처리 중",
  completed: "완료",
  cancelled: "취소",
};

function statusVariant(
  status: InternalObservationPipelineStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ready_to_measure" || status === "completed") return "default";
  if (status === "preparing" || status === "measuring" || status === "postprocessing") return "secondary";
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
    case "ENTITY_FACTS_PENDING":
      return "Entity Facts v2 후처리 대기";
    case "ENTITY_FACTS_CHECK_RETRY":
      return "Entity Facts v2 재확인";
    case "ENTITY_FACTS_INVALID":
      return "Entity Facts v2 계약 확인 필요";
    case "ENTITY_FACTS_RUN_MISMATCH":
      return "대표 Run 불일치";
    case "RUN_INCOMPLETE":
      return "24/24 측정 계약 미충족";
    case "RUN_FAILED":
      return "Run 실패";
    case "RUN_CANCELLED":
      return "Run 취소";
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

function activationBlockerLabel(code: SchedulerActivationBlocker): string {
  switch (code) {
    case "STATE_ALREADY_RUNNING":
      return "이미 자동 실행 중입니다.";
    case "EXECUTOR_NOT_READY":
      return "자동 실행 준비 Gate가 아직 승인되지 않았습니다.";
    case "ACTOR_NOT_CONFIGURED":
      return "Scheduler actor 설정이 필요합니다.";
    case "CRON_NOT_AVAILABLE":
      return "정기 tick Cron이 준비되지 않았습니다.";
    case "NO_PLANNED_CANDIDATE":
      return "현재 오늘 계획에 포함되는 후보가 없습니다.";
    case "NO_DISPATCH_SLOT":
      return "현재 즉시 실행 가능한 동시 실행 슬롯이 없습니다.";
    case "OPERATOR_WRITE_ROLE_REQUIRED":
      return "현재 운영자 계정에 이 내부 조직의 실행 권한이 없습니다.";
  }
}

function schedulerBlockerLabel(code: InternalObservationSchedulerBlocker): string {
  switch (code) {
    case "CANDIDATE_DATA_INVALID":
      return "후보 연결 정보 확인 필요";
    case "BUSINESS_NOT_AVAILABLE":
      return "업체 상태 확인 필요";
    case "QUESTION_SET_NOT_AVAILABLE":
      return "통합 질문 세트 확인 필요";
    case "INVALID_QUESTION_CONTRACT":
      return "24문항 계약 확인 필요";
    case "SAME_CONDITION_RUN_ACTIVE":
      return "동일 조건 Run 진행 중";
    case "PROVIDER_NOT_READY":
      return "Provider 준비 필요";
    case "NO_MEASUREMENT_CREDIT":
      return "측정권 부족";
    case "DAILY_PIPELINE_RUN_LIMIT":
      return "오늘 내부 실행 한도 초과";
    case "DAILY_USAGE_LIMIT":
      return "오늘 요청 한도 초과";
    case "MONTHLY_USAGE_LIMIT":
      return "월 예산 한도 초과";
  }
}

function executionBlockerLabel(code: InternalObservationExecutionBlocker): string {
  switch (code) {
    case "ITEM_NOT_READY":
      return "이 후보는 현재 측정 실행 승인 상태가 아닙니다.";
    case "INTERNAL_OBSERVATION_ORG_REQUIRED":
      return "내부 관찰 조직에서만 실행할 수 있습니다.";
    case "BUSINESS_NOT_AVAILABLE":
      return "대상 업체가 비활성 또는 사용할 수 없는 상태입니다.";
    case "QUESTION_SET_NOT_AVAILABLE":
      return "현재 통합 질문 세트를 사용할 수 없습니다.";
    case "INVALID_QUESTION_CONTRACT":
      return "통합 질문 세트가 24문항 계약과 일치하지 않습니다.";
    case "PROVIDER_NOT_READY":
      return "OpenAI Provider 자동 측정 설정을 확인해 주세요.";
    case "NO_MEASUREMENT_CREDIT":
      return "측정권이 없습니다.";
    case "OPERATOR_MEMBERSHIP_REQUIRED":
      return "현재 운영자 계정에 이 내부 조직의 측정 실행 권한이 없습니다.";
    case "SAME_CONDITION_RUN_ACTIVE":
      return "같은 업체·질문 세트의 진행 중 Run이 이미 있습니다.";
    case "CONCURRENT_RUN_LIMIT":
      return "현재 동시 실행 한도에 도달했습니다.";
    case "DAILY_PIPELINE_RUN_LIMIT":
      return "오늘 내부 파이프라인 실행 한도에 도달했습니다.";
    case "DAILY_USAGE_LIMIT":
      return "조직의 오늘 요청 한도를 초과합니다.";
    case "MONTHLY_USAGE_LIMIT":
      return "조직의 월 예산 한도를 초과합니다.";
    case "PLAN_NOT_AVAILABLE":
      return "실행 계획을 계산할 수 없습니다.";
  }
}

function discoveryDuplicateLabel(
  status: InternalObservationDiscoveryDuplicateStatus,
): string {
  switch (status) {
    case "existing_business_exact":
      return "기존 업체 일치";
    case "existing_pipeline_exact":
      return "기존 후보 일치";
    case "existing_domain_overlap":
      return "공개 도메인 중복";
    case "none":
      return "신규 후보";
  }
}

function discoveryDuplicateVariant(
  status: InternalObservationDiscoveryDuplicateStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "none") return "outline";
  if (status === "existing_domain_overlap") return "secondary";
  return "destructive";
}

function usd(value: number): string {
  return `${value.toFixed(2)}`;
}

function metricCountText(
  confirmed: number,
  valid: number,
  lowerPct: number | null,
  upperPct: number | null,
): string {
  if (valid <= 0 || lowerPct === null || upperPct === null) return `${confirmed}/${valid}`;
  const pctText =
    lowerPct === upperPct
      ? `${Math.round(lowerPct * 100) / 100}%`
      : `${Math.round(lowerPct * 100) / 100}~${Math.round(upperPct * 100) / 100}%`;
  return `${confirmed}/${valid} · ${pctText}`;
}

function InternalObservationPipelinePage() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getInternalObservationPipelineOverview);
  const enqueueCandidate = useServerFn(enqueueInternalObservationCandidate);
  const previewCandidate = useServerFn(previewInternalObservationCandidate);
  const prepareCandidate = useServerFn(prepareInternalObservationCandidate);
  const previewExecutionPlan = useServerFn(previewInternalObservationExecutionPlan);
  const approveExecution = useServerFn(approveInternalObservationExecution);
  const reconcilePipeline = useServerFn(reconcileInternalObservationPipeline);
  const fetchSchedulerDryRun = useServerFn(getInternalObservationSchedulerDryRun);
  const fetchSchedulerOperations = useServerFn(getInternalObservationSchedulerOperations);
  const requestSchedulerActivation = useServerFn(requestInternalObservationSchedulerActivation);
  const confirmSchedulerActivation = useServerFn(confirmInternalObservationSchedulerActivation);
  const pauseScheduler = useServerFn(pauseInternalObservationScheduler);
  const stopScheduler = useServerFn(stopInternalObservationScheduler);
  const fetchAdminResult = useServerFn(getPilotOpsAdminResult);
  const fetchDiscoveryPreview = useServerFn(getInternalObservationDiscoveryPreview);

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
  const [executionOpen, setExecutionOpen] = useState(false);
  const [executionItemId, setExecutionItemId] = useState<string | null>(null);
  const [resultTarget, setResultTarget] = useState<InternalObservationPipelineItemDTO | null>(null);
  const [activationConfirmation, setActivationConfirmation] = useState("");
  const [discoveryCategory, setDiscoveryCategory] = useState("");
  const [discoveryRegion, setDiscoveryRegion] = useState("");
  const [discoveryCity, setDiscoveryCity] = useState("");
  const [discoveryServiceSelect, setDiscoveryServiceSelect] = useState("");
  const [discoveryServiceCustom, setDiscoveryServiceCustom] = useState("");
  const [discoveryBrandModel, setDiscoveryBrandModel] = useState("");
  const [discoveryDesiredCount, setDiscoveryDesiredCount] = useState("5");

  const service =
    serviceSelect === INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION
      ? serviceCustom.trim()
      : serviceSelect;

  const discoveryService =
    discoveryServiceSelect === INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION
      ? discoveryServiceCustom.trim()
      : discoveryServiceSelect;

  const overviewQuery = useQuery({
    queryKey: ["internal-observation-pipeline-overview"],
    queryFn: () => fetchOverview({ data: undefined }),
    retry: false,
    refetchInterval: 15000,
  });

  const overview = overviewQuery.data?.ok ? overviewQuery.data.overview : null;

  const schedulerQuery = useQuery({
    queryKey: ["internal-observation-scheduler-dry-run", orgId],
    enabled: !!orgId,
    retry: false,
    refetchInterval: 15000,
    queryFn: () => fetchSchedulerDryRun({ data: { orgId } }),
  });

  const schedulerOpsQuery = useQuery({
    queryKey: ["internal-observation-scheduler-operations", orgId],
    enabled: !!orgId,
    retry: false,
    refetchInterval: 15000,
    queryFn: () => fetchSchedulerOperations({ data: { orgId } }),
  });

  const resultQuery = useQuery({
    queryKey: [
      "internal-observation-pipeline-result",
      resultTarget?.orgId,
      resultTarget?.businessId,
    ],
    enabled: !!resultTarget?.orgId && !!resultTarget?.businessId,
    retry: false,
    queryFn: () =>
      fetchAdminResult({
        data: {
          orgId: resultTarget!.orgId,
          businessId: resultTarget!.businessId!,
        },
      }),
  });

  useEffect(() => {
    if (orgId || !overview?.organizations.length) return;
    setOrgId(overview.organizations[0]!.orgId);
  }, [orgId, overview?.organizations]);

  const discoveryMutation = useMutation({
    mutationFn: () =>
      fetchDiscoveryPreview({
        data: {
          orgId,
          category: discoveryCategory,
          service: discoveryService,
          region: discoveryRegion,
          city: discoveryCity || null,
          brandModel: discoveryBrandModel || null,
          desiredCount: Number(discoveryDesiredCount),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(
          res.error === "INVALID_INPUT"
            ? "탐색 조건을 확인해 주세요."
            : res.error === "FORBIDDEN"
              ? "내부 Discovery Preview 권한이 없습니다."
              : res.error === "NOT_AVAILABLE"
                ? "Discovery 응답 형식을 확인하지 못했습니다. 다시 시도해 주세요."
                : "Discovery 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      toast.success(
        `공개 후보 ${res.preview.candidates.length}곳을 읽기 전용으로 확인했습니다.`,
      );
    },
    onError: () => toast.error("Discovery Preview 중 오류가 발생했습니다."),
  });

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

  const executionPlanMutation = useMutation({
    mutationFn: (itemId: string) => previewExecutionPlan({ data: { itemId } }),
    onError: () => toast.error("측정 실행 계획을 불러오지 못했습니다."),
  });

  const requestActivationMutation = useMutation({
    mutationFn: () => requestSchedulerActivation({ data: { orgId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(
          res.error === "PLAN_BLOCKED"
            ? "현재 조건에서는 자동 실행 활성화를 요청할 수 없습니다."
            : "활성화 요청을 만들지 못했습니다.",
        );
        schedulerOpsQuery.refetch();
        return;
      }
      setActivationConfirmation("");
      toast.success("활성화 요청을 만들었습니다. 10분 안에 최종 확인해 주세요.");
      schedulerOpsQuery.refetch();
    },
    onError: () => toast.error("활성화 요청 중 오류가 발생했습니다."),
  });

  const confirmActivationMutation = useMutation({
    mutationFn: (requestId: string) =>
      confirmSchedulerActivation({
        data: {
          orgId,
          requestId,
          confirmation: activationConfirmation,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(
          res.error === "PLAN_CHANGED"
            ? "실행 조건이 바뀌었습니다. 활성화 계획을 다시 확인해 주세요."
            : res.error === "INVALID_CONFIRMATION"
              ? "확인 문구가 일치하지 않습니다."
              : "자동 실행을 활성화하지 못했습니다.",
        );
        schedulerOpsQuery.refetch();
        schedulerQuery.refetch();
        return;
      }
      setActivationConfirmation("");
      toast.success("Guarded Scheduler가 활성화되었습니다.");
      schedulerOpsQuery.refetch();
      schedulerQuery.refetch();
      overviewQuery.refetch();
    },
    onError: () => toast.error("자동 실행 활성화 중 오류가 발생했습니다."),
  });

  const pauseSchedulerMutation = useMutation({
    mutationFn: () => pauseScheduler({ data: { orgId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("자동 실행을 일시정지하지 못했습니다.");
        return;
      }
      toast.success("자동 실행을 일시정지했습니다. 진행 중인 Run은 취소하지 않습니다.");
      schedulerOpsQuery.refetch();
      schedulerQuery.refetch();
    },
    onError: () => toast.error("일시정지 중 오류가 발생했습니다."),
  });

  const stopSchedulerMutation = useMutation({
    mutationFn: () => stopScheduler({ data: { orgId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("자동 실행을 중지하지 못했습니다.");
        return;
      }
      setActivationConfirmation("");
      toast.success("자동 실행을 중지했습니다. 진행 중인 Run은 취소하지 않습니다.");
      schedulerOpsQuery.refetch();
      schedulerQuery.refetch();
    },
    onError: () => toast.error("자동 실행 중지 중 오류가 발생했습니다."),
  });

  const reconcileMutation = useMutation({
    mutationFn: () => reconcilePipeline({ data: {} }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("파이프라인 상태를 동기화하지 못했습니다.");
        return;
      }
      if (res.completed > 0) {
        toast.success(`완료 ${res.completed}건을 결과 준비 완료로 반영했습니다.`);
      } else if (res.postprocessing > 0) {
        toast.message(`후처리 대기 ${res.postprocessing}건을 확인했습니다.`);
      } else {
        toast.message("현재 파이프라인 상태를 확인했습니다.");
      }
      qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
    },
    onError: () => toast.error("파이프라인 상태 동기화 중 오류가 발생했습니다."),
  });

  const approveExecutionMutation = useMutation({
    mutationFn: (args: { itemId: string; planHash: string }) =>
      approveExecution({ data: args }),
    onSuccess: (res) => {
      if (!res.ok) {
        if (res.error === "PLAN_CHANGED" && res.plan) {
          toast.warning("측정권·예산·실행 상태가 바뀌었습니다. 새 실행 계획을 다시 확인해 주세요.");
          executionPlanMutation.reset();
          executionPlanMutation.mutate(res.plan.itemId);
          return;
        }
        if (res.error === "PLAN_BLOCKED") {
          toast.error("현재 조건에서는 측정을 시작할 수 없습니다.");
          return;
        }
        toast.error(
          res.error === "RUN_START_FAILED"
            ? "실행 승인 직후 조건이 바뀌어 측정을 시작하지 못했습니다."
            : "측정을 시작하지 못했습니다.",
        );
        qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
        return;
      }

      toast.success(`측정을 시작했습니다. ${res.plannedJobs}개 Job이 준비됩니다.`);
      setExecutionOpen(false);
      setExecutionItemId(null);
      executionPlanMutation.reset();
      qc.invalidateQueries({ queryKey: ["internal-observation-pipeline-overview"] });
    },
    onError: () => toast.error("측정 실행 승인 중 오류가 발생했습니다."),
  });

  const openPreview = (itemId: string) => {
    setPreviewItemId(itemId);
    setPreviewOpen(true);
    previewMutation.reset();
    previewMutation.mutate(itemId);
  };

  const openExecutionPlan = (itemId: string) => {
    setExecutionItemId(itemId);
    setExecutionOpen(true);
    executionPlanMutation.reset();
    executionPlanMutation.mutate(itemId);
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

  const executionPlan =
    executionPlanMutation.data?.ok &&
    executionItemId === executionPlanMutation.data.plan.itemId
      ? executionPlanMutation.data.plan
      : null;

  const schedulerPlan = schedulerQuery.data?.ok ? schedulerQuery.data.plan : null;
  const schedulerOps = schedulerOpsQuery.data?.ok ? schedulerOpsQuery.data.data : null;
  const discoveryPreview = discoveryMutation.data?.ok
    ? discoveryMutation.data.preview
    : null;
  const discoveryCount = Number(discoveryDesiredCount);
  const canDiscover =
    !!orgId &&
    discoveryCategory.trim().length > 0 &&
    discoveryRegion.trim().length > 0 &&
    discoveryService.trim().length > 0 &&
    Number.isInteger(discoveryCount) &&
    discoveryCount >= 1 &&
    discoveryCount <= 8 &&
    !discoveryMutation.isPending;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">내부 데이터 수집</h1>
          <Badge variant="secondary">내부 운영자 전용</Badge>
          <Badge variant="outline">Pipeline v0.8 Validated</Badge>
          <Badge variant="outline">Discovery v0.9.1 Preview</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          v0.8 자동 순차 실행을 검증했고, v0.9.1에서는 공개 웹 후보를 저장 없이 미리 확인합니다.
          Discovery Preview는 기존 측정·Scheduler 경로와 분리된 읽기 전용 단계입니다.
        </p>
        <p className="text-xs text-muted-foreground">
          기준 시각 {formatSeoul(overview.generatedAt)}
        </p>
      </header>

      <Card className="border-primary/25 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">
              Guarded Scheduler · {schedulerOps?.plan.schedulerState === "running" ? "RUNNING" : schedulerOps?.plan.schedulerState === "paused" ? "PAUSED" : "OFF"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              실행기 배포는 {schedulerOps?.plan.executorDeployed ? "완료" : "대기"}, 실제 자동 실행 준비 Gate는{" "}
              {schedulerOps?.plan.executorReady ? "통과" : "차단"} 상태입니다.
              활성화되더라도 1곳 실행 → 완료·실패 정리 → 다음 1곳 순서만 허용합니다.
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

      {schedulerPlan && (
        <Card className="border-dashed">
          <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">자동 스케줄 Dry-run</CardTitle>
                <Badge variant="outline">실행 없음</Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                오래 준비된 후보부터 순서대로 계산합니다. 이 계획을 보는 것만으로는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={schedulerQuery.isFetching}
              onClick={() => schedulerQuery.refetch()}
            >
              {schedulerQuery.isFetching ? "계산 중…" : "Dry-run 다시 계산"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">오늘 실행 슬롯</p>
                <p className="mt-2 text-lg font-semibold tabular-nums">
                  {schedulerPlan.pipelineRunsToday}/{schedulerPlan.dailyRunLimit}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  남음 {schedulerPlan.dailySlotsRemaining}곳
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">동시 실행</p>
                <p className="mt-2 text-lg font-semibold tabular-nums">
                  {schedulerPlan.activeRunCount}/{schedulerPlan.concurrentRunLimit}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  지금 시작 가능 {schedulerPlan.dispatchSlotsNow}곳
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">측정권</p>
                <p className="mt-2 text-lg font-semibold tabular-nums">
                  {schedulerPlan.creditBalance}회
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  계획 후 {schedulerPlan.plannedCreditBalanceAfter}회
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">오늘 계획</p>
                <p className="mt-2 text-lg font-semibold tabular-nums">
                  {schedulerPlan.plannedCandidateCount}곳
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  지금 dispatch {schedulerPlan.dispatchNowCount}곳
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">계획 비용</p>
                <p className="mt-2 text-lg font-semibold">
                  {usd(schedulerPlan.estimatedCostUsdTotal)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  최대 예약 {usd(schedulerPlan.maxCostUsdTotal)}
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/10 p-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                <p>
                  정책 · <span className="font-medium">오래 준비된 후보 우선</span>
                </p>
                <p>
                  자동 실행 ·{" "}
                  <span className="font-medium">
                    {schedulerPlan.automaticExecutionEnabled ? "ON" : "OFF"}
                  </span>
                </p>
                <p>
                  Scheduler actor ·{" "}
                  <span className="font-medium">
                    {schedulerPlan.schedulerActorConfigured ? "설정됨" : "미설정"}
                  </span>
                </p>
                <p>
                  요청량 ·{" "}
                  <span className="font-medium tabular-nums">
                    {schedulerPlan.dailyRequestsUsed} →{" "}
                    {schedulerPlan.projectedDailyRequestsAfter}/
                    {schedulerPlan.dailyRequestLimit}
                  </span>
                </p>
                <p>
                  월 최대 ·{" "}
                  <span className="font-medium tabular-nums">
                    {usd(schedulerPlan.projectedMonthlyCostUsdAfter)} /{" "}
                    {usd(schedulerPlan.monthlyBudgetUsd)}
                  </span>
                </p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                최근 자동 tick ·{" "}
                {schedulerPlan.lastSchedulerTickAt
                  ? `${formatSeoul(schedulerPlan.lastSchedulerTickAt)} · ${schedulerPlan.lastSchedulerResult ?? "-"}`
                  : "아직 실행 없음"}
              </p>
            </div>

            {schedulerPlan.candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                현재 측정 준비 완료 상태의 후보가 없어 오늘 Dry-run 실행 계획은 비어 있습니다.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">순서</TableHead>
                      <TableHead>후보 업체</TableHead>
                      <TableHead>계획</TableHead>
                      <TableHead>비용</TableHead>
                      <TableHead>계획 후 상태</TableHead>
                      <TableHead>제외 사유</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedulerPlan.candidates.map((candidate) => (
                      <TableRow key={candidate.itemId}>
                        <TableCell className="align-top font-medium tabular-nums">
                          {candidate.sequence ?? "-"}
                        </TableCell>
                        <TableCell className="min-w-52 align-top">
                          <p className="font-medium">{candidate.businessName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {candidate.region}
                            {candidate.city ? ` ${candidate.city}` : ""} · {candidate.service}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-32 align-top">
                          {candidate.planned ? (
                            <div className="space-y-1">
                              <Badge variant="secondary">오늘 계획</Badge>
                              {candidate.dispatchNow && (
                                <p className="text-xs text-muted-foreground">지금 시작 가능</p>
                              )}
                            </div>
                          ) : (
                            <Badge variant="outline">계획 제외</Badge>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          <p>{candidate.plannedJobs} jobs</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {usd(candidate.estimatedCostUsd)} · 최대 {usd(candidate.maxCostUsd)}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-40 align-top text-xs text-muted-foreground">
                          {candidate.planned ? (
                            <>
                              <p>측정권 {candidate.creditBalanceAfter}회</p>
                              <p className="mt-1">
                                요청 {candidate.projectedDailyRequestsAfter}/
                                {schedulerPlan.dailyRequestLimit}
                              </p>
                            </>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="min-w-48 align-top">
                          {candidate.blockers.length === 0 ? (
                            <span className="text-sm text-muted-foreground">-</span>
                          ) : (
                            <div className="space-y-1">
                              {candidate.blockers.map((blocker) => (
                                <p key={blocker} className="text-xs text-muted-foreground">
                                  · {schedulerBlockerLabel(blocker)}
                                </p>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-[11px] leading-5 text-muted-foreground">
              v0.5 Guarded Scheduler는 동일한 Dry-run 순서를 사용하며, master switch OFF 상태에서는 어떤 후보도 claim하거나 측정하지 않습니다.
              ON 이후에도 한 번에 1건만 원자적으로 claim하고 이전 Run이 완료·실패로 정리된 뒤에만 다음 후보를 시작합니다.
            </p>
          </CardContent>
        </Card>
      )}

      {schedulerOps && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">자동 실행 제어</CardTitle>
                  <Badge
                    variant={
                      schedulerOps.plan.schedulerState === "running"
                        ? "default"
                        : schedulerOps.plan.schedulerState === "paused"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {schedulerOps.plan.schedulerState === "running"
                      ? "RUNNING"
                      : schedulerOps.plan.schedulerState === "paused"
                        ? "PAUSED"
                        : "OFF"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  활성화는 계획 고정 → 요청 생성 → 확인 문구 입력의 2단계를 모두 통과해야 합니다.
                  일시정지·중지는 진행 중 Run을 강제로 취소하지 않고 다음 후보 시작만 막습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {schedulerOps.plan.schedulerState === "running" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pauseSchedulerMutation.isPending}
                      onClick={() => pauseSchedulerMutation.mutate()}
                    >
                      일시정지
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={stopSchedulerMutation.isPending}
                      onClick={() => stopSchedulerMutation.mutate()}
                    >
                      자동 실행 중지
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={
                      !schedulerOps.plan.canRequestActivation ||
                      requestActivationMutation.isPending ||
                      !!schedulerOps.pendingRequest
                    }
                    onClick={() => requestActivationMutation.mutate()}
                  >
                    활성화 요청 만들기
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">실행기</p>
                <p className="mt-2 font-semibold">
                  {!schedulerOps.plan.executorDeployed
                    ? "배포 대기"
                    : schedulerOps.plan.executorReady
                      ? "배포·QA 완료"
                      : "배포 완료 · QA 대기"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Cron</p>
                <p className="mt-2 font-semibold">
                  {schedulerOps.plan.cronJobExists
                    ? schedulerOps.plan.cronActive
                      ? "활성"
                      : "비활성"
                    : "없음"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {schedulerOps.plan.cronSchedule ?? "-"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Scheduler actor</p>
                <p className="mt-2 font-semibold">
                  {schedulerOps.plan.schedulerActorConfigured ? "설정됨" : "미설정"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">활성화 계획</p>
                <p className="mt-2 font-semibold">
                  오늘 {schedulerOps.plan.dryRun.plannedCandidateCount}곳 · 즉시{" "}
                  {schedulerOps.plan.dryRun.dispatchNowCount}곳
                </p>
              </div>
            </div>

            {schedulerOps.plan.blockers.length > 0 && schedulerOps.plan.schedulerState !== "running" && (
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-sm font-semibold">현재 활성화 차단 조건</p>
                <div className="mt-2 space-y-1">
                  {schedulerOps.plan.blockers.map((blocker) => (
                    <p key={blocker} className="text-sm text-muted-foreground">
                      · {activationBlockerLabel(blocker)}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {schedulerOps.pendingRequest && (
              <div className="rounded-lg border border-primary/25 bg-primary/[0.03] p-4">
                <p className="text-sm font-semibold">활성화 요청 생성됨</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  만료 {formatSeoul(schedulerOps.pendingRequest.expiresAt)} · 계획이 바뀌면 최종 활성화가 자동 거부됩니다.
                </p>
                {schedulerOps.pendingRequest.requestedByCurrentUser ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={activationConfirmation}
                      onChange={(event) => setActivationConfirmation(event.target.value)}
                      placeholder={schedulerOps.plan.confirmText}
                      disabled={confirmActivationMutation.isPending}
                    />
                    <Button
                      className="shrink-0"
                      disabled={
                        activationConfirmation.trim() !== schedulerOps.plan.confirmText ||
                        confirmActivationMutation.isPending
                      }
                      onClick={() =>
                        confirmActivationMutation.mutate(
                          schedulerOps.pendingRequest!.requestId,
                        )
                      }
                    >
                      {confirmActivationMutation.isPending
                        ? "최종 확인 중…"
                        : "최종 활성화"}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    다른 운영자가 만든 요청입니다. 요청 생성자가 최종 확인해야 합니다.
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] leading-5 text-muted-foreground">
              실행기 배포 여부와 별개로 executor_ready가 false인 동안 자동 실행 활성화는 차단됩니다.
              Cron job도 최종 활성화 전까지 비활성 상태를 유지합니다.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">공개 업체 Discovery Preview</CardTitle>
            <Badge variant="outline">v0.9.1</Badge>
            <Badge variant="secondary">읽기 전용</Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            지역·서비스 조건으로 공개 웹에서 실제 업체 후보와 근거 URL을 찾습니다.
            이 단계에서는 업체·후보·질문·Run·Job을 저장하지 않고 측정권도 차감하지 않습니다.
            OpenAI 웹 검색 호출만 발생합니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label>내부 관찰 조직</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="조직 선택" />
                </SelectTrigger>
                <SelectContent>
                  {overview.organizations.map((org) => (
                    <SelectItem key={org.orgId} value={org.orgId}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>업종</Label>
              <Select value={discoveryCategory} onValueChange={setDiscoveryCategory}>
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
                value={discoveryServiceSelect}
                onValueChange={(value) => {
                  setDiscoveryServiceSelect(value);
                  if (value !== INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION) {
                    setDiscoveryServiceCustom("");
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
              {discoveryServiceSelect === INTERNAL_OBSERVATION_CUSTOM_SERVICE_OPTION && (
                <Input
                  value={discoveryServiceCustom}
                  onChange={(event) => setDiscoveryServiceCustom(event.target.value)}
                  placeholder="서비스 직접 입력"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="discovery-region">기준 지역</Label>
              <Input
                id="discovery-region"
                value={discoveryRegion}
                onChange={(event) => setDiscoveryRegion(event.target.value)}
                placeholder="예: 경기"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="discovery-city">상세 지역 (선택)</Label>
              <Input
                id="discovery-city"
                value={discoveryCity}
                onChange={(event) => setDiscoveryCity(event.target.value)}
                placeholder="예: 안산"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="discovery-brand">브랜드·차종 포커스 (선택)</Label>
              <Input
                id="discovery-brand"
                value={discoveryBrandModel}
                onChange={(event) => setDiscoveryBrandModel(event.target.value)}
                placeholder="예: 테슬라 모델Y / 수입차"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="discovery-count">후보 수</Label>
              <Input
                id="discovery-count"
                type="number"
                min={1}
                max={8}
                value={discoveryDesiredCount}
                onChange={(event) => setDiscoveryDesiredCount(event.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={!canDiscover}
                onClick={() => discoveryMutation.mutate()}
              >
                {discoveryMutation.isPending ? "공개 웹 탐색 중…" : "공개 후보 찾기"}
              </Button>
            </div>
          </div>

          {discoveryPreview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">저장 0건</Badge>
                <span>후보 {discoveryPreview.candidates.length}곳</span>
                <span>· 공개 검색 근거 {discoveryPreview.publicSourceCount}개</span>
                <span>· 측정권 차감 없음</span>
              </div>

              {discoveryPreview.candidates.length === 0 ? (
                <p className="rounded-lg border p-5 text-sm text-muted-foreground">
                  검증 가능한 공개 근거가 있는 후보를 찾지 못했습니다. 지역이나 서비스를 조금 넓혀 다시 확인해 주세요.
                </p>
              ) : (
                <div className="space-y-3">
                  {discoveryPreview.candidates.map((candidate) => (
                    <div
                      key={`${candidate.name}|${candidate.websiteUrl ?? ""}`}
                      className="rounded-lg border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{candidate.name}</p>
                            <Badge
                              variant={discoveryDuplicateVariant(candidate.duplicateStatus)}
                            >
                              {discoveryDuplicateLabel(candidate.duplicateStatus)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {candidate.category} · {candidate.region}
                            {candidate.city ? ` ${candidate.city}` : ""} · {candidate.service}
                          </p>
                        </div>
                        {candidate.websiteUrl && (
                          <a
                            href={candidate.websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs underline underline-offset-4"
                          >
                            공개 사이트 보기
                          </a>
                        )}
                      </div>

                      {candidate.duplicateWarnings.length > 0 && (
                        <div className="mt-3 rounded-md bg-muted/30 p-3">
                          {candidate.duplicateWarnings.map((warning) => (
                            <p key={warning} className="text-xs text-muted-foreground">
                              · {warning}
                            </p>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium">공개 근거</p>
                        {candidate.evidence.map((evidence) => (
                          <div key={evidence.url} className="text-xs leading-5">
                            <a
                              href={evidence.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-4"
                            >
                              {evidence.title || evidence.domain}
                            </a>
                            {evidence.note && (
                              <span className="ml-2 text-muted-foreground">
                                {evidence.note}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                        Preview 결과는 자동 등록하지 않습니다. 업체 identity와 지점 여부를 운영자가 확인한 뒤 기존 후보 등록 절차를 사용합니다.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">수집 파이프라인</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              화면은 15초마다 측정 종료와 Entity Facts v2 준비 여부를 자동 확인합니다. 필요하면 수동으로 다시 동기화할 수 있습니다.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={reconcileMutation.isPending}
            onClick={() => reconcileMutation.mutate()}
          >
            {reconcileMutation.isPending ? "동기화 중…" : "상태 동기화"}
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
                      {(item.status === "pending" ||
                        item.status === "blocked" ||
                        (item.status === "failed" && !item.runId)) && (
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={executionPlanMutation.isPending || approveExecutionMutation.isPending}
                          onClick={() => openExecutionPlan(item.id)}
                        >
                          실행 계획 보기
                        </Button>
                      )}
                      {item.status === "measuring" && item.runId && (
                        <Badge variant="secondary">Run 진행 중</Badge>
                      )}
                      {item.status === "postprocessing" && item.runId && (
                        <Badge variant="secondary">결과 후처리 중</Badge>
                      )}
                      {item.status === "completed" && item.businessId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResultTarget(item)}
                        >
                          결과 보기
                        </Button>
                      )}
                      {item.status === "failed" && (
                        <Badge variant="destructive">자동 재시도 없음</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resultTarget} onOpenChange={(open) => !open && setResultTarget(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              내부 수집 결과{resultTarget ? ` · ${resultTarget.businessName}` : ""}
            </DialogTitle>
            <DialogDescription>
              완료된 파이프라인 Run의 Entity Facts v2 결과를 읽기 전용으로 확인합니다.
            </DialogDescription>
          </DialogHeader>

          {resultQuery.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">결과를 불러오는 중…</p>
          ) : !resultQuery.data || !resultQuery.data.ok ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              완료 상태이지만 결과를 불러오지 못했습니다. 상태 동기화를 다시 실행해 주세요.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">확정 노출</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {metricCountText(
                      resultQuery.data.data.overview.confirmedMentionCount,
                      resultQuery.data.data.overview.validCount,
                      resultQuery.data.data.overview.visibilityLowerBoundPct,
                      resultQuery.data.data.overview.visibilityUpperBoundPct,
                    )}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">상위 3곳</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {metricCountText(
                      resultQuery.data.data.overview.confirmedTop3Count,
                      resultQuery.data.data.overview.validCount,
                      resultQuery.data.data.overview.top3LowerBoundPct,
                      resultQuery.data.data.overview.top3UpperBoundPct,
                    )}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">관찰 업체</p>
                  <p className="mt-2 text-lg font-semibold">
                    {resultQuery.data.data.competitors.length}곳
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">관련 출처</p>
                  <p className="mt-2 text-lg font-semibold">
                    {resultQuery.data.data.verifiedTargetCitationPages?.length ??
                      resultQuery.data.data.targetSources.length}
                    개
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{resultQuery.data.data.scope.runName}</p>
                  <Badge variant="outline">
                    {resultQuery.data.data.scope.completedJobs}/{resultQuery.data.data.scope.totalJobs}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatSeoul(resultQuery.data.data.scope.measuredAt)} · 실패{" "}
                  {resultQuery.data.data.scope.failedJobs}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">검색 상황</p>
                  <div className="mt-3 space-y-2">
                    {resultQuery.data.data.questionGroups.map((group) => (
                      <div key={group.intentType} className="flex items-center justify-between gap-3 text-sm">
                        <span>{intentLabel(group.intentType)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {group.confirmedMentionCount}/{group.validCount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">함께 관찰된 업체</p>
                  <div className="mt-3 space-y-2">
                    {resultQuery.data.data.competitors.slice(0, 5).map((competitor) => (
                      <div key={competitor.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{competitor.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {competitor.responseCount}회
                        </span>
                      </div>
                    ))}
                    {resultQuery.data.data.competitors.length === 0 && (
                      <p className="text-sm text-muted-foreground">확정 관찰 업체가 없습니다.</p>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                이 결과는 내부 데이터 축적용 관찰 결과입니다. 관찰 업체와 출처 연결은 인과관계를 의미하지 않습니다.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={executionOpen}
        onOpenChange={(open) => {
          if (approveExecutionMutation.isPending) return;
          setExecutionOpen(open);
          if (!open) {
            setExecutionItemId(null);
            executionPlanMutation.reset();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              측정 실행 계획{executionPlan ? ` · ${executionPlan.businessName}` : ""}
            </DialogTitle>
            <DialogDescription>
              이 화면을 보는 것만으로는 Run 생성, AI 호출, 측정권 차감이 발생하지 않습니다.
              마지막 승인 버튼을 눌렀을 때만 측정을 시작합니다.
            </DialogDescription>
          </DialogHeader>

          {executionPlanMutation.isPending ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              측정권·예산·동시 실행·중복 Run 상태를 확인하는 중…
            </p>
          ) : !executionPlanMutation.data || !executionPlanMutation.data.ok || !executionPlan ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              실행 계획을 만들 수 없습니다. 파이프라인 상태를 다시 확인해 주세요.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">실행 규모</p>
                  <p className="mt-2 text-lg font-semibold">{executionPlan.plannedJobs} jobs</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {executionPlan.provider} · 반복 {executionPlan.repetitions}회
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">예상 원가</p>
                  <p className="mt-2 text-lg font-semibold">{usd(executionPlan.estimatedCostUsd)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    내부 최대 예약 {usd(executionPlan.maxCostUsd)}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">측정권</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {executionPlan.creditBefore}회 → {executionPlan.creditAfter}회
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    실제 차감은 기존 Job 생성 트리거가 담당
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">자동 실행</p>
                  <p className="mt-2 text-lg font-semibold">
                    {executionPlan.automaticExecutionEnabled ? "ON" : "OFF"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    이번 건은 수동 승인
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">요청 한도</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">오늘 사용</span>
                      <span className="tabular-nums">
                        {executionPlan.dailyRequestsUsed}/{executionPlan.dailyRequestLimit}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">승인 후 예상</span>
                      <span className="tabular-nums">
                        {executionPlan.projectedDailyRequests}/{executionPlan.dailyRequestLimit}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">오늘 내부 실행</span>
                      <span className="tabular-nums">
                        {executionPlan.pipelineRunsToday}/{executionPlan.dailyPipelineRunLimit}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">예산·동시 실행</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">월 실제+예약</span>
                      <span className="tabular-nums">
                        {usd(executionPlan.monthlyActualCostUsd + executionPlan.monthlyReservedCostUsd)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">승인 후 최대</span>
                      <span className="tabular-nums">
                        {usd(executionPlan.projectedMonthlyCostUsd)} / {usd(executionPlan.monthlyBudgetUsd)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">진행 중 Run</span>
                      <span className="tabular-nums">
                        {executionPlan.activeRunCount}/{executionPlan.concurrentRunLimit}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold">실행 대상</p>
                <p className="mt-2 text-sm">
                  {executionPlan.businessName} · {executionPlan.questionSetName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  동일 조건 active Run ·{" "}
                  {executionPlan.sameConditionRun
                    ? `${executionPlan.sameConditionRun.status} · ${executionPlan.sameConditionRun.runId}`
                    : "없음"}
                </p>
              </div>

              {executionPlan.blockers.length > 0 ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-semibold">실행 차단 조건</p>
                  <div className="mt-2 space-y-1">
                    {executionPlan.blockers.map((blocker) => (
                      <p key={blocker} className="text-sm text-muted-foreground">
                        · {executionBlockerLabel(blocker)}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-primary/25 bg-primary/[0.03] p-4">
                  <p className="text-sm font-semibold">실행 가능</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    현재 측정권·예산·동시 실행·중복 Run 조건을 모두 통과했습니다.
                    승인 시 서버가 조건을 다시 계산하고 동일한 경우에만 측정을 시작합니다.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={approveExecutionMutation.isPending}
              onClick={() => setExecutionOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={!executionPlan?.canApprove || approveExecutionMutation.isPending}
              onClick={() => {
                if (!executionPlan?.canApprove) return;
                approveExecutionMutation.mutate({
                  itemId: executionPlan.itemId,
                  planHash: executionPlan.planHash,
                });
              }}
            >
              {approveExecutionMutation.isPending ? "승인 처리 중…" : "측정 실행 승인"}
            </Button>
          </DialogFooter>
          <p className="text-center text-[11px] text-muted-foreground">
            승인 직전에 계획 fingerprint를 재검증합니다. 조건이 바뀌면 실행하지 않고 새 계획을 요구합니다.
          </p>
        </DialogContent>
      </Dialog>

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
