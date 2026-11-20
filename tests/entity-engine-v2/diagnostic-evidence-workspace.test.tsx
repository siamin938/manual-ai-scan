import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceArchive, EvidenceBar, isEvidenceTopic } from "../../src/components/diagnostic-evidence-workspace";

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
});