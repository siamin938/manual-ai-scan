import { describe, expect, it } from "vitest";
import {
  buildAttributionRows,
  dedupeCitations,
  domainFromUrl,
  extractUrlCitations,
  findEntityOccurrences,
  type AttributionEntityInput,
} from "./citation-attribution.engine.server";
import { aggregateAttributedSources } from "./citation-attribution.aggregate";

const CLIENT: AttributionEntityInput = {
  canonicalKey: "business:b1",
  canonicalDisplayName: "타깃업체 A지점",
  mentionId: "m-client",
  matchTexts: ["타깃업체 A지점", "타깃업체"],
};
const RIVAL: AttributionEntityInput = {
  canonicalKey: "auto:경쟁업체b",
  canonicalDisplayName: "경쟁업체 B",
  mentionId: "m-rival",
  matchTexts: ["경쟁업체 B"],
};

function cite(url: string, startIndex: number) {
  return { url, title: null, startIndex, endIndex: startIndex + 10 };
}

describe("citation attribution engine v0.1.0", () => {
  it("finds occurrences through markdown decoration", () => {
    const text = "- **타깃업체 A지점**은 프리미엄 오일 전문";
    const occ = findEntityOccurrences(text, [CLIENT]);
    expect(occ).toHaveLength(1);
    expect(text.slice(occ[0]!.start, occ[0]!.end)).toContain("타깃업체");
  });

  it("attributes each business to the citation on its own line (no cross-attribution)", () => {
    const line1 = "- **타깃업체 A지점** — 순정 오일 전문입니다. ";
    const c1 = "([yna.co.kr](https://www.yna.co.kr/a))";
    const line2 = "\n- **경쟁업체 B** — 합성유 전문입니다. ";
    const c2 = "([oiltune.tistory.com](https://oiltune.tistory.com/))";
    const text = line1 + c1 + line2 + c2;
    const rows = buildAttributionRows({
      measurementId: "meas-1",
      responseText: text,
      citations: [
        cite("https://www.yna.co.kr/a", line1.length),
        cite("https://oiltune.tistory.com/", line1.length + c1.length + line2.length),
      ],
      entities: [CLIENT, RIVAL],
    });
    expect(rows).toHaveLength(2);
    const yna = rows.find((r) => r.citationUrl.includes("yna"))!;
    const oil = rows.find((r) => r.citationUrl.includes("oiltune"))!;
    expect(yna.canonicalKey).toBe("business:b1");
    expect(yna.attributionLevel).toBe("direct");
    expect(oil.canonicalKey).toBe("auto:경쟁업체b");
    expect(oil.attributionLevel).toBe("direct");
  });

  it("never attributes a citation to a business only because it appears in the same answer", () => {
    const text =
      "## 추천\n- **타깃업체 A지점** 소개 문장입니다.\n- **경쟁업체 B** 소개 문장입니다. ([oiltune.tistory.com](https://oiltune.tistory.com/))";
    const start = text.indexOf("([oiltune");
    const rows = buildAttributionRows({
      measurementId: "meas-2",
      responseText: text,
      citations: [cite("https://oiltune.tistory.com/", start)],
      entities: [CLIENT, RIVAL],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.canonicalKey).toBe("auto:경쟁업체b");
  });

  it("falls back to section level inside a business section", () => {
    const text =
      "### 1. 타깃업체 A지점\n- 위치: 판교\n- 가격대는 합리적입니다.\n\n참고 자료입니다. ([yna.co.kr](https://www.yna.co.kr/a))\n\n### 2. 경쟁체인\n";
    const start = text.indexOf("([yna");
    const rows = buildAttributionRows({
      measurementId: "meas-3",
      responseText: text,
      citations: [cite("https://www.yna.co.kr/a", start)],
      entities: [CLIENT],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attributionLevel).toBe("section");
    expect(rows[0]!.evidence.relation).toBe("same_section");
  });

  it("produces no row for an ambiguous citation outside any business section", () => {
    const text =
      "판교 지역 정비소 시장은 경쟁이 치열합니다. ([news.example.com](https://news.example.com/a))\n\n### 타깃업체 A지점\n";
    const start = text.indexOf("([news");
    const rows = buildAttributionRows({
      measurementId: "meas-4",
      responseText: text,
      citations: [cite("https://news.example.com/a", start)],
      entities: [CLIENT, RIVAL],
    });
    expect(rows).toHaveLength(0);
  });

  it("does not attribute across a distance larger than the direct limit", () => {
    const filler = "가".repeat(600);
    const text = `- 타깃업체 A지점 소개 ${filler} 참고 ([yna.co.kr](https://www.yna.co.kr/a))`;
    const start = text.indexOf("([yna");
    const rows = buildAttributionRows({
      measurementId: "meas-5",
      responseText: text,
      citations: [cite("https://www.yna.co.kr/a", start)],
      entities: [CLIENT],
    });
    // Same bullet line but too far for `direct`; the bullet still opens a
    // section for this entity, so at most a conservative `section` row.
    expect(rows.every((r) => r.attributionLevel === "section")).toBe(true);
  });

  it("allows two businesses on the same table row", () => {
    const text = "| 타깃업체 A지점 대비 경쟁업체 B 우위 ([a.com](https://a.com/x)) |";
    const start = text.indexOf("([a.com");
    const rows = buildAttributionRows({
      measurementId: "meas-6",
      responseText: text,
      citations: [cite("https://a.com/x", start)],
      entities: [CLIENT, RIVAL],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.evidence.relation === "same_row")).toBe(true);
  });

  it("dedupes repeated provider annotations and extracts url_citations", () => {
    const payload = {
      output: [
        {
          content: [
            {
              annotations: [
                {
                  type: "url_citation",
                  url: "https://a.com/x",
                  title: "A",
                  start_index: 10,
                  end_index: 20,
                },
                {
                  type: "url_citation",
                  url: "https://a.com/x",
                  title: "A",
                  start_index: 10,
                  end_index: 20,
                },
                { type: "file_citation", url: "https://b.com/y", start_index: 1, end_index: 2 },
              ],
            },
          ],
        },
      ],
    };
    const citations = extractUrlCitations(payload);
    expect(citations).toHaveLength(1);
    expect(citations[0]!.url).toBe("https://a.com/x");
    expect(dedupeCitations([...citations, ...citations])).toHaveLength(1);
    expect(domainFromUrl("https://www.yna.co.kr/amp/view/x?y=1")).toBe("yna.co.kr");
  });

  it("aggregates stored rows per domain and side", () => {
    const out = aggregateAttributedSources({
      rows: [
        {
          domain: "oiltune.tistory.com",
          title: "오일튠",
          measurement_id: "m1",
          canonical_key: "auto:경쟁업체b",
          canonical_display_name: "경쟁업체 B",
          attribution_level: "direct",
        },
        {
          domain: "oiltune.tistory.com",
          title: null,
          measurement_id: "m2",
          canonical_key: "business:b1",
          canonical_display_name: "타깃업체 A지점",
          attribution_level: "section",
        },
      ],
      clientKey: "business:b1",
      competitorKey: "auto:경쟁업체b",
      competitorName: "경쟁업체 B",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.competitorDirectResponseCount).toBe(1);
    expect(out[0]!.clientSectionResponseCount).toBe(1);
    expect(out[0]!.clientDirectResponseCount).toBe(0);
  });
});
