import type { CustomerPreviewV1Card, CustomerPreviewV1Model } from "@/lib/action-opportunity-v1.customer-preview.viewmodel";
import { formatSeoul } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export type CustomerPreviewV1SourceLink = {
  entityName: string;
  url: string;
};

function OwnerOpportunityCard({
  card,
  citedPages,
  citedPagesLoading,
}: {
  card: CustomerPreviewV1Card;
  citedPages: readonly CustomerPreviewV1SourceLink[];
  citedPagesLoading: boolean;
}) {
  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={card.priority === "high" ? "default" : "secondary"}>
          {card.priority === "high" ? "먼저 확인" : "함께 확인"}
        </Badge>
        <p className="text-xs text-muted-foreground">이번 측정에서 확인할 내용</p>
      </div>

      <h3 className="mt-3 text-base font-semibold leading-7 sm:text-lg">
        {card.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-foreground/85">{card.observation}</p>

      <div className="mt-4 rounded-lg bg-muted/45 px-4 py-3">
        <p className="text-sm font-semibold">무엇을 확인하면 될까요?</p>
        <p className="mt-1 text-sm leading-6">{card.recommendedCheck}</p>
      </div>

      <details className="group/evidence mt-4 rounded-lg border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          <span className="group-open/evidence:hidden">판단 근거 살펴보기 ▾</span>
          <span className="hidden group-open/evidence:inline">근거 접기 ▴</span>
        </summary>
        <div className="space-y-3 border-t px-4 py-3">
          <p className="text-sm leading-6 text-muted-foreground">{card.explanation}</p>
          <dl className="space-y-2">
            {card.evidence.map((row, index) => (
              <div key={row.label + index} className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 font-medium break-words">{row.value}</dd>
              </div>
            ))}
          </dl>

          {card.id === "competitor_source_difference" && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold">실제로 인용된 페이지</p>
              {citedPagesLoading ? (
                <p className="text-sm text-muted-foreground">인용된 페이지를 확인 중입니다.</p>
              ) : citedPages.length > 0 ? (
                citedPages.map((page, index) => (
                  <a
                    key={page.url + index}
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all text-sm leading-6 text-primary underline underline-offset-2"
                  >
                    인용 페이지 열기 · {page.entityName} ↗
                  </a>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  연결 관계가 구분되는 인용 페이지 링크를 확인하지 못했습니다.
                </p>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                AI 답변에서 인용된 페이지입니다. 해당 업체의 공식 페이지이거나 노출 원인으로 확인된 것은 아닙니다.
              </p>
            </div>
          )}
        </div>
      </details>
    </article>
  );
}

/**
 * Customer-style component is deliberately mounted ONLY in the authenticated
 * internal-observation admin result dialog. It is not a customer dashboard
 * route, public endpoint, shareable report, or publication feature.
 */
export function ActionOpportunityV1CustomerPreview({
  model,
  citedPages,
  citedPagesLoading,
}: {
  model: CustomerPreviewV1Model;
  citedPages: readonly CustomerPreviewV1SourceLink[];
  citedPagesLoading: boolean;
}) {
  return (
    <section className="space-y-5" aria-label="고객용 Action Opportunity 비공개 미리보기">
      <div className="rounded-xl border border-primary/25 bg-accent/65 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">고객 화면 구성 검수</Badge>
          <span className="text-xs text-muted-foreground">비공개 미리보기 · 고객에게 미노출</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {model.businessName} · {formatSeoul(model.measuredAt)} 측정 기준
        </p>
        <h2 className="mt-2 text-xl font-semibold leading-8 sm:text-2xl">
          이번 측정에서 확인해 볼 내용
        </h2>
        <p className="mt-2 text-sm leading-6 text-foreground/80">
          AI 답변 {model.answeredCount}개 중 내 업체가 나온 답변은{" "}
          <strong className="text-foreground">{model.confirmedCount}개</strong>입니다.
          실제로 관찰된 차이를 바탕으로 확인할 항목을 정리했습니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-card/90 p-3">
            <p className="text-xs text-muted-foreground">내 업체 확정 노출</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {model.confirmedCount}/{model.answeredCount}
            </p>
          </div>
          <div className="rounded-lg border bg-card/90 p-3">
            <p className="text-xs text-muted-foreground">상위 3곳 확정</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {model.top3Count}/{model.answeredCount}
            </p>
          </div>
          <div className="col-span-2 rounded-lg border bg-card/90 p-3 sm:col-span-1">
            <p className="text-xs text-muted-foreground">내 업체 관련 페이지</p>
            <p className="mt-1 text-lg font-semibold">{model.relatedPageLabel}</p>
          </div>
        </div>
      </div>

      {model.primary.length === 0 ? (
        <div className="rounded-xl border p-5 text-sm leading-6 text-muted-foreground">
          현재 측정 결과에서 근거가 충분한 확인 항목이 없습니다.
          새로운 사실을 임의로 만들어 표시하지 않습니다.
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold">먼저 확인해 보세요</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              가장 먼저 읽을 두 가지 관찰을 보여드립니다. 개선 효과의 순위는 아닙니다.
            </p>
          </div>
          {model.primary.map((card) => (
            <OwnerOpportunityCard
              key={card.id}
              card={card}
              citedPages={citedPages}
              citedPagesLoading={citedPagesLoading}
            />
          ))}
        </div>
      )}

      {model.additional.length > 0 && (
        <details className="group/extra rounded-xl border bg-background">
          <summary className="cursor-pointer px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold">
                다른 관찰 {model.additional.length}개도 확인하기
              </span>
              <span className="text-sm text-muted-foreground">
                <span className="group-open/extra:hidden">펼쳐보기 ▾</span>
                <span className="hidden group-open/extra:inline">접기 ▴</span>
              </span>
            </div>
          </summary>
          <div className="space-y-3 border-t p-3 sm:p-4">
            {model.additional.map((card) => (
              <OwnerOpportunityCard
                key={card.id}
                card={card}
                citedPages={citedPages}
                citedPagesLoading={citedPagesLoading}
              />
            ))}
          </div>
        </details>
      )}

      <p className="text-xs leading-5 text-muted-foreground">{model.disclaimer}</p>
    </section>
  );
}
