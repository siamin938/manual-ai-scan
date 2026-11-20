import { useState } from "react";
import { Check, MessageSquare, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EntityFactsV2ReadBroadSearchObservationDTO, EntityFactsV2ReadQuestionAreaDTO, EntityFactsV2ReadQuestionLocationDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { VisibilityBenchmarkDTO } from "@/lib/visibility-benchmark.types";
import { searchContextQuestionEvidenceLabel } from "@/lib/search-context-question-evidence";

export function QuestionScopeEvidence({ questions, locations, enabled }: {
  questions: readonly EntityFactsV2ReadQuestionAreaDTO[];
  locations: readonly EntityFactsV2ReadQuestionLocationDTO[];
  enabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!enabled) return <p className="text-base text-muted-foreground">이 측정은 실제 질문의 검색 범위를 구분할 자료가 없습니다.</p>;
  const locationById = new Map(locations.map((row) => [row.questionId, row]));
  const current = questions.find((row) => row.questionId === selected);
  return <section className="space-y-5" aria-label="실제 질문별 등장 결과">
    {[true, false].map((broad) => <div key={String(broad)}>
      <h3 className="mb-3 text-lg font-semibold">{broad ? "넓은 지역" : "조건을 좁힌 질문"}</h3>
      <div className="flex flex-wrap gap-2">{questions.filter((q) => {
        const location = locationById.get(q.questionId);
        return location && (location.city === null) === broad;
      }).map((q, i) => <Button key={q.questionId} variant="outline" className="question-mark h-auto min-h-11 gap-2 whitespace-normal" aria-pressed={selected === q.questionId} onClick={() => setSelected(selected === q.questionId ? null : q.questionId)} aria-label={`${q.questionText}: ${searchContextQuestionEvidenceLabel(q)}`}>
        <MessageSquare className="size-4 shrink-0" aria-hidden="true" /><span>{i + 1}</span><span className="text-sm">{searchContextQuestionEvidenceLabel(q)}</span>
      </Button>)}</div>
    </div>)}
    {current && <div className="border-l-4 border-primary bg-muted p-4" role="status"><p className="text-base font-semibold">{current.questionText}</p><p className="mt-2 text-base">{searchContextQuestionEvidenceLabel(current)}</p><p className="mt-2 text-sm text-muted-foreground">확정 등장 {current.confirmedMentionCount}/{current.validCount} 답변. 추가 확인 {current.unresolvedTargetCount}개.</p></div>}
  </section>;
}

export function BroadCompetitorEvidence({ observation, printExpanded = false }: { observation: EntityFactsV2ReadBroadSearchObservationDTO; printExpanded?: boolean }) {
  const [selection, setSelection] = useState<"single" | "repeated">(() => observation.singleObservationCompetitors.length > 0 ? "single" : "repeated");
  const groups = [{key:"single" as const, label:"한 번 등장", heading:"넓은 범위 검색에서 추가로 한 번 확인된 업체", rows:observation.singleObservationCompetitors}, {key:"repeated" as const, label:"두 번 이상", heading:"넓은 범위 검색에서 두 번 이상 확인된 업체", rows:observation.repeatedCompetitors}];
  return <section className="space-y-5 border-t pt-6" aria-label="넓은 범위 검색 업체 분류">
    <h3 className="text-xl font-bold">넓은 지역 검색에 나온 다른 업체</h3>
    <p className="text-base text-muted-foreground">이번 넓은 검색의 유효 답변 {observation.validCount}개 기준입니다. 한 번의 등장은 반복 패턴이 아닌 추가 관찰입니다.</p>
    <div className="no-print grid grid-cols-2 gap-3">{groups.map((group) => <Button key={group.key} variant="ghost" className="broad-choice h-auto min-h-20 whitespace-normal" aria-pressed={selection === group.key} onClick={() => setSelection(group.key)}>
      <span className="min-w-0 text-base">{group.label} <strong>{group.rows.length}곳</strong></span>{selection === group.key && <Check className="size-5 shrink-0" aria-hidden="true" />}
    </Button>)}</div>
    {groups.map((group) => <div key={group.key} className={!printExpanded && selection !== group.key ? "broad-evidence-list hidden space-y-3 print:block" : "broad-evidence-list space-y-3"} data-classification={group.key}>
      <h4 className="text-lg font-semibold">{group.heading} <span className="tabular-nums">{group.rows.length}곳</span></h4>
      {group.rows.length === 0 ? <p className="text-base text-muted-foreground">이 분류에서 확인된 업체가 없습니다.</p> : group.rows.map((row) => <details key={row.name} className="rounded-lg border p-4" open={printExpanded}>
        <summary className="grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><span className="min-w-0 break-words text-base font-semibold">{row.name}</span><span className="shrink-0 tabular-nums">{row.responseCount}/{observation.validCount} 답변</span></summary>
        <p className="mt-3 text-base">상위 3곳에서 {row.top3ResponseCount}회 관찰. 검색 상황 {row.intentCount}종.</p>
        <p className="mt-2 text-base text-muted-foreground">{row.strongestIndependentSource ? `함께 확인된 독립 웹 출처 ${row.strongestIndependentSource.domain}: ${row.strongestIndependentSource.responseCount}개 답변` : "함께 확인된 독립 웹 출처 없음"}</p>
      </details>)}
    </div>)}
    <p className="text-base text-muted-foreground">저장된 업체와 독립 출처의 관찰 근거이며 추천 원인을 뜻하지 않습니다.</p>
  </section>;
}

export function BenchmarkSourceEvidence({ benchmark, printExpanded = false }: { benchmark: VisibilityBenchmarkDTO; printExpanded?: boolean }) {
  return <section className="space-y-5" aria-label="시장 표본 출처 상세">
    <p className="text-base leading-7">시장 표본: 최근 {benchmark.windowDays}일, 비교 대상 {benchmark.eligibleTargetBusinessCount ?? "확인 불가"}곳 중 자주 관찰된 업체 {benchmark.highVisibilityEntityCount}곳. 내 업체 연결 여부는 현재 업체의 별도 측정 결과입니다.</p>
    {benchmark.sourceGroups.map((group) => <details key={group.key} className="rounded-lg border p-4" open={printExpanded}>
      <summary className="cursor-pointer"><div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><span className="min-w-0 text-base font-semibold">{group.label}</span><span className="shrink-0 text-lg font-bold tabular-nums">{group.highEntitySharePct === null ? "미집계" : `${group.highEntitySharePct.toFixed(1)}%`}</span></div>
        {group.highEntitySharePct !== null && <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={group.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={group.highEntitySharePct}><div className="h-full bg-primary" style={{width:`${group.highEntitySharePct}%`}} /></div>}
        <p className="mt-3 text-base text-muted-foreground">관찰 업체 {group.highEntityCount}/{benchmark.highVisibilityEntityCount}곳</p>
      </summary>
      <p className="mt-4 text-base font-medium">{group.targetConnected ? "내 업체 연결 관찰 확인" : "내 업체 연결 관찰 미확인"}</p>
      <ul className="mt-2 space-y-2">{group.sites.map((site,i) => <li key={`${site.label}:${i}`} className="text-base">{site.label}{site.domain ? ` (${site.domain})` : ""}</li>)}</ul>
      {group.sites.length === 0 && <p className="text-base text-muted-foreground">이 분류의 개별 출처 정보가 없습니다.</p>}
    </details>)}
    <p className="text-base text-muted-foreground">한 업체가 여러 출처 그룹에 겹쳐 포함될 수 있습니다. 비율의 합은 확률이 아니며 인과관계를 뜻하지 않습니다.</p>
  </section>;
}
