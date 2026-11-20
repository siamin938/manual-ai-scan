import { useId, useRef, useState, type ReactNode } from "react";
import { siteDisplayName } from "@/lib/diagnostic-source-links";
import { ChevronUp, ChevronRight, MapPin, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSearchContextQuestionEvidence } from "@/lib/search-context-question-evidence";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { ActionOpportunityKind } from "@/lib/action-opportunity-engine-v01";
import type { PriorityEvidence } from "@/components/diagnostic-priority-evidence";

type Copy = { title: string; where: string; task: string; source: string };
export const actionGuideCopy: Record<ActionOpportunityKind, Copy> = {
  profile_directory: { title: "업체 프로필에 지점명과 대표 서비스를 적어 주세요", where: "평소 관리하는 지도나 업체 소개 페이지에서 확인하세요.", task: "대표 서비스가 적혀 있는지 보고, 빠진 서비스만 실제 제공 내용에 맞게 보완하세요.", source: "업체 프로필" },
  owned_web_presence: { title: "홈페이지 지점 소개에 실제 서비스 내용을 담아 주세요", where: "직접 관리하는 홈페이지의 지점 소개에서 확인하세요.", task: "대표 서비스 설명을 살펴보고, 빠진 작업 내용과 연락 방법을 보완하세요.", source: "공식 홈페이지" },
  auto_platform: { title: "자동차 업체 소개에 제공하는 작업을 적어 주세요", where: "직접 관리하는 자동차 전문 플랫폼의 업체 소개에서 확인하세요.", task: "대표 서비스 목록을 살펴보고, 실제 제공하는 작업 중 빠진 항목을 추가하세요.", source: "자동차 전문 서비스" },
  blog_presence: { title: "블로그 작업 글에 서비스와 작업 내용을 담아 주세요", where: "직접 운영하는 블로그의 소개나 작업 글에서 확인하세요.", task: "공개할 수 있는 실제 작업 글에 대표 서비스와 작업 내용을 보완하세요.", source: "블로그" },
  news_presence: { title: "내 업체 소개에 공개된 서비스 정보를 정리하세요", where: "직접 관리하는 홈페이지나 업체 소개 페이지에서 확인하세요.", task: "내 소개에 대표 서비스가 있는지 보고, 실제 제공 내용 중 빠진 정보를 보완하세요.", source: "언론 기사" },
  video_presence: { title: "영상 설명에 실제 서비스와 작업 내용을 적어 주세요", where: "직접 운영하는 영상 채널의 소개나 영상 설명에서 확인하세요.", task: "영상에 나온 대표 서비스와 실제 작업 내용을 설명에 보완하세요.", source: "영상" },
  community_presence: { title: "내 업체 소개에 실제 서비스 내용을 담아 주세요", where: "직접 관리하는 업체 소개나 홈페이지에서 확인하세요.", task: "대표 서비스가 적혀 있는지 보고, 실제 제공 내용 중 빠진 정보를 보완하세요.", source: "커뮤니티" },
};
const writingHints = {
  cost: "서로 비교할 수 있게 작업에 포함되는 항목과 비용이 달라지는 기준을 적어 보세요.",
  review: "공개할 수 있는 실제 작업 사례 한 건에 서비스와 작업 내용을 담아 보세요.",
  location: "실제 주소와 찾는 방법을 함께 표시하세요.",
  expertise: "확인 가능한 자격이나 작업 경험을 실제 서비스와 함께 적어 보세요.",
  service: "실제로 제공하는 작업의 범위와 진행 과정을 적어 보세요.",
  recommendation: "어떤 작업을 원하는 고객에게 맞는지 실제 제공 범위 안에서 적어 보세요.",
  discovery: "고객이 찾는 서비스 이름을 업체 소개에 알아보기 쉽게 적어 보세요.",
};
const hintByIntent: Record<string, keyof typeof writingHints> = { comparison: "cost", price_value: "cost", review_quality: "review", local: "location", trust: "expertise", service: "service", recommendation: "recommendation", discovery: "discovery" };
export function actionWritingHintKind(priority: PriorityEvidence | null, question: ReturnType<typeof nextMeasurementQuestion>) {
  if (!priority?.kind || priority.highEntityCount <= 0 || priority.highVisibilityEntityCount <= 0 || !question) return null;
  return hintByIntent[question.intentType] ?? null;
}
function guideCopyFor(priority: PriorityEvidence | null) {
  return priority?.kind && priority.highEntityCount > 0 && priority.highVisibilityEntityCount > 0 ? actionGuideCopy[priority.kind] : null;
}
export function nextMeasurementQuestion(dto: Pick<EntityFactsV2ReadGatewayDTO, "questionAreas" | "questionGroups" | "questionLocations">) {
  const proved = buildSearchContextQuestionEvidence(dto.questionGroups, dto.questionAreas).flatMap(group => group.questions ?? []);
  const ids = new Set(proved.map(q => q.questionId));
  const locations = new Map((dto.questionLocations ?? []).map(row => [row.questionId, row.city]));
  const rows = dto.questionAreas.filter(q => ids.has(q.questionId) && q.validCount > 0 && q.confirmedMentionCount === 0 && q.unresolvedTargetCount === 0);
  return rows.find(q => locations.has(q.questionId) && locations.get(q.questionId) !== null) ?? rows[0] ?? null;
}
function ActionSourceLinks({ priority, validCount, targetCount }: { priority: PriorityEvidence; validCount: number; targetCount: number }) {
  const own = priority.ownPage;
  const pages = priority.peerExamples ?? [];
  if (!own && !pages.length) return null;
  const ownLabels: Record<string, string> = {
    naver_place: "내 네이버 플레이스 확인하기", owned_domain: "내 홈페이지 확인하기", naver_blog: "내 네이버 블로그 확인하기",
  };
  return <div className="my-3 space-y-3 rounded-xl border bg-card p-4">
    {own && <a href={own.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
      {ownLabels[own.sourceType] ?? "내 업체 페이지 확인하기"}<ExternalLink size={15} aria-label="새 창"/>
    </a>}
    {pages.length > 0 && <div><h4 className="text-sm font-semibold">이번 측정에서 반복 등장한 업체 사례</h4>
      <p className="mt-1 text-sm text-muted-foreground">전체 답변 {validCount}개에서 내 업체는 {targetCount}회 등장했습니다.</p>
      <ul className="mt-2 space-y-2">{pages.map(page => <li key={page.domain} className="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-muted/50 px-3 py-2">
        <div className="text-sm"><strong>{page.name}</strong> {page.appearances}회 등장<br/><span className="text-muted-foreground">{siteDisplayName(page.domain)} 출처가 함께 나온 답변 {page.count}개</span></div>
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-2 text-sm font-semibold text-primary underline underline-offset-4">{siteDisplayName(page.domain)} 사례 보기 <ExternalLink size={13} aria-label="새 창"/></a>
      </li>)}</ul></div>}
  </div>;
}
export function ActionGuideReason({ priority, original, printExpanded = false }: { priority: PriorityEvidence | null; original: string; printExpanded?: boolean }) {
  const copy = guideCopyFor(priority);
  return <details className="action-guide-reason" {...(printExpanded ? {open:true} : {})}><summary>이 일을 추천한 이유</summary>{priority && copy ? <>
    <p>{priority.windowDays ? `최근 ${priority.windowDays}일 동안 ` : ""}{priority.evidenceScope === "category" ? "같은 업종에서 " : "자동차 업종에서 "}AI에 자주 관찰된 업체 {priority.highVisibilityEntityCount}곳 중 {priority.highEntityCount}곳에서 {copy.source} 출처가 함께 관찰됐어요.</p>
    <p>{priority.targetConnected === null ? "이번 업체 답변의 직접 연결 여부는 아직 확인할 수 없어요." : priority.targetConnected ? `이번 업체 답변에서 ${copy.source} 연결도 확인됐어요.` : `이번 업체 답변에서 ${copy.source} 직접 연결은 확인되지 않았어요.`} 함께 관찰된 출처를 살펴보자는 안내이며, 정보 누락이나 수정 효과가 확인된 것은 아니에요.</p>
    {priority.sites.length > 0 && <details><summary>관찰된 출처 예시</summary><ul>{priority.sites.map((site,i) => <li key={`${site.label}:${i}`}>{site.label}{site.domain && ` (${site.domain})`}</li>)}</ul></details>}
  {original && <details><summary>저장된 관찰 원문</summary><p>{original}</p></details>}
  </> : <><p>현재 자료에는 특정 채널을 권할 출처 근거가 충분하지 않아, 저장된 질문과 출처부터 살펴보는 단계예요.</p>{original && <details><summary>저장된 관찰 원문</summary><p>{original}</p></details>}</>}</details>;
}
export function DiagnosticActionGuide({ priority, dto, original = "", archive, compact = false, printExpanded = false }: { priority: PriorityEvidence | null; dto: EntityFactsV2ReadGatewayDTO; original?: string; archive?: ReactNode; compact?: boolean; printExpanded?: boolean }) {
  const [open,setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const copy = guideCopyFor(priority);
  const valid = dto.overview.validCount > 0;
  const question = nextMeasurementQuestion(dto);
  const hintKind = valid ? actionWritingHintKind(priority, question) : null;
  const title = valid && copy ? copy.title : valid ? "저장된 질문과 출처를 먼저 확인해 주세요" : "답변 결과를 확인한 뒤 다음 할 일을 정해 주세요";
  const task = valid && copy ? copy.task : valid ? "현재 자료만으로 특정 정보의 누락이나 개선 대상을 단정할 수 없어요." : "유효한 답변이 없어 지금은 특정 채널의 개선을 권하기 어려워요.";
  const expanded = !compact || open || printExpanded;
  const branch = [dto.business.name, ...new Set([dto.business.region, dto.business.city].filter(Boolean))].filter(Boolean).join(" · ");
  const collapse = () => { setOpen(false); trigger.current?.focus(); };
  return <section className={`action-guide${compact ? " action-guide-summary" : ""}`} aria-label="먼저 할 일">
    {compact && <div className="diagnostic-action"><div className="diagnostic-action-icon"><MapPin aria-hidden="true"/></div><div><p className="diagnostic-eyebrow">먼저 할 일</p><h3>{title}</h3><p className="action-guide-task">{valid && copy ? copy.where : task}</p></div><Button ref={trigger} className="diagnostic-evidence-cta no-print" aria-expanded={expanded} aria-controls={panelId} onClick={() => { if (open) { collapse(); return; } setOpen(true); requestAnimationFrame(() => { panel.current?.scrollIntoView({block:"nearest",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); panel.current?.focus({preventScroll:true}); }); }}>{open ? "실행 방법 접기" : "실행 방법 보기"}{open ? <ChevronUp aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>}</Button></div>}
    {expanded && <div id={panelId} ref={panel} tabIndex={-1} className="action-guide-panel">
      <h3>{compact ? "실행 방법" : title}</h3>
      {valid && copy ? <ol className="action-guide-steps"><li><span>1</span><div>{copy.where} {branch ? <><strong>{branch}</strong> 표시가 현재 지점 정보와 맞는지 살펴보세요.</> : "현재 지점명과 지역 표시를 살펴보세요."}</div></li><li><span>2</span><div>{copy.task}{hintKind && <> {writingHints[hintKind]}</>}</div></li><li><span>3</span><div>정보가 반영된 뒤 같은 질문으로 다시 측정해 변화를 비교하세요.</div></li></ol> : <p>{task}</p>}
      {valid && priority && copy && <ActionSourceLinks priority={priority} validCount={dto.overview.validCount} targetCount={dto.overview.confirmedMentionCount}/>}
      {question ? <figure className="action-guide-question" data-question-id={question.questionId}><figcaption>다음 측정에서 확인할 질문</figcaption><blockquote>{question.questionText}</blockquote><p>이번 측정에서 우리 업체가 나오지 않은 질문이에요.</p></figure> : <p>{valid ? "이번 자료에서 비교할 미등장 질문을 찾지 못했어요. 저장된 질문과 출처를 살펴보세요." : "비교할 질문은 유효 답변을 확인한 뒤 안내합니다."}</p>}
      <ActionGuideReason priority={valid ? priority : null} original={original} printExpanded={printExpanded}/>
      {archive && <details className="action-guide-original"><summary>판정 기준과 원자료</summary>{archive}</details>}
      {compact && <Button variant="outline" className="no-print" onClick={collapse}><ChevronUp aria-hidden="true"/>접기</Button>}
    </div>}
  </section>;
}
