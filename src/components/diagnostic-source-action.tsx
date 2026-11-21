import { useContext, useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DiagnosticQuestionAnswerPanel, QuestionAnswerContext } from "./diagnostic-question-answer-panel";
import { answerSignalLabels, type SignalKind } from "@/lib/profile-answer-signals";
import { siteDisplayName } from "@/lib/diagnostic-source-links";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { PriorityEvidence } from "./diagnostic-priority-evidence";

type Page = NonNullable<PriorityEvidence["peerExamples"]>[number];
const kinds = Object.keys(answerSignalLabels) as SignalKind[];

function recommendedCheck(evidence: Page["answerEvidence"]) {
  if (evidence?.counts.regulars && (evidence.counts.reviews || evidence.counts.rating)) return "최근 후기에 어떤 작업이나 차종이 언급되는지 살펴보세요. 단골 혜택이 있다면 내 프로필에서 혜택과 이용 조건을 쉽게 찾을 수 있는지도 확인하세요.";
  if (evidence?.counts.price || evidence?.counts.included) return "대표 작업 한 건의 가격과 부품, 공임 포함 여부를 내 업체 소개에 표시했는지 확인하세요.";
  if (evidence?.counts.reviews || evidence?.counts.rating) return "내 프로필의 최근 후기를 열어 고객이 어떤 작업을 받았는지 살펴보세요. 후기에 자주 나오는 작업을 서비스 목록에서 쉽게 찾을 수 있게 해 주세요.";
  if (evidence?.counts.regulars) return "내 프로필에서 단골 혜택과 이용 조건을 확인하세요. 실제 제공하는 혜택이 있다면 고객이 찾기 쉽게 소개에 적어 주세요.";
  if (evidence?.counts.duration) return "내 업체 소개에서 대표 작업의 예상 소요 시간과 예약 조건을 찾을 수 있는지 확인하세요.";
  return "인용 페이지에서 업체가 서비스를 어떻게 설명하는지 보고, 내 소개에 보완할 내용이 있는지 확인하세요.";
}

function SiteActions({ domain }: { domain: string }) {
  const host = domain.toLowerCase().replace(/^www\./u, "");
  const linkStyle = "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-primary underline underline-offset-4";
  if (host === "daangn.com") return <div className="flex flex-wrap items-start gap-2">
    <a href="https://business.daangn.com/profile/login" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">당근 비즈프로필 관리 <ExternalLink size={14} aria-label="새 창"/></a>
    <details className="text-sm"><summary className="cursor-pointer px-2 py-2.5 text-muted-foreground">아직 등록 전이라면</summary>
      <a href="https://business.daangn.com/profile/login" target="_blank" rel="noopener noreferrer" className={linkStyle}>당근 비즈프로필 등록하기 <ExternalLink size={14} aria-label="새 창"/></a>
    </details>
  </div>;
  if (host === "service.mycle.co.kr" || host === "play.mycle.co.kr") return <details className="text-sm">
    <summary className="cursor-pointer py-2 text-muted-foreground">마이클에 입점하고 싶다면</summary>
    <a href="https://partners.mycle.co.kr/" target="_blank" rel="noopener noreferrer" className={linkStyle}>마이클 입점 신청 바로가기 <ExternalLink size={14} aria-label="새 창"/></a>
  </details>;
  return null;
}

function SourceDetail({ page, dto }: { page: Page; dto: EntityFactsV2ReadGatewayDTO }) {
  const site = siteDisplayName(page.domain);
  const source = dto.observedSourcesStatus === "available" ? dto.observedSources.find(row => row.domain === page.domain) : null;
  const evidence = page.answerEvidence;
  const scope = useContext(QuestionAnswerContext);
  const question = evidence && dto.questionAreas.find(q => q.questionId === evidence.example.questionId);
  const [answerOpen, setAnswerOpen] = useState(false);
  const id = useId();
  return <div className="space-y-3 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <strong className="text-base">{page.name}</strong>
      <a href={page.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4">{site} 인용 페이지 보기 <ExternalLink size={14} aria-label="새 창"/></a>
    </div>
    <p className="text-sm">이번 측정에서 이 업체와 {site} 출처가 함께 나온 답변 <strong>{page.count}개</strong>{source && <> / 우리 업체와 연결된 답변 <strong>{source.targetResponseCount}개</strong></>}</p>
    {evidence && <>
      <h4 className="text-sm font-semibold">AI가 이 업체를 설명할 때 언급한 정보</h4>
      <ul className="flex flex-wrap gap-2">{kinds.filter(kind => evidence.counts[kind]).map(kind =>
        <li key={kind} className="rounded-lg bg-muted px-3 py-1.5 text-sm">{answerSignalLabels[kind]} <strong>{evidence.counts[kind]}개 답변</strong></li>)}</ul>
      {question && <div className="rounded-lg bg-muted/50 p-3 text-sm">
        <p className="font-semibold">{question.questionText}</p>
        <p className="mt-1 text-muted-foreground">이 답변에 나온 항목　{evidence.example.phrases.join(", ")}</p>
        {scope && <button type="button" aria-controls={id} aria-expanded={answerOpen} onClick={() => setAnswerOpen(!answerOpen)} className="mt-1 min-h-9 font-semibold text-primary underline underline-offset-4">{answerOpen ? "답변 접기" : "이 답변 원문 보기"}</button>}
        {scope && answerOpen && <div id={id} className="saved-answer-panel max-h-80 overflow-y-auto"><DiagnosticQuestionAnswerPanel scope={scope} questionId={question.questionId} measurementId={evidence.example.measurementId}/></div>}
      </div>}
      <p className="text-xs text-muted-foreground">측정 당시 답변에서 확인한 항목입니다. 각 항목이 인용에 미친 영향은 알 수 없습니다.</p>
    </>}
    <div className="space-y-2 border-t pt-3">
      <h4 className="text-sm font-semibold">내 업체에서 확인할 일</h4>
      <p className="text-sm leading-relaxed">{recommendedCheck(evidence)}</p>
      {page.domain === "daangn.com" && source?.targetResponseCount === 0 && <p className="text-xs text-muted-foreground">우리 업체의 실제 후기 수와 단골 수는 당근에서 확인하세요.</p>}
      <SiteActions domain={page.domain}/>
    </div>
  </div>;
}

export function DiagnosticSourceAction({ pages, dto }: { pages: readonly Page[]; dto: EntityFactsV2ReadGatewayDTO }) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = pages.find(p => p.domain === selected) ?? pages[0];
  if (!current) return null;
  return <section className="my-3 space-y-3" aria-label="이번 측정의 출처별 실행 방법">
    {pages.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="비교할 출처 선택">{pages.map(page =>
      <button key={page.domain} type="button" aria-pressed={page === current} onClick={() => setSelected(page.domain)}
        className="min-h-10 rounded-lg border px-4 text-sm font-semibold aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">{siteDisplayName(page.domain)}</button>)}</div>}
    <SourceDetail key={current.url} page={current} dto={dto}/>
  </section>;
}
