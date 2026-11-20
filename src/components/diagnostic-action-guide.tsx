import { useRef, useState, type ReactNode } from "react";
import { ChevronUp, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSearchContextQuestionEvidence } from "@/lib/search-context-question-evidence";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { ActionOpportunityKind } from "@/lib/action-opportunity-engine-v01";
import type { PriorityEvidence } from "@/components/diagnostic-priority-evidence";

type Copy = { title: string; where: string; task: string; source: string };
export const actionGuideCopy: Record<ActionOpportunityKind, Copy> = {
  profile_directory: { title: "업체 프로필에 지점명과 대표 서비스를 함께 적어 주세요", where: "평소 관리하는 지도나 업체 소개 페이지를 열어 주세요.", task: "정확한 지점명, 지역, 실제 대표 서비스가 함께 보이는지 확인하고 빠진 내용만 보완해 주세요.", source: "업체 프로필" },
  owned_web_presence: { title: "내 홈페이지의 지점 소개를 구체적으로 확인해 주세요", where: "직접 관리하는 홈페이지나 지점 소개 페이지를 열어 주세요.", task: "지점명, 지역, 제공하는 서비스와 연락처가 실제 정보와 맞는지 확인하고 필요한 내용만 보완해 주세요.", source: "공식 홈페이지" },
  auto_platform: { title: "관리하는 자동차 업체 소개를 최신 정보로 확인해 주세요", where: "직접 관리할 수 있는 자동차 전문 서비스의 내 업체 소개를 열어 주세요.", task: "지점명, 지역, 실제 제공 서비스가 정확한지 확인해 주세요. 관리하는 소개가 없다면 내 지도나 홈페이지부터 확인해 주세요.", source: "자동차 전문 서비스" },
  blog_presence: { title: "내 블로그에 실제 작업 정보와 지점명을 함께 보여 주세요", where: "직접 운영하는 블로그의 업체 소개나 작업 글을 열어 주세요.", task: "실제 수행한 서비스, 지점명과 지역이 함께 보이는지 확인하고 사실에 맞는 정보만 보완해 주세요.", source: "블로그" },
  news_presence: { title: "내 소개 페이지에서 공개된 업체 정보를 확인해 주세요", where: "직접 관리하는 홈페이지나 업체 소개 페이지를 열어 주세요.", task: "외부 기사와 비교할 수 있도록 실제 업체명, 지역, 서비스 정보를 정확하게 정리해 주세요. 다른 업체의 기사 수정을 요청하는 안내는 아닙니다.", source: "언론 기사" },
  video_presence: { title: "내 영상 소개에 지점명과 실제 서비스를 함께 적어 주세요", where: "직접 운영하는 영상 채널의 소개나 영상 설명을 열어 주세요.", task: "영상에 나온 실제 서비스, 지점명과 지역을 확인해 주세요. 영상 채널이 없다면 관리하는 업체 소개부터 확인해 주세요.", source: "영상" },
  community_presence: { title: "내가 관리하는 업체 소개의 정보를 먼저 확인해 주세요", where: "직접 관리하는 업체 소개나 홈페이지를 열어 주세요.", task: "지점명, 지역과 실제 서비스가 일치하는지 확인해 주세요. 타업체나 커뮤니티의 글을 수정하거나 게시할 필요는 없습니다.", source: "커뮤니티" },
};
export function nextMeasurementQuestion(dto: Pick<EntityFactsV2ReadGatewayDTO, "questionAreas" | "questionGroups" | "questionLocations">) {
  const proved = buildSearchContextQuestionEvidence(dto.questionGroups, dto.questionAreas).flatMap(group => group.questions ?? []);
  const ids = new Set(proved.map(q => q.questionId));
  const locations = new Map((dto.questionLocations ?? []).map(row => [row.questionId, row.city]));
  const rows = dto.questionAreas.filter(q => ids.has(q.questionId) && q.validCount > 0 && q.confirmedMentionCount === 0 && q.unresolvedTargetCount === 0);
  return rows.find(q => locations.has(q.questionId) && locations.get(q.questionId) !== null) ?? rows[0] ?? null;
}
export function ActionGuideReason({ priority, original, printExpanded = false }: { priority: PriorityEvidence | null; original: string; printExpanded?: boolean }) {
  const copy = priority?.kind ? actionGuideCopy[priority.kind] : null;
  return <details className="action-guide-reason" {...(printExpanded ? {open:true} : {})}><summary>이 일을 추천한 이유</summary>{priority && copy ? <>
    <p>{priority.windowDays ? `최근 ${priority.windowDays}일 동안 ` : ""}{priority.evidenceScope === "category" ? "같은 업종에서 " : "자동차 업종에서 "}AI에 자주 관찰된 업체 {priority.highVisibilityEntityCount}곳 중 {priority.highEntityCount}곳에서 {copy.source} 출처가 함께 관찰됐어요.</p>
    <p>{priority.targetConnected === null ? "이번 업체 답변의 직접 연결 여부는 아직 확인할 수 없어요." : priority.targetConnected ? `이번 업체 답변에서 ${copy.source} 연결도 확인됐어요.` : `이번 업체 답변에서 ${copy.source} 연결은 확인되지 않았어요. 등록 여부나 정보 누락을 뜻하지는 않아요.`}</p>
    <p>이 관찰이 추천 원인이나 개선 효과를 뜻하지는 않습니다.</p>
    {priority.sites.length > 0 && <details><summary>관찰된 출처 예시</summary><ul>{priority.sites.map((site,i) => <li key={`${site.label}:${i}`}>{site.label}{site.domain && ` (${site.domain})`}</li>)}</ul></details>}
  {original && <details><summary>저장된 관찰 원문</summary><p>{original}</p></details>}
  </> : <p>{original || "현재 자료만으로 특정 채널의 개선을 권하기 어렵습니다. 저장된 질문과 출처를 먼저 확인해 주세요."}</p>}</details>;
}
export function DiagnosticActionGuide({ priority, dto, original = "", archive, compact = false, printExpanded = false }: { priority: PriorityEvidence | null; dto: EntityFactsV2ReadGatewayDTO; original?: string; archive?: ReactNode; compact?: boolean; printExpanded?: boolean }) {
  const [open,setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const copy = priority?.kind ? actionGuideCopy[priority.kind] : null;
  const valid = dto.overview.validCount > 0;
  const question = nextMeasurementQuestion(dto);
  const title = valid && copy ? copy.title : valid ? "저장된 질문과 출처를 먼저 확인해 주세요" : "답변 결과를 확인한 뒤 다음 할 일을 정해 주세요";
  const task = valid && copy ? copy.task : valid ? "현재 자료만으로 특정 정보의 누락이나 개선 대상을 단정할 수 없어요." : "유효한 답변이 없어 지금은 특정 채널의 개선을 권하기 어려워요.";
  const expanded = !compact || open || printExpanded;
  return <section className={`action-guide${compact ? " action-guide-summary" : ""}`} aria-label="먼저 할 일">
    {compact && <div className="diagnostic-action"><div className="diagnostic-action-icon"><MapPin aria-hidden="true"/></div><div><p className="diagnostic-eyebrow">먼저 할 일</p><h3>{title}</h3><p className="action-guide-task">{task}</p></div><Button ref={trigger} className="diagnostic-evidence-cta no-print" aria-expanded={expanded} onClick={() => { setOpen(true); requestAnimationFrame(() => { panel.current?.scrollIntoView({block:"nearest",behavior:"smooth"}); panel.current?.focus({preventScroll:true}); }); }}>실행 방법 보기<ChevronRight aria-hidden="true"/></Button></div>}
    {expanded && <div ref={panel} tabIndex={-1} className="action-guide-panel">
      <h3>{compact ? "실행 방법" : title}</h3>
      {valid && copy && dto.business.name && <p className="action-guide-business">확인할 지점: {dto.business.name}{[dto.business.region, dto.business.city].filter(Boolean).length > 0 && ` (${[...new Set([dto.business.region, dto.business.city].filter(Boolean))].join(" ")})`}</p>}
      {valid && copy ? <ol className="action-guide-steps"><li><span>1</span>{copy.where}</li><li><span>2</span>{copy.task}</li><li><span>3</span>정보가 반영된 뒤 같은 질문으로 다시 측정해 변화를 비교해 주세요. 재측정은 직접 선택할 때만 진행됩니다.</li></ol> : <p>{task}</p>}
      {question ? <figure className="action-guide-question" data-question-id={question.questionId}><figcaption>다음 측정에서 확인할 질문</figcaption><blockquote>{question.questionText}</blockquote><p>이번에는 등장 여부가 확인되지 않은 질문입니다. 수정 효과를 보장하는 질문은 아닙니다.</p></figure> : <p>{valid ? "확인 가능한 질문 중 별도로 미확인 질문을 고를 수 없어요. 같은 질문으로 반복 여부를 확인해 주세요." : "비교할 질문은 유효 답변을 확인한 뒤 안내합니다."}</p>}
      <ActionGuideReason priority={valid ? priority : null} original={original} printExpanded={printExpanded}/>
      {archive && <details className="action-guide-original"><summary>판정 기준과 원자료</summary>{archive}</details>}
      {compact && <Button variant="outline" className="no-print" onClick={() => { setOpen(false); trigger.current?.focus(); }}><ChevronUp aria-hidden="true"/>접기</Button>}
    </div>}
  </section>;
}
