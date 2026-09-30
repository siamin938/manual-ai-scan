import { useState, type ReactNode } from "react";
import {
  createFileRoute,
  Link,
  useNavigate,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, BarChart3, Building2, FileCheck2, Search } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { formatSeoul } from "@/lib/format";
import { INTENT_LABELS, normalizeQuestion } from "@/lib/question-suggestions";
import { getEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.functions";
import { buildEntityFactsV2DashboardCutoverModel } from "@/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import {
  buildEntityFactsV2DashboardSummaryViewModel,
  type DashboardSummaryMetric,
  type EntityFactsV2DashboardSummaryViewModel,
} from "@/lib/entity-facts-v2-dashboard-summary.viewmodel";
import { getEntityFactsV2Comparison } from "@/lib/entity-facts-v2-comparison.functions";
import { buildEntityFactsV2ComparisonViewModel } from "@/lib/entity-facts-v2-comparison.viewmodel";
import { buildActionOpportunityEngineV01 } from "@/lib/action-opportunity-engine-v01";
import { getActionOpportunityEvidence } from "@/lib/action-opportunity-evidence.functions";
import { getVerifiedFirstPartySourceTypes } from "@/lib/first-party-source-registry.functions";
import { getVisibilityBenchmark } from "@/lib/visibility-benchmark.functions";
import { getCustomDiagnostic } from "@/lib/custom-diagnostic.functions";
import type {
  CustomDiagnosticDTO,
  CustomDiagnosticQuestionDTO,
} from "@/lib/custom-diagnostic.helpers";
import {
  UNIFIED_DIAGNOSTIC_SET_PREFIX,
  isUnifiedDiagnosticSetName,
  naturalizeQuestionLocation,
} from "@/lib/custom-question-suggestions";
import {
  buildUnifiedDiagnosticLayerSummary,
  confirmedRatePct,
  type UnifiedDiagnosticLayerMetric,
  type UnifiedDiagnosticLayerSummary,
} from "@/lib/unified-diagnostic-layer-summary";
import { BusinessSelector, useClientBusinessSelection } from "@/components/business-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DashboardSearch = { view?: "detail" };
type DashboardSearchInput = SearchSchemaInput & { view?: string };

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: DashboardSearchInput): DashboardSearch =>
    search["view"] === "detail" ? { view: "detail" } : {},
  head: () => ({
    meta: [
      { title: "AI 노출 진단 · 차보임 CHABOIM" },
      {
        name: "description",
        content:
          "여러 고객 질문에서 업체가 AI 답변에 관찰된 노출 범위, 함께 관찰된 업체와 연결 출처를 확인하는 진단 대시보드.",
      },
      { property: "og:title", content: "AI 노출 진단 · 차보임 CHABOIM" },
      {
        property: "og:description",
        content: "확정 노출과 추가 확인이 필요한 범위를 구분해 보여주는 AI 노출 진단",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function intentLabel(intentType: string): string {
  return (INTENT_LABELS as Record<string, string>)[intentType] ?? "기타";
}

function pctRange(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) return "–";
  const format = (value: number) => `${Math.round(value * 100) / 100}%`;
  return lower === upper ? format(lower) : `${format(lower)} ~ ${format(upper)}`;
}

function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (100 * part) / total));
}

function questionUsesDetailedLocation(
  questionText: string,
  detailLocation: string | null | undefined,
): boolean {
  const detailSurface = naturalizeQuestionLocation(detailLocation ?? "");
  const detailKey = normalizeQuestion(detailSurface);
  if (detailKey.length < 2) return false;
  return normalizeQuestion(questionText).includes(detailKey);
}

function unifiedWeakQuestionPriority(
  questionText: string,
  detailLocation: string | null | undefined,
): number {
  return questionUsesDetailedLocation(questionText, detailLocation) ? 0 : 1;
}

function layerMetricText(metric: UnifiedDiagnosticLayerMetric): string {
  const rate = confirmedRatePct(metric);
  const rateText = rate === null ? "–" : pctRange(rate, rate);
  return `${metric.confirmedCount}/${metric.validCount} · ${rateText}`;
}

function unifiedLayerSummarySentence(summary: UnifiedDiagnosticLayerSummary): string {
  const customConfirmed = summary.custom.confirmedCount;
  const coreConfirmed = summary.core.confirmedCount;

  if (customConfirmed > 0 && coreConfirmed === 0) {
    return "상세 검색에서는 확인됐지만, 더 넓은 기준 검색에서는 확인되지 않았습니다.";
  }
  if (customConfirmed === 0 && coreConfirmed > 0) {
    return "더 넓은 기준 검색에서는 확인됐지만, 상세 검색에서는 확인되지 않았습니다.";
  }
  if (customConfirmed > 0 && coreConfirmed > 0) {
    return "상세 검색과 더 넓은 기준 검색 모두에서 확정 노출이 확인됐습니다.";
  }
  return "이번 측정에서는 상세 검색과 기준 검색 모두에서 확정 노출이 확인되지 않았습니다.";
}

function UnifiedDiagnosticLayerSummaryCard({
  summary,
}: {
  summary: UnifiedDiagnosticLayerSummary;
}) {
  const hasUnresolved =
    summary.overall.unresolvedCount > 0 ||
    summary.custom.unresolvedCount > 0 ||
    summary.core.unresolvedCount > 0;

  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <p className="report-kicker">SEARCH SCOPE</p>
        <CardTitle className="text-xl">검색 범위별 확정 노출</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          같은 24문항 안에서 넓은 기준 검색과 상세 검색을 나눠 보여드립니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid overflow-hidden rounded-lg border bg-border sm:grid-cols-3 sm:gap-px">
          {[
            {
              label: "전체 확정 노출",
              metric: summary.overall,
              note: "통합 24문항 전체",
            },
            {
              label: "상세 검색 확정 노출",
              metric: summary.custom,
              note: "상세 지역 · 선택 조건",
            },
            {
              label: "기준 검색 확정 노출",
              metric: summary.core,
              note: "넓은 지역 · 주력 서비스",
            },
          ].map((item) => (
            <div key={item.label} className="bg-card px-4 py-4">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {layerMetricText(item.metric)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            </div>
          ))}
        </div>
        <p className="rounded-md bg-muted/40 px-3 py-2 text-sm leading-6">
          {unifiedLayerSummarySentence(summary)}
        </p>
        <p className="text-xs text-muted-foreground">
          이번 통합 24문항 측정에서 확정된 응답 기준입니다.
        </p>
        {hasUnresolved && (
          <p className="text-xs text-muted-foreground">
            추가 확인이 필요한 응답은 위 확정 노출 수치에 포함하지 않았습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const UNIFIED_V2_RETRY_DELAYS_MS = [1500, 2500, 4000] as const;

function isTransientV2ReadError(result: {
  ok: boolean;
  error?: string;
} | null | undefined): boolean {
  return (
    !!result &&
    !result.ok &&
    (result.error === "NO_V2_DATA" || result.error === "INVALID_V2_DATA")
  );
}

function waitForDashboardRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChartTooltipPayload = {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { label?: string; connected?: boolean; validCount?: number };
};

function MeasurementTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const validCount = payload[0]?.payload?.validCount;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {typeof validCount === "number" && (
        <p className="mb-1 border-b pb-1 text-muted-foreground">총 {validCount}문항</p>
      )}
      {payload.map((item) => (
        <p key={item.name} className="flex min-w-32 justify-between gap-4">
          <span>{item.name}</span>
          <span className="font-semibold tabular-nums">{item.value}건</span>
        </p>
      ))}
    </div>
  );
}

function SearchContextChart({
  groups,
}: {
  groups: Array<QuestionGroupCounts & { intentType: string }>;
}) {
  const data = groups.map((group) => ({
    label: intentLabel(group.intentType),
    confirmed: group.confirmedMentionCount,
    unresolved: group.unresolvedTargetCount,
    validCount: group.validCount,
    missing: Math.max(
      0,
      group.validCount - group.confirmedMentionCount - group.unresolvedTargetCount,
    ),
    confirmedRatio: `${group.confirmedMentionCount}/${group.validCount}`,
  }));
  const maximum = Math.max(1, ...groups.map((group) => group.validCount));

  return (
    <div>
      <div
        className="h-[26rem] w-full sm:h-[24rem]"
        role="img"
        aria-label="검색 상황별 확정 노출, 추가 확인, 노출 미확인 건수 비교"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 48, bottom: 8, left: 8 }}
            barCategoryGap="28%"
          >
            <CartesianGrid horizontal={false} stroke="var(--color-border)" />
            <XAxis
              type="number"
              domain={[0, maximum]}
              allowDecimals={false}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={118}
              tick={{ fill: "var(--color-foreground)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<MeasurementTooltip />} cursor={{ fill: "var(--color-muted)" }} />
            <Bar
              dataKey="confirmed"
              name="확정 노출"
              stackId="context"
              fill="var(--color-chart-1)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="unresolved"
              name="추가 확인"
              stackId="context"
              fill="var(--color-chart-2)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="missing"
              name="노출 미확인"
              stackId="context"
              fill="var(--color-muted)"
              isAnimationActive={false}
            >
              <LabelList
                dataKey="confirmedRatio"
                position="right"
                className="fill-foreground text-[11px] font-semibold"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span>
          <span className="mr-1.5 inline-block size-2.5 bg-chart-1" />
          확정 노출
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2.5 bg-chart-2" />
          추가 확인
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2.5 bg-muted" />
          노출 미확인
        </span>
      </div>
      <div className="sr-only">
        {data.map((item) => (
          <p key={item.label}>
            {item.label}: 확정 노출 {item.confirmed}건, 추가 확인 {item.unresolved}건, 노출 미확인{" "}
            {item.missing}건
          </p>
        ))}
      </div>
    </div>
  );
}

const LOW_VALUE_COMPARISON_SOURCE_PATTERNS = [
  /(^|\.)saramin\.co\.kr$/u,
  /(^|\.)jobkorea\.co\.kr$/u,
  /(^|\.)albamon\.com$/u,
  /(^|\.)alba\.co\.kr$/u,
  /(^|\.)career\.co\.kr$/u,
  /(^|\.)jobplanet\.co\.kr$/u,
  /(^|\.)work24\.go\.kr$/u,
  /(^|\.)govjob\.co\.kr$/u,
  /(^|\.)easylaw\.go\.kr$/u,
  /(^|\.)news\.nate\.com$/u,
  /(^|\.)n\.news\.naver\.com$/u,
  /(^|\.)yna\.co\.kr$/u,
  /(^|\.)newsis\.com$/u,
  /(^|\.)wowtv\.co\.kr$/u,
  /(^|\.)v\.daum\.net$/u,
] as const;

function lowValueComparisonSourceDomain(value: string): boolean {
  const domain = value.trim().toLowerCase().replace(/^www\./u, "");
  return (
    !domain ||
    domain.endsWith(".go.kr") ||
    LOW_VALUE_COMPARISON_SOURCE_PATTERNS.some((pattern) => pattern.test(domain))
  );
}

function weakQuestionBadgeVariant(
  tone: "positive" | "neutral" | "attention",
): "default" | "secondary" | "outline" {
  if (tone === "positive") return "default";
  if (tone === "attention") return "secondary";
  return "outline";
}

type QuestionGroupCounts = {
  confirmedMentionCount: number;
  validCount: number;
  unresolvedTargetCount: number;
};

function DashboardPage() {
  const { view: requestedView } = Route.useSearch();
  const view = requestedView ?? "summary";
  const navigate = useNavigate({ from: "/dashboard" });
  const { activeOrgId } = useOrg();
  const businesses = useClientBusinessSelection(activeOrgId);
  const businessId = businesses.selectedBusinessId;
  const [expandedCompetitorBusinessId, setExpandedCompetitorBusinessId] = useState<string | null>(
    null,
  );
  const [expandedWeakQuestionBusinessId, setExpandedWeakQuestionBusinessId] = useState<
    string | null
  >(null);
  const [expandedCitationSourceBusinessId, setExpandedCitationSourceBusinessId] = useState<
    string | null
  >(null);
  const [expandedLinkedClueBusinessId, setExpandedLinkedClueBusinessId] = useState<
    string | null
  >(null);
  const [expandedTargetReferenceBusinessId, setExpandedTargetReferenceBusinessId] = useState<
    string | null
  >(null);
  const [
    expandedTargetExposureCitationBusinessId,
    setExpandedTargetExposureCitationBusinessId,
  ] = useState<string | null>(null);
  const [
    expandedAllTargetExposureCitationBusinessId,
    setExpandedAllTargetExposureCitationBusinessId,
  ] = useState<string | null>(null);
  const [
    expandedVerifiedTargetCitationBusinessId,
    setExpandedVerifiedTargetCitationBusinessId,
  ] = useState<string | null>(null);
  const [expandedOtherConfirmedSourceBusinessId, setExpandedOtherConfirmedSourceBusinessId] =
    useState<string | null>(null);
  const showAllCompetitors = expandedCompetitorBusinessId === businessId;
  const showAllWeakQuestions = expandedWeakQuestionBusinessId === businessId;
  const showAllCitationSources = expandedCitationSourceBusinessId === businessId;
  const showLinkedClues = expandedLinkedClueBusinessId === businessId;
  const showTargetReferenceSources = expandedTargetReferenceBusinessId === businessId;
  const showTargetExposureCitationSources =
    expandedTargetExposureCitationBusinessId === businessId;
  const showAllTargetExposureCitationSources =
    expandedAllTargetExposureCitationBusinessId === businessId;
  const showAllVerifiedTargetCitationPages =
    expandedVerifiedTargetCitationBusinessId === businessId;
  const showOtherConfirmedSources = expandedOtherConfirmedSourceBusinessId === businessId;

  const unifiedSetQuery = useQuery({
    queryKey: ["active-unified-diagnostic-set", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data: set, error: setError } = await supabase
        .from("question_sets")
        .select("id, name")
        .eq("org_id", activeOrgId as string)
        .eq("business_id", businessId as string)
        .eq("active", true)
        .like("name", `${UNIFIED_DIAGNOSTIC_SET_PREFIX}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (setError) throw setError;
      if (!set) return { set: null, completedRunId: null };

      const { data: completedRun, error: runError } = await supabase
        .from("measurement_runs")
        .select("id")
        .eq("org_id", activeOrgId as string)
        .eq("business_id", businessId as string)
        .eq("question_set_id", set.id)
        .eq("run_type", "audit")
        .eq("phase", "standalone")
        .eq("diagnostic_scope", "customer")
        .eq("status", "completed")
        .is("experiment_id", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runError) throw runError;

      return { set, completedRunId: completedRun?.id ?? null };
    },
  });
  const hasUnifiedDiagnosticSet = !!unifiedSetQuery.data?.set;
  const hasCompletedUnifiedRun = !!unifiedSetQuery.data?.completedRunId;
  const unifiedTransitionPending =
    hasUnifiedDiagnosticSet && !hasCompletedUnifiedRun;

  const fetchV2 = useServerFn(getEntityFactsV2ReadGateway);
  const query = useQuery({
    queryKey: [
      "entity-facts-v2-dashboard",
      activeOrgId,
      businessId,
      hasUnifiedDiagnosticSet,
      hasCompletedUnifiedRun,
    ],
    enabled:
      !!activeOrgId &&
      !!businessId &&
      !unifiedSetQuery.isLoading &&
      !unifiedSetQuery.isError,
    queryFn: async () => {
      const request = () =>
        fetchV2({
          data: {
            orgId: activeOrgId as string,
            businessId: businessId as string,
          },
        });

      let response = await request();
      if (!hasCompletedUnifiedRun) return response;

      for (const delayMs of UNIFIED_V2_RETRY_DELAYS_MS) {
        if (!isTransientV2ReadError(response)) break;
        await waitForDashboardRetry(delayMs);
        response = await request();
      }
      return response;
    },
  });

  const fetchComparison = useServerFn(getEntityFactsV2Comparison);
  const comparisonQuery = useQuery({
    queryKey: ["entity-facts-v2-comparison", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchComparison({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });

  const fetchBenchmark = useServerFn(getVisibilityBenchmark);
  const benchmarkQuery = useQuery({
    queryKey: ["visibility-benchmark", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchBenchmark({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });
  const benchmarkResult = benchmarkQuery.data;
  const benchmark = benchmarkResult && benchmarkResult.ok ? benchmarkResult.benchmark : null;

  const fetchVerifiedFirstPartySourceTypes = useServerFn(getVerifiedFirstPartySourceTypes);
  const firstPartyQuery = useQuery({
    queryKey: ["verified-first-party-source-types", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: () =>
      fetchVerifiedFirstPartySourceTypes({
        data: {
          orgId: activeOrgId as string,
          businessId: businessId as string,
        },
      }),
  });
  const firstPartyResult = firstPartyQuery.data;
  const verifiedFirstPartySourceTypes =
    firstPartyResult && firstPartyResult.ok ? firstPartyResult.sourceTypes : [];

  const fetchActionOpportunityEvidence = useServerFn(getActionOpportunityEvidence);
  const actionEvidenceQuery = useQuery({
    queryKey: ["action-opportunity-evidence", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId && !!benchmark,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetchActionOpportunityEvidence({
          data: {
            orgId: activeOrgId as string,
            businessId: businessId as string,
            highVisibilityThresholdPct: benchmark?.thresholdPct ?? 20,
          },
        });
        return response && response.ok
          ? {
              highVisibilityExamples: response.highVisibilityExamples,
              currentRunReferences: response.currentRunReferences,
            }
          : { highVisibilityExamples: [], currentRunReferences: [] };
      } catch {
        return { highVisibilityExamples: [], currentRunReferences: [] };
      }
    },
  });
  const actionEvidenceExamples = actionEvidenceQuery.data?.highVisibilityExamples ?? [];
  const currentRunReferences = actionEvidenceQuery.data?.currentRunReferences ?? [];

  const fetchCustom = useServerFn(getCustomDiagnostic);
  const customQuery = useQuery({
    queryKey: ["custom-diagnostic", activeOrgId, businessId],
    enabled:
      !!activeOrgId &&
      !!businessId &&
      !unifiedSetQuery.isLoading &&
      !hasCompletedUnifiedRun,
    retry: false,
    queryFn: () =>
      fetchCustom({
        data: { orgId: activeOrgId as string, businessId: businessId as string },
      }),
  });

  const result = query.data;
  const dto = result && result.ok ? result.data : null;
  const model = dto ? buildEntityFactsV2DashboardCutoverModel(dto) : null;
  const isUnifiedDiagnostic =
    hasCompletedUnifiedRun ||
    (!!dto?.scope.questionSetName && isUnifiedDiagnosticSetName(dto.scope.questionSetName));
  const showLegacyDiagnosticSection =
    !isUnifiedDiagnostic && (!unifiedTransitionPending || !!dto);
  const detailBasisLabel = isUnifiedDiagnostic ? "AI 진단 기준" : "기본 진단 기준";
  const unifiedLayerSummary =
    dto && isUnifiedDiagnostic && dto.questionLocations
      ? buildUnifiedDiagnosticLayerSummary({
          questionAreas: dto.questionAreas,
          questionLocations: dto.questionLocations,
          overview: dto.overview,
        })
      : null;

  const linkedTargetSources =
    model?.sources.rows.filter(
      (source) => source.evidence !== "clue" && source.targetResponseCount > 0,
    ) ?? [];
  const linkedCompetitorConfirmedSources =
    model?.sources.rows.filter(
      (source) =>
        source.evidence !== "clue" &&
        source.targetResponseCount === 0 &&
        source.competitorResponseCount > 0,
    ) ?? [];
  const usefulCompetitorSources = linkedCompetitorConfirmedSources.filter(
    (source) => !lowValueComparisonSourceDomain(source.domain),
  );
  const otherConfirmedSources = linkedCompetitorConfirmedSources.filter((source) =>
    lowValueComparisonSourceDomain(source.domain),
  );
  const linkedClueSources =
    model?.sources.rows.filter((source) => source.evidence === "clue") ?? [];
  const targetReferenceSources = model?.targetReferenceSources.rows ?? [];
  const targetExposureCitationSources =
    model?.targetExposureCitationSources.rows ?? [];
  const verifiedTargetCitationPages =
    model?.verifiedTargetCitationPages.rows ?? [];
  const linkedTargetSourceCount = linkedTargetSources.length;
  const linkedCompetitorSourceCount = usefulCompetitorSources.length;
  const linkedClueSourceCount = linkedClueSources.length;
  const targetExposureCitationSourceCount = targetExposureCitationSources.length;
  const verifiedTargetCitationPageCount = verifiedTargetCitationPages.length;
  const weakQuestionRows =
    model && isUnifiedDiagnostic
      ? model.weakQuestions.rows
          .map((item, index) => ({ item, index }))
          .sort(
            (a, b) =>
              unifiedWeakQuestionPriority(a.item.questionText, dto?.business.city) -
                unifiedWeakQuestionPriority(b.item.questionText, dto?.business.city) ||
              a.index - b.index,
          )
          .map(({ item }) => item)
      : (model?.weakQuestions.rows ?? []);
  const actionOpportunityModel = benchmark
    ? buildActionOpportunityEngineV01({
        benchmark,
        verifiedFirstPartySourceTypes,
      })
    : null;
  const comparisonResult = comparisonQuery.data;
  const comparisonModel =
    comparisonResult && comparisonResult.ok
      ? buildEntityFactsV2ComparisonViewModel(comparisonResult.data)
      : null;
  const summaryModel = model
    ? buildEntityFactsV2DashboardSummaryViewModel({
        model,
        unifiedLayerSummary,
        actionOpportunityModel,
      })
    : null;
  const setDashboardView = (nextView: "summary" | "detail") => {
    void navigate({ search: nextView === "detail" ? { view: "detail" } : {}, replace: true });
  };

  return (
    <div className="space-y-8 lg:space-y-10">
      <div className="border-b border-border pb-6 lg:flex lg:items-end lg:justify-between lg:gap-8">
        <div className="max-w-3xl">
          <p className="report-kicker mb-3">
            {view === "summary" ? "AI VISIBILITY OVERVIEW" : "AI VISIBILITY REPORT"}
          </p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            {view === "summary" ? "AI 노출 요약" : "내 AI 노출 진단"}
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            {view === "summary"
              ? "이번 측정의 핵심 지표와 주요 관찰 결과를 한 화면에서 확인할 수 있습니다."
              : isUnifiedDiagnostic
                ? "내 업체에 맞춘 24개 질문으로 대표 노출·관찰 업체·출처·기간 변화를 한 번에 확인합니다."
                : "내 업체에서 중요하게 보는 맞춤 검색 결과를 먼저 보여드리고, 기본 진단은 비교 기준으로 따로 제공합니다."}
          </p>
        </div>
        <div className="mt-5 flex min-w-0 flex-col gap-3 lg:mt-0 lg:items-end">
          <div className="inline-flex w-full rounded-lg border bg-muted/40 p-1 sm:w-auto" aria-label="진단 보기 방식">
            <Button
              type="button"
              variant={view === "summary" ? "default" : "ghost"}
              className="flex-1 shadow-none sm:flex-none"
              onClick={() => setDashboardView("summary")}
            >
              핵심 요약
            </Button>
            <Button
              type="button"
              variant={view === "detail" ? "default" : "ghost"}
              className="flex-1 shadow-none sm:flex-none"
              onClick={() => setDashboardView("detail")}
            >
              상세 분석
            </Button>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-card p-3">
            <BusinessSelector
              options={businesses.options}
              value={businesses.selectedBusinessId}
              onChange={businesses.select}
              isLoading={businesses.isLoading}
              isError={businesses.isError}
            />
          </div>
        </div>
      </div>

      {!businessId && !businesses.isLoading && (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <p>진단할 대상 업체가 없습니다. 내 업체를 먼저 등록하세요.</p>
            <Button asChild>
              <Link to="/businesses">내 업체 등록하기</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {view === "detail" && businessId && unifiedTransitionPending && (
        <Card className="border-primary/40 bg-primary/[0.03]">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">새 통합 AI 진단 질문이 준비되었습니다.</p>
                <Badge variant="outline">첫 측정 필요</Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {dto
                  ? "첫 통합 24문항 측정을 완료하기 전까지는 기존 대표 진단 결과를 계속 보여드립니다. 측정이 완료되면 새 통합 진단으로 자동 전환됩니다."
                  : "저장된 통합 24문항으로 첫 측정을 진행해 주세요. 측정이 완료되면 대표 진단 결과가 표시됩니다."}
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link to="/runs">첫 통합 진단 측정하기</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {view === "detail" && businessId && !isUnifiedDiagnostic && (
        <CustomDiagnosticSection
          isLoading={customQuery.isLoading}
          isError={customQuery.isError || (!!customQuery.data && !customQuery.data.ok)}
          data={customQuery.data && customQuery.data.ok ? customQuery.data.data : null}
          loaded={!!customQuery.data && customQuery.data.ok}
          questionsReady={unifiedTransitionPending}
        />
      )}

      {view === "detail" && businessId && showLegacyDiagnosticSection && (
        <section className="space-y-2 border-t border-border pt-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold">
              {isUnifiedDiagnostic ? "내 업체 AI 진단" : "기본 AI 노출 진단"}
            </h2>
            <Badge variant={isUnifiedDiagnostic ? "default" : "outline"}>
              {isUnifiedDiagnostic ? "대표 진단" : "비교 기준"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {isUnifiedDiagnostic
              ? "지역·주력 서비스·중요 브랜드/차종을 반영한 24개 질문으로 내 업체의 AI 노출을 진단합니다."
              : "같은 24개 질문으로 전체 노출 상태와 장기 변화를 보는 기준선입니다."}
          </p>
          <p className="text-xs text-muted-foreground">
            {isUnifiedDiagnostic
              ? "아래 상세 분석·관찰 업체·출처·검색 상황·기간 비교는 모두 이 24문항 측정을 기준으로 합니다."
              : "맞춤 진단과 질문 구성이 다르므로 두 노출률을 상승·하락으로 직접 비교하지 않습니다."}
          </p>
          {!isUnifiedDiagnostic && (
            <p className="text-xs text-muted-foreground">
              아래 상세 분석과 벤치마크는 기본 24문항 측정을 기준으로 합니다.
            </p>
          )}
        </section>
      )}

      {query.isLoading && businessId && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}

      {result &&
        !result.ok &&
        !(unifiedTransitionPending && result.error === "NO_V2_DATA") && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {result.error === "NO_V2_DATA"
              ? "최근 완료된 측정에 v2 진단 데이터가 아직 준비되지 않았습니다."
              : result.error === "FORBIDDEN"
                ? "이 업체의 진단을 볼 권한이 없습니다."
                : result.error === "BUSINESS_NOT_AVAILABLE"
                  ? "현재 진단할 수 있는 업체가 아닙니다."
                  : result.error === "INVALID_V2_DATA"
                    ? "최근 진단 데이터의 검증에 실패해 결과를 표시하지 않습니다."
                    : "진단 결과를 불러오지 못했습니다. 잠시 후 다시 시도하세요."}
          </CardContent>
        </Card>
      )}

      {query.isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            진단 요청이 실패했습니다.
          </CardContent>
        </Card>
      )}

      {dto && model && summaryModel && view === "summary" && (
        <DashboardSummary
          summary={summaryModel}
          intentLabelFor={intentLabel}
          onShowDetail={() => setDashboardView("detail")}
        />
      )}

      {dto && model && view === "detail" && (
        <>
          <div className="grid overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4 lg:gap-px">
            <MetricCard
              highlight
              label="확정 AI 노출률"
              value={pctRange(
                model.metricCards.visibility.lowerPct,
                model.metricCards.visibility.lowerPct,
              )}
              note={
                model.metricCards.visibility.unresolvedCount > 0
                  ? `유효 응답 ${model.metricCards.visibility.validCount}건 중 확정 노출 ${model.metricCards.visibility.confirmedCount}건 · 추가 확인 ${model.metricCards.visibility.unresolvedCount}건`
                  : `유효 응답 ${model.metricCards.visibility.validCount}건 중 확정 노출 ${model.metricCards.visibility.confirmedCount}건`
              }
            />
            <MetricCard
              label="확정 상위 3곳 노출률"
              value={pctRange(model.metricCards.top3.lowerPct, model.metricCards.top3.lowerPct)}
              note={
                model.metricCards.top3.unresolvedCount > 0
                  ? `유효 응답 ${model.metricCards.top3.validCount}건 중 상위 3곳 확정 ${model.metricCards.top3.confirmedCount}건 · 상위 3곳 여부 추가 확인 ${model.metricCards.top3.unresolvedCount}건`
                  : `유효 응답 ${model.metricCards.top3.validCount}건 중 상위 3곳 확정 ${model.metricCards.top3.confirmedCount}건`
              }
            />
            <MetricCard
              label="함께 관찰된 업체"
              value={`${model.metricCards.competitorCount}곳`}
              note="이번 측정에서 업체로 확인된 항목"
            />
            <MetricCard
              label="실제 인용 출처"
              value={
                dto.citationSources ? `${model.metricCards.citationSourceCount}개` : "준비 중"
              }
              note="이번 24개 AI 답변 전체의 인용 출처 수 · 내 업체 성과 점수는 아닙니다"
            />
          </div>

          {unifiedLayerSummary && (
            <UnifiedDiagnosticLayerSummaryCard summary={unifiedLayerSummary} />
          )}

          {actionOpportunityModel && (
            <ActionOpportunitySection
              model={actionOpportunityModel}
              evidenceExamples={actionEvidenceExamples}
              currentRunReferences={currentRunReferences}
              basisLabel={detailBasisLabel}
            />
          )}

          {comparisonModel && (
            <ComparisonCard model={comparisonModel} basisLabel={detailBasisLabel} />
          )}
          {(comparisonQuery.isError || (comparisonResult && !comparisonResult.ok)) && (
            <Card className="report-section">
              <CardContent className="py-5 text-sm text-muted-foreground">
                이전 측정 비교 정보를 불러오지 못했습니다. 최근 측정 결과에는 영향이 없습니다.
              </CardContent>
            </Card>
          )}

          <p className="border-b border-border pb-5 text-sm text-muted-foreground">
            분석에 사용한 유효 AI 답변 {model.recentSummary.validCount}건 · 최근 측정{" "}
            {formatSeoul(model.measuredAt)}
            {model.recentSummary.invalidCount > 0
              ? ` · 제외 ${model.recentSummary.invalidCount}건`
              : ""}
          </p>

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">OBSERVED BUSINESSES</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                {model.competitors.heading}
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs text-muted-foreground">
                이번 측정의 AI 답변에서 업체로 확인된 항목입니다. 같은 업체가 여러 답변에서 보인
                횟수를 함께 표시합니다.
              </p>
              {model.competitors.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  함께 관찰된 다른 업체가 없습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>업체</TableHead>
                      <TableHead>AI 답변에서 관찰</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.competitors.rows
                      .slice(0, showAllCompetitors ? model.competitors.rows.length : 6)
                      .map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="text-sm font-medium">
                            {c.name}
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="tabular-nums">{c.responseCount}건</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              질문 {c.questionCount}개 · 상위 3곳 안에서 {c.top3ResponseCount}건
                              관찰
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
              {model.competitors.rows.length > 6 && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedCompetitorBusinessId(showAllCompetitors ? null : businessId)
                    }
                  >
                    {showAllCompetitors ? "접기" : `전체 ${model.competitors.rows.length}곳 보기`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">CITED SOURCES</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                {model.citationSources.heading}
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                이번 측정의 최종 AI 답변에 실제 citation으로 남은 출처를 도메인별로 묶었습니다.
                검색 과정에서만 참고된 후보 출처는 포함하지 않습니다. 위쪽일수록 더 많은 서로 다른
                AI 답변에서 반복 인용된 출처입니다. 특정 업체와 연결됐다는 뜻은 아니며, 아래
                ‘업체 연결까지 확인된 출처’에서 별도로 확인합니다.
              </p>
              <p className="mb-3 rounded-md bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground">
                ‘인용된 답변 수’는 이 출처가 한 번 이상 인용된 AI 답변 수이고, ‘전체 인용 횟수’는
                답변 안에서 확인된 citation의 합계입니다.
              </p>
              {model.citationSources.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  이번 측정의 최종 AI 답변에서 인용된 출처가 확인되지 않았습니다.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>출처</TableHead>
                      <TableHead>인용된 답변 수</TableHead>
                      <TableHead>전체 인용 횟수</TableHead>
                      <TableHead className="text-right">예시</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.citationSources.rows
                      .slice(0, showAllCitationSources ? model.citationSources.rows.length : 8)
                      .map((source) => (
                        <TableRow key={source.domain}>
                          <TableCell className="text-sm font-medium">
                            {siteDisplayName(source.domain)}
                            {siteDisplayName(source.domain) !== source.domain && (
                              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                {source.domain}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {source.responseCount}개 답변
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {source.citationCount}회
                          </TableCell>
                          <TableCell className="text-right">
                            <a
                              href={source.sampleUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-primary underline-offset-4 hover:underline"
                            >
                              인용 페이지 예시 보기 ↗
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
              {model.citationSources.rows.length > 8 && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedCitationSourceBusinessId(
                        showAllCitationSources ? null : businessId,
                      )
                    }
                  >
                    {showAllCitationSources
                      ? "접기"
                      : `전체 ${model.citationSources.rows.length}개 출처 보기`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  {model.weakQuestions.heading}
                  <BaselineBadge label={detailBasisLabel} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {isUnifiedDiagnostic
                    ? "상세 지역과 선택 조건이 반영된 상세 검색을 먼저 보여드리고, 넓은 기준 검색은 그다음에 표시합니다."
                    : "노출이 확정되지 않았거나, 일부만 확인됐거나, 대상 동일성 확인이 더 필요한 질문입니다."}
                </p>
                {weakQuestionRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    현재 우선 확인할 질문이 없습니다.
                  </p>
                ) : (
                  weakQuestionRows
                    .slice(0, showAllWeakQuestions ? weakQuestionRows.length : 6)
                    .map((q) => (
                      <div key={q.questionId} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium">{q.questionText}</p>
                          <Badge variant={weakQuestionBadgeVariant(q.statusTone)}>
                            {q.statusLabel}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{intentLabel(q.intentType)}</span>
                          {isUnifiedDiagnostic && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                              {questionUsesDetailedLocation(q.questionText, dto.business.city)
                                ? "상세 검색"
                                : "기준 검색"}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          확정 노출 {q.confirmedMentionCount}건 · 추가 확인 필요{" "}
                          {q.unresolvedTargetCount}건
                        </p>
                      </div>
                    ))
                )}
                {weakQuestionRows.length > 6 && (
                  <div className="flex justify-center pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedWeakQuestionBusinessId(showAllWeakQuestions ? null : businessId)
                      }
                    >
                      {showAllWeakQuestions
                        ? "접기"
                        : `전체 ${weakQuestionRows.length}개 질문 보기`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="report-section">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  {model.sources.heading}
                  <BaselineBadge label={detailBasisLabel} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 overflow-x-auto">
                <p className="text-xs leading-5 text-muted-foreground">
                  먼저 인용 페이지 자체에서 내 업체 관련성이 확인된 출처를 보여드립니다.
                  AI 답변 안에서의 직접 연결·근접 단서는 별도 기준으로 구분하고, 같은 답변에 함께
                  인용됐을 뿐인 전체 출처는 참고용으로 접어둡니다.
                </p>

                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge
                    variant={verifiedTargetCitationPageCount > 0 ? "default" : "outline"}
                  >
                    페이지 내용 기준 관련 확인 {verifiedTargetCitationPageCount}개
                  </Badge>
                  <Badge variant={linkedTargetSourceCount > 0 ? "default" : "outline"}>
                    AI 답변 내 직접 연결 {linkedTargetSourceCount}개
                  </Badge>
                  <Badge variant="secondary">
                    AI 답변 내 근접 단서 {targetReferenceSources.length}개
                  </Badge>
                  <Badge
                    variant={targetExposureCitationSourceCount > 0 ? "secondary" : "outline"}
                  >
                    함께 인용된 전체 출처 {targetExposureCitationSourceCount}개 · 참고
                  </Badge>
                  <Badge variant="outline">
                    비교해볼 타업체 출처 {linkedCompetitorSourceCount}개
                  </Badge>
                </div>

                {!model.sources.available ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    이번 측정의 출처 진단 데이터가 아직 준비되지 않았습니다.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div>
                        <h3 className="text-sm font-semibold">
                          {model.verifiedTargetCitationPages.heading}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          AI가 실제 인용한 페이지 자체에서 내 업체의 업체명·지점·지역 또는
                          검증된 공식 출처 근거를 확인한 페이지입니다. 같은 답변에 함께 인용됐다는
                          이유만으로는 포함하지 않습니다.
                        </p>
                      </div>
                      {!model.verifiedTargetCitationPages.available ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          인용 페이지의 내 업체 관련성을 확인 중입니다. 기존 노출률과 출처 판정에는
                          영향이 없습니다.
                        </p>
                      ) : verifiedTargetCitationPages.length === 0 ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이번 측정에서는 페이지 자체에서 내 업체 관련성을 확정한 인용 출처가
                          확인되지 않았습니다.
                        </p>
                      ) : (
                        <>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>출처</TableHead>
                                <TableHead>확인된 페이지</TableHead>
                                <TableHead>확인 근거</TableHead>
                                <TableHead>노출 답변</TableHead>
                                <TableHead className="text-right">페이지</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {verifiedTargetCitationPages
                                .slice(
                                  0,
                                  showAllVerifiedTargetCitationPages
                                    ? verifiedTargetCitationPages.length
                                    : 6,
                                )
                                .map((source) => (
                                  <TableRow key={`verified-target-page:${source.sampleUrl}`}>
                                    <TableCell className="text-sm font-medium">
                                      {siteDisplayName(source.domain)}
                                      {siteDisplayName(source.domain) !== source.domain && (
                                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                          {source.domain}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="max-w-[280px] text-sm">
                                      <span className="line-clamp-2">
                                        {source.title ?? "페이지 제목 미확인"}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      <Badge
                                        variant={source.confidence === "high" ? "default" : "secondary"}
                                      >
                                        {source.basisLabel}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm tabular-nums">
                                      {source.responseCount}/
                                      {model.metricCards.visibility.confirmedCount}건
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <a
                                        href={source.sampleUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm text-primary underline-offset-4 hover:underline"
                                      >
                                        관련 페이지 보기 ↗
                                      </a>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                          {verifiedTargetCitationPages.length > 6 && (
                            <div className="flex justify-center pt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setExpandedVerifiedTargetCitationBusinessId(
                                    showAllVerifiedTargetCitationPages
                                      ? null
                                      : businessId,
                                  )
                                }
                              >
                                {showAllVerifiedTargetCitationPages
                                  ? "접기"
                                  : `전체 ${verifiedTargetCitationPages.length}개 관련 출처 보기`}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <div>
                        <h3 className="text-sm font-semibold">AI 답변 내 직접 연결된 출처</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          AI 답변 구조에서 내 업체와 citation의 직접·반복 연결 기준을 통과한 출처입니다.
                          여기에 포함합니다.
                        </p>
                      </div>
                      {linkedTargetSources.length === 0 ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이번 측정에서는 AI 답변 안에서 내 업체와 직접 연결된 출처가 확인되지 않았습니다.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>출처</TableHead>
                              <TableHead>확인된 답변</TableHead>
                              <TableHead>연결</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {linkedTargetSources.map((source) => (
                              <TableRow key={`target:${source.domain}`}>
                                <TableCell className="text-sm font-medium">
                                  {siteDisplayName(source.domain)}
                                  {siteDisplayName(source.domain) !== source.domain && (
                                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                      {source.domain}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                  {source.targetResponseCount}건
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="default">내 업체</Badge>
                                    {source.linkedEntities
                                      .filter((entity) => !entity.isTarget)
                                      .map((entity) => (
                                        <Badge
                                          key={`${source.domain}:${entity.name}:target-row`}
                                          variant="outline"
                                        >
                                          {entity.name} · {entity.responseCount}건
                                        </Badge>
                                      ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    {targetReferenceSources.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedTargetReferenceBusinessId(
                              showTargetReferenceSources ? null : businessId,
                            )
                          }
                        >
                          {showTargetReferenceSources
                            ? "AI 답변 내 근접 단서 접기"
                            : `AI 답변 내 근접 단서 ${targetReferenceSources.length}개 보기`}
                        </Button>
                        {showTargetReferenceSources && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                              AI 답변에서 내 업체명과 citation이 가까운 위치에서 관찰됐지만 반복 기준을 충족하지
                              않아 확정 연결에는 포함하지 않은 보조 증거입니다.
                            </p>
                            <div className="divide-y">
                              {targetReferenceSources.map((source) => (
                                <div
                                  key={`target-clue:${source.domain}`}
                                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                                >
                                  <div className="min-w-0">
                                    <span className="font-medium">
                                      {siteDisplayName(source.domain)}
                                    </span>
                                    {siteDisplayName(source.domain) !== source.domain && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {source.domain}
                                      </span>
                                    )}
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      AI 답변 {source.responseCount}건에서 단서
                                    </span>
                                  </div>
                                  <a
                                    href={source.sampleUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-primary underline-offset-4 hover:underline"
                                  >
                                    단서 페이지 예시 보기 ↗
                                  </a>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-2 border-t pt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const nextOpen = !showTargetExposureCitationSources;
                          setExpandedTargetExposureCitationBusinessId(
                            nextOpen ? businessId : null,
                          );
                          if (!nextOpen) {
                            setExpandedAllTargetExposureCitationBusinessId(null);
                          }
                        }}
                      >
                        {showTargetExposureCitationSources
                          ? "함께 인용된 전체 출처 접기"
                          : `함께 인용된 전체 출처 ${targetExposureCitationSourceCount}개 보기 · 참고`}
                      </Button>

                      {showTargetExposureCitationSources && (
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold">
                              함께 인용된 전체 출처
                            </h3>
                            <Badge variant="outline">
                              참고용 · 내 업체 노출 답변 기준
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            내 업체가 확정 노출된 {model.metricCards.visibility.confirmedCount}건의 답변에 실제
                            citation으로 함께 등장한 전체 출처입니다. 페이지 자체가 내 업체와 관련됐다는
                            뜻은 아니며 참고용 원본 관찰 자료입니다.
                          </p>

                          {!model.targetExposureCitationSources.available ? (
                            <p className="mt-3 rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                              내 업체 노출 답변의 인용 출처 집계를 불러오지 못했습니다. 확정 연결
                              판정에는 영향이 없습니다.
                            </p>
                          ) : targetExposureCitationSources.length === 0 ? (
                            <p className="mt-3 rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                              확정 노출된 답변에서는 실제 citation이 확인되지 않았습니다.
                            </p>
                          ) : (
                            <>
                              <Table className="mt-3">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>출처</TableHead>
                                    <TableHead>내 업체 노출 답변</TableHead>
                                    <TableHead>인용 횟수</TableHead>
                                    <TableHead className="text-right">예시</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {targetExposureCitationSources
                                    .slice(
                                      0,
                                      showAllTargetExposureCitationSources
                                        ? targetExposureCitationSources.length
                                        : 5,
                                    )
                                    .map((source) => (
                                      <TableRow key={`target-exposure:${source.domain}`}>
                                        <TableCell className="text-sm font-medium">
                                          {siteDisplayName(source.domain)}
                                          {siteDisplayName(source.domain) !== source.domain && (
                                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                              {source.domain}
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-sm tabular-nums">
                                          {source.responseCount}/
                                          {model.metricCards.visibility.confirmedCount}건
                                        </TableCell>
                                        <TableCell className="text-sm tabular-nums">
                                          {source.citationCount}회
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <a
                                            href={source.sampleUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-sm text-primary underline-offset-4 hover:underline"
                                          >
                                            인용 페이지 예시 보기 ↗
                                          </a>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>

                              {targetExposureCitationSources.length > 5 && (
                                <div className="flex justify-center pt-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setExpandedAllTargetExposureCitationBusinessId(
                                        showAllTargetExposureCitationSources
                                          ? null
                                          : businessId,
                                      )
                                    }
                                  >
                                    {showAllTargetExposureCitationSources
                                      ? "상위 5개만 보기"
                                      : `나머지 ${targetExposureCitationSources.length - 5}개 더 보기`}
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <div>
                        <h3 className="text-sm font-semibold">비교해볼 타업체 출처</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          홈페이지·업체 프로필·자동차 플랫폼처럼 실제 업체 비교에 활용하기 쉬운
                          확정 연결만 기본으로 보여드립니다.
                        </p>
                      </div>
                      {usefulCompetitorSources.length === 0 ? (
                        <p className="rounded-md bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          이번 측정에서는 기본 화면에 보여줄 타업체 비교 출처가 없습니다.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>출처</TableHead>
                              <TableHead>확인된 답변</TableHead>
                              <TableHead>연결된 업체</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {usefulCompetitorSources.map((source) => (
                              <TableRow key={`competitor:${source.domain}`}>
                                <TableCell className="text-sm font-medium">
                                  {siteDisplayName(source.domain)}
                                  {siteDisplayName(source.domain) !== source.domain && (
                                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                      {source.domain}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                  {source.competitorResponseCount}건
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div className="flex flex-wrap gap-1.5">
                                    {source.linkedEntities
                                      .filter((entity) => !entity.isTarget)
                                      .map((entity) => (
                                        <Badge
                                          key={`${source.domain}:${entity.name}:competitor-row`}
                                          variant="outline"
                                        >
                                          {entity.name} · {entity.responseCount}건
                                        </Badge>
                                      ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    {otherConfirmedSources.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedOtherConfirmedSourceBusinessId(
                              showOtherConfirmedSources ? null : businessId,
                            )
                          }
                        >
                          {showOtherConfirmedSources
                            ? "기타 확정 연결 접기"
                            : `기타 확정 연결 ${otherConfirmedSources.length}개 보기`}
                        </Button>
                        {showOtherConfirmedSources && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                              채용·공공·뉴스처럼 연결 자체는 확인됐지만 업체 비교에는 상대적으로
                              덜 유용한 출처입니다. 데이터에서는 유지하되 기본 화면에서는 강조하지
                              않습니다.
                            </p>
                            <div className="divide-y">
                              {otherConfirmedSources.map((source) => (
                                <div key={`other:${source.domain}`} className="py-2 text-sm">
                                  <span className="font-medium">{source.domain}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {source.competitorResponseCount}개 답변 ·{" "}
                                    {source.linkedEntities
                                      .filter((entity) => !entity.isTarget)
                                      .map((entity) => entity.name)
                                      .join(", ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {linkedClueSources.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedLinkedClueBusinessId(showLinkedClues ? null : businessId)
                          }
                        >
                          {showLinkedClues
                            ? "타업체 연결 단서 접기"
                            : `타업체 연결 단서 ${linkedClueSources.length}개 보기`}
                        </Button>
                        {showLinkedClues && (
                          <div className="rounded-lg border bg-muted/10 p-3">
                            <p className="mb-2 text-xs leading-5 text-muted-foreground">
                              확정 연결 기준을 통과하지 않은 타업체 보조 단서입니다.
                            </p>
                            <div className="divide-y">
                              {linkedClueSources.map((source) => (
                                <div key={`competitor-clue:${source.domain}`} className="py-2 text-sm">
                                  <span className="font-medium">{source.domain}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    AI 답변 {source.clueResponseCount}건 ·{" "}
                                    {source.linkedEntities.map((entity) => entity.name).join(", ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">SEARCH CONTEXT</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                어떤 검색 상황에서 보였나요?
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <p className="mb-3 text-xs text-muted-foreground">
                비슷한 검색 질문을 묶어 내 업체가 실제로 확인된 질문과 추가 확인이 필요한 질문을
                보여드립니다. 각 검색 상황은 이번 측정의 해당 질문 수를 기준으로 비교합니다.
              </p>
              {model.questionGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  질문군 요약이 아직 없습니다.
                </p>
              ) : (
                <SearchContextChart groups={model.questionGroups} />
              )}
            </CardContent>
          </Card>

          {benchmark && <BenchmarkCard benchmark={benchmark} basisLabel={detailBasisLabel} />}

          <Card className="report-section">
            <CardHeader className="border-b bg-muted/20">
              <p className="report-kicker">METHODOLOGY</p>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                분석 방법과 신뢰도
                <BaselineBadge label={detailBasisLabel} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                기준 측정: {dto.scope.runName} · 반복 {dto.scope.repetitions}회 · 완료{" "}
                {dto.scope.completedJobs}/{dto.scope.totalJobs}
              </p>
              <p>
                최근 측정의 메인 노출률은 내 업체로 확정된 응답만 계산합니다. 추가 확인이 필요한
                응답은 별도로 표시하며, 가능한 최대 범위는 상세 정보에서 참고할 수 있습니다.
              </p>
              <p>
                이전 측정 비교는 같은 질문과 측정 조건이 확인되는 경우에만 제공합니다. 충분한 동일
                조건 측정이 쌓이기 전까지 시간 추세와 경쟁업체 상세 비교는 표시하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function summaryCountText(metric: DashboardSummaryMetric): string {
  return metric.count === null ? "확인 중" : `${metric.count}건`;
}

function summaryMetricNote(metric: DashboardSummaryMetric): string {
  if (metric.total === null || metric.pct === null) return "확인 가능한 결과를 준비하고 있습니다.";
  return `${metric.total}개 답변 중 · ${pctRange(metric.pct, metric.pct)}`;
}

function DashboardSummary({
  summary,
  intentLabelFor,
  onShowDetail,
}: {
  summary: EntityFactsV2DashboardSummaryViewModel;
  intentLabelFor: (intentType: string) => string;
  onShowDetail: () => void;
}) {
  const hasHeroCounts =
    summary.visibility.total !== null &&
    summary.visibility.count !== null &&
    summary.top3.count !== null;
  const scopeLabels = {
    custom: "상세 검색",
    core: "기준 검색",
    overall: "전체",
  } as const;

  return (
    <section className="space-y-6" aria-label="사장님용 10초 요약">
      <div className="rounded-xl border border-primary/20 bg-accent/70 px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BarChart3 aria-hidden="true" />
          </div>
          <div className="min-w-0">
            {hasHeroCounts ? (
              <p className="text-xl font-semibold leading-8 sm:text-2xl sm:leading-9">
                {summary.visibility.total}번 물어봤더니 내 업체는{" "}
                <strong className="text-primary">{summary.visibility.count}번</strong> 나왔고, 그중{" "}
                <strong className="text-primary">{summary.top3.count}번</strong>은{" "}
                <strong className="text-primary">상위 3곳</strong> 안에 나왔습니다.
              </p>
            ) : (
              <p className="text-xl font-semibold leading-8 sm:text-2xl">
                이번 측정의 핵심 결과를 확인하고 있습니다.
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              이번 측정 기준 · AI 답변 {summary.visibility.total ?? "확인 중"}건 분석
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryKpiCard
          icon={<BarChart3 aria-hidden="true" />}
          label="내 업체가 나온 답변"
          value={summaryCountText(summary.visibility)}
          note={summaryMetricNote(summary.visibility)}
          highlight
        />
        <SummaryKpiCard
          icon={<Search aria-hidden="true" />}
          label="상위 3곳에 나온 답변"
          value={summaryCountText(summary.top3)}
          note={summaryMetricNote(summary.top3)}
        />
        <SummaryKpiCard
          icon={<FileCheck2 aria-hidden="true" />}
          label="내 업체 관련 페이지"
          value={summary.verifiedPageCount === null ? "확인 중" : `${summary.verifiedPageCount}개`}
          note="페이지 내용 기준 관련 확인"
        />
        <SummaryKpiCard
          icon={<Building2 aria-hidden="true" />}
          label="가장 자주 함께 나온 업체"
          value={summary.topCompetitor?.name ?? "확인된 업체 없음"}
          note={
            summary.topCompetitor
              ? `AI 답변에서 ${summary.topCompetitor.responseCount}건 관찰`
              : "이번 측정에서 함께 확인된 업체가 없습니다."
          }
          compact
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="report-section">
          <CardHeader>
            <CardTitle className="text-xl">어떤 검색에서 보였나요?</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              이번 측정에서 실제로 확인된 검색 상황만 요약했습니다.
            </p>
          </CardHeader>
          <CardContent>
            {summary.searchContexts.length === 0 ? (
              <p className="rounded-lg bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                이번 측정에서 확정 노출이 확인된 검색 상황이 없습니다.
              </p>
            ) : (
              <div className="space-y-5">
                {summary.searchContexts.map((context) => (
                  <div key={context.intentType}>
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium">{intentLabelFor(context.intentType)}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {context.confirmedCount}/{context.validCount}
                      </span>
                    </div>
                    <Progress value={percentOf(context.confirmedCount, context.validCount)} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="report-section">
          <CardHeader>
            <CardTitle className="text-xl">검색 범위 요약</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              같은 측정 안에서 확인된 상세 검색과 기준 검색을 나눠 보여드립니다.
            </p>
          </CardHeader>
          <CardContent>
            {summary.searchScopes === null ? (
              <p className="rounded-lg bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                이번 측정은 검색 범위를 안전하게 나눠 표시할 수 없습니다.
              </p>
            ) : (
              <div className="divide-y rounded-lg border px-4">
                {summary.searchScopes.map((scope) => (
                  <div key={scope.kind} className="flex items-center justify-between gap-4 py-3">
                    <span className="text-sm font-medium">{scopeLabels[scope.kind]}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {scope.confirmedCount}/{scope.validCount}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {scope.confirmedPct === null ? "–" : pctRange(scope.confirmedPct, scope.confirmedPct)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="report-section">
          <CardHeader>
            <CardTitle className="text-xl">지금 먼저 확인할 것</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.opportunities.length === 0 ? (
              <p className="rounded-lg bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                현재 데이터에서는 근거가 충분한 출처 연결 차이가 확인되지 않았습니다.
              </p>
            ) : (
              <ol className="space-y-3">
                {summary.opportunities.map((item) => (
                  <li key={item.rank} className="flex gap-3 rounded-lg border p-4">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                      {item.rank}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold leading-6">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {item.observation}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              이 차이는 관찰 결과이며, 특정 작업이 노출 상승을 보장하는 것은 아닙니다.
            </p>
          </CardContent>
        </Card>

        <Card className="report-section">
          <CardHeader>
            <CardTitle className="text-xl">관련성이 확인된 출처</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.verifiedPageCount === null ? (
              <p className="rounded-lg bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                인용 페이지의 내 업체 관련성을 확인 중입니다.
              </p>
            ) : summary.verifiedPages.length === 0 ? (
              <p className="rounded-lg bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                이번 측정에서는 관련성이 확인된 인용 페이지가 없습니다.
              </p>
            ) : (
              <div className="divide-y">
                {summary.verifiedPages.map((page) => (
                  <div key={page.sampleUrl} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{siteDisplayName(page.domain)}</p>
                        <p className="truncate text-sm text-muted-foreground" title={page.title ?? undefined}>
                          {page.title ?? "페이지 제목 미확인"}
                        </p>
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {page.responseCount}/{summary.visibility.count ?? "–"} 확정 노출건
                        </p>
                      </div>
                      <a
                        href={page.sampleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        관련 페이지 보기 ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Button type="button" size="lg" onClick={onShowDetail}>
          상세 분석 보기 <ArrowRight aria-hidden="true" />
        </Button>
        <p className="text-xs text-muted-foreground">
          이 화면은 자세한 분석을 쉽게 요약한 버전입니다.
        </p>
      </div>
    </section>
  );
}

function SummaryKpiCard({
  icon,
  label,
  value,
  note,
  highlight = false,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  highlight?: boolean;
  compact?: boolean;
}) {
  return (
    <Card className={highlight ? "report-section border-primary/35" : "report-section"}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="[&_svg]:size-4">{icon}</span>
          <p className="text-sm font-medium">{label}</p>
        </div>
        <p
          className={
            compact
              ? "mt-4 line-clamp-2 min-h-14 text-xl font-bold leading-7"
              : "mt-4 text-3xl font-bold leading-none tabular-nums"
          }
        >
          {value}
        </p>
        <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function BaselineBadge({ label = "기본 진단 기준" }: { label?: string }) {
  return (
    <Badge
      variant="outline"
      className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
    >
      {label}
    </Badge>
  );
}

function ActionOpportunitySection({
  model,
  evidenceExamples,
  currentRunReferences,
  basisLabel,
}: {
  model: ReturnType<typeof buildActionOpportunityEngineV01>;
  basisLabel: string;
  evidenceExamples: Array<{
    sourceGroupKey: string;
    entityName: string;
    domain: string;
    url: string;
    attributionLevel: "direct" | "section";
  }>;
  currentRunReferences: Array<{
    sourceGroupKey: string;
    domain: string;
    responseCount: number;
    entityCount: number;
    entities: Array<{
      entityName: string;
      url: string;
      attributionLevel: "direct" | "section";
    }>;
  }>;
}) {
  return (
    <Card className="report-section border-t-2 border-t-primary">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">ACTION OPPORTUNITIES</p>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {model.heading}
          <BaselineBadge label={basisLabel} />
        </CardTitle>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{model.description}</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {model.items.length === 0 ? (
          <p className="rounded-md border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
            현재 데이터에서는 근거가 충분한 출처 연결 차이를 찾지 못했습니다. 의미가 약한 차이는
            억지로 보여주지 않습니다.
          </p>
        ) : (
          <div
            className={
              model.items.length === 1
                ? "grid gap-4"
                : model.items.length === 2
                  ? "grid gap-4 lg:grid-cols-2"
                  : "grid gap-4 lg:grid-cols-3"
            }
          >
            {model.items.map((item) => {
              const sameChannelExamples = item.sites.flatMap((site) => {
                const normalizedDomain = site.domain?.toLowerCase().replace(/^www\./, "");
                const currentReference = currentRunReferences.find(
                  (reference) =>
                    normalizedDomain &&
                    reference.domain === normalizedDomain &&
                    reference.entities.length > 0,
                );
                if (!currentReference?.entities[0]) return [];
                return [
                  {
                    siteLabel: site.label,
                    entityName: currentReference.entities[0].entityName,
                    url: currentReference.entities[0].url,
                  },
                ];
              });
              const sameChannelEntityKeys = new Set(
                sameChannelExamples.map((example) => normalizeQuestion(example.entityName)),
              );
              const seenEvidenceExamples = new Set<string>();
              const dedupedEvidenceExamples = evidenceExamples
                .filter((example) => example.sourceGroupKey === item.sourceGroupKey)
                .filter((example) => !lowValueComparisonSourceDomain(example.domain))
                .filter((example) => !sameChannelEntityKeys.has(normalizeQuestion(example.entityName)))
                .filter((example) => {
                  const key = `${normalizeQuestion(example.entityName)}|${example.url}`;
                  if (seenEvidenceExamples.has(key)) return false;
                  seenEvidenceExamples.add(key);
                  return true;
                })
                .slice(0, 2);

              return (
              <div key={item.sourceGroupKey} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {item.evidenceScope === "category" ? "같은 업종 관찰" : "전체 자동차 관찰"}
                  </Badge>
                </div>

                <p className="mt-3 text-base font-semibold leading-6">{item.title}</p>

                <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-sm font-semibold leading-6">
                    AI에 자주 관찰된 업체 {item.highVisibilityEntityCount}곳 중 {item.highEntityCount}
                    곳에서 관찰
                    {item.highEntitySharePct !== null
                      ? ` · ${item.highEntitySharePct.toFixed(1)}%`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">내 업체 연결 미확인</p>
                </div>

                <div className="mt-4 space-y-3">
                  {sameChannelExamples.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">실제로 비교할 수 있는 같은 채널 사례</p>
                      <div className="mt-2 space-y-2">
                        {sameChannelExamples.map((example) => (
                          <a
                            key={`${example.siteLabel}:${example.entityName}:${example.url}`}
                            href={example.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                          >
                            <span className="font-medium">{example.siteLabel}</span>
                            <span className="ml-2 text-muted-foreground">
                              {example.entityName} · 실제 페이지 보기 ↗
                            </span>
                          </a>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        이번 측정에서 다른 업체와 확정 연결된 동일 채널만 표시합니다.
                      </p>
                    </div>
                  )}

                  {dedupedEvidenceExamples.length > 0 && (
                    <div>
                      <p className="text-xs font-medium">실제 비교해볼 업체 사례</p>
                      <div className="mt-2 space-y-1.5">
                        {dedupedEvidenceExamples.map((example) => (
                          <a
                            key={`${example.entityName}:${example.url}`}
                            href={example.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                          >
                            <span className="font-medium">{example.entityName}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {example.domain} · 실제 페이지 보기 ↗
                            </span>
                          </a>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        위 동일 채널 사례와 겹치지 않는 다른 업체 사례만 표시합니다. 직접 비교용
                        참고 사례이며, 해당 페이지가 노출의 원인임을 의미하지 않습니다.
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium">확인해볼 차이</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.actionText}
                    </p>
                  </div>
                </div>

              </div>
              );
            })}
          </div>
        )}

        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {model.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}

const SITE_DISPLAY_NAMES: Array<{ match: RegExp; name: string }> = [
  { match: /(^|\.)mycle\.co\.kr$/, name: "마이클" },
  { match: /(^|\.)seongnam\.go\.kr$/, name: "성남시" },
  { match: /(^|\.)issuetale\.kr$/, name: "이슈테일" },
  { match: /(^|\.)daangn\.com$/, name: "당근" },
  { match: /(^|\.)pf\.kakao\.com$/, name: "카카오톡 채널" },
  { match: /(^|\.)placeview\.co\.kr$/, name: "플레이스뷰" },
  { match: /(^|\.)oh-car\.kr$/, name: "오늘의카" },
  { match: /(^|\.)blog\.naver\.com$/, name: "네이버 블로그" },
  { match: /(^|\.)cafe\.naver\.com$/, name: "네이버 카페" },
];

function siteDisplayName(domain: string): string {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return SITE_DISPLAY_NAMES.find((entry) => entry.match.test(normalized))?.name ?? domain;
}

function ComparisonCard({
  model,
  basisLabel,
}: {
  model: ReturnType<typeof buildEntityFactsV2ComparisonViewModel>;
  basisLabel: string;
}) {
  if (!model.comparisonAvailable) {
    return (
      <Card>
        <CardContent className="space-y-1.5 py-4">
          <p className="text-sm font-semibold">이전 측정 비교</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {model.heading}. {model.description}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">측정 비교</p>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {model.heading}
          <BaselineBadge label={basisLabel} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <p className="text-sm leading-6 text-muted-foreground">{model.description}</p>

        {model.comparisonAvailable && model.visibility && model.top3 && (
          <div className="grid gap-4 md:grid-cols-2">
            {[model.visibility, model.top3].map((metric) => (
              <div key={metric.label} className="rounded-md border p-4">
                <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-2xl font-semibold tabular-nums">
                    {metric.currentValueText}
                  </span>
                  {metric.deltaText && <Badge variant="outline">{metric.deltaText}</Badge>}
                </div>
                {metric.previousValueText && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    이전 동일 조건 측정 {metric.previousValueText}
                  </p>
                )}
                {metric.comparisonSentence && (
                  <p className="mt-3 text-sm">{metric.comparisonSentence}</p>
                )}
                {metric.uncertaintyText && (
                  <p className="mt-2 text-xs text-muted-foreground">{metric.uncertaintyText}</p>
                )}
                {metric.maximumNotice && (
                  <p className="mt-1 text-xs text-muted-foreground">{metric.maximumNotice}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {model.searchScope && (
          <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
            <div>
              <p className="text-sm font-semibold">검색 범위별 변화</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                같은 통합 24문항에서 상세 검색과 기준 검색의 확정 노출만 따로 비교합니다.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[model.searchScope.custom, model.searchScope.core].map((metric) => (
                <div key={metric.label} className="rounded-md border bg-card p-3">
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-xl font-semibold tabular-nums">
                      {metric.currentValueText}
                    </span>
                    {metric.deltaText && <Badge variant="outline">{metric.deltaText}</Badge>}
                  </div>
                  {metric.previousValueText && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      이전 동일 조건 측정 {metric.previousValueText}
                    </p>
                  )}
                  {metric.comparisonSentence && (
                    <p className="mt-2 text-sm leading-6">{metric.comparisonSentence}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-sm">
              새로 확정된 질문{" "}
              <span className="font-semibold tabular-nums">
                {model.searchScope.newlyConfirmedQuestionCount}개
              </span>
              {" · "}
              이전에는 확정됐지만 이번 측정에서 확정되지 않은 질문{" "}
              <span className="font-semibold tabular-nums">
                {model.searchScope.noLongerConfirmedQuestionCount}개
              </span>
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              동일한 질문 세트와 측정 조건이 확인된 두 측정의 확정 여부만 비교합니다. 변화의 원인을
              의미하지 않습니다.
            </p>
          </div>
        )}

        {model.trendAvailable && model.compatibleMeasurementCount !== null && (
          <p className="text-xs text-muted-foreground">
            동일 조건 측정 {model.compatibleMeasurementCount}회가 확인되었습니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BenchmarkCard({
  benchmark,
  basisLabel,
}: {
  basisLabel: string;
  benchmark: NonNullable<
    Extract<Awaited<ReturnType<typeof getVisibilityBenchmark>>, { ok: true }>["benchmark"]
  >;
}) {
  const chartGroups = benchmark.sourceGroups.slice(0, 6);
  const chartData = chartGroups.map((group) => ({
    label: group.label,
    share: group.highEntitySharePct ?? 0,
    connected: group.targetConnected,
  }));

  return (
    <Card className="report-section">
      <CardHeader className="border-b bg-muted/20">
        <p className="report-kicker">MARKET BENCHMARK</p>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          AI에 자주 관찰되는 업체들은 어떤 출처와 함께 보일까요?
          <BaselineBadge label={basisLabel} />
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            데이터 축적 중
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          최근 {benchmark.windowDays}일 동안의 별도 벤치마크 집계입니다. 현재 업체의 v2 최근 측정
          진단과는 독립된 참고 정보입니다.
        </p>
        {benchmark.dataStatus === "early" && (
          <p className="text-xs text-muted-foreground">현재는 초기 표본으로 참고용 집계입니다.</p>
        )}
        {benchmark.sourceGroups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            아직 공통 출처 패턴을 판단할 표본이 부족합니다.
          </p>
        ) : (
          <div className="space-y-4">
            <div
              className="h-72 w-full sm:h-80"
              role="img"
              aria-label="시장 벤치마크 출처 그룹별 고노출 업체 관찰 비율"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 8, right: 48, bottom: 8, left: 8 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={112}
                    tick={{ fill: "var(--color-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<BenchmarkTooltip />} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar
                    dataKey="share"
                    name="관찰 비율"
                    fill="var(--color-chart-1)"
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  >
                    <LabelList
                      dataKey="share"
                      position="right"
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                      className="fill-foreground text-[11px] font-semibold"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="divide-y rounded-md border">
              {chartGroups.map((g) => (
                <div
                  key={g.key}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
                >
                  <p className="text-sm font-medium">{g.label}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {g.sites.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {g.sites
                          .slice(0, 4)
                          .map((site) => site.label)
                          .join(" · ")}
                      </p>
                    )}
                    <Badge variant={g.targetConnected ? "default" : "secondary"}>
                      {g.targetConnected
                        ? "최근 측정에서 내 업체 직접 연결 확인"
                        : "최근 측정에서 내 업체 직접 연결 미확인"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="sr-only">
              {chartGroups.map((group) => (
                <p key={group.key}>
                  {group.label}: 고노출 업체 {benchmark.highVisibilityEntityCount}곳 중{" "}
                  {group.highEntityCount}곳에서 관찰
                  {group.highEntitySharePct !== null
                    ? `, ${group.highEntitySharePct.toFixed(1)}%`
                    : ""}
                  .{" "}
                  {group.targetConnected
                    ? "최근 측정에서 내 업체 직접 연결 확인"
                    : "최근 측정에서 내 업체 직접 연결 미확인"}
                </p>
              ))}
            </div>
          </div>
        )}
        {benchmark.categoryContext?.available === true && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">같은 업종에서 특히 자주 보인 출처</p>
            <p className="text-xs text-muted-foreground">
              {benchmark.categoryContext.category ?? "동일"} 업종의 비교 가능한 업체{" "}
              {benchmark.categoryContext.eligibleTargetBusinessCount}곳에서 별도로 관찰된 참고
              패턴입니다.
            </p>
            <div className="space-y-1">
              {benchmark.categoryContext.sourceGroups.slice(0, 3).map((g) => {
                const labels = (g.sites ?? [])
                  .slice(0, 4)
                  .map((site) => site.label)
                  .join(" · ");
                return (
                  <p key={g.key} className="text-xs">
                    <span className="font-medium">{g.label}</span>
                    {labels && <span className="text-muted-foreground"> · {labels}</span>}
                  </p>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{benchmark.disclaimer}</p>
      </CardContent>
    </Card>
  );
}

function BenchmarkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}) {
  const item = payload?.[0];
  if (!active || !item) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{item.payload?.label}</p>
      <p className="mt-1 tabular-nums">관찰 비율 {Number(item.value ?? 0).toFixed(1)}%</p>
      <p className="mt-1 text-muted-foreground">
        {item.payload?.connected
          ? "최근 측정에서 내 업체 직접 연결 확인"
          : "최근 측정에서 내 업체 직접 연결 미확인"}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  note?: string | null;
  highlight?: boolean;
}) {
  return (
    <Card
      className={
        highlight
          ? "rounded-none border-0 bg-primary/[0.04] shadow-none"
          : "rounded-none border-0 bg-card shadow-none"
      }
    >
      <CardHeader
        className={`border-t-2 pb-2 pt-5 ${
          highlight
            ? "border-t-primary"
            : "border-t-transparent transition-colors hover:border-t-primary"
        }`}
      >
        <CardTitle
          className={`text-sm font-semibold leading-5 ${
            highlight ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-5">
        <p
          className={`text-4xl font-bold leading-none tabular-nums ${
            highlight ? "text-primary" : "text-foreground"
          }`}
        >
          {value}
        </p>
        {note && <p className="mt-3 text-sm leading-6 text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function CustomQuestionRow({ q }: { q: CustomDiagnosticQuestionDTO }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm leading-6">{q.promptText}</p>
        <p className="text-xs text-muted-foreground">{intentLabel(q.intentType)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {q.status === "confirmed" && <Badge>확정 노출</Badge>}
        {q.status === "unresolved" && <Badge variant="secondary">추가 확인</Badge>}
        {q.status === "missing" && <Badge variant="outline">이번 측정에서 확인되지 않음</Badge>}
        {q.position !== null && (
          <span className="text-xs text-muted-foreground">{q.position}번째로 관찰</span>
        )}
      </div>
    </li>
  );
}

function CustomDiagnosticSection({
  isLoading,
  isError,
  loaded,
  data,
  questionsReady,
}: {
  isLoading: boolean;
  isError: boolean;
  loaded: boolean;
  data: CustomDiagnosticDTO | null;
  questionsReady: boolean;
}) {
  const [showAllMissing, setShowAllMissing] = useState(false);
  const confirmed = data?.questions.filter((q) => q.status === "confirmed") ?? [];
  const unresolved = data?.questions.filter((q) => q.status === "unresolved") ?? [];
  const missing = data?.questions.filter((q) => q.status === "missing") ?? [];
  const visibleMissing = showAllMissing ? missing : missing.slice(0, 3);

  return (
    <Card className="border-primary/50 shadow-sm">
      <CardHeader className="space-y-2">
        <p className="report-kicker">CUSTOM DIAGNOSTIC</p>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-2xl">내 업체 맞춤 진단</CardTitle>
          <Badge>대표 진단</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          내가 중요하게 설정한 검색 질문에서 AI가 내 업체를 얼마나 보여주는지 확인합니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && <Skeleton className="h-32" />}
        {!isLoading && isError && (
          <p className="text-sm text-muted-foreground">
            맞춤 진단을 불러오지 못했습니다. 기본 진단에는 영향이 없습니다.
          </p>
        )}
        {!isLoading && !isError && loaded && !data && (
          <div className="space-y-3 py-4 text-center">
            {questionsReady ? (
              <>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <p className="font-medium">통합 AI 진단 질문 24개가 준비되었습니다.</p>
                  <Badge variant="outline">첫 측정 필요</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  질문 생성은 완료되었습니다. 위의 ‘첫 통합 진단 측정하기’에서 첫 측정을 진행하세요.
                </p>
                <Button asChild variant="outline">
                  <Link to="/questions">질문 확인·수정</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">아직 완료된 맞춤 진단이 없습니다.</p>
                <p className="text-sm text-muted-foreground">
                  내 업체에서 중요하게 보는 검색 질문을 먼저 설정해 보세요.
                </p>
                <Button asChild>
                  <Link to="/questions">내 업체 맞춤 진단 만들기</Link>
                </Button>
              </>
            )}
          </div>
        )}
        {data && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">확정 노출</p>
                <p className="text-4xl font-bold tabular-nums">
                  {data.confirmedCount} / {data.validCount}
                  <span className="ml-3 text-2xl text-primary">
                    {data.confirmedPct === null ? "-" : `${data.confirmedPct.toFixed(1)}%`}
                  </span>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  유효 질문 {data.validCount}개 중 확정 노출 {data.confirmedCount}개
                  {data.unresolvedCount > 0 && ` · 추가 확인 ${data.unresolvedCount}개`}
                  {data.missingCount > 0 && ` · 이번 측정에서 미확인 ${data.missingCount}개`}
                </p>
              </div>
              <div className="min-w-0 text-xs text-muted-foreground sm:text-right">
                <p>{formatSeoul(data.measuredAt)}</p>
                <p className="truncate" title={data.questionSetName}>
                  {data.questionSetName}
                </p>
              </div>
            </div>

            {confirmed.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">확인된 질문</h3>
                <ul className="divide-y">
                  {confirmed.map((q) => (
                    <CustomQuestionRow key={q.questionId} q={q} />
                  ))}
                </ul>
              </div>
            )}
            {unresolved.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">추가 확인이 필요한 질문</h3>
                <ul className="divide-y">
                  {unresolved.map((q) => (
                    <CustomQuestionRow key={q.questionId} q={q} />
                  ))}
                </ul>
              </div>
            )}
            {missing.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">
                  이번 측정에서 확인되지 않은 질문 {missing.length}개
                </h3>
                <ul className="divide-y">
                  {visibleMissing.map((q) => (
                    <CustomQuestionRow key={q.questionId} q={q} />
                  ))}
                </ul>
                {missing.length > 3 && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAllMissing((v) => !v)}>
                    {showAllMissing ? "접기" : `전체 ${missing.length}개 보기`}
                  </Button>
                )}
              </div>
            )}
            {data.invalidCount > 0 && (
              <p className="text-xs text-muted-foreground">
                응답을 확인할 수 없었던 질문 {data.invalidCount}개는 집계에서 제외했습니다.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
