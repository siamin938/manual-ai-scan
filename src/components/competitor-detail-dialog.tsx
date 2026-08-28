import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { formatSeoul } from "@/lib/format";
import {
  getCompetitorCompare,
  getCompetitorDetail,
  resolveCompetitor,
} from "@/lib/visibility-competitor.functions";
import type {
  CompetitorCompareDTO,
  CompetitorCompareObservedIn,
  CompetitorDetailDTO,
} from "@/lib/visibility-competitor.types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const OBSERVED_IN_LABELS: Record<CompetitorCompareObservedIn, string> = {
  both: "양쪽 답변",
  client_only: "내 업체 쪽",
  competitor_only: "경쟁업체 쪽",
};

const COMPARE_NOTE =
  "이 비교는 같은 최신 측정에서 두 업체가 어떤 질문과 출처와 함께 관찰됐는지 나란히 보여줍니다. 차이가 노출의 직접적인 원인이라는 뜻은 아닙니다.";

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
  const fetchCompare = useServerFn(getCompetitorCompare);

  const open = !!competitorName && !!orgId && !!businessId;
  const [tab, setTab] = useState("detail");

  useEffect(() => {
    if (open) setTab("detail");
  }, [open, competitorName]);

  const resolveQuery = useQuery({
    queryKey: ["visibility-competitor-resolve", orgId, businessId, competitorName],
    enabled: open,
    queryFn: async () => {
      const resolved = await resolve({
        data: {
          orgId: orgId as string,
          businessId: businessId as string,
          competitorName: competitorName as string,
        },
      });
      return resolved.ok ? { ok: true as const, ref: resolved.competitor.ref } : { ok: false as const };
    },
  });

  const ref = resolveQuery.data?.ok ? resolveQuery.data.ref : null;

  const detailQuery = useQuery({
    queryKey: ["visibility-competitor-detail", orgId, businessId, ref],
    enabled: open && !!ref,
    queryFn: async () => {
      const detail = await fetchDetail({
        data: {
          orgId: orgId as string,
          businessId: businessId as string,
          competitorRef: ref as string,
        },
      });
      return detail.ok ? { ok: true as const, detail: detail.detail } : { ok: false as const };
    },
  });

  const compareQuery = useQuery({
    queryKey: ["visibility-competitor-compare", orgId, businessId, ref],
    enabled: open && !!ref && tab === "compare",
    queryFn: async () => {
      const compare = await fetchCompare({
        data: {
          orgId: orgId as string,
          businessId: businessId as string,
          competitorRef: ref as string,
        },
      });
      return compare.ok ? { ok: true as const, compare: compare.compare } : { ok: false as const };
    },
  });

  const detail: CompetitorDetailDTO | null =
    detailQuery.data && detailQuery.data.ok ? detailQuery.data.detail : null;
  const compare: CompetitorCompareDTO | null =
    compareQuery.data && compareQuery.data.ok ? compareQuery.data.compare : null;

  const detailLoading = resolveQuery.isLoading || detailQuery.isLoading || (!!ref && !detailQuery.data);
  const compareLoading =
    resolveQuery.isLoading || compareQuery.isLoading || (tab === "compare" && !!ref && !compareQuery.data);

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

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="detail" className="flex-1">
              업체 상세
            </TabsTrigger>
            <TabsTrigger value="compare" className="flex-1">
              내 업체와 비교
            </TabsTrigger>
          </TabsList>

          <TabsContent value="detail" className="mt-4">
            {detailLoading && (
              <div className="space-y-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-40" />
              </div>
            )}

            {!detailLoading && !detail && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                이 업체의 상세 정보를 지금은 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.
              </p>
            )}

            {detail && <DetailBody detail={detail} />}
          </TabsContent>

          <TabsContent value="compare" className="mt-4">
            {compareLoading && (
              <div className="space-y-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-40" />
              </div>
            )}

            {!compareLoading && !compare && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                비교 정보를 지금은 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.
              </p>
            )}

            {compare && <CompareBody compare={compare} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({ detail }: { detail: CompetitorDetailDTO }) {
  return (
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
                    <TableCell className="text-sm tabular-nums">{g.measurementCount}</TableCell>
                    <TableCell className="text-sm tabular-nums">{g.responseCount}</TableCell>
                    <TableCell className="text-sm tabular-nums">{g.mentionCount}</TableCell>
                    <TableCell className="text-sm tabular-nums">{pct(g.responseRatePct)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{pct(g.top3RatePct)}</TableCell>
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
                  {intentLabel(q.intentType)} · 등장 답변 {q.responseCount}/{q.measurementCount} ·
                  답변 비율 {pct(q.responseRatePct)} · 최고 순위{" "}
                  {q.bestPosition === null ? "–" : `${q.bestPosition}위`} · Top3 {pct(q.top3RatePct)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">이 업체가 등장한 답변에서 실제 인용된 출처</h3>
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
                    <TableCell className="text-sm tabular-nums">{pct(s.responseRatePct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        이 데이터는 반복 측정된 AI 답변에서 함께 관찰된 패턴입니다. 특정 출처나 질문이 해당 업체
        노출의 직접적인 원인임을 의미하지 않습니다.
      </p>
    </div>
  );
}

function CompareBody({ compare }: { compare: CompetitorCompareDTO }) {
  const o = compare.overview;
  const myName = compare.business.name;
  const theirName = compare.competitor.name;

  const competitorOnly = compare.questions.filter(
    (q) => q.competitorResponseCount > 0 && q.clientResponseCount === 0,
  );
  const clientOnly = compare.questions.filter(
    (q) => q.clientResponseCount > 0 && q.competitorResponseCount === 0,
  );
  const bothQuestions = compare.questions.filter((q) => q.bothResponseCount > 0);

  const sourcesBoth = compare.sources.filter((s) => s.observedIn === "both").length;
  const sourcesClientOnly = compare.sources.filter((s) => s.observedIn === "client_only").length;
  const sourcesCompetitorOnly = compare.sources.filter(
    (s) => s.observedIn === "competitor_only",
  ).length;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{COMPARE_NOTE}</p>

      <p className="text-xs text-muted-foreground">
        기준 측정: {compare.scope.runName} · {formatSeoul(compare.scope.measuredAt)} · 전체 유효 측정{" "}
        {o.validCount}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <CompareColumn
          title={myName}
          rows={[
            ["등장 답변", `${o.clientResponseCount} / ${o.validCount}`],
            ["등장 비율", pct(o.clientResponseRatePct)],
            ["Top3 답변", String(o.clientTop3ResponseCount)],
            ["Top3 비율", pct(o.clientTop3RatePct)],
          ]}
        />
        <CompareColumn
          title={theirName}
          rows={[
            ["등장 답변", `${o.competitorResponseCount} / ${o.validCount}`],
            ["등장 비율", pct(o.competitorResponseRatePct)],
            ["Top3 답변", String(o.competitorTop3ResponseCount)],
            ["Top3 비율", pct(o.competitorTop3RatePct)],
          ]}
        />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">한눈에 보는 차이</h3>
        <p className="text-xs text-muted-foreground">
          관찰된 차이이며 원인 분석이 아닙니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <DiffCard title="경쟁업체만 등장한 질문" questions={competitorOnly} />
          <DiffCard title="내 업체만 등장한 질문" questions={clientOnly} />
          <DiffCard title="함께 등장한 질문" questions={bothQuestions} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">질문군별 비교</h3>
        {compare.questionGroups.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">질문군 정보가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>질문군</TableHead>
                  <TableHead>측정</TableHead>
                  <TableHead className="min-w-[140px]">{myName}</TableHead>
                  <TableHead className="min-w-[140px]">{theirName}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.questionGroups.map((g) => (
                  <TableRow key={g.intentType}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {intentLabel(g.intentType)}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{g.measurementCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      <span className="block">
                        등장 {g.clientResponseCount} · {pct(g.clientResponseRatePct)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Top3 {g.clientTop3ResponseCount} · {pct(g.clientTop3RatePct)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      <span className="block">
                        등장 {g.competitorResponseCount} · {pct(g.competitorResponseRatePct)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Top3 {g.competitorTop3ResponseCount} · {pct(g.competitorTop3RatePct)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">질문별 비교</h3>
        {compare.questions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">질문 정보가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {compare.questions.map((q) => (
              <div key={q.questionId} className="rounded-md border p-3">
                <p className="text-sm font-medium">{q.questionText}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {intentLabel(q.intentType)} · 함께 등장 {q.bothResponseCount}회
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <QuestionMiniCard
                    name={myName}
                    responseCount={q.clientResponseCount}
                    measurementCount={q.measurementCount}
                    responseRatePct={q.clientResponseRatePct}
                    bestPosition={q.clientBestPosition}
                    top3ResponseCount={q.clientTop3ResponseCount}
                  />
                  <QuestionMiniCard
                    name={theirName}
                    responseCount={q.competitorResponseCount}
                    measurementCount={q.measurementCount}
                    responseRatePct={q.competitorResponseRatePct}
                    bestPosition={q.competitorBestPosition}
                    top3ResponseCount={q.competitorTop3ResponseCount}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">업체별로 연결된 출처</h3>
        <p className="text-xs text-muted-foreground">
          AI 답변 안에서 각 업체 설명에 직접 붙어 있던 출처입니다. <strong>직접 연결</strong>은 업체를
          설명하는 문장·행에 인용이 붙은 경우로 가장 강한 근거이고, <strong>관련 구간</strong>은 같은
          업체 설명 구간 안에서 인용된 경우입니다.
        </p>
        {compare.attributedSources.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            업체에 직접 연결된 출처가 아직 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>도메인</TableHead>
                  <TableHead className="min-w-[140px]">{myName}</TableHead>
                  <TableHead className="min-w-[140px]">{theirName}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.attributedSources.map((s) => (
                  <TableRow key={s.domain}>
                    <TableCell className="text-sm">
                      {s.domain}
                      {s.sampleTitle && (
                        <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-foreground">
                          {s.sampleTitle}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      <AttributedCell
                        direct={s.clientDirectResponseCount}
                        section={s.clientSectionResponseCount}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      <AttributedCell
                        direct={s.competitorDirectResponseCount}
                        section={s.competitorSectionResponseCount}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          답변에서 함께 인용된 출처 (참고)
        </summary>
        <section className="space-y-2 pt-3">
          <p className="text-xs text-muted-foreground">
            각 업체가 등장한 AI 답변에서 함께 인용된 출처를 비교합니다. 해당 웹페이지가 그 업체를
            직접 언급하거나 소개했다는 뜻은 아닙니다.
          </p>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="양쪽 업체 등장 답변에서 인용" value={String(sourcesBoth)} />
          <Metric label="내 업체 등장 답변에서만 인용" value={String(sourcesClientOnly)} />
          <Metric label="경쟁업체 등장 답변에서만 인용" value={String(sourcesCompetitorOnly)} />
        </div>
        {compare.sources.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">인용 출처 정보가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-2 text-xs text-muted-foreground">
              답변 = 해당 업체가 등장하면서 이 도메인이 함께 인용된 AI 답변 수 / 인용 = 그 답변들에
              기록된 실제 citation 수 / 비율 = 해당 업체 등장 답변 중 이 도메인이 함께 인용된 비율
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>도메인</TableHead>
                  <TableHead>함께 인용된 범위</TableHead>
                  <TableHead className="min-w-[120px]">{myName}</TableHead>
                  <TableHead className="min-w-[120px]">{theirName}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.sources.map((s) => (
                  <TableRow key={s.domain}>
                    <TableCell className="text-sm">
                      {s.domain}
                      {s.sampleTitle && (
                        <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-foreground">
                          {s.sampleTitle}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <Badge variant="secondary">{OBSERVED_IN_LABELS[s.observedIn]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      <SourceCell
                        responseCount={s.clientResponseCount}
                        citationCount={s.clientCitationCount}
                        responseRatePct={s.clientResponseRatePct}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      <SourceCell
                        responseCount={s.competitorResponseCount}
                        citationCount={s.competitorCitationCount}
                        responseRatePct={s.competitorResponseRatePct}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        </section>
      </details>
    </div>
  );
}

function AttributedCell({ direct, section }: { direct: number; section: number }) {
  if (direct === 0 && section === 0) {
    return <span className="text-xs text-muted-foreground">연결 없음</span>;
  }
  return (
    <div className="space-y-0.5">
      {direct > 0 && <div className="text-sm font-medium">직접 연결 {direct}답변</div>}
      {section > 0 && (
        <div className="text-xs text-muted-foreground">관련 구간 {section}답변</div>
      )}
    </div>
  );
}


function DiffCard({
  title,
  questions,
}: {
  title: string;
  questions: CompetitorCompareDTO["questions"];
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{questions.length}</p>
      {questions.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">없음</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {questions.slice(0, 2).map((q) => (
            <li key={q.questionId} className="truncate text-xs text-muted-foreground">
              {q.questionText}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionMiniCard({
  name,
  responseCount,
  measurementCount,
  responseRatePct,
  bestPosition,
  top3ResponseCount,
}: {
  name: string;
  responseCount: number;
  measurementCount: number;
  responseRatePct: number | null;
  bestPosition: number | null;
  top3ResponseCount: number;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 p-2">
      <p className="truncate text-xs font-medium">{name}</p>
      <p className="mt-1 text-xs tabular-nums">
        등장 {responseCount}/{measurementCount} ({pct(responseRatePct)})
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        최고 {bestPosition === null ? "–" : `${bestPosition}위`}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        Top3 {top3ResponseCount}/{measurementCount}
      </p>
    </div>
  );
}

function SourceCell({
  responseCount,
  citationCount,
  responseRatePct,
}: {
  responseCount: number;
  citationCount: number;
  responseRatePct: number | null;
}) {
  if (responseCount === 0 && citationCount === 0) {
    return <span className="text-muted-foreground">–</span>;
  }
  return (
    <>
      <span className="block">
        답변 {responseCount} · 인용 {citationCount}
      </span>
      <span className="block text-xs text-muted-foreground">비율 {pct(responseRatePct)}</span>
    </>
  );
}

function CompareColumn({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <p className="truncate text-base font-semibold">{title}</p>
      <div className="mt-2 space-y-1">
        {rows.map(([label, value]) => (
          <p key={label} className="text-sm tabular-nums">
            <span className="text-muted-foreground">{label}</span>{" "}
            <span className="font-semibold">{value}</span>
          </p>
        ))}
      </div>
    </div>
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
