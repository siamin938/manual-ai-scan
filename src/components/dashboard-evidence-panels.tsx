import { useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidencePopup, QuestionMatrix } from "@/components/diagnostic-layout";
import type { EntityFactsV2ReadBroadSearchObservationDTO, EntityFactsV2ReadQuestionAreaDTO, EntityFactsV2ReadQuestionLocationDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { BenchmarkSourceGroupDTO, VisibilityBenchmarkDTO } from "@/lib/visibility-benchmark.types";

export function isCompetitorInitiallyVisible(classification: "single" | "repeated", index: number): boolean {
  return classification === "repeated" || index < 8;
}

export function benchmarkShareText(share: number | null): string {
  return share === null ? "집계 전" : `${share.toFixed(1)}%`;
}

function sourceDisplayLabel(group: BenchmarkSourceGroupDTO): string {
  const labels: Record<string, string> = {
    profile_directory: "업체 프로필·등록 채널",
    business_brand_site: "업체·브랜드 홈페이지",
    community: "자동차 커뮤니티",
    news: "언론 보도",
  };
  return labels[group.key] ?? group.label;
}

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
        {group.rows.map((row,index) => <article key={row.name} className={`diagnostic-business-card${!expanded && !printExpanded && !isCompetitorInitiallyVisible(group.key, index) ? " diagnostic-extra-row" : ""}`}><div><h4>{row.name}</h4>{row.top3ResponseCount > 0 && <span className="diagnostic-top3-badge">{group.key === "single" ? "상위 3곳" : `상위 3곳 ${row.top3ResponseCount}회`}</span>}</div><p className="diagnostic-business-count">{observation.validCount}개 답변 중 <strong>{row.responseCount}회 등장</strong></p><p>{row.strongestIndependentSource ? `독립 웹 ${row.strongestIndependentSource.domain} · ${row.strongestIndependentSource.responseCount}개 답변` : "독립 웹 출처 미확인"}</p><p className="diagnostic-state-note">검색 상황 {row.intentCount}종에서 관찰</p></article>)}
      </div>{group.key === "single" && group.rows.length > 8 && <Button variant="outline" className="no-print" onClick={() => setExpanded(!expanded)}>{expanded ? "접기" : `나머지 업체 보기 (${group.rows.length}곳)`}</Button>}
    </div>)}<p className="diagnostic-state-note">저장된 업체와 독립 출처의 관찰 근거이며 추천 원인을 뜻하지 않습니다. 한 번의 등장은 반복 패턴이 아닌 추가 관찰입니다.</p>
  </section>;
}

export function BenchmarkSourceEvidence({ benchmark, printExpanded = false }: { benchmark: VisibilityBenchmarkDTO; printExpanded?: boolean }) {
  const [selected, setSelected] = useState<BenchmarkSourceGroupDTO | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  return <section className="diagnostic-source-view" aria-label="시장 표본 출처 상세"><h2>자주 등장한 업체의 출처</h2><p className="diagnostic-source-description">최근 {benchmark.windowDays}일 동안 AI에 자주 등장한 자동차 업체 {benchmark.highVisibilityEntityCount}곳</p>
    <div className="diagnostic-source-table"><div className="diagnostic-source-head"><span>출처 유형</span><span>해당 출처와 함께 보인 업체 비율</span><span>내 업체 직접 연결</span></div>{benchmark.sourceGroups.map(group => <div key={group.key}>
      <Button variant="ghost" className="diagnostic-source-row" onClick={event => { focus.current = event.currentTarget; setSelected(group); }} aria-label={`${sourceDisplayLabel(group)}: ${benchmarkShareText(group.highEntitySharePct)}, 출처 예시 보기`}><strong>{sourceDisplayLabel(group)}</strong><span className="diagnostic-source-metric">{group.highEntitySharePct !== null && <span className="diagnostic-source-track" role="progressbar" aria-label={sourceDisplayLabel(group)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={group.highEntitySharePct}><span style={{width:`${group.highEntitySharePct}%`}} /></span>}<b>{benchmarkShareText(group.highEntitySharePct)}</b><small>시장 업체 {group.highEntityCount} / {benchmark.highVisibilityEntityCount}곳</small></span><span className="diagnostic-connection" data-connected={group.targetConnected}>내 업체 {group.targetConnected ? "연결 확인" : "연결 미확인"}</span><ChevronRight aria-hidden="true"/></Button>
      <div className={printExpanded ? "diagnostic-source-examples" : "diagnostic-source-examples diagnostic-print-only"}><ul>{group.sites.map((site,index) => <li key={`${site.label}:${index}`}>{site.label}{site.domain ? ` (${site.domain})` : ""}</li>)}</ul></div>
    </div>)}</div><p className="diagnostic-state-note">시장 표본과 내 업체의 이번 측정은 별도입니다. 한 업체가 여러 출처 그룹에 포함될 수 있습니다. 비율의 합은 확률이 아니며 인과관계를 뜻하지 않습니다.</p>
    <details><summary>시장 표본 상세 근거</summary><p>진단 고객 기준 대상 업체 {benchmark.eligibleTargetBusinessCount ?? "확인 불가"}곳. 출처 비율의 분모는 이 대상 수가 아니라 AI에 자주 등장한 자동차 업체 {benchmark.highVisibilityEntityCount}곳입니다.</p></details>
    <EvidencePopup title={selected ? sourceDisplayLabel(selected) : "출처 예시"} description="시장 표본에서 관찰된 출처 예시입니다. 내 업체의 직접 연결 여부는 이번 측정 기준입니다." open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }} returnFocus={focus.current}>
      {selected && <><section><h3 className="font-semibold">시장 표본에서 함께 관찰된 업체</h3><p>이 출처와 함께 관찰된 {selected.highEntityCount} / {benchmark.highVisibilityEntityCount}곳 · {benchmarkShareText(selected.highEntitySharePct)}</p></section><section><h3 className="font-semibold">실제 출처 예시</h3><ul>{selected.sites.map((site,index) => <li key={`${site.label}:${index}`}>{site.label}{site.domain ? ` (${site.domain})` : ""}</li>)}</ul>{selected.sites.length === 0 && <p>이 분류의 개별 출처 정보가 없습니다.</p>}</section><section><h3 className="font-semibold">내 업체의 이번 측정</h3><p>{selected.targetConnected ? "내 업체 직접 연결 확인" : "내 업체 직접 연결 미확인"}</p></section></>}
      <Button variant="outline" onClick={() => setSelected(null)}>닫기</Button>
    </EvidencePopup>
  </section>;
}
