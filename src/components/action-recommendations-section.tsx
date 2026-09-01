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

/**
 * 서버 DTO의 라벨 문자열을 고객이 이해하기 쉬운 표현으로만 바꾼다.
 * 내부 enum/key/수치는 그대로 두고 표시 문구만 치환한다.
 */
const CUSTOMER_LABEL_OVERRIDES: Record<string, string> = {
  "콘텐츠 보강 후보": "우선 개선 채널",
  "작성·보강 후보": "콘텐츠 개선",
  관찰만: "참고용",
  "기타 제3자 정보": "기타 웹사이트",
};

function customerLabel(label: string): string {
  return CUSTOMER_LABEL_OVERRIDES[label] ?? label;
}

/** 최우선 액션 제목만 한 줄로 안내한다(계산 규칙 없음). */
function gapHeadline(
  rec: ActionRecommendationDTO | undefined,
  prefix: string,
): string | null {
  if (!rec) return null;
  const label = rec.title?.trim();
  if (!label) return null;
  return `${prefix} ${label}`;
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
  const topRec = payload?.recommendations
    ? [...payload.recommendations].sort((a, b) => a.rank - b.rank)[0]
    : undefined;
  const isPreliminary = (payload?.scope?.repetitions ?? 0) < 2;
  const headline = gapHeadline(
    topRec,
    isPreliminary ? "먼저 확인해볼 영역:" : "반복해서 확인된 우선 영역:",
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {isPreliminary ? "첫 측정에서 먼저 확인해볼 영역" : "AI 노출을 높이기 위해 먼저 해볼 것"}
        </h2>
        {headline && (
          <p className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
            {headline}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {isPreliminary
            ? "이번에는 한 번 관찰된 결과입니다. 동일 조건으로 다시 측정해 같은 차이가 반복되는지 확인합니다."
            : "반복 측정에서 경쟁업체와 실제 연결된 출처·검색 상황의 차이를 바탕으로, 지금 우선 시도해볼 항목을 정리했습니다."}
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
            {isPreliminary
              ? "첫 측정에서 표시할 만큼 뚜렷한 경쟁업체 격차가 아직 없습니다. 동일 조건으로 한 번 더 측정하면 반복 여부를 확인합니다."
              : "아직 행동을 권할 만큼 반복적으로 확인된 격차가 없습니다. 측정 데이터가 더 쌓이면 우선순위를 제안합니다."}
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
          <p className="text-sm font-medium">어디를 확인해볼까요?</p>
          {rec.sourceGroups.length > 0 || (rec.referenceSourceGroups?.length ?? 0) > 0 ? (
            <SourceGroups
              groups={rec.sourceGroups}
              referenceGroups={rec.referenceSourceGroups ?? []}
            />
          ) : rec.channelSuggestions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              현재 관련 질문에서 AI 답변에 연결된 데이터만으로는 특정 채널을 권할 근거가
              부족합니다.
            </p>
          ) : (
            <ChannelGroups channels={rec.channelSuggestions} />
          )}
        </div>

        <details className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            판단 근거 자세히 보기
          </summary>
          <p className="mt-2">
            내 업체 등장 답변 {e.clientResponseCount} · 경쟁업체 등장 답변{" "}
            {e.competitorResponseCount} · 함께 관찰된 경쟁업체 {e.distinctCompetitorCount}곳
          </p>
          <p className="mt-1">
            측정 {e.measurementCount}건 · 관련 질문 {e.questionCount}개
          </p>
          {e.domains.length > 0 && <p className="mt-1">관찰 출처: {e.domains.join(", ")}</p>}
        </details>


        {rec.sampleQuestions.length > 0 && (
          <div>
            <p className="text-sm font-medium">실제로 측정한 질문 예시</p>
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

function SourceGroups({
  groups,
  referenceGroups,
}: {
  groups: ActionRecommendationDTO["sourceGroups"];
  referenceGroups: ActionRecommendationDTO["sourceGroups"];
}) {
  const main = groups.filter(
    (g) => g.actionType !== "observe_only" && g.evidenceGrade !== "reference",
  );
  const reference = [
    ...groups.filter((g) => g.actionType === "observe_only" || g.evidenceGrade === "reference"),
    ...referenceGroups,
  ];

  return (
    <div className="mt-2 space-y-4">
      {main.length > 0 ? (
        <div className="space-y-2">
          {main.map((g) => (
            <SourceGroupCard key={g.key} group={g} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          현재 데이터에서 직접 반영할 출처군은 확인되지 않았습니다.
        </p>
      )}

      {reference.length > 0 && (
        <details className="rounded-md border border-dashed bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            참고 출처 보기 ({reference.length})
          </summary>
          <div className="mt-2 space-y-2">
            {reference.map((g) => (
              <SourceGroupCard key={g.key} group={g} referenceOnly />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SourceGroupCard({
  group: g,
  referenceOnly = false,
}: {
  group: ActionRecommendationDTO["sourceGroups"][number];
  referenceOnly?: boolean;
}) {
  const isPriority = g.evidenceGrade === "priority";
  const badgeText = referenceOnly
    ? "참고"
    : isPriority
      ? customerLabel(g.evidenceLabel ?? g.actionLabel)
      : g.evidenceGrade === "candidate"
        ? "먼저 확인"
        : customerLabel(g.actionLabel);
  const badgeVariantForGroup: "default" | "secondary" | "outline" = referenceOnly
    ? "outline"
    : isPriority
      ? "default"
      : g.evidenceGrade === "candidate"
        ? "outline"
        : channelBadgeVariant(g.actionType);

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{customerLabel(g.name)}</span>
        <Badge variant={badgeVariantForGroup}>{badgeText}</Badge>
        {g.scopeLabel && (
          <span className="text-xs text-muted-foreground">{g.scopeLabel}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        경쟁업체 답변 {g.responseCount}/{g.relatedResponseTotal}에서 관찰 · 경쟁업체{" "}
        {g.distinctCompetitorCount}곳
      </p>

      <p className="mt-1 text-sm text-muted-foreground">{g.reason}</p>
      {!referenceOnly && g.evidenceGrade === "candidate" && (g.clientOverallResponseCount ?? 0) > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          전체 측정에서는 내 업체도 이 출처군이 {g.clientOverallResponseCount}개 답변에서 함께
          관찰됐습니다.
        </p>
      )}

      {g.platforms.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">실제 관찰 플랫폼</p>
          <p className="text-xs text-muted-foreground">
            플랫폼별 수치는 같은 답변에서 함께 관찰될 수 있어 서로 더하지 않습니다.
          </p>
          <ul className="space-y-1">
            {g.platforms.map((p) => (
              <li key={p.key} className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{customerLabel(p.name)}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.responseCount}/{p.relatedResponseTotal} 답변에서 연결 · 경쟁업체{" "}
                    {p.distinctCompetitorCount}곳
                  </span>

                  <Badge
                    variant={
                      referenceOnly
                        ? "outline"
                        : p.evidenceGrade === "priority"
                          ? "default"
                          : p.evidenceGrade === "candidate"
                            ? "outline"
                            : channelBadgeVariant(p.actionType)
                    }
                  >
                    {referenceOnly
                      ? "참고"
                      : p.evidenceGrade === "priority"
                        ? customerLabel(p.evidenceLabel ?? p.actionLabel)
                        : p.evidenceGrade === "candidate"
                          ? "먼저 확인"
                          : customerLabel(p.actionLabel)}
                  </Badge>
                </div>
                {p.domains.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{p.domains.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


function ChannelGroups({

  channels,
}: {
  channels: ActionRecommendationDTO["channelSuggestions"];
}) {
  const actionable = channels.filter((c) => c.actionType !== "observe_only");
  const observedOnly = channels.filter((c) => c.actionType === "observe_only");

  return (
    <div className="mt-2 space-y-4">
      {actionable.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">우선 반영·점검할 채널</p>
          {actionable.map((c) => (
            <ChannelCard key={c.key} channel={c} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          현재 데이터에서 직접 반영할 채널은 확인되지 않았습니다.
        </p>
      )}

      {observedOnly.length > 0 && (
        <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">함께 관찰된 출처</p>
          <p className="text-xs text-muted-foreground">
            직접 반영 가능한 채널인지 확인되지 않아 행동 추천이 아닌 관찰 정보로만 표시합니다.
          </p>
          {observedOnly.map((c) => (
            <ChannelCard key={c.key} channel={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  channel: c,
}: {
  channel: ActionRecommendationDTO["channelSuggestions"][number];
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{customerLabel(c.name)}</span>
        <Badge variant={channelBadgeVariant(c.actionType)}>{customerLabel(c.actionLabel)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        경쟁업체 답변 {c.responseCount}/{c.relatedResponseTotal}에서 연결 · 경쟁업체{" "}
        {c.distinctCompetitorCount}곳
      </p>

      {c.domains.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">관찰 도메인: {c.domains.join(", ")}</p>
      )}
    </div>
  );
}

