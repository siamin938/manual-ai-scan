import { useContext, useId, useState } from "react";
import {
  Clock,
  ExternalLink,
  ListChecks,
  MessageSquare,
  Star,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { DiagnosticQuestionAnswerPanel, QuestionAnswerContext } from "./diagnostic-question-answer-panel";
import { answerSignalLabels, type SignalKind } from "@/lib/profile-answer-signals";
import { siteDisplayName } from "@/lib/diagnostic-source-links";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { PriorityEvidence } from "./diagnostic-priority-evidence";

type Page = NonNullable<PriorityEvidence["peerExamples"]>[number];
type AnswerEvidence = Page["answerEvidence"];
const kinds = Object.keys(answerSignalLabels) as SignalKind[];
const signalIcons: Record<SignalKind, LucideIcon> = {
  reviews: MessageSquare,
  rating: Star,
  regulars: Users,
  price: Tag,
  included: ListChecks,
  duration: Clock,
};

export function sourceActionTask(evidence: AnswerEvidence) {
  if (evidence?.counts.regulars && (evidence.counts.reviews || evidence.counts.rating)) {
    return "최근 후기의 작업명과 단골 혜택을 확인하세요.";
  }
  if (evidence?.counts.price || evidence?.counts.included) {
    return "대표 작업의 가격과 공임 포함 여부를 확인하세요.";
  }
  if (evidence?.counts.reviews || evidence?.counts.rating) {
    return "최근 후기의 작업명과 서비스 목록을 함께 확인하세요.";
  }
  if (evidence?.counts.regulars) return "단골 혜택과 이용 조건을 확인하세요.";
  if (evidence?.counts.duration) return "대표 작업의 소요 시간과 예약 조건을 확인하세요.";
  return "인용 페이지의 서비스 설명과 내 업체 소개를 비교하세요.";
}

function SiteActions({ domain }: { domain: string }) {
  const host = domain.toLowerCase().replace(/^www\./u, "");
  if (host === "daangn.com") return <div className="source-official-actions">
    <a href="https://business.daangn.com/profile/login" target="_blank" rel="noopener noreferrer" className="source-primary-action">
      당근 비즈프로필 관리 <ExternalLink size={15} aria-label="새 창" />
    </a>
    <details className="source-registration">
      <summary>아직 등록 전이라면</summary>
      <a href="https://business.daangn.com/profile/login" target="_blank" rel="noopener noreferrer">
        당근 비즈프로필 등록하기 <ExternalLink size={14} aria-label="새 창" />
      </a>
    </details>
  </div>;
  if (host === "service.mycle.co.kr" || host === "play.mycle.co.kr") return <div className="source-official-actions">
    <a href="https://partners.mycle.co.kr/" target="_blank" rel="noopener noreferrer" className="source-primary-action">
      마이클 입점 신청 <ExternalLink size={15} aria-label="새 창" />
    </a>
  </div>;
  return null;
}

function ComparisonBar({ name, count, max, own = false }: { name: string; count: number | null; max: number; own?: boolean }) {
  const width = count === null ? 0 : Math.max(0, Math.min(100, count / max * 100));
  return <div className="source-comparison-row" data-value={count === null ? "unknown" : count}>
    <div className="source-comparison-label">
      <span>{name}{own && <small>우리 업체</small>}</span>
      {count === null ? <strong className="source-value-unknown">미확인</strong> : <strong>{count}<small>개 답변</small></strong>}
    </div>
    <div className="source-comparison-track" aria-hidden="true">
      <span data-own={own} data-unknown={count === null} style={{ width: `${width}%` }} />
    </div>
  </div>;
}

function SourceDetail({ page, dto }: { page: Page; dto: EntityFactsV2ReadGatewayDTO }) {
  const site = siteDisplayName(page.domain);
  const source = dto.observedSourcesStatus === "available" ? dto.observedSources.find(row => row.domain === page.domain) : null;
  const targetCount = source?.targetResponseCount ?? null;
  const evidence = page.answerEvidence;
  const scope = useContext(QuestionAnswerContext);
  const question = evidence && dto.questionAreas.find(q => q.questionId === evidence.example.questionId);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const id = useId();
  const max = Math.max(1, page.count, targetCount ?? 0);
  const mentionedKinds = evidence ? kinds.filter(kind => (evidence.counts[kind] ?? 0) > 0) : [];

  return <div className="source-action-card">
    <div className="source-action-lead">
      <div>
        <p>{site}에서 먼저 확인할 일</p>
        <h4>{sourceActionTask(evidence)}</h4>
      </div>
      <SiteActions domain={page.domain} />
    </div>

    <div className="source-infographic">
      <section className="source-comparison" aria-label={`${site} 인용 답변 수 비교`}>
        <h4>{site} 인용 답변</h4>
        <ComparisonBar name={page.name} count={page.count} max={max} />
        <ComparisonBar name={dto.business.name} count={targetCount} max={max} own />
      </section>
      {mentionedKinds.length > 0 && <section className="source-signals" aria-label="AI가 언급한 항목">
        <h4>AI가 언급한 항목</h4>
        <ul>{mentionedKinds.map(kind => {
          const Icon = signalIcons[kind];
          const count = evidence?.counts[kind] ?? 0;
          return <li key={kind} aria-label={`${answerSignalLabels[kind]}가 언급된 답변 ${count}개`}>
            <Icon aria-hidden="true" />
            <span>{answerSignalLabels[kind]}</span>
            <strong>{count}<small>개 답변</small></strong>
          </li>;
        })}</ul>
      </section>}
    </div>

    <details className="source-evidence-details" onToggle={event => setEvidenceOpen(event.currentTarget.open)}>
      <summary aria-controls={id}>질문과 근거 보기</summary>
      <div id={id} className="source-evidence-content">
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="source-page-link">
          {site} 인용 페이지 보기 <ExternalLink size={14} aria-label="새 창" />
        </a>
        {evidence && question ? <>
          <div className="source-evidence-question">
            <span>저장된 질문</span>
            <p>{question.questionText}</p>
            {evidence.example.phrases.length > 0 && <small>이 답변에 나온 항목 · {evidence.example.phrases.join(", ")}</small>}
          </div>
          {scope && evidenceOpen && <div className="saved-answer-panel source-saved-answer">
            <DiagnosticQuestionAnswerPanel scope={scope} questionId={question.questionId} measurementId={evidence.example.measurementId} />
          </div>}
          {!scope && <p className="source-evidence-empty">저장된 AI 답변은 로그인한 측정 화면에서 확인할 수 있습니다.</p>}
          <p className="source-evidence-note">측정 당시 답변에서 확인한 항목이며, 인용 원인을 뜻하지는 않습니다.</p>
        </> : <p className="source-evidence-empty">이 출처에 연결된 질문별 세부 관찰은 저장되어 있지 않습니다.</p>}
        {page.domain === "daangn.com" && source?.targetResponseCount === 0 && <p className="source-evidence-note">우리 업체의 실제 후기 수와 단골 수는 당근에서 확인하세요.</p>}
      </div>
    </details>
  </div>;
}

export function DiagnosticSourceAction({ pages, dto }: { pages: readonly Page[]; dto: EntityFactsV2ReadGatewayDTO }) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = pages.find(page => page.domain === selected) ?? pages[0];
  if (!current) return null;
  return <section className="source-action" aria-label="이번 측정의 출처별 실행 방법">
    {pages.length > 1 && <div className="source-picker" role="group" aria-label="비교할 출처 선택">
      {pages.map(page => <button key={page.domain} type="button" aria-pressed={page === current} onClick={() => setSelected(page.domain)}>
        {siteDisplayName(page.domain)}
      </button>)}
    </div>}
    <SourceDetail key={current.url} page={current} dto={dto} />
  </section>;
}
