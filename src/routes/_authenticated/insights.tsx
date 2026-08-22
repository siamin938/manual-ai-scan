import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import {
  getInsightOverview,
  type InsightActionDTO,
  type InsightFindingDTO,
} from "@/lib/insights.functions";
import {
  createExperimentFromInsightAction,
  finalizeExperimentBaseline,
  previewExperimentBaseline,
  recordExperimentActionApplied,
  startExperimentBaseline,
  type ActionAppliedErrorCode,
  type BaselineErrorCode,
  type BaselinePlanSummary,
  type CreateExperimentErrorCode,
} from "@/lib/experiments.functions";



import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";


export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "AI 인사이트 · AI Visibility Lab" },
      {
        name: "description",
        content: "AI 검색 측정 데이터를 분석해 노출 문제와 우선 테스트 행동을 보여주는 인사이트 대시보드입니다.",
      },
      { property: "og:title", content: "AI 인사이트 · AI Visibility Lab" },
      { property: "og:description", content: "Insight Engine 분석 결과 대시보드" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InsightsPage,
});

const GRADE_LABELS: Record<string, string> = {
  directional: "방향성",
  supported: "근거 있음",
  strong: "강한 근거",
  confirmed: "확인됨",
};

/** 실험 시작이 가능한 Action 조건 (서버 함수와 동일 기준, UI는 사전 안내용) */
const EXPERIMENTABLE_STATUSES = ["proposed", "accepted"];

function canStartExperiment(a: InsightActionDTO): boolean {
  return a.recommendation_mode === "test" && EXPERIMENTABLE_STATUSES.includes(a.status);
}

/** 서버 오류 코드 → 사용자 문구. 내부 구조/DB 오류는 노출하지 않는다. */
const EXPERIMENT_ERROR_MESSAGES: Record<CreateExperimentErrorCode, string> = {
  FORBIDDEN: "실험을 생성할 권한이 없습니다.",
  INSIGHT_ACTION_NOT_FOUND: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  ACTION_SCOPE_MISMATCH: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  ACTION_MODE_NOT_EXPERIMENTABLE: "현재 추천은 실험 대상이 아닙니다.",
  ACTION_STATUS_NOT_EXPERIMENTABLE: "현재 상태에서는 새 실험을 시작할 수 없습니다.",
  BUSINESS_SCOPE_MISMATCH: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  ENGINE_RUN_SCOPE_MISMATCH: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  PRIMARY_FINDING_SCOPE_MISMATCH: "실험을 준비할 수 없습니다. 데이터 상태를 확인해주세요.",
  EXPERIMENT_ALREADY_ACTIVE: "이미 진행 중인 실험이 있습니다.",
  EXPERIMENT_CREATE_FAILED: "실험 생성 중 오류가 발생했습니다.",
  INTERNAL_ERROR: "실험 생성 중 오류가 발생했습니다.",
};

/** Baseline 서버 오류 코드 → 안전한 한글 문구. raw DB/Edge error는 노출하지 않는다. */
const BASELINE_ERROR_MESSAGES: Partial<Record<BaselineErrorCode, string>> = {
  FORBIDDEN: "Baseline 측정을 시작할 권한이 없습니다.",
  EXPERIMENT_NOT_FOUND: "실험을 찾을 수 없습니다.",
  INVALID_EXPERIMENT_STATE: "현재 실험 상태에서는 Baseline을 시작할 수 없습니다.",
  PROVIDER_NOT_READY: "측정 Provider 설정이 아직 준비되지 않았습니다.",
  QUESTION_SET_CHANGED: "질문 구성이 변경되어 Baseline 조건을 확정할 수 없습니다.",
  NON_PUBLIC_QUESTION: "공개(public) 질문만 자동 측정할 수 있습니다.",
  RUN_COST_CAP_EXCEEDED: "예상 비용이 최대 비용 한도를 초과합니다.",
  BASELINE_RUN_CREATE_FAILED: "Baseline 측정 준비 중 오류가 발생했습니다.",
  BASELINE_LINK_FAILED: "Baseline 연결 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  BASELINE_ENQUEUE_FAILED:
    "Baseline 실행 준비는 저장되었지만 측정 작업 등록에 실패했습니다. 같은 Baseline으로 다시 시도할 수 있습니다.",
  BASELINE_RUN_REQUIRES_REVIEW: "Baseline 측정 상태 확인이 필요합니다.",
  BASELINE_RUN_NOT_COMPLETED: "Baseline 측정이 아직 완료되지 않았습니다.",
  BASELINE_CONDITION_DRIFT: "저장된 Baseline 조건과 현재 조건이 일치하지 않습니다.",
  BASELINE_FINALIZE_MISMATCH: "Baseline 데이터가 확정 조건과 일치하지 않습니다. 담당자 확인이 필요합니다.",
};


/** Action Applied 서버 오류 코드 → 안전한 한글 문구. raw DB error 노출 금지. */
const ACTION_APPLY_ERROR_MESSAGES: Record<ActionAppliedErrorCode, string> = {
  FORBIDDEN: "변경 적용을 기록할 권한이 없습니다.",
  ACTION_APPLY_INVALID_STATE: "현재 실험 상태에서는 변경 적용을 기록할 수 없습니다.",
  ACTION_APPLY_INVALID_INPUT: "입력한 내용을 다시 확인해주세요. (변경 내용은 10자 이상 2000자 이하)",
  ACTION_APPLY_BASELINE_NOT_FINALIZED: "Baseline 확정이 완료된 뒤에 기록할 수 있습니다.",
  ACTION_APPLY_TIME_INVALID: "적용 시각이 올바르지 않습니다. Baseline 종료 이후이면서 미래가 아닌 시각을 입력해주세요.",
  ACTION_APPLY_ALREADY_RECORDED: "이미 변경 적용이 기록되어 있습니다. 기록은 덮어쓸 수 없습니다.",
  ACTION_APPLY_FAILED: "변경 적용 기록 중 오류가 발생했습니다.",
  INTERNAL_ERROR: "변경 적용 기록 중 오류가 발생했습니다.",
};

function actionApplyErrorText(code: ActionAppliedErrorCode): string {
  return ACTION_APPLY_ERROR_MESSAGES[code] ?? "변경 적용 기록 중 오류가 발생했습니다.";
}

function baselineErrorText(code: BaselineErrorCode): string {
  return BASELINE_ERROR_MESSAGES[code] ?? "Baseline 처리 중 오류가 발생했습니다.";
}

/** datetime-local 기본값: 현재 시각(KST) */
function nowSeoulLocalInput(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 16);
}

/** datetime-local(KST 기준 입력) → ISO(UTC) */
function seoulLocalInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type BaselineCta =
  | { kind: "create" }
  | { kind: "start"; label: string }
  | { kind: "finalize"; label: string }
  | { kind: "apply"; label: string }
  | { kind: "disabled"; label: string }
  | { kind: "none" };

function baselineCta(a: InsightActionDTO): BaselineCta {
  const exp = a.active_experiment;
  if (!exp) return canStartExperiment(a) ? { kind: "create" } : { kind: "none" };

  if (exp.status === "action_applied") {
    return { kind: "disabled", label: "변경 적용 기록 완료" };
  }

  if (exp.status === "draft" && !exp.baseline_run_id) {
    return { kind: "start", label: "Baseline 시작하기" };
  }
  if (exp.status === "baseline" && exp.baseline_run_id) {
    switch (exp.baseline_run_status) {
      case "draft":
        return { kind: "start", label: "Baseline 다시 시작" };
      case "queued":
        return { kind: "disabled", label: "Baseline 대기 중" };
      case "running":
        return { kind: "disabled", label: "Baseline 측정 중" };
      case "completed":
        if (!exp.baseline_finalized) return { kind: "finalize", label: "Baseline 확정하기" };
        return exp.action_applied
          ? { kind: "disabled", label: "변경 적용 기록 완료" }
          : { kind: "apply", label: "변경 내용 기록하기" };
      default:
        return { kind: "disabled", label: "Baseline 확인 필요" };
    }
  }
  return { kind: "disabled", label: "Baseline 확인 필요" };
}



const FINDING_TYPE_LABELS: Record<string, string> = {
  visibility_gap: "노출 공백",
  competitor_substitution: "경쟁업체 대체",
  question_sensitivity: "질문 민감도",
};


const ACTION_TYPE_LABELS: Record<string, string> = {
  visibility_gap_test: "노출 공백 테스트",
  competitor_substitution_test: "경쟁업체 대체 테스트",
  question_sensitivity_test: "질문 반응 테스트",
};

function gradeLabel(g?: string | null) {
  if (!g) return "-";
  return GRADE_LABELS[g] ?? g;
}

function priorityLabel(score: number) {
  if (score >= 60) return "높은 우선순위";
  if (score >= 40) return "중간 우선순위";
  return "관찰 필요";
}

function priorityVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 60) return "default";
  if (score >= 40) return "secondary";
  return "outline";
}

function pct(n: number | null) {
  if (n === null) return null;
  return `${fmtNum(Math.round(n * 1000) / 10)}%`;
}

/** 불필요한 .0 없이 숫자 표시 (값 자체는 변경하지 않음) */
function fmtNum(n: number) {
  return Number.isInteger(n) ? `${n}` : `${n}`.replace(/\.0+$/, "");
}

const METRIC_LABELS: Record<string, string> = {
  substitution_share: "경쟁업체 대체 관찰률",
  target_visibility_rate: "대상 업체 노출률",
  rate_spread: "질문별 노출률 차이",
  visibility_rate_spread: "질문별 노출률 차이",
};

/** 내부 metric code를 노출하지 않는 한글 근거 문장 (DB 값은 그대로 사용) */
function evidenceText(f: InsightFindingDTO): string {
  const metric = f.metric_name ?? "";
  const rate = f.metric_value !== null ? pct(f.metric_value) : null;
  const hasFraction = f.numerator !== null && f.denominator !== null;

  if (metric === "substitution_share") {
    const base = hasFraction
      ? `표본 ${f.denominator}건 중 ${f.numerator}건에서 경쟁업체가 관찰됨`
      : `표본 ${f.sample_size}건`;
    return rate ? `${base} · 대체 관찰률 ${rate}` : base;
  }

  if (metric === "target_visibility_rate") {
    const base = hasFraction
      ? `${f.denominator}회 측정 중 대상 업체 노출 ${f.numerator}회`
      : `표본 ${f.sample_size}건`;
    return rate ? `${base} · 노출률 ${rate}` : base;
  }

  if (metric === "rate_spread" || metric === "visibility_rate_spread") {
    const base = `표본 ${f.sample_size}건`;
    return rate ? `${base} · 질문별 노출률 차이 ${rate.replace("%", "%p")}` : base;
  }

  const parts = [`표본 ${f.sample_size}건`];
  if (hasFraction) parts.push(`${f.numerator}/${f.denominator}건 관찰`);
  if (rate && metric && METRIC_LABELS[metric]) parts.push(`${METRIC_LABELS[metric]} ${rate}`);
  else if (rate) parts.push(rate);
  return parts.join(" · ");
}


function InsightsPage() {
  const { activeOrgId } = useOrg();
  const fetchOverview = useServerFn(getInsightOverview);
  const [openFinding, setOpenFinding] = useState<InsightFindingDTO | null>(null);
  const [openAction, setOpenAction] = useState<InsightActionDTO | null>(null);
  const [confirmAction, setConfirmAction] = useState<InsightActionDTO | null>(null);
  const [baselineTarget, setBaselineTarget] = useState<
    { experimentId: string; summary: BaselinePlanSummary } | null
  >(null);
  const [applyTarget, setApplyTarget] = useState<InsightActionDTO | null>(null);
  const [applySummary, setApplySummary] = useState("");
  const [applyNote, setApplyNote] = useState("");
  const [applyAt, setApplyAt] = useState(nowSeoulLocalInput());
  const startExperiment = useServerFn(createExperimentFromInsightAction);
  const previewBaseline = useServerFn(previewExperimentBaseline);
  const runBaseline = useServerFn(startExperimentBaseline);
  const confirmBaseline = useServerFn(finalizeExperimentBaseline);
  const recordActionApplied = useServerFn(recordExperimentActionApplied);



  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["insight-overview", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: () => fetchOverview({ data: { orgId: activeOrgId as string } }),
  });

  const createExperiment = useMutation({
    // 클라이언트는 orgId와 insightActionId만 전달한다. 그 외 값은 서버가 결정한다.
    mutationFn: (actionId: string) =>
      startExperiment({ data: { orgId: activeOrgId as string, insightActionId: actionId } }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("실험 초안이 생성되었습니다.");
      } else {
        toast.error(EXPERIMENT_ERROR_MESSAGES[result.error] ?? "실험 생성 중 오류가 발생했습니다.");
      }
      // 생성 성공/이미 존재 모두 server truth로 동기화
      void refetch();
      setConfirmAction(null);
    },
    onError: () => {
      toast.error("실험 생성 중 오류가 발생했습니다.");
      void refetch();
      setConfirmAction(null);
    },
  });

  // 1단계: READ ONLY preview (비용 발생 없음)
  const preview = useMutation({
    mutationFn: (experimentId: string) =>
      previewBaseline({ data: { orgId: activeOrgId as string, experimentId } }),
    onSuccess: (result, experimentId) => {
      if (result.ok) setBaselineTarget({ experimentId, summary: result.summary });
      else toast.error(baselineErrorText(result.error));
    },
    onError: () => toast.error("Baseline 정보를 불러오지 못했습니다."),
  });

  // 2단계: 확인 Dialog의 최종 버튼에서만 실제 실행
  const start = useMutation({
    mutationFn: (experimentId: string) =>
      runBaseline({ data: { orgId: activeOrgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) {
        setBaselineTarget(null);
        toast.success(
          result.baseline.runStatus === "running"
            ? "Baseline 측정이 진행 중입니다."
            : "Baseline 측정이 시작되었습니다.",
        );
      } else {
        toast.error(baselineErrorText(result.error));
      }
      void refetch();
    },
    onError: () => {
      toast.error("Baseline 측정 시작 중 오류가 발생했습니다.");
      void refetch();
    },
  });

  // 3단계: Baseline 확정 (추가 측정/비용 없음). 사용자의 명시적 클릭에서만 호출.
  const finalize = useMutation({
    mutationFn: (experimentId: string) =>
      confirmBaseline({ data: { orgId: activeOrgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Baseline이 확정되었습니다.");
      else toast.error(baselineErrorText(result.error));
      void refetch();
    },
    onError: () => {
      toast.error("Baseline 확정 중 오류가 발생했습니다.");
      void refetch();
    },
  });

  // 4단계: 실제 적용한 변경 기록 (측정/비용 없음). 서버가 최종 검증한다.
  const applyRecord = useMutation({
    mutationFn: (vars: { experimentId: string; appliedAt: string }) =>
      recordActionApplied({
        data: {
          orgId: activeOrgId as string,
          experimentId: vars.experimentId,
          actualChangeSummary: applySummary,
          evidenceNote: applyNote.trim() ? applyNote : null,
          appliedAt: vars.appliedAt,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("변경 적용 기록이 저장되었습니다.");
        setApplyTarget(null);
        setApplySummary("");
        setApplyNote("");
      } else {
        toast.error(actionApplyErrorText(result.error));
      }
      void refetch();
    },
    onError: () => {
      toast.error("변경 적용 기록 중 오류가 발생했습니다.");
      void refetch();
    },
  });





  const run = data?.run ?? null;
  const findings = data?.findings ?? [];
  const actions = data?.actions ?? [];
  const topPriority = Math.max(0, ...findings.map((f) => f.priority_score), ...actions.map((a) => a.priority_score));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI 인사이트</h1>
        <p className="text-sm text-muted-foreground">
          AI 검색 측정 데이터를 분석해 현재 노출 문제와 우선적으로 테스트해야 할 행동을 보여줍니다.
        </p>
      </header>

      {run?.business_name && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">분석 대상</p>
          <p className="text-lg font-semibold tracking-tight">{run.business_name}</p>
        </div>
      )}

      {isLoading || (isFetching && !data) ? (
        <LoadingState />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTitle>인사이트를 불러오지 못했습니다.</AlertTitle>
          <AlertDescription className="mt-3">
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : !run ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            아직 생성된 AI 인사이트가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <>
          {data?.evidence_grade === "directional" && (
            <Alert>
              <AlertTitle>방향성 결과 안내</AlertTitle>
              <AlertDescription>
                현재 결과는 제한된 측정 데이터를 기반으로 발견된 방향성입니다. 확정적인 결론이 아니라 추가 실험을 위한
                우선순위로 활용하세요.
              </AlertDescription>
            </Alert>
          )}

          {/* 분석 상태 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">분석 상태</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <Meta label="분석 시점" value={formatSeoul(run.completed_at)} />
              <Meta label="Insight Engine 버전" value={`v${run.engine_version}`} />
              <Meta
                label="분석 데이터"
                value={`포함 ${run.eligible_measurement_count}건 · 제외 ${run.excluded_measurement_count}건`}
                sub={`입력 측정 ${run.input_measurement_count}건`}
              />
              <Meta label="Evidence Grade" value={gradeLabel(data?.evidence_grade)} />
              <Meta
                label="Recommendation Mode"
                value={data?.recommendation_mode === "test" ? "테스트 권장" : (data?.recommendation_mode ?? "-")}
              />
            </CardContent>
          </Card>

          {/* 요약 카드 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="발견된 인사이트" value={`${findings.length}건`} />
            <StatCard label="추천 액션" value={`${actions.length}건`} />
            <StatCard
              label="가장 높은 Priority"
              value={findings.length + actions.length ? fmtNum(topPriority) : "-"}
              sub={findings.length + actions.length ? priorityLabel(topPriority) : undefined}
            />
            <StatCard label="데이터 신뢰 수준" value={gradeLabel(data?.evidence_grade)} />
          </div>

          {/* 핵심 인사이트 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">핵심 인사이트</h2>
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">표시할 인사이트가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {findings.map((f) => (
                  <button key={f.id} type="button" onClick={() => setOpenFinding(f)} className="text-left">
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardHeader className="pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{FINDING_TYPE_LABELS[f.finding_type] ?? f.finding_type}</Badge>
                          <Badge variant="secondary">{gradeLabel(f.evidence_grade)}</Badge>
                          <Badge variant={priorityVariant(f.priority_score)}>
                            {priorityLabel(f.priority_score)} · {fmtNum(f.priority_score)}
                          </Badge>
                        </div>
                        <CardTitle className="pt-2 text-base leading-snug">{f.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <p className="text-muted-foreground">{f.summary}</p>
                        {(f.question_text || f.competitor_name) && (
                          <p className="text-xs text-muted-foreground">
                            {f.question_text ? `관련 질문: ${f.question_text}` : `관련 경쟁업체: ${f.competitor_name}`}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">관찰된 근거: {evidenceText(f)}</p>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 추천 테스트 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">추천 테스트</h2>
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">표시할 추천 액션이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {actions.map((a) => (
                  <Card key={a.id} className="h-full transition-colors hover:border-primary/50">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenAction(a)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenAction(a);
                        }
                      }}
                      className="cursor-pointer text-left"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{ACTION_TYPE_LABELS[a.action_type] ?? a.action_type}</Badge>
                          <Badge variant="secondary">{gradeLabel(a.evidence_grade)}</Badge>
                          <Badge variant={priorityVariant(a.priority_score)}>
                            {priorityLabel(a.priority_score)} · {fmtNum(a.priority_score)}
                          </Badge>
                          {a.recommendation_mode === "test" && <Badge>테스트 권장</Badge>}
                        </div>
                        <CardTitle className="pt-2 text-base leading-snug">{a.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 text-sm">
                        <Block title="무엇을 해볼까요?" body={a.recommended_action} />
                        <Block title="왜 이 테스트를 하나요?" body={a.rationale} />
                        <Block title="어떻게 검증하나요?" body={a.validation_plan} />
                        {a.recommendation_mode === "test" && (
                          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                            효과가 확인된 방법이 아니라 추가 측정을 통해 검증할 실험입니다.
                          </p>
                        )}
                        <Separator />
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <MetaSmall label="Evidence Grade" value={gradeLabel(a.evidence_grade)} />
                          <MetaSmall
                            label="Recommendation Mode"
                            value={a.recommendation_mode === "test" ? "테스트 권장" : a.recommendation_mode}
                          />
                          <MetaSmall
                            label="Priority"
                            value={`${fmtNum(a.priority_score)} · ${priorityLabel(a.priority_score)}`}
                          />
                          <MetaSmall label="연결된 인사이트" value={`${a.source_finding_count}건`} />
                        </dl>
                      </CardContent>
                    </div>
                    <div className="px-6 pb-6">
                      <ExperimentCta
                        action={a}
                        pending={
                          (preview.isPending && preview.variables === a.active_experiment?.id) ||
                          (finalize.isPending && finalize.variables === a.active_experiment?.id)
                        }
                        onCreate={() => setConfirmAction(a)}
                        onBaseline={() => {
                          const expId = a.active_experiment?.id;
                          if (expId && !preview.isPending) preview.mutate(expId);
                        }}
                        onFinalize={() => {
                          const expId = a.active_experiment?.id;
                          if (expId && !finalize.isPending) finalize.mutate(expId);
                        }}
                      />

                    </div>

                  </Card>
                ))}
              </div>

            )}
          </section>
        </>
      )}

      <Dialog open={!!openFinding} onOpenChange={(o) => !o && setOpenFinding(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {openFinding && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">{openFinding.title}</DialogTitle>
                <DialogDescription>
                  {FINDING_TYPE_LABELS[openFinding.finding_type] ?? openFinding.finding_type} ·{" "}
                  {gradeLabel(openFinding.evidence_grade)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>{openFinding.summary}</p>
                <Separator />
                <Meta label="우선순위" value={`${fmtNum(openFinding.priority_score)} (${priorityLabel(openFinding.priority_score)})`} />
                <Meta label="신뢰도 점수" value={fmtNum(openFinding.confidence_score)} />
                <Meta label="주장 유형" value={openFinding.claim_type} />
                <Meta label="관찰된 근거" value={evidenceText(openFinding)} />
                {openFinding.question_text && <Meta label="관련 질문" value={openFinding.question_text} />}
                {openFinding.competitor_name && <Meta label="관련 경쟁업체" value={openFinding.competitor_name} />}
                {openFinding.small_sample && (
                  <Alert>
                    <AlertDescription>표본이 적어 결과가 쉽게 흔들릴 수 있습니다.</AlertDescription>
                  </Alert>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!openAction} onOpenChange={(o) => !o && setOpenAction(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {openAction && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">{openAction.title}</DialogTitle>
                <DialogDescription>
                  {ACTION_TYPE_LABELS[openAction.action_type] ?? openAction.action_type} ·{" "}
                  {gradeLabel(openAction.evidence_grade)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <Block title="무엇을 해볼까요?" body={openAction.recommended_action} />
                <Block title="왜 이 테스트를 하나요?" body={openAction.rationale} />
                <Block title="어떻게 검증하나요?" body={openAction.validation_plan} />
                <Separator />
                <Meta label="우선순위" value={`${fmtNum(openAction.priority_score)} (${priorityLabel(openAction.priority_score)})`} />
                <Meta label="신뢰도 점수" value={fmtNum(openAction.confidence_score)} />
                <Meta
                  label="Recommendation Mode"
                  value={openAction.recommendation_mode === "test" ? "테스트 권장" : openAction.recommendation_mode}
                />
                <Meta label="연결된 인사이트" value={`${openAction.source_finding_count}건`} />
                {openAction.recommendation_mode === "test" && (
                  <Alert>
                    <AlertDescription>효과가 확인된 방법이 아니라 추가 측정을 통해 검증할 실험입니다.</AlertDescription>
                  </Alert>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmAction}
        onOpenChange={(o) => {
          if (!o && !createExperiment.isPending) setConfirmAction(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {confirmAction && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">실험 초안을 만들까요?</DialogTitle>
                <DialogDescription>
                  {ACTION_TYPE_LABELS[confirmAction.action_type] ?? confirmAction.action_type}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <Meta label="실험 제목" value={confirmAction.title} />
                <Meta label="추천 행동" value={confirmAction.recommended_action} />
                <Meta label="근거 수준" value={gradeLabel(confirmAction.evidence_grade)} />
                <Meta
                  label="우선순위"
                  value={`${fmtNum(confirmAction.priority_score)} (${priorityLabel(confirmAction.priority_score)})`}
                />
                <Alert>
                  <AlertDescription className="leading-relaxed">
                    지금은 실험 초안만 생성됩니다. 측정 비용은 아직 발생하지 않습니다. Baseline 측정은 다음
                    단계에서 별도로 시작합니다.
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmAction(null)}
                  disabled={createExperiment.isPending}
                >
                  취소
                </Button>
                <Button
                  onClick={() => createExperiment.mutate(confirmAction.id)}
                  disabled={createExperiment.isPending}
                >
                  {createExperiment.isPending ? "생성 중..." : "실험 초안 만들기"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Baseline 실행 확인 — 여기서만 실제 측정 비용이 발생할 수 있다 */}
      <Dialog
        open={!!baselineTarget}
        onOpenChange={(o) => {
          if (!o && !start.isPending) setBaselineTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {baselineTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">Baseline 측정을 시작할까요?</DialogTitle>
                <DialogDescription>OpenAI Web Search API 벤치마크</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <MetaSmall label="질문 수" value={`${baselineTarget.summary.questionCount}개`} />
                  <MetaSmall label="반복 횟수" value={`${baselineTarget.summary.repetitions}회`} />
                  <MetaSmall label="총 측정" value={`${baselineTarget.summary.plannedJobs}회`} />
                  <MetaSmall label="Provider" value="OpenAI" />
                  <MetaSmall label="모델" value={baselineTarget.summary.model} />
                  <MetaSmall
                    label="예상 비용"
                    value={`$${baselineTarget.summary.estimatedCostUsd.toFixed(2)}`}
                  />
                  <MetaSmall
                    label="최대 비용 한도"
                    value={`$${baselineTarget.summary.maxCostUsd.toFixed(2)}`}
                  />
                </dl>
                <Alert>
                  <AlertDescription className="leading-relaxed">
                    아래 &apos;Baseline 측정 시작&apos;을 누르면 실제 OpenAI 측정 작업이 등록되며 API
                    비용이 발생할 수 있습니다. 최대 비용 한도는 이 실행 기준 $
                    {baselineTarget.summary.maxCostUsd.toFixed(2)}입니다.
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setBaselineTarget(null)}
                  disabled={start.isPending}
                >
                  취소
                </Button>
                <Button
                  onClick={() => start.mutate(baselineTarget.experimentId)}
                  disabled={start.isPending}
                >
                  {start.isPending ? "시작 중..." : "Baseline 측정 시작"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExperimentCta({
  action,
  pending,
  onCreate,
  onBaseline,
  onFinalize,
}: {
  action: InsightActionDTO;
  pending: boolean;
  onCreate: () => void;
  onBaseline: () => void;
  onFinalize: () => void;
}) {
  const cta = baselineCta(action);

  if (cta.kind === "create") {
    return (
      <Button className="w-full" onClick={onCreate}>
        실험 시작하기
      </Button>
    );
  }
  if (cta.kind === "start") {
    return (
      <Button className="w-full" onClick={onBaseline} disabled={pending}>
        {pending ? "불러오는 중..." : cta.label}
      </Button>
    );
  }
  if (cta.kind === "finalize") {
    return (
      <Button className="w-full" onClick={onFinalize} disabled={pending}>
        {pending ? "확정 중..." : cta.label}
      </Button>
    );
  }

  if (cta.kind === "disabled") {
    return (
      <Button variant="secondary" className="w-full" disabled>
        {cta.label}
      </Button>
    );
  }
  return (
    <Button variant="outline" className="w-full" disabled>
      실험 대상이 아닙니다
    </Button>
  );
}


function Meta({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MetaSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <p className="text-sm leading-relaxed whitespace-pre-line break-words">{body}</p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
