import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { CalendarDays, Check, ChevronRight, ClipboardCheck, Link2, MessageSquare, ShieldCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidencePopup } from "@/components/diagnostic-layout";
import { buildSearchContextQuestionEvidence } from "@/lib/search-context-question-evidence";
import { QuestionResults } from "@/components/diagnostic-question-results";
import type { PriorityEvidence } from "@/components/diagnostic-priority-evidence";
import { INTENT_LABELS } from "@/lib/question-suggestions";
import { formatSeoul } from "@/lib/format";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { EntityFactsV2DashboardCutoverModel } from "@/lib/entity-facts-v2-read-gateway.dashboard-cutover";
import type { EntityFactsV2DashboardSummaryViewModel } from "@/lib/entity-facts-v2-dashboard-summary.viewmodel";
import type { EntityFactsV2ComparisonViewModel } from "@/lib/entity-facts-v2-comparison.viewmodel";

export const evidenceTopics = ["questions", "businesses", "sources", "comparison", "priorities", "method"] as const;
export type EvidenceTopic = typeof evidenceTopics[number];
export function isEvidenceTopic(value: string): value is EvidenceTopic { return evidenceTopics.some(topic => topic === value); }
const labels: Record<EvidenceTopic, string> = { questions: "질문별 노출", businesses: "함께 나온 업체", sources: "인용 출처", comparison: "지난 측정", priorities: "먼저 확인할 일", method: "측정 기준" };
const icons = { questions: MessageSquare, businesses: Store, sources: Link2, comparison: CalendarDays, priorities: ClipboardCheck, method: ShieldCheck };
const ArchiveContext = createContext<{ topic: EvidenceTopic | null; print: boolean }>({ topic: null, print: false });

// Original reports mount only on an explicit source request or for complete printing.
export function EvidenceArchive({ topic, children }: { topic: EvidenceTopic; children: ReactNode }) {
  const context = useContext(ArchiveContext);
  return context.print || context.topic === topic ? <section className="evidence-archive">{children}</section> : null;
}

export function EvidenceBar({ confirmed, valid, label }: { confirmed: number; valid: number; label: string }) {
  if (valid <= 0) return <span className="evidence-empty">유효 응답 없음</span>;
  return <div className="evidence-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={valid} aria-valuenow={confirmed}><span style={{ width: `${Math.min(100, Math.max(0, confirmed / valid * 100))}%` }} /></div>;
}

export function sourceCardMetrics(model: Pick<EntityFactsV2DashboardCutoverModel, "verifiedTargetCitationPages" | "sources">) {
  return {
    pages: model.verifiedTargetCitationPages.status === "complete" && model.verifiedTargetCitationPages.available ? model.verifiedTargetCitationPages.rows.length : null,
    pageState: model.verifiedTargetCitationPages.status === "pending" ? "확인 중" : model.verifiedTargetCitationPages.status === "not_verified" ? "미검증" : "미수집",
    direct: model.sources.available ? model.sources.rows.filter(row => row.evidence !== "clue" && row.targetResponseCount > 0).length : null,
  };
}
function koreanIntent(intent: string) { return INTENT_LABELS[intent as keyof typeof INTENT_LABELS] ?? "기타"; }
export function DiagnosticEvidenceWorkspace({ dto, model, summary, comparison, comparisonError, printExpanded, entryTopic, entryVersion, children, priority = null }: {
  dto: EntityFactsV2ReadGatewayDTO; model: EntityFactsV2DashboardCutoverModel; summary: EntityFactsV2DashboardSummaryViewModel | null;
  comparison: EntityFactsV2ComparisonViewModel | null; comparisonError: boolean; printExpanded: boolean;
  entryTopic: string; entryVersion: number; children: ReactNode; priority?: PriorityEvidence | null;
}) {
  const [topic, setTopic] = useState<EvidenceTopic>("questions");
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState(false);
  const [criteria, setCriteria] = useState(false);
  const [questions, setQuestions] = useState<string | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (entryVersion > 0 && isEvidenceTopic(entryTopic)) { setTopic(entryTopic); setExpanded(true); }
  }, [entryTopic, entryVersion]);
  useEffect(() => {
    const enter = () => {
      const key = window.location.hash.replace("#diagnostic-", "");
      if (isEvidenceTopic(key)) { setTopic(key); setExpanded(true); requestAnimationFrame(() => root.current?.scrollIntoView({ block: "start" })); }
    };
    enter(); window.addEventListener("hashchange", enter); return () => window.removeEventListener("hashchange", enter);
  }, []);
  const metric = model.metricCards.visibility;
  const verified = model.verifiedTargetCitationPages;
  const sourceMetrics = sourceCardMetrics(model);
  const pageState = verified.status === "complete" ? `${verified.rows.length}개 확인` : verified.status === "pending" ? "확인 중" : verified.status === "not_verified" ? "미검증" : "미수집";
  const values: Record<EvidenceTopic, string> = {
    questions: metric.validCount > 0 ? `확정 ${metric.confirmedCount} / 유효 ${metric.validCount}개` : "유효 응답 없음",
    businesses: `${model.competitors.rows.length}곳 관찰`, sources: pageState,
    comparison: comparisonError ? "조회 실패" : comparison?.comparisonAvailable ? "동일 조건 비교" : "비교 자료 없음",
    priorities: summary?.opportunities.length ? `${summary.opportunities.length}개 확인 대상` : "우선 대상 미확정",
    method: `유효 응답 ${model.recentSummary.validCount}개`,
  };
  const openRaw = (event: MouseEvent<HTMLButtonElement>) => { focus.current = event.currentTarget; setCriteria(false); setRaw(true); };
  const sourceLists = [
    { label: "페이지 내용 확인", state: pageState, rows: verified.rows },
    { label: "AI 답변에서 직접 연결", state: model.sources.available ? `${model.sources.rows.filter(r => r.evidence !== "clue" && r.targetResponseCount > 0).length}개` : "미수집", rows: model.sources.rows.filter(r => r.evidence !== "clue" && r.targetResponseCount > 0) },
    { label: "근접 단서", state: dto.targetReferenceSources ? `${model.targetReferenceSources.rows.length}개` : "미수집", rows: model.targetReferenceSources.rows },
    { label: "업체가 나온 답변에 함께 인용 · 참고", state: model.targetExposureCitationSources.available ? `${model.targetExposureCitationSources.rows.length}개` : "미수집", rows: model.targetExposureCitationSources.rows },
  ];
  const hasRawEvidence = topic === "comparison" ? !!comparison?.comparisonAvailable : topic === "priorities" ? !!priority || !!summary?.opportunities.length : topic === "questions" ? dto.questionAreas.length > 0 : true;
  const sourceDetails = [...sourceLists,
    { label: "타업체 연결 출처", state: model.sources.available ? `${model.sources.rows.filter(r => r.evidence !== "clue" && r.targetResponseCount === 0 && r.competitorResponseCount > 0).length}개` : "미수집", rows: model.sources.rows.filter(r => r.evidence !== "clue" && r.targetResponseCount === 0 && r.competitorResponseCount > 0) },
    { label: "추가 연결 단서", state: model.sources.available ? `${model.sources.rows.filter(r => r.evidence === "clue").length}개` : "미수집", rows: model.sources.rows.filter(r => r.evidence === "clue") },
    { label: "측정 전체 인용 도메인", state: dto.citationSources ? `${model.citationSources.rows.length}개` : "미수집", rows: model.citationSources.rows },
  ];
  const questionEvidence = buildSearchContextQuestionEvidence(dto.questionGroups, dto.questionAreas);
  const popupQuestions = questions === "all" ? dto.questionAreas : questionEvidence.find(group => group.intentType === questions)?.questions;
  return <details ref={root} className="diagnostic-additional evidence-workspace" open={expanded || printExpanded} onToggle={event => { if (!printExpanded) setExpanded(event.currentTarget.open); }}>
    <summary>추가 분석/근거 보기</summary>
    <div className="evidence-picker no-print" aria-label="추가 근거 주제">{evidenceTopics.map(key => {
      const Icon = icons[key]; return <Button key={key} id={`diagnostic-${key}`} variant="outline" className="evidence-choice" aria-pressed={topic === key} aria-controls="diagnostic-evidence-panel" onClick={() => { setTopic(key); setQuestions(null); }}>
        <span className="evidence-choice-heading"><Icon aria-hidden="true" /><strong>{labels[key]}</strong>{topic === key && <Check aria-hidden="true" />}</span>
        {key === "sources" ? <span className="evidence-card-source-metrics"><span><small>관련 페이지</small><strong>{sourceMetrics.pages === null ? sourceMetrics.pageState : `${sourceMetrics.pages}개`}</strong></span><span><small>답변 내 직접 연결</small><strong>{sourceMetrics.direct === null ? "미수집" : `${sourceMetrics.direct}개`}</strong></span></span> : key === "questions" && metric.validCount > 0 ? <span><strong className="evidence-card-number">{metric.confirmedCount} / {metric.validCount}</strong><small> 업체 등장 / 유효 답변</small></span> : key === "businesses" ? <span><strong className="evidence-card-number">{model.competitors.rows.length}곳</strong><small> 관찰</small></span> : key === "method" ? <span><strong className="evidence-card-number">{model.recentSummary.validCount}개</strong><small> 유효 응답</small></span> : <span>{values[key]}</span>}
        {key === "questions" && <EvidenceBar confirmed={metric.confirmedCount} valid={metric.validCount} label="유효 응답 중 확정 등장" />}
        {key === "method" && <EvidenceBar confirmed={dto.scope.completedJobs} valid={dto.scope.totalJobs} label="전체 작업 중 응답 완료" />}
      </Button>;
    })}</div>
    <section id="diagnostic-evidence-panel" className="evidence-panel" aria-label={labels[topic]}>
      <h2>{labels[topic]}</h2>
      {topic === "questions" && <><p>업체가 등장한 답변 / 유효 답변</p><div className="evidence-question-groups">{model.questionGroups.map(group => <Button key={group.intentType} variant="ghost" className="evidence-group" onClick={event => { focus.current = event.currentTarget; setQuestions(group.intentType); }}><span><strong>{koreanIntent(group.intentType)}</strong><span>{group.confirmedMentionCount} / {group.validCount}{group.unresolvedTargetCount > 0 && ` · 추가 확인 ${group.unresolvedTargetCount}`}</span></span><EvidenceBar confirmed={group.confirmedMentionCount} valid={group.validCount} label={`${koreanIntent(group.intentType)} 업체 등장 / 유효 답변`} /><ChevronRight aria-hidden="true" /></Button>)}</div>{model.questionGroups.length === 0 && <p>저장된 질문 그룹이 없습니다.</p>}<Button variant="outline" onClick={event => { focus.current = event.currentTarget; setQuestions("all"); }}>질문 원문 {dto.questionAreas.length}개</Button></>}
      {topic === "businesses" && <><p>이번 측정 전체에서 확인된 업체입니다. 넓은 지역 분류와는 별개입니다.</p><ol className="evidence-short-list">{model.competitors.rows.slice(0, 5).map(row => <li key={row.name}><strong>{row.name}</strong><span>등장 {row.responseCount}회 · 상위 3곳 {row.top3ResponseCount}회</span><EvidenceBar confirmed={row.responseCount} valid={model.recentSummary.validCount} label={`${row.name} 등장 횟수`} /></li>)}</ol>{model.competitors.rows.length === 0 && <p>확인된 다른 업체가 없습니다.</p>}{dto.broadSearchObservation ? <p>넓은 지역: 한 번 {dto.broadSearchObservation.singleObservationCompetitors.length}곳 · 두 번 이상 {dto.broadSearchObservation.repeatedCompetitors.length}곳</p> : <p>넓은 지역 분류 자료는 없습니다.</p>}</>}
      {topic === "sources" && <><p>이번 업체의 출처 근거입니다. 시장 표본과 합산하지 않습니다.</p><div className="evidence-source-states">{sourceLists.map((list, index) => { const Icon = index === 0 ? ShieldCheck : Link2; return <div key={list.label}><Icon aria-hidden="true"/><strong>{list.label}</strong><span>{list.state}</span><ul>{list.rows.slice(0, 2).map((row, i) => <li key={`${row.domain}:${i}`}>{"sampleUrl" in row ? <a href={row.sampleUrl} target="_blank" rel="noopener noreferrer">{row.domain}</a> : row.domain}</li>)}</ul></div>; })}</div></>}
      {topic === "comparison" && (comparisonError ? <p>이전 측정 비교 정보를 불러오지 못했습니다.</p> : comparison?.comparisonAvailable && comparison.visibility ? <><p>같은 질문과 측정 조건이 확인된 결과입니다.</p><div className="evidence-comparison"><span>이전<strong>{comparison.visibility.previousValueText}</strong></span><ChevronRight aria-hidden="true"/><span>이번<strong>{comparison.visibility.currentValueText}</strong></span></div><p>변화 {comparison.visibility.deltaText ?? "확인 불가"}</p></> : <p>{comparison?.description ?? "같은 조건으로 비교할 이전 측정 자료를 아직 확인할 수 없습니다."}</p>)}
      {topic === "priorities" && (priority ? <div className="evidence-priority"><div className="evidence-priority-flow"><div><span>시장 업체 · {priority.sourceGroupLabel}</span><strong>{priority.highEntityCount} / {priority.highVisibilityEntityCount}곳</strong>{priority.highEntitySharePct !== null ? <><EvidenceBar confirmed={priority.highEntityCount} valid={priority.highVisibilityEntityCount} label="시장 표본 업체 중 출처 관찰"/><span>{priority.highEntitySharePct.toFixed(1)}%</span></> : <span>비율 미집계</span>}</div><ChevronRight aria-hidden="true"/><div><span>내 업체 · 같은 출처 그룹</span><strong>{priority.targetConnected === null ? "연결 미수집" : priority.targetConnected ? "연결 확인" : "연결 미확인"}</strong></div></div><h3>{priority.title}</h3><p>관찰된 차이이며 개선 보장이 아닙니다.</p></div> : summary?.opportunities[0] ? <div className="evidence-priority"><h3>{summary.opportunities[0].title}</h3><span>확인 대상 · 수치 근거 없음</span></div> : <p>현재 근거로 우선 확인할 대상을 정하기 어렵습니다.</p>)}
      {topic === "method" && <><p>{formatSeoul(model.measuredAt)} · 반복 {dto.scope.repetitions}회 · 응답 완료 {dto.scope.completedJobs} / {dto.scope.totalJobs}개</p><dl className="evidence-method">{[["유효 응답", metric.validCount], ["확정 등장", metric.confirmedCount], ["추가 확인", metric.unresolvedCount], ["제외 응답", model.recentSummary.invalidCount]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}개</dd></div>)}</dl><p>확정·추가 확인은 유효 응답 내 구분이며, 제외 응답은 별도입니다.</p></>}
      {hasRawEvidence && <Button variant="outline" className="no-print" onClick={openRaw}>{topic === "sources" ? "전체 출처 보기" : topic === "businesses" ? "전체 업체·넓은 지역 근거 보기" : topic === "method" ? "측정 기준 자세히" : "상세 근거 보기"}<ChevronRight aria-hidden="true"/></Button>}
    </section>
    <EvidencePopup title={`${labels[topic]} · 원자료`} description="현재 업체의 근거와 시장 표본은 별도로 표시합니다." open={raw} onOpenChange={setRaw} returnFocus={focus.current}>
      {raw && <>
        {topic === "questions" && <QuestionResults questions={dto.questionAreas}/>}
        {topic === "sources" && <div className="evidence-source-detail-groups">{sourceDetails.map(list => <details key={list.label} open={list.rows.length > 0 && list.rows.length <= 3}><summary>{list.label}<strong>{list.state}</strong></summary>{list.rows.length === 0 ? <p>{list.state}</p> : <ul className="evidence-short-list">{list.rows.map((row, i) => <li key={`${row.domain}:${i}`}><strong>{"title" in row && typeof row.title === "string" && row.title ? row.title : row.domain}</strong>{"sampleUrl" in row ? <a href={row.sampleUrl} target="_blank" rel="noopener noreferrer">{row.domain} · 페이지 열기</a> : <span>{row.domain}</span>}<span>관찰 {row.responseCount}회{"basisLabel" in row && ` · ${row.basisLabel}`}</span>{"linkedEntities" in row && <span>{row.linkedEntities.map(entity => `${entity.name} ${entity.responseCount}회`).join(" · ")}</span>}</li>)}</ul>}</details>)}</div>}
        {topic === "priorities" && <><h3>{priority?.title ?? summary?.opportunities[0]?.title}</h3>{priority && <><p>{priority.sourceGroupLabel} · 시장 {priority.highEntityCount} / {priority.highVisibilityEntityCount}곳 · {priority.highEntitySharePct === null ? "비율 미집계" : `${priority.highEntitySharePct.toFixed(1)}%`}</p><p>내 업체 같은 출처 그룹: {priority.targetConnected === null ? "미수집" : priority.targetConnected ? "연결 확인" : "연결 미확인"}</p><ul>{priority.sites.map((site, i) => <li key={`${site.label}:${i}`}>{site.label}{site.domain && ` · ${site.domain}`}</li>)}</ul></>}</>}
        {(topic === "businesses" || topic === "comparison") && <ArchiveContext.Provider value={{ topic, print: false }}>{children}</ArchiveContext.Provider>}
        {topic !== "businesses" && topic !== "comparison" && <details className="evidence-criteria" open={criteria} onToggle={event => setCriteria(event.currentTarget.open)}><summary>판정 기준·전체 근거</summary>{criteria && <ArchiveContext.Provider value={{ topic, print: false }}>{children}</ArchiveContext.Provider>}</details>}
      </>}
      <Button variant="outline" onClick={() => setRaw(false)}>닫기</Button>
    </EvidencePopup>
    <EvidencePopup title="질문 원문과 실제 결과" description="확정 결과와 추가 확인을 구분합니다." open={questions !== null} onOpenChange={open => { if (!open) setQuestions(null); }} returnFocus={focus.current}>{popupQuestions ? <QuestionResults questions={popupQuestions}/> : <p>질문별 저장 근거가 유형 집계와 일치하지 않아 결과를 표시할 수 없습니다. 전체 질문 원문에서 저장 자료를 확인하세요.</p>}<Button variant="outline" onClick={() => setQuestions(null)}>닫기</Button></EvidencePopup>
    {printExpanded && <div className="evidence-print-archive"><ArchiveContext.Provider value={{ topic: null, print: true }}>{children}</ArchiveContext.Provider></div>}
  </details>;
}