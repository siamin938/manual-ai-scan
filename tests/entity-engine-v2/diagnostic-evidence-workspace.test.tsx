import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CurrentRunSourceEvidence, currentRunSourceCategories, EvidenceArchive, EvidenceBar, initialCurrentRunSourceCategory, isEvidenceTopic, PrintEvidenceArchive, sourceCardMetrics } from "../../src/components/diagnostic-evidence-workspace";

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

  it("selects the first positive category and keeps page counts distinct from domain counts", () => {
    const pages = Array.from({ length: 5 }, (_, index) => ({ domain: `page-${index}.example`, title: `저장된 페이지 ${index + 1}`, responseCount: 1, citationCount: 1, sampleUrl: `https://page-${index}.example/saved`, confidence: "high", basisLabel: "상호 확인" }));
    const model = {
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: true, status: "complete", rows: pages },
      sources: { heading: "업체 연결까지 확인된 출처", available: true, referenceSourcesAvailable: false, rows: [{ domain: "direct.example", responseCount: 1, targetResponseCount: 1, competitorResponseCount: 0, clueResponseCount: 0, evidence: "confirmed", linkedEntities: [] }] },
      targetReferenceSources: { rows: [] },
      targetExposureCitationSources: { available: true, rows: Array.from({ length: 5 }, (_, index) => ({ domain: `together-${index}.example`, responseCount: 1, citationCount: 1, sampleUrl: "" })) },
    } as never;
    const dto = { targetReferenceSources: [] } as never;
    const categories = currentRunSourceCategories(dto, model);
    expect(categories.map(category => category.value)).toEqual([5, 1, 5, 0]);
    expect(categories.map(category => category.unit)).toEqual(["페이지", "도메인", "도메인", "도메인"]);
    expect(initialCurrentRunSourceCategory(categories)).toBe("pages");

    const html = renderToStaticMarkup(createElement(CurrentRunSourceEvidence, { dto, model }));
    const screen = html.split("current-run-source-print")[0] ?? "";
    expect(screen).toContain("우리 업체는 어디에 나왔나요?");
    expect(screen).toContain("저장된 페이지 1");
    expect(screen).toContain("https://page-0.example/saved");
    expect(screen).not.toContain("저장된 페이지 3");
    expect(screen).toContain("나머지 3개 보기 · 전체 5개");
    expect(screen).not.toContain("<details");
    expect(html).toContain("저장된 페이지 5");
  });

  it("skips zero counts to select the first positive available domain category", () => {
    const model = {
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: true, status: "complete", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: true, referenceSourcesAvailable: false, rows: [{ domain: "direct.example", responseCount: 1, targetResponseCount: 1, competitorResponseCount: 0, clueResponseCount: 0, evidence: "confirmed", linkedEntities: [] }] },
      targetReferenceSources: { rows: [] },
      targetExposureCitationSources: { available: true, rows: [] },
    } as never;
    const html = renderToStaticMarkup(createElement(CurrentRunSourceEvidence, { dto: { targetReferenceSources: [] } as never, model }));
    expect(html).toContain('aria-label="AI 답변에서 직접 연결" aria-live="polite"');
    expect(html).toContain("direct.example");
    expect(html).not.toContain("추가 분석/근거 보기");
  });

  it("preserves pending, unverified and uncollected states instead of plotting zeros", () => {
    const model = {
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: false, status: "pending", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: false, referenceSourcesAvailable: false, rows: [] },
      targetReferenceSources: { rows: [] },
      targetExposureCitationSources: { available: false, rows: [] },
    } as never;
    const categories = currentRunSourceCategories({} as never, model);
    expect(categories.map(category => category.value)).toEqual([null, null, null, null]);
    expect(categories.map(category => category.state)).toEqual(["확인 중", "미수집", "미수집", "미수집"]);
    const html = renderToStaticMarkup(createElement(CurrentRunSourceEvidence, { dto: {} as never, model, printExpanded: true }));
    expect(html).toContain("확인 중");
    expect(html).toContain("미수집");
    expect(html).not.toContain('<details class="current-run-source-evidence"');
  });

  it("keeps all four categories and every saved row in the print presentation", () => {
    const model = {
      verifiedTargetCitationPages: { heading: "페이지 내용 기준 관련 확인", available: false, status: "not_verified", rows: [] },
      sources: { heading: "업체 연결까지 확인된 출처", available: false, referenceSourcesAvailable: false, rows: [] },
      targetReferenceSources: { rows: [{ domain: "clue.example", responseCount: 1, sampleUrl: "" }] },
      targetExposureCitationSources: { available: true, rows: [{ domain: "together.example", responseCount: 1, citationCount: 1, sampleUrl: "" }] },
    } as never;
    const html = renderToStaticMarkup(createElement(CurrentRunSourceEvidence, { dto: { targetReferenceSources: [{}] } as never, model, printExpanded: true }));
    for (const label of ["업체가 확인된 페이지", "AI 답변에서 직접 연결", "같은 답변에 나온 출처", "연결 단서"]) expect(html).toContain(label);
    expect(html).toContain("미검증");
    expect(html).toContain("clue.example");
    expect(html).toContain("together.example");
    expect(html).toContain("current-run-source-print diagnostic-print-only");

    const archive = renderToStaticMarkup(createElement(PrintEvidenceArchive, {
      printExpanded: true,
      children: createElement(EvidenceArchive, { topic: "method", children: "인쇄용 측정 기준" }),
    }));
    expect(archive).toContain("인쇄용 측정 기준");
    expect(archive).toContain("evidence-print-archive");
  });
});
