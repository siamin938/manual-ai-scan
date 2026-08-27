import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { formatSeoul } from "@/lib/format";
import {
  getCompetitorDetail,
  resolveCompetitor,
} from "@/lib/visibility-competitor.functions";
import type { CompetitorDetailDTO } from "@/lib/visibility-competitor.types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** DTO 퍼센트 값을 그대로 표시한다(재계산 없음). */
function pct(value: number | null): string {
  return value === null ? "–" : `${value.toFixed(1)}%`;
}

function intentLabel(intentType: string): string {
  return (INTENT_LABELS as Record<string, string>)[intentType] ?? "기타";
}

export function CompetitorDetailDialog({
  orgId,
  businessId,
  competitorName,
  onClose,
}: {
  orgId: string | null;
  businessId: string | null;
  competitorName: string | null;
  onClose: () => void;
}) {
  const resolve = useServerFn(resolveCompetitor);
  const fetchDetail = useServerFn(getCompetitorDetail);

  const open = !!competitorName && !!orgId && !!businessId;

  const query = useQuery({
    queryKey: ["visibility-competitor-detail", orgId, businessId, competitorName],
    enabled: open,
    queryFn: async () => {
      const resolved = await resolve({
        data: {
          orgId: orgId as string,
          businessId: businessId as string,
          competitorName: competitorName as string,
        },
      });
      if (!resolved.ok) return { ok: false as const };
      const detail = await fetchDetail({
        data: {
          orgId: orgId as string,
          businessId: businessId as string,
          competitorRef: resolved.competitor.ref,
        },
      });
      if (!detail.ok) return { ok: false as const };
      return { ok: true as const, detail: detail.detail };
    },
  });

  const detail: CompetitorDetailDTO | null =
    query.data && query.data.ok ? query.data.detail : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{competitorName ?? "업체 상세"}</DialogTitle>
          <DialogDescription>
            이 업체가 어떤 질문에서 자주 등장했고, 그 답변에 어떤 출처가 함께 인용됐는지
            보여줍니다.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
          </div>
        )}

        {!query.isLoading && !detail && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            이 업체의 상세 정보를 지금은 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}

        {detail && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="등장 답변 수" value={String(detail.competitor.responseCount)} />
              <Metric label="답변 비율" value={pct(detail.competitor.responseRatePct)} />
              <Metric label="언급 수" value={String(detail.competitor.mentionCount)} />
              <Metric label="Top3 비율" value={pct(detail.competitor.top3RatePct)} />
            </div>

            <p className="text-xs text-muted-foreground">
              기준 측정: {detail.scope.runName} · {formatSeoul(detail.scope.measuredAt)}
            </p>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">어떤 질문군에서 자주 등장했나</h3>
              {detail.questionGroups.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">질문군 정보가 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>질문군</TableHead>
                        <TableHead>측정</TableHead>
                        <TableHead>등장 답변</TableHead>
                        <TableHead>언급</TableHead>
                        <TableHead>답변 비율</TableHead>
                        <TableHead>Top3</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.questionGroups.map((g) => (
                        <TableRow key={g.intentType}>
                          <TableCell className="text-sm">{intentLabel(g.intentType)}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {g.measurementCount}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{g.responseCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">{g.mentionCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(g.responseRatePct)}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(g.top3RatePct)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">실제로 등장한 질문</h3>
              {detail.questions.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">등장한 질문이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {detail.questions.map((q) => (
                    <div key={q.questionId} className="rounded-md border p-3">
                      <p className="text-sm font-medium">{q.questionText}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {intentLabel(q.intentType)} · 등장 답변 {q.responseCount}/
                        {q.measurementCount} · 답변 비율 {pct(q.responseRatePct)} · 최고 순위{" "}
                        {q.bestPosition === null ? "–" : `${q.bestPosition}위`} · Top3{" "}
                        {pct(q.top3RatePct)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                이 업체가 등장한 답변에서 실제 인용된 출처
              </h3>
              <p className="text-xs text-muted-foreground">
                이 업체가 등장한 답변과 같은 답변에서 실제 인용된 출처입니다.
              </p>
              {detail.sources.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">인용 출처 정보가 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>도메인</TableHead>
                        <TableHead>등장 답변 수</TableHead>
                        <TableHead>인용 수</TableHead>
                        <TableHead>답변 비율</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.sources.map((s) => (
                        <TableRow key={s.domain}>
                          <TableCell className="text-sm">
                            {s.domain}
                            {s.sampleTitle && (
                              <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-foreground">
                                {s.sampleTitle}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{s.responseCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">{s.citationCount}</TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {pct(s.responseRatePct)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <p className="text-xs text-muted-foreground">
              이 데이터는 반복 측정된 AI 답변에서 함께 관찰된 패턴입니다. 특정 출처나 질문이 해당
              업체 노출의 직접적인 원인임을 의미하지 않습니다.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
