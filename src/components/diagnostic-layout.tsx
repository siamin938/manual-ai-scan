import { useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronRight, Link2, MapPin, MessageSquare, Search, ShieldCheck, Star, Store, Wallet, Wrench, Columns2, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { QuestionResults, questionPresentationState, confirmedUniqueQuestionCount } from "@/components/diagnostic-question-results";
import { DiagnosticActionGuide } from "@/components/diagnostic-action-guide";
import { type PriorityEvidence } from "@/components/diagnostic-priority-evidence";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { searchContextQuestionEvidenceLabel, buildSearchContextQuestionEvidence } from "@/lib/search-context-question-evidence";
import { INTENT_LABELS, ALLOWED_INTENTS } from "@/lib/question-suggestions";
import { formatSeoul } from "@/lib/format";
import type { EntityFactsV2ReadQuestionAreaDTO, EntityFactsV2ReadQuestionLocationDTO, EntityFactsV2ReadQuestionGroupDTO, EntityFactsV2ReadBroadSearchObservationDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { EntityFactsV2DashboardSummaryViewModel } from "@/lib/entity-facts-v2-dashboard-summary.viewmodel";
import type { EntityFactsV2ComparisonDTO } from "@/lib/entity-facts-v2-comparison.types";
import type { VisibilityBenchmarkDTO } from "@/lib/visibility-benchmark.types";

type Question = Pick<EntityFactsV2ReadQuestionAreaDTO, "questionId" | "questionText" | "intentType" | "validCount" | "confirmedMentionCount" | "unresolvedTargetCount">;

// Presentation ordering only: keep each stored question object and its evidence unchanged.
export function interleaveQuestionsByIntent<T extends Pick<Question, "intentType">>(questions: readonly T[], intentOrder: readonly string[]): T[] {
  const order = [...new Set([...intentOrder, ...questions.map(q => q.intentType)])];
  const buckets = order.map(intent => questions.filter(q => q.intentType === intent));
  const result: T[] = [];
  const depth = Math.max(0, ...buckets.map(bucket => bucket.length));
  for (let row = 0; row < depth; row += 1) {
    for (const bucket of buckets) {
      const question = bucket[row];
      if (question) result.push(question);
    }
  }
  return result;
}

export function hasVerifiedBroadAbsence(scopes: EntityFactsV2DashboardSummaryViewModel["searchScopes"]): boolean {
  const broad = scopes?.find(scope => scope.kind === "core");
  return !!broad && broad.validCount > 0 && broad.confirmedCount === 0;
}

export function EvidencePopup({ title, description, children, open, onOpenChange, returnFocus }: {
  title: string; description: string; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: HTMLElement | null;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogPortal><DialogOverlay/><DialogPrimitive.Content className="diagnostic-popup diagnostic-local-dialog" onCloseAutoFocus={(event) => { if (returnFocus?.isConnected) { event.preventDefault(); returnFocus.focus(); } }}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}
  <DialogClose asChild><Button variant="ghost" className="diagnostic-popup-close" aria-label="닫기"><X aria-hidden="true"/></Button></DialogClose></DialogPrimitive.Content></DialogPortal></Dialog>;
}

export function QuestionBubble({ question }: { question: Question }) {
  return <svg viewBox="0 0 40 38" className="diagnostic-bubble" data-state={questionPresentationState(question)} aria-hidden="true">
    <path className="bubble-body" d="M8 3h24a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H17l-9 7v-7a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z" />
    {questionPresentationState(question) === "confirmed" ? <path className="bubble-symbol" d="m13 15 4 4 9-9" /> : question.unresolvedTargetCount > 0 ? <path className="bubble-symbol" d="M20 10v7m0 4v1" /> : question.validCount === 0 ? <path className="bubble-symbol" d="m16 12 8 8m0-8-8 8" /> : <path className="bubble-symbol" d="M16 16h8" />}
  </svg>;
}

export function QuestionLegend() {
  return <div className="diagnostic-legend"><span><QuestionBubble question={{questionId:"", questionText:"", intentType:"",validCount:1,confirmedMentionCount:1,unresolvedTargetCount:0}} />우리 업체 등장</span><span><QuestionBubble question={{questionId:"",questionText:"",intentType:"",validCount:1,confirmedMentionCount:0,unresolvedTargetCount:0}} />등장 미확인</span><span><QuestionBubble question={{questionId:"",questionText:"",intentType:"",validCount:1,confirmedMentionCount:0,unresolvedTargetCount:1}}/>추가 확인</span><span><QuestionBubble question={{questionId:"",questionText:"",intentType:"",validCount:0,confirmedMentionCount:0,unresolvedTargetCount:0}}/>유효 답변 없음</span></div>;
}

export function QuestionMatrix({ questions, locations, enabled, scopes, headline, intentOrder = ALLOWED_INTENTS }: {
  questions: readonly EntityFactsV2ReadQuestionAreaDTO[]; locations: readonly EntityFactsV2ReadQuestionLocationDTO[]; enabled: boolean;
  scopes: EntityFactsV2DashboardSummaryViewModel["searchScopes"]; headline: string; intentOrder?: readonly string[];
}) {
  const [current, setCurrent] = useState<Question | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  const byId = new Map(locations.map(row => [row.questionId, row]));
  return <section className="diagnostic-panel diagnostic-matrix" aria-label="실제 질문별 등장 결과"><h2>{headline}</h2>
    {!enabled ? <p className="text-muted-foreground">이 측정은 실제 질문의 검색 범위를 구분할 자료가 없습니다. 저장된 질문은 상세 분석에서 확인할 수 있습니다.</p> : [true, false].map(broad => {
      const rows = interleaveQuestionsByIntent(questions.filter(q => { const location = byId.get(q.questionId); return location && (location.city === null) === broad; }), intentOrder);
      const scope = scopes?.find(s => s.kind === (broad ? "core" : "custom"));
      return <div className="diagnostic-scope" key={String(broad)}><div className="diagnostic-scope-label"><h3>{broad ? "넓은 지역 전체에서 찾을 때" : "조건을 좁혀 찾을 때"}</h3><strong>{scope && scope.validCount > 0 ? `${scope.confirmedCount} / ${scope.validCount}` : "유효 답변 없음"}</strong></div>
        <div className="diagnostic-bubble-grid">{rows.map(q => <Button key={q.questionId} variant="ghost" className="diagnostic-bubble-button" aria-label={`${q.questionText}: ${searchContextQuestionEvidenceLabel(q)}`} onClick={event => { focus.current = event.currentTarget; setCurrent(q); }}><QuestionBubble question={q} /></Button>)}</div>
        {rows.length === 0 && <p>저장된 범위별 질문 없음</p>}
      </div>;
    })}<QuestionLegend />
    {questions.some(q => q.validCount === 0 || q.unresolvedTargetCount > 0) && <p className="diagnostic-state-note">! 추가 확인 · × 유효 답변 없음 (미측정·무응답 여부는 측정 근거에서 확인)</p>}
    <EvidencePopup title="질문별 실제 등장 결과" description="현재 선택한 업체와 측정에 저장된 질문의 결과입니다." open={current !== null} onOpenChange={open => { if (!open) setCurrent(null); }} returnFocus={focus.current}>{current && <QuestionResults questions={[current]} />}</EvidencePopup>
  </section>;
}

function Podium() {
  return <svg className="diagnostic-podium" viewBox="0 0 100 100" aria-hidden="true"><path d="m50 8 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="none" stroke="currentColor" strokeWidth="2"/><rect className="podium-low" x="5" y="52" width="26" height="25" rx="4"/><rect className="podium-high" x="36" y="31" width="28" height="46" rx="4"/><rect className="podium-low" x="69" y="60" width="24" height="17" rx="4"/></svg>;
}

export function DiagnosticSummaryLayout({ summary, questions, locations, enabled, observation, benchmark, actionTitle, actionEvidence, onAction, onTopic, intentOrder, priority = null, actionDto, printExpanded = false }: {
  summary: EntityFactsV2DashboardSummaryViewModel; questions: readonly EntityFactsV2ReadQuestionAreaDTO[]; locations: readonly EntityFactsV2ReadQuestionLocationDTO[]; enabled: boolean;
  observation: EntityFactsV2ReadBroadSearchObservationDTO | null; benchmark: VisibilityBenchmarkDTO | null;
  actionTitle: string; actionEvidence: string; onAction: () => void; onTopic: (topic: string) => void;
  intentOrder?: readonly string[]; priority?: PriorityEvidence | null; actionDto?: import("@/lib/entity-facts-v2-read-gateway.types").EntityFactsV2ReadGatewayDTO; printExpanded?: boolean;
}) {
  const hasCounts = summary.visibility.count !== null && summary.visibility.total !== null;
  return <div className="diagnostic-summary-layout"><div className="diagnostic-summary-top">
    <section className="diagnostic-result" aria-label="이번 진단 결과"><p>AI 답변 {summary.visibility.total ?? "확인 중"}{summary.visibility.total !== null ? "개 중" : ""}</p><div className="diagnostic-result-number"><strong data-digits={String(summary.visibility.count ?? "").length}>{hasCounts ? summary.visibility.count : "–"}</strong><span>{hasCounts ? "개에 등장" : "결과 확인 중"}</span><Podium /></div><div className="diagnostic-result-footer"><Star aria-hidden="true"/><span>{summary.top3.count === null ? "상위 3곳 결과 확인 중" : `등장한 답변 중 ${summary.top3.count}개에서 상위 3곳`}</span></div></section>
    <QuestionMatrix questions={questions} locations={locations} enabled={enabled} scopes={summary.searchScopes} {...(intentOrder ? { intentOrder } : {})} headline={enabled && summary.searchScopeObservation && hasVerifiedBroadAbsence(summary.searchScopes) ? "조건을 좁혔을 때만 등장" : "어떤 범위의 질문에서 나왔나요?"} />
  </div>{actionDto && <DiagnosticActionGuide key={`${actionDto.business.id}:${actionDto.scope.runId}`} priority={priority} dto={actionDto} original={actionEvidence} compact printExpanded={printExpanded}/>}
    <div className="diagnostic-summary-tiles"><Button variant="outline" className="diagnostic-link-tile" onClick={() => onTopic("businesses")}><span className="diagnostic-tile-icon"><Store/></span><span><strong>넓은 지역에 나온 업체</strong><small>{observation ? `한 번 등장 ${observation.singleObservationCompetitors.length}곳 / 반복 등장 ${observation.repeatedCompetitors.length}곳` : "넓은 지역 분류 자료 없음"}</small></span><ChevronRight/></Button><Button variant="outline" className="diagnostic-link-tile diagnostic-source-tile" onClick={() => onTopic("sources")}><span className="diagnostic-tile-icon"><Link2/></span><span><strong>자주 등장한 업체의 출처</strong><small>{benchmark ? `최근 ${benchmark.windowDays}일 / 자동차 업체 ${benchmark.highVisibilityEntityCount}곳` : "시장 표본 자료 없음"}</small></span><ChevronRight/></Button></div>
  </div>;
}

const topicIcons = [MessageSquare, Store, Link2, CalendarDays];
export function DiagnosticTopicTabs({ topic, onChange }: { topic: string; onChange: (topic: string) => void }) {
  return <nav className="diagnostic-tabs no-print" aria-label="상세 분석 탐색">{["questions", "businesses", "sources", "comparison"].map((key, index) => { const Icon = topicIcons[index] ?? MessageSquare; return <Button key={key} variant="outline" aria-pressed={topic === key} onClick={() => onChange(key)}><Icon aria-hidden="true"/>{["질문", "다른 업체", "인용 출처", "지난 측정"][index]}</Button>; })}</nav>;
}

const intentIcons = [MapPin, Star, Wrench, MessageSquare, ShieldCheck, Columns2, Wallet, Search];
export function DiagnosticQuestions({ groups, questions }: { groups: readonly EntityFactsV2ReadQuestionGroupDTO[]; questions: readonly EntityFactsV2ReadQuestionAreaDTO[] }) {
  const evidence = buildSearchContextQuestionEvidence(groups, questions);
  const [selected, setSelected] = useState<{ title: string; questions: readonly Question[] | null } | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  const confirmed = questions.filter(q => questionPresentationState(q) === "confirmed");
  return <section className="diagnostic-questions-view"><h2>어떤 질문에서 나왔을까요?</h2><p className="diagnostic-answer-legend">업체가 등장한 답변 / 유효 답변 (질문 개수가 아닙니다)</p><QuestionLegend /><div className="diagnostic-intent-grid">{evidence.map((group, index) => { const iconIndex = ALLOWED_INTENTS.findIndex(intent => intent === group.intentType); const Icon = intentIcons[iconIndex] ?? Search; const title = (INTENT_LABELS as Record<string, string>)[group.intentType] ?? "기타"; return <Button key={group.intentType} variant="outline" className="diagnostic-intent" data-visible={group.confirmedMentionCount > 0} onClick={event => { focus.current = event.currentTarget; setSelected({title, questions:group.questions}); }} aria-label={`${title}: 유효 답변 ${group.validCount}개 중 ${group.confirmedMentionCount}개에 등장, 실제 질문 보기`}><span className="diagnostic-intent-top"><span className="diagnostic-tile-icon"><Icon/></span><strong>{group.validCount > 0 ? `${group.confirmedMentionCount} / ${group.validCount}` : "유효 답변 없음"}</strong></span><span className="diagnostic-intent-title">{title}</span><span className="diagnostic-intent-bottom"><span>{group.questions?.map(q => <QuestionBubble key={q.questionId} question={q}/>)}</span><ChevronRight/></span></Button>; })}</div>{confirmed.length > 0 ? <Button className="diagnostic-confirmed-cta" onClick={event => { focus.current = event.currentTarget; setSelected({title:"우리 업체가 등장한 질문",questions:confirmed}); }}><MessageSquare aria-hidden="true"/>등장한 질문 {confirmedUniqueQuestionCount(confirmed)}개만 보기<ChevronRight aria-hidden="true"/></Button> : <p className="diagnostic-answer-legend">이번 측정에서 등장이 확정된 질문은 없습니다.</p>}<EvidencePopup title={selected?.title ?? "실제 질문"} description="현재 측정에 저장된 질문과 확정 등장 결과입니다." open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }} returnFocus={focus.current}>{selected?.questions ? <QuestionResults questions={selected.questions}/> : <p>질문별 저장 근거를 확인할 수 없습니다.</p>}</EvidencePopup></section>;
}

export function DiagnosticHistory({ comparison, measuredAt, reason, error = false, loading = false }: { comparison: EntityFactsV2ComparisonDTO | null; measuredAt: string; reason?: string; error?: boolean; loading?: boolean }) {
  const available = comparison?.status === "verified" && !!comparison.previousRun;
  return <section className="diagnostic-history"><h2>지난 측정과 달라졌을까요?</h2><div className="diagnostic-history-grid"><div className="diagnostic-panel"><CalendarDays/><strong>{formatSeoul(comparison?.currentRun?.measuredAt ?? measuredAt)}</strong><p>이번 측정</p></div>{available && <div className="diagnostic-panel"><CalendarDays/><strong>{formatSeoul(comparison.previousRun?.measuredAt ?? measuredAt)}</strong><p>동일 조건의 이전 측정</p></div>}</div>{!available && <p className="diagnostic-history-status" role="status">{error ? "이전 측정 비교 정보를 불러오지 못했습니다." : loading || !comparison ? "이전 측정 비교 자료 확인 중" : reason ?? "같은 조건으로 비교할 이전 측정이 없습니다."}</p>}</section>;
}
