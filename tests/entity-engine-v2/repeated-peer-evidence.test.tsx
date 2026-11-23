import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RepeatedPeerEvidence } from "../../src/components/repeated-peer-evidence";

const rows = [
  { name: "선택 업체", responseCount: 3, questionCount: 2, intentCount: 2, top3ResponseCount: 1, sources: [{ domain: "saved.example", count: 2, url: "https://saved.example/verified" }] },
  { name: "링크가 없는 아주 긴 자동차 업체", responseCount: 2, questionCount: 2, intentCount: 1, top3ResponseCount: 0, sources: [{ domain: "plain.example", count: 1 }] },
] as never;

describe("repeated peer compact evidence", () => {
  it("shows answer counts on cards and only saved links as anchors", () => {
    const html = renderToStaticMarkup(createElement(RepeatedPeerEvidence, { rows, validCount: 8, targetCount: 1, sourcesAvailable: true }));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="선택 업체 등장 답변의 출처 보기, 3개 답변에 등장"');
    expect(html).toContain('<strong>3</strong><small>개 답변에 등장</small>');
    expect(html).toContain('href="https://saved.example/verified"');
    expect(html).toContain("함께 인용된 답변 2개");
    expect(html).toContain("<strong>plain.example</strong>");
    expect(html).not.toContain('href="plain.example"');
    expect(html).toContain("유효 답변 8개 · 내 업체 1회 등장 · 두 번 이상 나온 다른 업체 2곳");
  });

  it("keeps every peer and source available to print and explains unavailable evidence", () => {
    const html = renderToStaticMarkup(createElement(RepeatedPeerEvidence, { rows, validCount: 8, targetCount: 0, sourcesAvailable: false, printExpanded: true }));
    expect(html).toContain("peer-print-list diagnostic-print-only");
    expect(html).toContain("선택 업체 등장 답변의 출처");
    expect(html).toContain("링크가 없는 아주 긴 자동차 업체 등장 답변의 출처");
    expect(html).toContain('aria-label="선택 업체 등장 답변의 출처"');
    const empty = renderToStaticMarkup(createElement(RepeatedPeerEvidence, { rows: [] as never, validCount: 0, targetCount: 0, sourcesAvailable: false }));
    expect(empty).toContain("두 번 이상 확인된 다른 업체가 없습니다.");
    expect(empty).not.toContain("NaN");
  });
});
