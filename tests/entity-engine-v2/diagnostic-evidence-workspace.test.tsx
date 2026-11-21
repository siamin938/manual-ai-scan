import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CurrentRunSourceEvidence, EvidenceArchive, EvidenceBar, isEvidenceTopic, PrintEvidenceArchive, sourceCardMetrics } from "../../src/components/diagnostic-evidence-workspace";

describe("supplemental evidence boundaries", () => {
  it("does not construct a ratio when there are zero valid responses", () => {
    const bar = EvidenceBar({ confirmed: 0, valid: 0, label: "test" });
    expect(bar.props.role).toBeUndefined();
    expect(bar.props["aria-valuemax"]).toBeUndefined();
  });
  it("uses the valid response denominator, not the question count", () => {
    const bar = EvidenceBar({ confirmed: 3, valid: 16, label: "test" });
    expect(bar.props["aria-valuemax"]).toBe(16);
    expect(bar.props["aria-valuenow"]).toBe(3);
  });
  it("accepts all six original anchor topics and rejects unrelated navigation", () => {
    expect(["questions", "businesses", "sources", "comparison", "priorities", "method"].every(isEvidenceTopic)).toBe(true);
    expect(isEvidenceTopic("dashboard")).toBe(false);
  });
  it("does not mount the old report before an explicit source request", () => {
    const html = renderToStaticMarkup(createElement(EvidenceArchive, { topic: "questions", children: "protected long report" }));
    expect(html).toBe("");
  });
  it("keeps zero verified pages separate from one direct source", () => {
    const result = sourceCardMetrics({
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: true, status: "complete", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: true, referenceSourcesAvailable: false, rows: [{ domain: "example.com", responseCount: 1, targetResponseCount: 1, competitorResponseCount: 0, clueResponseCount: 0, evidence: "confirmed", linkedEntities: [] }] },
    });
    expect(result.pages).toBe(0);
    expect(result.direct).toBe(1);
  });
  it("does not turn unverified pages or uncollected direct sources into zero", () => {
    const result = sourceCardMetrics({
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: false, status: "not_verified", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: false, referenceSourcesAvailable: false, rows: [] },
    });
    expect(result.pages).toBeNull();
    expect(result.direct).toBeNull();
    expect(result.pageState).toBe("미검증");
  });

  it("keeps this run's zero verified pages and one direct source separate from the market sample", () => {
    const model = {
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: true, status: "complete", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: true, referenceSourcesAvailable: false, rows: [{ domain: "example.com", responseCount: 1, targetResponseCount: 1, competitorResponseCount: 0, clueResponseCount: 0, evidence: "confirmed", linkedEntities: [] }] },
      targetReferenceSources: { rows: [] },
      targetExposureCitationSources: { available: true, rows: [] },
    } as never;
    const html = renderToStaticMarkup(createElement(CurrentRunSourceEvidence, {
      dto: { targetReferenceSources: true } as never,
      model,
    }));
    expect(html).toContain("이번 측정의 인용 근거");
    expect(html).toContain("위 시장 표본과 합산하지 않습니다");
    expect(html).toContain("관련 페이지 0개");
    expect(html).toContain("답변 내 직접 연결 1개");
    expect(html).toContain("example.com");
    expect(html).not.toContain("추가 분석/근거 보기");
    expect(html).not.toContain('<details class="current-run-source-evidence" open');
  });

  it("opens current-run citations and the existing long archive only for print", () => {
    const model = {
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: false, status: "not_verified", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: false, referenceSourcesAvailable: false, rows: [] },
      targetReferenceSources: { rows: [] },
      targetExposureCitationSources: { available: false, rows: [] },
    } as never;
    const html = renderToStaticMarkup(createElement(CurrentRunSourceEvidence, {
      dto: { targetReferenceSources: false } as never,
      model,
      printExpanded: true,
    }));
    expect(html).toContain('<details class="current-run-source-evidence" open');
    expect(html).toContain("미검증");
    expect(html).toContain("답변 내 직접 연결 미수집");

    const archive = renderToStaticMarkup(createElement(PrintEvidenceArchive, {
      printExpanded: true,
      children: createElement(EvidenceArchive, { topic: "method", children: "인쇄용 측정 기준" }),
    }));
    expect(archive).toContain("인쇄용 측정 기준");
    expect(archive).toContain("evidence-print-archive");
  });
});