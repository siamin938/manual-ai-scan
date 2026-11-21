import { describe, expect, it } from "vitest";
import { citationPageKey, collectAnswerSignals, type CitationSpan } from "../../src/lib/profile-answer-signals";

const name = "비교 정비소";
const key = "peer";
const url = "https://daangn.com/kr/local-profile/example";
function fixture(id: string, description: string) {
  const text = name + " " + description + " ([당근](" + url + "))";
  const row: CitationSpan = { measurement_id: id, canonical_key: key, canonical_display_name: name,
    citation_url: url, entity_start_index: 0, entity_end_index: name.length,
    citation_start_index: text.indexOf("[당근]"), citation_end_index: text.length - 1 };
  return { row, answer: { questionId: "q" + id, text, confirmedKeys: [key] } };
}

describe("stored source-specific answer evidence", () => {
  it("counts distinct confirmed answers per signal and prefers a missed question for the example", () => {
    const a = fixture("1", "후기 62개, 평점 4.5, 단골 778명");
    const b = fixture("2", "리뷰 62건");
    const result = collectAnswerSignals([a.row, a.row, b.row], new Map([["1", a.answer], ["2", b.answer]]), [name], new Set(["q2"]));
    expect(result.get(citationPageKey(name, url))).toEqual({ counts: {reviews: 2, rating: 1, regulars: 1},
      example: { questionId: "q2", measurementId: "2", phrases: ["리뷰 62건"] } });
  });
  it("skips ambiguous spans and mismatched citations or identities", () => {
    const a = fixture("1", "다른 정비소의 후기 20개");
    const b = fixture("2", "후기 10개");
    const c = fixture("3", "단골 5명");
    const rows = [a.row, {...b.row, citation_url: url + "2"}, {...b.row, entity_end_index: 1}, c.row];
    const answers = new Map([["1", a.answer], ["2", b.answer], ["3", {...c.answer, confirmedKeys: []}]]);
    expect(collectAnswerSignals(rows, answers, [name, "다른 정비소"], new Set()).size).toBe(0);
  });
});
