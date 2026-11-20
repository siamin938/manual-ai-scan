import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceArchive, EvidenceBar, isEvidenceTopic, sourceCardMetrics } from "../../src/components/diagnostic-evidence-workspace";

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
});