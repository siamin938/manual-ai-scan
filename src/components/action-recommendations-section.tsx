import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActionRecommendations } from "@/lib/visibility-actions.functions";
import type { ActionRecommendationDTO } from "@/lib/visibility-actions.types";
import { formatSeoul } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/** evidenceLevel은 Badge variant 선택에만 쓰고, 어떤 판정에도 쓰지 않는다. */
function badgeVariant(
  level: ActionRecommendationDTO["evidenceLevel"],
): "default" | "secondary" | "outline" {
  if (level === "priority_try") return "default";
  if (level === "worth_review") return "secondary";
  return "outline";
}

/** actionType은 Badge variant 선택에만 쓰고, 어떤 판정/문구 생성에도 쓰지 않는다. */
function channelBadgeVariant(
  type: ActionRecommendationDTO["channelSuggestions"][number]["actionType"],
): "default" | "secondary" | "outline" {
  if (type === "observe_only") return "outline";
  if (type === "publish_candidate") return "default";
  return "secondary";
}

export function ActionRecommendationsSection({
  orgId,
  businessId,
}: {
  orgId: string | null;
  businessId: string | null;
}) {
  const fetchActions = useServerFn(getActionRecommendations);

  const query = useQuery({
    queryKey: ["visibility-actions", orgId, businessId],
    enabled: !!orgId && !!businessId,
    queryFn: () =>
      fetchActions({ data: { orgId: orgId as string, businessId: businessId as string } }),
  });

  if (!orgId || !businessId) return null;

  const result = query.data;
  const payload = result && result.ok ? result.data : null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">AI 노출을 높이기 위해 먼저 해볼 것</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          반복 측정에서 경쟁업체와 실제 인용 출처·질문군의 차이를 바탕으로, 지금 우선 시도해볼
          항목을 정리했습니다.
        </p>
      </div>

      {query.isLoading && <Skeleton className="h-40" />}

      {(query.isError || (result && !result.ok)) && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            추천 항목을 불러오지 못했습니다. 잠시 후 다시 시도하세요.
          </CardContent>
        </Card>
      )}

      {payload && payload.recommendations.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            아직 행동을 권할 만큼 반복적으로 확인된 격차가 없습니다. 측정 데이터가 더 쌓이면
            우선순위를 제안합니다.
          </CardContent>
        </Card>
      )}

      {payload && payload.recommendations.length > 0 && (
        <div className="space-y-4">
          {payload.recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}

      {payload?.scope && (
        <p className="text-xs text-muted-foreground">
          기준 측정: {payload.scope.runName} · {formatSeoul(payload.scope.measuredAt)} · 반복{" "}
          {payload.scope.repetitions}회 · 유효 측정 {payload.scope.validCount}건 · 관찰 경쟁업체{" "}
          {payload.scope.competitorCount}곳
        </p>
      )}

      {payload && <p className="text-xs text-muted-foreground">{payload.disclaimer}</p>}
    </section>
  );
}

function RecommendationCard({ rec }: { rec: ActionRecommendationDTO }) {
  const e = rec.evidence;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{rec.rank}순위</Badge>
          <Badge variant={badgeVariant(rec.evidenceLevel)}>{rec.evidenceLabel}</Badge>
        </div>
        <CardTitle className="mt-2 text-base sm:text-lg">{rec.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium">왜 이걸 먼저 보나요?</p>
          <p className="mt-1 text-sm text-muted-foreground">{rec.summary}</p>
        </div>

        {rec.steps.length > 0 && (
          <div>
            <p className="text-sm font-medium">무엇을 하면 되나요?</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {rec.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-sm font-medium">어디에 반영할까요?</p>
          {rec.channelSuggestions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              현재 관련 질문의 실제 인용 데이터만으로는 특정 채널을 권할 근거가 부족합니다.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {rec.channelSuggestions.map((c) => (
                <div key={c.key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{c.name}</span>
                    <Badge variant={channelBadgeVariant(c.actionType)}>{c.actionLabel}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    관련 경쟁업체 답변 {c.responseCount}/{c.relatedResponseTotal} · 인용{" "}
                    {c.citationCount}회 · 경쟁업체 {c.distinctCompetitorCount}곳
                  </p>
                  {c.domains.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      관찰 도메인: {c.domains.join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>


        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">데이터 근거</p>
          <p className="mt-1">
            내 업체 등장 답변 {e.clientResponseCount} · 경쟁업체 등장 답변{" "}
            {e.competitorResponseCount} · 함께 관찰된 경쟁업체 {e.distinctCompetitorCount}곳
          </p>
          <p className="mt-1">
            측정 {e.measurementCount}건 · 관련 질문 {e.questionCount}개
          </p>
          {e.domains.length > 0 && <p className="mt-1">관찰 출처: {e.domains.join(", ")}</p>}
        </div>

        {rec.sampleQuestions.length > 0 && (
          <div>
            <p className="text-sm font-medium">관련 질문 예시</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {rec.sampleQuestions.slice(0, 2).map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
