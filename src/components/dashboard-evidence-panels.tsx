import { useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidencePopup, QuestionMatrix } from "@/components/diagnostic-layout";
import type { EntityFactsV2ReadBroadSearchObservationDTO, EntityFactsV2ReadQuestionAreaDTO, EntityFactsV2ReadQuestionLocationDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { BenchmarkSourceGroupDTO, VisibilityBenchmarkDTO } from "@/lib/visibility-benchmark.types";

export function QuestionScopeEvidence({ questions, locations, enabled }: {questions: readonly EntityFactsV2ReadQuestionAreaDTO[]; locations: readonly EntityFactsV2ReadQuestionLocationDTO[]; enabled: boolean}) {
  return <QuestionMatrix questions={questions} locations={locations} enabled={enabled} scopes={null} headline="실제 질문별 등장 결과" />;
}

export function BroadCompetitorEvidence({ observation, printExpanded = false }: { observation: EntityFactsV2ReadBroadSearchObservationDTO; printExpanded?: boolean }) {
  const [selection, setSelection] = useState<"single" | "repeated">(() => observation.singleObservationCompetitors.length > 0 ? "single" : "repeated");
  const [expanded, setExpanded] = useState(false);
  const groups = [{key:"single" as const, label:"한 번 등장", heading:"넓은 범위 검색에서 추가로 한 번 확인된 업체", rows:observation.singleObservationCompetitors}, {key:"repeated" as const, label:"두 번 이상 등장", heading:"넓은 범위 검색에서 두 번 이상 확인된 업체", rows:observation.repeatedCompetitors}];
  return <section className="diagnostic-business-view" aria-label="넓은 범위 검색 업체 분류">
    <h2>넓은 지역 검색에 나온 다른 업체</h2><p className="diagnostic-state-note">이번 측정 · 넓은 지역 질문의 유효 AI 답변 {observation.validCount}개</p>
    <div className="diagnostic-choices no-print">{groups.map(group => <Button key={group.key} variant="ghost" className="broad-choice" aria-pressed={selection === group.key} onClick={() => { setSelection(group.key); setExpanded(false); }}><span><small>{group.label}</small><strong>{group.rows.length}곳</strong></span>{selection === group.key ? <Check aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>}</Button>)}</div>
    {groups.map(group => <div key={group.key} className={!printExpanded && selection !== group.key ? "broad-evidence-list hidden space-y-3 print:block" : "broad-evidence-list space-y-3"} data-classification={group.key}>
      <h3>{group.heading} <span>{group.rows.length}곳</span></h3><div className="diagnostic-business-grid">
        {group.rows.length === 0 && <p>이 분류에서 확인된 업체가 없습니다.</p>}
        {group.rows.map((row,index) => <article key={row.name} className={`diagnostic-business-card${!expanded && !printExpanded && index >= 6 ? " diagnostic-extra-row" : ""}`}><div><h4>{row.name}</h4>{row.top3ResponseCount > 0 && <span className="diagnostic-top3-badge">상위 3곳 {row.top3ResponseCount}회</span>}</div><p>{row.strongestIndependentSource ? `독립 웹 ${row.strongestIndependentSource.domain} · ${row.strongestIndependentSource.responseCount}개 답변` : "독립 웹 출처 미확인"}</p><p className="diagnostic-state-note">{row.responseCount}/{observation.validCount} 답변 · 검색 상황 {row.intentCount}종</p></article>)}
      </div>{group.rows.length > 6 && <Button variant="outline" className="no-print" onClick={() => setExpanded(!expanded)}>{expanded ? "접기" : `나머지 업체 보기 (${group.rows.length}곳)`}</Button>}
    </div>)}<p className="diagnostic-state-note">저장된 업체와 독립 출처의 관찰 근거이며 추천 원인을 뜻하지 않습니다. 한 번의 등장은 반복 패턴이 아닌 추가 관찰입니다.</p>
  </section>;
}

export function BenchmarkSourceEvidence({ benchmark, printExpanded = false }: { benchmark: VisibilityBenchmarkDTO; printExpanded?: boolean }) {
  const [selected, setSelected] = useState<BenchmarkSourceGroupDTO | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  return <section className="diagnostic-source-view" aria-label="시장 표본 출처 상세"><h2>자주 등장한 업체의 출처</h2><p className="diagnostic-source-description">최근 {benchmark.windowDays}일 · 자동차 업체 {benchmark.highVisibilityEntityCount}곳 (비교 대상 {benchmark.eligibleTargetBusinessCount ?? "확인 불가"}곳)</p>
    <div className="diagnostic-source-table"><div className="diagnostic-source-head"><span>출처 유형</span><span>해당 출처와 함께 보인 업체 비율</span><span>내 업체 직접 연결</span></div>{benchmark.sourceGroups.map(group => <div key={group.key}>
      <Button variant="ghost" className="diagnostic-source-row" onClick={event => { focus.current = event.currentTarget; setSelected(group); }} aria-label={`${group.label}: ${group.highEntitySharePct === null ? "미집계" : `${group.highEntitySharePct}%`}, 출처 예시 보기`}><strong>{group.label}</strong><span className="diagnostic-source-metric">{group.highEntitySharePct !== null && <span className="diagnostic-source-track" role="progressbar" aria-label={group.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={group.highEntitySharePct}><span style={{width:`${group.highEntitySharePct}%`}} /></span>}<b>{group.highEntitySharePct === null ? "미집계" : `${group.highEntitySharePct.toFixed(1)}%`}</b><small>{group.highEntityCount} / {benchmark.highVisibilityEntityCount}곳</small></span><span className="diagnostic-connection" data-connected={group.targetConnected}>{group.targetConnected ? "연결 확인" : "미확인"}</span><ChevronRight aria-hidden="true"/></Button>
      <div className={printExpanded ? "diagnostic-source-examples" : "diagnostic-source-examples diagnostic-print-only"}><ul>{group.sites.map((site,index) => <li key={`${site.label}:${index}`}>{site.label}{site.domain ? ` (${site.domain})` : ""}</li>)}</ul></div>
    </div>)}</div><p className="diagnostic-state-note">시장 표본과 내 업체의 이번 측정은 별도입니다. 한 업체가 여러 출처 그룹에 포함될 수 있습니다. 비율의 합은 확률이 아니며 인과관계를 뜻하지 않습니다.</p>
    <EvidencePopup title={selected?.label ?? "출처 예시"} description="시장 표본에서 관찰된 출처 예시입니다. 내 업체의 직접 연결 여부는 이번 측정 기준입니다." open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }} returnFocus={focus.current}><ul>{selected?.sites.map((site,index) => <li key={`${site.label}:${index}`}>{site.label}{site.domain ? ` (${site.domain})` : ""}</li>)}</ul>{selected?.sites.length === 0 && <p>이 분류의 개별 출처 정보가 없습니다.</p>}</EvidencePopup>
  </section>;
}
