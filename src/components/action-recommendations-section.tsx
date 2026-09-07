import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActionRecommendations } from "@/lib/visibility-actions.functions";
import type { ActionRecommendationDTO } from "@/lib/visibility-actions.types";
import { formatSeoul } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";

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

/** 액션 카드 제목을 고객이 바로 이해할 수 있는 표현으로만 바꾼다. */
const CUSTOMER_TITLE_OVERRIDES: Record<string, string> = {
  "업체를 믿고 맡길 수 있는 정보가 잘 보이는지 확인하기":
    "경력·전문 분야·보증·작업 이력을 한 페이지에 공개하기",
  "AS 기준을 공개하고 사후관리 사례와 실제 후기를 확보하기":
    "AS 기준·사후관리 사례·실제 고객 후기를 공개하기",
  "실제로 가능한 세부 서비스를 더 잘 발견되게 정리하기":
    "세부 서비스별 시공 범위와 실제 작업 사례를 정리하기",
};

function customerLabel(label: string): string {
  return CUSTOMER_LABEL_OVERRIDES[label] ?? label;
}

/**
 * 서버 DTO 라벨/문구 중 고객에게 노출될 때 "경쟁업체" 단정 표현을 관찰 중심으로만 바꾼다.
 * 내부 데이터/판정/점수는 변경하지 않고 렌더링에만 사용한다.
 */
function customerText(text: string): string {
  return text
    .replace(/관련 경쟁업체/g, "함께 관찰된 업체")
    .replace(/함께 관찰된 경쟁업체/g, "함께 관찰된 업체")
    .replace(/경쟁업체/g, "함께 관찰된 업체")
    .replace(/우선 시도/g, "우선 확인");
}

/** 액션 카드 제목용: 제목 오버라이드를 먼저 적용한 뒤 기존 치환도 유지한다. */
function customerTitle(title: string): string {
  return customerText(CUSTOMER_TITLE_OVERRIDES[title] ?? title);
}

/** 고객 표시용 intent 라벨 (표시 전용, 서버 판정과 무관). */
const INTENT_LABELS: Record<string, string> = {
  local: "지역·접근성",
  recommendation: "추천",
  service: "서비스·작업",
  review_quality: "후기·평판",
  trust: "전문성·신뢰",
  comparison: "비교",
  price_value: "가격·가성비",
  discovery: "탐색·발견",
  informational: "탐색·발견",
};
const INTENT_KEYS = Object.keys(INTENT_LABELS);

/** 소유 확인이 불가능한 공유형 블로그 플랫폼 (표시 전용 fail-closed). */
const SHARED_BLOG_PLATFORM_KEYS = ["tistory", "naver_blog"];
const SHARED_BLOG_STEPS = [
  "해당 블로그 글에서 내 업체 정보가 어떻게 언급되어 있는지 확인하세요.",
  "함께 관찰된 업체와 어떤 정보 차이가 있는지 참고하세요.",
  "직접 수정 가능한 내 채널이 아니라면 변경 대상으로 보지 말고 외부 노출 신호로만 관찰하세요.",
];

function isSharedBlogKey(key: string): boolean {
  return SHARED_BLOG_PLATFORM_KEYS.some(
    (k) => key === k || key.endsWith(`:${k}`) || key.startsWith(`${k}:`),
  );
}

/** `source:<sourceKey>:<intent>` 에서 마지막 known intent suffix만 제거한다. */
function parseSourceRecommendationId(
  id: string,
): { sourceKey: string; intent: string | null } | null {
  if (!id.startsWith("source:")) return null;
  const rest = id.slice("source:".length);
  for (const intent of INTENT_KEYS) {
    const suffix = `:${intent}`;
    if (rest.endsWith(suffix) && rest.length > suffix.length) {
      return { sourceKey: rest.slice(0, rest.length - suffix.length), intent };
    }
  }
  return { sourceKey: rest, intent: null };
}

/**
 * 이미 상위 source 카드로 병합된 platform key를 가진 group은 표시용 복사본에서 제거한다.
 * group.platforms가 비어있으면 판단 근거가 부족한 상태로 유지하기 위해 남겨둔다.
 */
function filterExplainedSourceGroups(
  groups: ActionRecommendationDTO["sourceGroups"],
  selectedSourceKeys: Set<string>,
): ActionRecommendationDTO["sourceGroups"] {
  return groups.filter((g) => {
    if (g.platforms.length === 0) return true;
    return !g.platforms.every((p) => selectedSourceKeys.has(p.key));
  });
}

/**
 * 이미 상위 source 카드로 병합된 platform key를 가진 channel은 표시용 복사본에서 제거한다.
 */
function filterExplainedChannels(
  channels: ActionRecommendationDTO["channelSuggestions"],
  selectedSourceKeys: Set<string>,
): ActionRecommendationDTO["channelSuggestions"] {
  return channels.filter((c) => !selectedSourceKeys.has(c.key));
}

/**
 * 고객 렌더링용 목록만 정리한다. 서버 rank/score/판정은 변경하지 않고,
 * 중복 출처 카드를 합쳐 표시용 rank만 1부터 다시 매긴다.
 */
function buildDisplayRecommendations(
  recommendations: ActionRecommendationDTO[],
): ActionRecommendationDTO[] {
  const sorted = [...recommendations].sort((a, b) => a.rank - b.rank);
  const groups = new Map<string, ActionRecommendationDTO[]>();
  const order: Array<{ type: "source"; sourceKey: string } | { type: "other"; rec: ActionRecommendationDTO }> = [];

  for (const rec of sorted) {
    const parsed = parseSourceRecommendationId(rec.id);
    if (parsed) {
      const existing = groups.get(parsed.sourceKey);
      if (existing) {
        existing.push(rec);
      } else {
        groups.set(parsed.sourceKey, [rec]);
        order.push({ type: "source", sourceKey: parsed.sourceKey });
      }
    } else {
      order.push({ type: "other", rec });
    }
  }

  const selectedSourceKeys = new Set(groups.keys());
  const out: ActionRecommendationDTO[] = [];

  for (const entry of order) {
    if (entry.type === "source") {
      const members = groups.get(entry.sourceKey) ?? [];
      const lead = members[0];
      if (!lead) continue;
      const questions: string[] = [];
      for (const m of members) {
        for (const q of m.sampleQuestions) {
          if (!questions.includes(q) && questions.length < 4) questions.push(q);
        }
      }
      const labels: string[] = [];
      for (const m of members) {
        const label = INTENT_LABELS[parseSourceRecommendationId(m.id)?.intent ?? ""];
        if (label && !labels.includes(label)) labels.push(label);
      }
      const summary =
        members.length > 1 && labels.length > 1
          ? `${lead.summary} 같은 출처 단서는 ${labels.join(", ")} 등 여러 검색 상황에서도 함께 관찰됐습니다.`
          : lead.summary;
      out.push({
        ...lead,
        summary,
        sampleQuestions: questions,
        steps: isSharedBlogKey(entry.sourceKey) ? SHARED_BLOG_STEPS : lead.steps,
      });
    } else {
      const rec = entry.rec;
      out.push({
        ...rec,
        sourceGroups: filterExplainedSourceGroups(rec.sourceGroups, selectedSourceKeys),
        referenceSourceGroups: filterExplainedSourceGroups(
          rec.referenceSourceGroups ?? [],
          selectedSourceKeys,
        ),
        channelSuggestions: filterExplainedChannels(rec.channelSuggestions, selectedSourceKeys),
      });
    }
  }

  return out.map((rec, i) => ({ ...rec, rank: i + 1 }));
}

/** 최우선 액션 제목만 한 줄로 안내한다(계산 규칙 없음). */
function gapHeadline(
  rec: ActionRecommendationDTO | undefined,
  prefix: string,
): string | null {
  if (!rec) return null;
  const label = rec.title?.trim();
  if (!label) return null;
  return `${prefix} ${customerTitle(label)}`;
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
  const displayRecommendations = payload
    ? buildDisplayRecommendations(payload.recommendations)
    : [];
  const topRec = displayRecommendations[0];
  const isPreliminary = (payload?.scope?.repetitions ?? 0) < 2;
  const headline = gapHeadline(
    topRec,
    isPreliminary ? "먼저 확인할 단서:" : "반복해서 확인된 우선 확인:",
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {isPreliminary ? "첫 측정에서 먼저 확인할 단서" : "AI 노출에서 먼저 확인할 단서"}
        </h2>
        {headline && (
          <p className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
            {headline}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {isPreliminary
            ? "실제 답변에 연결된 출처 차이를 먼저 보여드립니다. 질문 유형이나 출처가 추천의 원인이라는 뜻은 아니며, 해당 페이지를 직접 확인한 뒤 동일 조건으로 다시 측정해 보세요."
            : "반복 측정에서 실제 답변에 연결된 출처 차이를 우선해 정리했습니다. 인과로 단정하지 않으며, 먼저 확인해볼 지점입니다."}
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

      {payload && displayRecommendations.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {isPreliminary
              ? customerText(
                  "첫 측정에서 표시할 만큼 뚜렷한 경쟁업체 격차가 아직 없습니다. 동일 조건으로 한 번 더 측정하면 반복 여부를 확인합니다.",
                )
              : "아직 행동을 권할 만큼 반복적으로 확인된 격차가 없습니다. 측정 데이터가 더 쌓이면 우선순위를 제안합니다."}
          </CardContent>
        </Card>
      )}

      {payload && displayRecommendations.length > 0 && (
        <div className="space-y-4">
          {displayRecommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}

      {payload?.scope && (
        <p className="text-xs text-muted-foreground">
          기준 측정: {payload.scope.runName} · {formatSeoul(payload.scope.measuredAt)} · 반복{" "}
          {payload.scope.repetitions}회 · 유효 측정 {payload.scope.validCount}건 · 관찰 업체{" "}
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
          <Badge variant={badgeVariant(rec.evidenceLevel)}>
            {customerText(rec.evidenceLabel)}
          </Badge>
        </div>
        <CardTitle className="mt-2 text-base sm:text-lg">{customerTitle(rec.title)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium">왜 이걸 먼저 보나요?</p>
          <p className="mt-1 text-sm text-muted-foreground">{customerText(rec.summary)}</p>
        </div>

        {rec.steps.length > 0 && (
          <div>
            <p className="text-sm font-medium">무엇을 하면 되나요?</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {rec.steps.map((s, i) => (
                <li key={i}>{customerText(s)}</li>
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
            내 업체 등장 {e.clientResponseCount}개 · 함께 관찰된 업체 등장 {e.competitorResponseCount}개 · 관찰 업체 {e.distinctCompetitorCount}곳
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
                <li key={i}>{customerText(q)}</li>
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
  const badgeText = customerText(
    referenceOnly
      ? "참고"
      : isPriority
        ? customerLabel(g.evidenceLabel ?? g.actionLabel)
        : g.evidenceGrade === "candidate"
          ? "먼저 확인"
          : customerLabel(g.actionLabel),
  );
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
          <span className="text-xs text-muted-foreground">{customerText(g.scopeLabel)}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {customerText(
          `관련 답변 ${g.relatedResponseTotal}개 중 ${g.responseCount}개에서 업체 ${g.distinctCompetitorCount}곳과 함께 연결`,
        )}
      </p>

      <p className="mt-1 text-sm text-muted-foreground">{customerText(g.reason)}</p>
      {!referenceOnly && g.evidenceGrade === "candidate" && (g.clientOverallResponseCount ?? 0) > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          같은 검색 상황에서는 내 업체도 이 출처군이 {g.clientOverallResponseCount}개 답변에서 함께
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
                    {customerText(
                      `관련 답변 ${p.relatedResponseTotal}개 중 ${p.responseCount}개에서 업체 ${p.distinctCompetitorCount}곳과 연결`,
                    )}
                  </span>

                  <Badge
                    variant={
                      isSharedBlogKey(p.key) || referenceOnly
                        ? "outline"
                        : p.evidenceGrade === "priority"
                          ? "default"
                          : p.evidenceGrade === "candidate"
                            ? "outline"
                            : channelBadgeVariant(p.actionType)
                    }
                  >
                    {isSharedBlogKey(p.key)
                      ? "외부 콘텐츠 확인"
                      : customerText(
                          referenceOnly
                            ? "참고"
                            : p.evidenceGrade === "priority"
                              ? customerLabel(p.evidenceLabel ?? p.actionLabel)
                              : p.evidenceGrade === "candidate"
                                ? "먼저 확인"
                                : customerLabel(p.actionLabel),
                        )}
                  </Badge>
                </div>
                {p.domains.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{p.domains.join(", ")}</p>
                )}
                {isSharedBlogKey(p.key) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    소유가 확인되지 않은 공유형 블로그 출처로, 직접 수정 대상으로 단정하지 않고 외부
                    콘텐츠 확인 대상으로 표시합니다.
                  </p>
                )}
                {p.linkedCompetitors && p.linkedCompetitors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted-foreground">함께 연결된 업체</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.linkedCompetitors.map((c, i) =>
                        c.url ? (
                          <a
                            key={`${c.name}-${i}`}
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${c.name} 출처 페이지 열기 (새 창)`}
                            className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {c.name}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : (
                          <span
                            key={`${c.name}-${i}`}
                            className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {c.name}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {g.platforms.some((p) => p.linkedCompetitors?.some((c) => !!c.url)) && (
            <p className="text-xs text-muted-foreground">
              AI 답변에 실제 연결된 출처 페이지입니다. 업체별 상세 페이지가 아닐 수 있습니다.
            </p>
          )}
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
        <Badge variant={channelBadgeVariant(c.actionType)}>
          {customerText(customerLabel(c.actionLabel))}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{customerText(c.reason)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {customerText(
          `관련 답변 ${c.relatedResponseTotal}개 중 ${c.responseCount}개에서 업체 ${c.distinctCompetitorCount}곳과 연결`,
        )}
      </p>

      {c.domains.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">관찰 도메인: {c.domains.join(", ")}</p>
      )}
    </div>
  );
}

