import { createContext, useContext, useState, type ReactNode } from "react";
import { Check, ChevronRight, ExternalLink, Link2, Quote, Search, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";
import type { EntityFactsV2DashboardCutoverModel } from "@/lib/entity-facts-v2-read-gateway.dashboard-cutover";

export const evidenceTopics = ["questions", "businesses", "sources", "comparison", "priorities", "method"] as const;
export type EvidenceTopic = typeof evidenceTopics[number];
export function isEvidenceTopic(value: string): value is EvidenceTopic { return evidenceTopics.some(topic => topic === value); }
const PrintArchiveContext = createContext(false);

// The full reports are included only when preparing the printable report.
export function EvidenceArchive({ children }: { topic: EvidenceTopic; children: ReactNode }) {
  return useContext(PrintArchiveContext) ? <section className="evidence-archive">{children}</section> : null;
}

export function PrintEvidenceArchive({ printExpanded, children }: { printExpanded: boolean; children: ReactNode }) {
  return printExpanded ? <div className="evidence-print-archive"><PrintArchiveContext.Provider value={true}>{children}</PrintArchiveContext.Provider></div> : null;
}

export function EvidenceBar({ confirmed, valid, label }: { confirmed: number; valid: number; label: string }) {
  if (valid <= 0) return <span className="evidence-empty">유효 응답 없음</span>;
  return <div className="evidence-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={valid} aria-valuenow={confirmed}><span style={{ width: `${Math.min(100, Math.max(0, confirmed / valid * 100))}%` }} /></div>;
}

export function sourceCardMetrics(model: Pick<EntityFactsV2DashboardCutoverModel, "verifiedTargetCitationPages" | "sources">) {
  const pageState: Exclude<SourceState, null> = model.verifiedTargetCitationPages.status === "pending" ? "확인 중" : model.verifiedTargetCitationPages.status === "not_verified" ? "미검증" : "미수집";
  return {
    pages: model.verifiedTargetCitationPages.status === "complete" && model.verifiedTargetCitationPages.available ? model.verifiedTargetCitationPages.rows.length : null,
    pageState,
    direct: model.sources.available ? model.sources.rows.filter(row => row.evidence !== "clue" && row.targetResponseCount > 0).length : null,
  };
}

type SourceState = "미수집" | "확인 중" | "미검증" | null;
type CurrentRunSourceRow = {
  domain: string;
  responseCount: number;
  sampleUrl?: string;
  title?: string | null;
};
type CurrentRunSourceCategory = {
  key: "pages" | "direct" | "together" | "clues";
  label: string;
  unit: "페이지" | "도메인";
  value: number | null;
  state: SourceState;
  description: string;
  rows: readonly CurrentRunSourceRow[];
  icon: LucideIcon;
};

export function currentRunSourceCategories(dto: EntityFactsV2ReadGatewayDTO, model: EntityFactsV2DashboardCutoverModel): CurrentRunSourceCategory[] {
  const metrics = sourceCardMetrics(model);
  return [
    {
      key: "pages", label: "업체가 확인된 페이지", unit: "페이지", value: metrics.pages,
      state: metrics.pages === null ? metrics.pageState : null,
      description: "실제 인용 페이지의 내용에서 우리 업체 관련성을 확인한 페이지입니다.",
      rows: model.verifiedTargetCitationPages.rows, icon: ShieldCheck,
    },
    {
      key: "direct", label: "AI 답변에서 직접 연결", unit: "도메인", value: metrics.direct,
      state: metrics.direct === null ? "미수집" : null,
      description: "AI 답변에서 우리 업체와 이 출처 도메인의 연결이 함께 확인됐습니다.",
      rows: model.sources.rows.filter(row => row.evidence !== "clue" && row.targetResponseCount > 0), icon: Link2,
    },
    {
      key: "together", label: "같은 답변에 나온 출처", unit: "도메인",
      value: model.targetExposureCitationSources.available ? model.targetExposureCitationSources.rows.length : null,
      state: model.targetExposureCitationSources.available ? null : "미수집",
      description: "우리 업체가 나온 답변에 함께 인용된 출처입니다. 우리 업체와 직접 연결됐다는 뜻은 아닙니다.",
      rows: model.targetExposureCitationSources.rows, icon: Quote,
    },
    {
      key: "clues", label: "연결 단서", unit: "도메인",
      value: dto.targetReferenceSources ? model.targetReferenceSources.rows.length : null,
      state: dto.targetReferenceSources ? null : "미수집",
      description: "우리 업체와의 연결을 살펴볼 단서이며, 직접 연결로 확정한 출처는 아닙니다.",
      rows: model.targetReferenceSources.rows, icon: Search,
    },
  ];
}

export function initialCurrentRunSourceCategory(categories: readonly Pick<CurrentRunSourceCategory, "key" | "value">[]): CurrentRunSourceCategory["key"] {
  return (categories.find(category => category.value !== null && category.value > 0) ?? categories.find(category => category.value !== null) ?? categories[0])?.key ?? "pages";
}

function CurrentRunSourceRows({ rows, all = false }: { rows: readonly CurrentRunSourceRow[]; all?: boolean }) {
  return <ul className="current-run-source-rows">{(all ? rows : rows.slice(0, 2)).map((row, index) => {
    const title = row.title?.trim() || row.domain;
    return <li key={`${row.domain}:${row.sampleUrl ?? "text"}:${index}`}>
      <div><strong>{title}</strong><span>{title !== row.domain ? `${row.domain} · ` : ""}답변 {row.responseCount}개</span></div>
      {row.sampleUrl ? <a href={row.sampleUrl} target="_blank" rel="noopener noreferrer" aria-label={`${title} 저장된 출처를 새 창에서 열기`}><span>링크</span><ExternalLink aria-hidden="true" /></a> : null}
    </li>;
  })}</ul>;
}

function CurrentRunSourceEmpty({ category }: { category: CurrentRunSourceCategory }) {
  if (category.value === null) return <p className="current-run-source-empty">이 분류는 {category.state ?? "미수집"} 상태입니다.</p>;
  if (category.rows.length === 0) return <p className="current-run-source-empty">이 분류에서 확인된 출처가 없습니다.</p>;
  return null;
}

export function CurrentRunSourceEvidence({ dto, model, printExpanded = false }: {
  dto: EntityFactsV2ReadGatewayDTO;
  model: EntityFactsV2DashboardCutoverModel;
  printExpanded?: boolean;
}) {
  const categories = currentRunSourceCategories(dto, model);
  const [selectedKey, setSelectedKey] = useState<CurrentRunSourceCategory["key"]>(() => initialCurrentRunSourceCategory(categories));
  const [expanded, setExpanded] = useState(false);
  const selected = categories.find(category => category.key === selectedKey) ?? categories[0]!;
  const showAll = expanded || printExpanded;

  return <section className="current-run-source-evidence" aria-label="우리 업체의 이번 측정 인용 근거">
    <header className="current-run-source-heading"><p>우리 업체 · 이번 측정</p><h2>우리 업체는 어디에 나왔나요?</h2><span>아래 시장 표본과 합산하지 않는 이번 측정의 저장된 근거입니다.</span></header>
    <div className="current-run-source-choices no-print" aria-label="우리 업체 출처 분류">{categories.map(category => {
      const Icon = category.icon;
      const active = selected.key === category.key;
      return <Button key={category.key} variant="outline" className="current-run-source-choice" aria-pressed={active} aria-controls="current-run-source-panel" onClick={() => { setSelectedKey(category.key); setExpanded(false); }}>
        <span className="current-run-source-choice-top"><Icon aria-hidden="true" />{active ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</span>
        <span className="current-run-source-choice-value">{category.value === null ? <strong className="current-run-source-state">{category.state}</strong> : <><strong>{category.value}</strong><small>{category.unit}</small></>}</span>
        <span className="current-run-source-choice-label">{category.label}</span>
      </Button>;
    })}</div>
    <section id="current-run-source-panel" className="current-run-source-panel no-print" aria-label={selected.label} aria-live="polite">
      <h3>{selected.label}</h3><p>{selected.description}</p>
      <CurrentRunSourceEmpty category={selected} />
      <CurrentRunSourceRows rows={selected.rows} all={showAll} />
      {selected.rows.length > 2 && <Button variant="outline" className="current-run-source-more" onClick={() => setExpanded(value => !value)}>{showAll ? "간단히 접기" : `나머지 ${selected.rows.length - 2}개 보기 · 전체 ${selected.rows.length}개`}</Button>}
    </section>
    <div className="current-run-source-print diagnostic-print-only">{categories.map(category => <section key={category.key} aria-label={category.label}>
      <h3>{category.label} · {category.value === null ? category.state : `${category.value}${category.unit}`}</h3>
      <p>{category.description}</p><CurrentRunSourceEmpty category={category} /><CurrentRunSourceRows rows={category.rows} all />
    </section>)}</div>
  </section>;
}
