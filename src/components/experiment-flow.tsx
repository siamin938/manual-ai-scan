/**
 * Experiment CTA + 확인 Dialog 공용 흐름.
 * /insights의 Experiment UX를 Profile Coverage 등 다른 source에서도 재사용한다.
 * 비용이 발생할 수 있는 지점은 Baseline/Follow-up 확인 Dialog의 최종 버튼뿐이다.
 */
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatSeoul } from "@/lib/format";
import {
  finalizeExperimentBaseline,
  finalizeExperimentEvaluation,
  finalizeExperimentFollowup,
  previewExperimentBaseline,
  previewExperimentEvaluation,
  previewExperimentFollowup,
  recordExperimentActionApplied,
  startExperimentBaseline,
  startExperimentFollowup,
  type ActionAppliedErrorCode,
  type BaselineErrorCode,
  type BaselinePlanSummary,
  type EvaluationErrorCode,
  type ExperimentEvaluationDTO,
  type FollowupErrorCode,
  type FollowupPlanSummary,
} from "@/lib/experiments.functions";
import type { ActiveExperimentDTO } from "@/lib/insights.functions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

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
  BASELINE_FINALIZE_MISMATCH:
    "Baseline 데이터가 확정 조건과 일치하지 않습니다. 담당자 확인이 필요합니다.",
};

function baselineErrorText(code: BaselineErrorCode): string {
  return BASELINE_ERROR_MESSAGES[code] ?? "Baseline 처리 중 오류가 발생했습니다.";
}

const ACTION_APPLY_ERROR_MESSAGES: Partial<Record<ActionAppliedErrorCode, string>> = {
  FORBIDDEN: "변경 적용을 기록할 권한이 없습니다.",
  ACTION_APPLY_INVALID_STATE: "현재 실험 상태에서는 기록할 수 없습니다.",
  ACTION_APPLY_BASELINE_NOT_FINALIZED: "Baseline 확정이 완료된 뒤에 기록할 수 있습니다.",
  ACTION_APPLY_ALREADY_RECORDED: "이미 변경 적용이 기록되었습니다.",
  ACTION_APPLY_INVALID_INPUT: "입력한 내용을 다시 확인해주세요.",
  ACTION_APPLY_TIME_INVALID: "적용 시각이 올바르지 않습니다.",
};

function actionApplyErrorText(code: ActionAppliedErrorCode): string {
  return ACTION_APPLY_ERROR_MESSAGES[code] ?? "변경 적용 기록 중 오류가 발생했습니다.";
}

const FOLLOWUP_ERROR_MESSAGES: Partial<Record<FollowupErrorCode, string>> = {
  FORBIDDEN: "Follow-up 측정을 진행할 권한이 없습니다.",
  INVALID_EXPERIMENT_STATE: "현재 실험 상태에서는 Follow-up을 진행할 수 없습니다.",
  ACTION_NOT_APPLIED: "실제 적용한 변경을 먼저 기록해야 Follow-up을 시작할 수 있습니다.",
  BASELINE_NOT_FINALIZED: "Baseline 확정이 완료된 뒤에 Follow-up을 진행할 수 있습니다.",
  FOLLOWUP_ALREADY_EXISTS: "이미 Follow-up 측정이 존재합니다.",
  FOLLOWUP_RUN_CREATE_FAILED: "Follow-up 측정 준비 중 오류가 발생했습니다.",
  FOLLOWUP_RUN_NOT_COMPLETED: "Follow-up 측정이 아직 완료되지 않았습니다.",
};

function followupErrorText(code: FollowupErrorCode): string {
  return FOLLOWUP_ERROR_MESSAGES[code] ?? "Follow-up 처리 중 오류가 발생했습니다.";
}

const EVALUATION_ERROR_MESSAGES: Partial<Record<EvaluationErrorCode, string>> = {
  FORBIDDEN: "결과를 비교할 권한이 없습니다.",
  EVALUATION_BASELINE_NOT_FINALIZED: "Baseline 확정이 완료된 뒤에 비교할 수 있습니다.",
  EVALUATION_FOLLOWUP_NOT_FINALIZED: "Follow-up 확정이 완료된 뒤에 비교할 수 있습니다.",
};

function evaluationErrorText(code: EvaluationErrorCode): string {
  return EVALUATION_ERROR_MESSAGES[code] ?? "결과 비교 중 오류가 발생했습니다.";
}

const OUTCOME_LABELS: Record<string, string> = {
  directional_improvement: "개선 방향성 관찰",
  directional_decline: "악화 방향성 관찰",
  no_clear_change: "뚜렷한 변화 없음",
};


function pctText(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

function ppText(pp: number | null): string {
  if (pp === null) return "-";
  return `${pp > 0 ? "+" : ""}${pp.toFixed(1)}%p`;
}

/** datetime-local 기본값: 현재 시각(KST) */
function nowSeoulLocalInput(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** datetime-local(KST 기준 입력) → ISO(UTC) */
function seoulLocalInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export type ExperimentCtaState =
  | { kind: "create" }
  | { kind: "start"; label: string }
  | { kind: "finalize"; label: string }
  | { kind: "apply"; label: string }
  | { kind: "followup-start"; label: string }
  | { kind: "followup-finalize"; label: string }
  | { kind: "evaluate"; label: string }
  | { kind: "evaluate-view"; label: string }
  | { kind: "disabled"; label: string };

/** ActiveExperimentDTO → 상태별 CTA (insights와 동일 규칙) */
export function experimentCta(exp: ActiveExperimentDTO | null): ExperimentCtaState {
  if (!exp) return { kind: "create" };

  if (exp.status === "action_applied") {
    return { kind: "followup-start", label: "Follow-up 측정 시작" };
  }
  if (exp.status === "followup") {
    switch (exp.followup_run_status) {
      case "draft":
        return { kind: "followup-start", label: "Follow-up 다시 시작" };
      case "queued":
        return { kind: "disabled", label: "Follow-up 대기 중" };
      case "running":
        return { kind: "disabled", label: "Follow-up 측정 중" };
      case "completed":
        if (!exp.followup_finalized) return { kind: "followup-finalize", label: "Follow-up 확정하기" };
        return exp.evaluation_recorded
          ? { kind: "evaluate-view", label: "결과 보기" }
          : { kind: "evaluate", label: "결과 비교하기" };
      default:
        return { kind: "disabled", label: "Follow-up 확인 필요" };
    }
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

type ApplyTarget = { experimentId: string; title: string; recommendedAction: string };

export type ExperimentFlow = {
  /** 상태별 CTA 버튼 렌더 */
  renderCta: (args: {
    experiment: ActiveExperimentDTO | null;
    title: string;
    recommendedAction: string;
    onCreate: () => void;
    createLabel?: string;
  }) => ReactNode;
  /** 페이지 하단에 한 번 렌더할 확인 Dialog 묶음 */
  dialogs: ReactNode;
};

/**
 * Experiment 단계 실행 훅.
 * @param orgId 활성 조직
 * @param onChanged 서버 상태 변경 후 목록 재조회 콜백
 */
export function useExperimentFlow(orgId: string | null, onChanged: () => void): ExperimentFlow {
  const previewBaselineFn = useServerFn(previewExperimentBaseline);
  const runBaselineFn = useServerFn(startExperimentBaseline);
  const confirmBaselineFn = useServerFn(finalizeExperimentBaseline);
  const recordActionAppliedFn = useServerFn(recordExperimentActionApplied);
  const previewFollowupFn = useServerFn(previewExperimentFollowup);
  const runFollowupFn = useServerFn(startExperimentFollowup);
  const confirmFollowupFn = useServerFn(finalizeExperimentFollowup);
  const previewEvaluationFn = useServerFn(previewExperimentEvaluation);
  const confirmEvaluationFn = useServerFn(finalizeExperimentEvaluation);

  const [baselineTarget, setBaselineTarget] = useState<
    { experimentId: string; summary: BaselinePlanSummary } | null
  >(null);
  const [applyTarget, setApplyTarget] = useState<ApplyTarget | null>(null);
  const [applySummary, setApplySummary] = useState("");
  const [applyNote, setApplyNote] = useState("");
  const [applyAt, setApplyAt] = useState(nowSeoulLocalInput());
  const [followupTarget, setFollowupTarget] = useState<
    { experimentId: string; summary: FollowupPlanSummary } | null
  >(null);
  const [evaluationTarget, setEvaluationTarget] = useState<{
    title: string;
    evaluation: ExperimentEvaluationDTO;
  } | null>(null);

  // 1단계: READ ONLY preview (비용 발생 없음)
  const preview = useMutation({
    mutationFn: (experimentId: string) =>
      previewBaselineFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result, experimentId) => {
      if (result.ok) setBaselineTarget({ experimentId, summary: result.summary });
      else toast.error(baselineErrorText(result.error));
    },
    onError: () => toast.error("Baseline 정보를 불러오지 못했습니다."),
  });

  // 2단계: 확인 Dialog 최종 버튼에서만 실제 측정 실행
  const start = useMutation({
    mutationFn: (experimentId: string) =>
      runBaselineFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) {
        setBaselineTarget(null);
        toast.success("Baseline 측정이 시작되었습니다.");
      } else {
        toast.error(baselineErrorText(result.error));
      }
      onChanged();
    },
    onError: () => {
      toast.error("Baseline 측정 시작 중 오류가 발생했습니다.");
      onChanged();
    },
  });

  const finalize = useMutation({
    mutationFn: (experimentId: string) =>
      confirmBaselineFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Baseline이 확정되었습니다.");
      else toast.error(baselineErrorText(result.error));
      onChanged();
    },
    onError: () => {
      toast.error("Baseline 확정 중 오류가 발생했습니다.");
      onChanged();
    },
  });

  const applyRecord = useMutation({
    mutationFn: (vars: { experimentId: string; appliedAt: string }) =>
      recordActionAppliedFn({
        data: {
          orgId: orgId as string,
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
      onChanged();
    },
    onError: () => {
      toast.error("변경 적용 기록 중 오류가 발생했습니다.");
      onChanged();
    },
  });

  const previewFollowup = useMutation({
    mutationFn: (experimentId: string) =>
      previewFollowupFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result, experimentId) => {
      if (result.ok) setFollowupTarget({ experimentId, summary: result.summary });
      else toast.error(followupErrorText(result.error));
    },
    onError: () => toast.error("Follow-up 정보를 불러오지 못했습니다."),
  });

  const startFollowup = useMutation({
    mutationFn: (experimentId: string) =>
      runFollowupFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) {
        setFollowupTarget(null);
        toast.success("Follow-up 측정이 시작되었습니다.");
      } else {
        toast.error(followupErrorText(result.error));
      }
      onChanged();
    },
    onError: () => {
      toast.error("Follow-up 측정 시작 중 오류가 발생했습니다.");
      onChanged();
    },
  });

  const finalizeFollowup = useMutation({
    mutationFn: (experimentId: string) =>
      confirmFollowupFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Follow-up이 확정되었습니다.");
      else toast.error(followupErrorText(result.error));
      onChanged();
    },
    onError: () => {
      toast.error("Follow-up 확정 중 오류가 발생했습니다.");
      onChanged();
    },
  });

  const previewEvaluation = useMutation({
    mutationFn: (vars: { experimentId: string; title: string }) =>
      previewEvaluationFn({ data: { orgId: orgId as string, experimentId: vars.experimentId } }),
    onSuccess: (result, vars) => {
      if (result.ok) setEvaluationTarget({ title: vars.title, evaluation: result.evaluation });
      else toast.error(evaluationErrorText(result.error));
    },
    onError: () => toast.error("결과를 불러오지 못했습니다."),
  });

  const finalizeEvaluation = useMutation({
    mutationFn: (experimentId: string) =>
      confirmEvaluationFn({ data: { orgId: orgId as string, experimentId } }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("실험 결과가 확정되었습니다.");
        setEvaluationTarget((prev) =>
          prev ? { title: prev.title, evaluation: result.evaluation } : prev,
        );
      } else {
        toast.error(evaluationErrorText(result.error));
      }
      onChanged();
    },
    onError: () => {
      toast.error("결과 확정 중 오류가 발생했습니다.");
      onChanged();
    },
  });

  const busy =
    preview.isPending ||
    start.isPending ||
    finalize.isPending ||
    previewFollowup.isPending ||
    startFollowup.isPending ||
    finalizeFollowup.isPending ||
    previewEvaluation.isPending;

  const renderCta: ExperimentFlow["renderCta"] = ({
    experiment,
    title,
    recommendedAction,
    onCreate,
    createLabel,
  }) => {
    const cta = experimentCta(experiment);
    if (cta.kind === "create") {
      return (
        <Button className="w-full" onClick={onCreate}>
          {createLabel ?? "실험으로 검증하기"}
        </Button>
      );
    }
    const expId = experiment?.id as string;
    switch (cta.kind) {
      case "start":
        return (
          <Button className="w-full" onClick={() => preview.mutate(expId)} disabled={busy}>
            {preview.isPending ? "불러오는 중..." : cta.label}
          </Button>
        );
      case "finalize":
        return (
          <Button className="w-full" onClick={() => finalize.mutate(expId)} disabled={busy}>
            {finalize.isPending ? "확정 중..." : cta.label}
          </Button>
        );
      case "apply":
        return (
          <Button
            className="w-full"
            onClick={() => setApplyTarget({ experimentId: expId, title, recommendedAction })}
            disabled={busy}
          >
            {cta.label}
          </Button>
        );
      case "followup-start":
        return (
          <Button className="w-full" onClick={() => previewFollowup.mutate(expId)} disabled={busy}>
            {previewFollowup.isPending ? "불러오는 중..." : cta.label}
          </Button>
        );
      case "followup-finalize":
        return (
          <Button className="w-full" onClick={() => finalizeFollowup.mutate(expId)} disabled={busy}>
            {finalizeFollowup.isPending ? "확정 중..." : cta.label}
          </Button>
        );
      case "evaluate":
      case "evaluate-view":
        return (
          <Button
            className="w-full"
            variant={cta.kind === "evaluate-view" ? "secondary" : "default"}
            onClick={() => previewEvaluation.mutate({ experimentId: expId, title })}
            disabled={busy}
          >
            {previewEvaluation.isPending ? "불러오는 중..." : cta.label}
          </Button>
        );
      default:
        return (
          <Button variant="secondary" className="w-full" disabled>
            {cta.label}
          </Button>
        );
    }
  };

  const dialogs = (
    <>
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
                    비용이 발생할 수 있습니다.
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

      {/* 실제 적용한 변경 기록 — 추가 측정/비용 없음 */}
      <Dialog
        open={!!applyTarget}
        onOpenChange={(o) => {
          if (!o && !applyRecord.isPending) setApplyTarget(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {applyTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">실제 적용한 변경을 기록할까요?</DialogTitle>
                <DialogDescription>{applyTarget.title}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">보완 대상 (참고용)</p>
                  <p className="text-sm leading-relaxed break-words">
                    {applyTarget.recommendedAction}
                  </p>
                </div>
                <Alert>
                  <AlertDescription className="leading-relaxed">
                    추천 내용을 그대로 복사하지 말고, 실제로 적용을 완료한 변경만 기록하세요. 이 기록
                    이후의 Follow-up 측정과 비교에 사용됩니다.
                  </AlertDescription>
                </Alert>
                <div className="space-y-1.5">
                  <Label htmlFor="flow-apply-summary">실제로 적용한 변경 내용 (필수)</Label>
                  <Textarea
                    id="flow-apply-summary"
                    rows={5}
                    maxLength={2000}
                    value={applySummary}
                    onChange={(e) => setApplySummary(e.target.value)}
                    placeholder="예) 홈페이지 서비스 페이지에 지역·차종·정비 항목을 명시하고 후기 3건을 추가했습니다."
                  />
                  <p className="text-xs text-muted-foreground">10자 이상 2000자 이하</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="flow-apply-note">확인 메모 / 근거 (선택)</Label>
                  <Textarea
                    id="flow-apply-note"
                    rows={3}
                    maxLength={2000}
                    value={applyNote}
                    onChange={(e) => setApplyNote(e.target.value)}
                    placeholder="예) 변경 페이지 URL, 확인한 담당자, 배포 시각 등"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="flow-apply-at">실제 적용 시각 (KST)</Label>
                  <Input
                    id="flow-apply-at"
                    type="datetime-local"
                    value={applyAt}
                    onChange={(e) => setApplyAt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Baseline 측정 종료 이후이면서 미래가 아닌 시각이어야 합니다.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setApplyTarget(null)}
                  disabled={applyRecord.isPending}
                >
                  취소
                </Button>
                <Button
                  onClick={() => {
                    const iso = seoulLocalInputToIso(applyAt);
                    if (!iso) {
                      toast.error("적용 시각이 올바르지 않습니다.");
                      return;
                    }
                    if (applySummary.trim().length < 10) {
                      toast.error("실제로 적용한 변경 내용을 10자 이상 입력해주세요.");
                      return;
                    }
                    if (!applyRecord.isPending) {
                      applyRecord.mutate({ experimentId: applyTarget.experimentId, appliedAt: iso });
                    }
                  }}
                  disabled={applyRecord.isPending}
                >
                  {applyRecord.isPending ? "기록 중..." : "변경 적용 기록"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Follow-up 실행 확인 — 여기서만 실제 재측정 비용이 발생할 수 있다 */}
      <Dialog
        open={!!followupTarget}
        onOpenChange={(o) => {
          if (!o && !startFollowup.isPending) setFollowupTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {followupTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">Follow-up 측정을 시작할까요?</DialogTitle>
                <DialogDescription>Baseline과 동일한 조건으로 재측정합니다.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <MetaSmall label="질문 수" value={`${followupTarget.summary.questionCount}개`} />
                  <MetaSmall label="반복 횟수" value={`${followupTarget.summary.repetitions}회`} />
                  <MetaSmall label="총 측정" value={`${followupTarget.summary.plannedJobs}회`} />
                  <MetaSmall label="Provider" value="OpenAI" />
                  <MetaSmall label="모델" value={followupTarget.summary.model} />
                  <MetaSmall
                    label="예상 비용"
                    value={`$${followupTarget.summary.estimatedCostUsd.toFixed(2)}`}
                  />
                  <MetaSmall
                    label="최대 비용 한도"
                    value={`$${followupTarget.summary.maxCostUsd.toFixed(2)}`}
                  />
                </dl>
                <Alert>
                  <AlertDescription className="leading-relaxed">
                    질문·모델·업체 정보가 Baseline 시점과 동일한 것을 확인했습니다. 아래
                    &apos;Follow-up 측정 시작&apos;을 누르면 실제 OpenAI 측정 작업이 등록되며 API
                    비용이 발생할 수 있습니다.
                  </AlertDescription>
                </Alert>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setFollowupTarget(null)}
                  disabled={startFollowup.isPending}
                >
                  취소
                </Button>
                <Button
                  onClick={() => startFollowup.mutate(followupTarget.experimentId)}
                  disabled={startFollowup.isPending}
                >
                  {startFollowup.isPending ? "시작 중..." : "Follow-up 측정 시작"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 실험 결과 비교 — 추가 측정/비용 없음, 방향성만 표시 */}
      <Dialog
        open={!!evaluationTarget}
        onOpenChange={(o) => {
          if (!o && !finalizeEvaluation.isPending) setEvaluationTarget(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {evaluationTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">실험 결과 비교</DialogTitle>
                <DialogDescription>{evaluationTarget.title}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {OUTCOME_LABELS[evaluationTarget.evaluation.outcome] ?? "판단 보류"}
                  </Badge>
                  <Badge variant="outline">증거 등급: 방향성</Badge>
                  {evaluationTarget.evaluation.recorded && (
                    <Badge variant="outline">
                      확정됨 · {formatSeoul(evaluationTarget.evaluation.evaluatedAt)}
                    </Badge>
                  )}
                </div>

                <Alert>
                  <AlertTitle>해석 주의</AlertTitle>
                  <AlertDescription>{evaluationTarget.evaluation.caution}</AlertDescription>
                </Alert>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">지표</th>
                        <th className="px-3 py-2 font-medium">변경 전</th>
                        <th className="px-3 py-2 font-medium">변경 후</th>
                        <th className="px-3 py-2 font-medium">변화</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="px-3 py-2">AI 답변 포함률</td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.baseline.inclusionRate)}
                        </td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.followup.inclusionRate)}
                        </td>
                        <td className="px-3 py-2">
                          {ppText(evaluationTarget.evaluation.delta.inclusionPp)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="px-3 py-2">상위 3순위 노출률</td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.baseline.top3Rate)}
                        </td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.followup.top3Rate)}
                        </td>
                        <td className="px-3 py-2">
                          {ppText(evaluationTarget.evaluation.delta.top3Pp)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="px-3 py-2">경쟁사 대체 노출률</td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.baseline.substitutionRate)}
                        </td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.followup.substitutionRate)}
                        </td>
                        <td className="px-3 py-2">
                          {ppText(evaluationTarget.evaluation.delta.substitutionPp)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="px-3 py-2">자사 도메인 인용률</td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.baseline.domainCitedRate)}
                        </td>
                        <td className="px-3 py-2">
                          {pctText(evaluationTarget.evaluation.followup.domainCitedRate)}
                        </td>
                        <td className="px-3 py-2">
                          {ppText(evaluationTarget.evaluation.delta.domainCitationPp)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p>변경 적용 시각</p>
                    <p className="text-foreground">
                      {formatSeoul(evaluationTarget.evaluation.actionAppliedAt)}
                    </p>
                  </div>
                  <div>
                    <p>측정 조건</p>
                    <p className="text-foreground">
                      {evaluationTarget.evaluation.quality.providerModel} / parser{" "}
                      {evaluationTarget.evaluation.quality.parserVersion}
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setEvaluationTarget(null)}
                  disabled={finalizeEvaluation.isPending}
                >
                  닫기
                </Button>
                {!evaluationTarget.evaluation.recorded && (
                  <Button
                    onClick={() =>
                      finalizeEvaluation.mutate(evaluationTarget.evaluation.experimentId)
                    }
                    disabled={finalizeEvaluation.isPending}
                  >
                    {finalizeEvaluation.isPending ? "확정 중..." : "결과 확정하기"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  return { renderCta, dialogs };
}

function MetaSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
