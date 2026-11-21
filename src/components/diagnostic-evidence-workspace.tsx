import { createContext, useContext, type ReactNode } from "react";
import { ChevronDown, Link2, ShieldCheck } from "lucide-react";
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
  return {
    pages: model.verifiedTargetCitationPages.status === "complete" && model.verifiedTargetCitationPages.available ? model.verifiedTargetCitationPages.rows.length : null,
    pageState: model.verifiedTargetCitationPages.status === "pending" ? "확인 중" : model.verifiedTargetCitationPages.status === "not_verified" ? "미검증" : "미수집",
    direct: model.sources.available ? model.sources.rows.filter(row => row.evidence !== "clue" && row.targetResponseCount > 0).length : null,
  };
}

export function CurrentRunSourceEvidence({ dto, model, printExpanded = false }: {
  dto: EntityFactsV2ReadGatewayDTO;
  model: EntityFactsV2DashboardCutoverModel;
  printExpanded?: boolean;
}) {
  const verified = model.verifiedTargetCitationPages;
  const metrics = sourceCardMetrics(model);
  const pageState = verified.status === "complete" ? `${verified.rows.length}개 확인` : metrics.pageState;
  const directState = metrics.direct === null ? "미수집" : `${metrics.direct}개`;
  const sourceLists = [
    { label: "페이지 내용 확인", state: pageState, rows: verified.rows },
    { label: "AI 답변에서 직접 연결", state: directState, rows: model.sources.rows.filter(row => row.evidence !== "clue" && row.targetResponseCount > 0) },
    { label: "근접 단서", state: dto.targetReferenceSources ? `${model.targetReferenceSources.rows.length}개` : "미수집", rows: model.targetReferenceSources.rows },
    { label: "업체가 나온 답변에 함께 인용 · 참고", state: model.targetExposureCitationSources.available ? `${model.targetExposureCitationSources.rows.length}개` : "미수집", rows: model.targetExposureCitationSources.rows },
  ];

  return <details className="current-run-source-evidence" open={printExpanded || undefined}>
    <summary>
      <span><small>우리 업체 · 이번 측정</small><strong>이번 측정의 인용 근거</strong></span>
      <span className="current-run-source-summary-metrics"><span>관련 페이지 {metrics.pages === null ? metrics.pageState : `${metrics.pages}개`}</span><span>답변 내 직접 연결 {directState}</span></span>
      <ChevronDown className="current-run-source-chevron" aria-hidden="true" />
    </summary>
    <div className="current-run-source-body">
      <p>이번 측정에서 확인한 우리 업체의 출처 근거입니다. 위 시장 표본과 합산하지 않습니다.</p>
      <div className="evidence-source-states">{sourceLists.map((list, index) => {
        const Icon = index === 0 ? ShieldCheck : Link2;
        return <div key={list.label}><Icon aria-hidden="true"/><strong>{list.label}</strong><span>{list.state}</span><ul>{list.rows.slice(0, 2).map((row, rowIndex) => <li key={`${row.domain}:${rowIndex}`}>{"sampleUrl" in row ? <a href={row.sampleUrl} target="_blank" rel="noopener noreferrer">{row.domain}</a> : row.domain}</li>)}</ul></div>;
      })}</div>
    </div>
  </details>;
}
