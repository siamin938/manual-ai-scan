import { describe, expect, it } from "vitest";
import {
  buildCompactSummaryInsights,
  compactSummaryCount,
  compactSummarySearchScopes,
  ownerSearchContextLabel,
  ownerSearchContextAnswerText,
  type CompactSummarySource,
} from "../../src/lib/dashboard-compact-insights";

function fake(args: {
  visibility?: number | null;
  core?: number;
  custom?: number;
  includeScopes?: boolean;
  competitor?: string | null;
  competitorCount?: number;
  pageStatus?: "complete" | "pending" | "not_verified";
  pages?: number | null;
  top3?: number | null;
} = {}): CompactSummarySource {
  const visibility = args.visibility === undefined ? 3 : args.visibility;
  const scopes = args.includeScopes === false ? null : [
    { kind: "core" as const, confirmedCount: args.core ?? 0, validCount: 8, confirmedPct: 0 },
    { kind: "custom" as const, confirmedCount: args.custom ?? 3, validCount: 16, confirmedPct: 18.75 },
    { kind: "overall" as const, confirmedCount: visibility ?? 0, validCount: 24, confirmedPct: null },
  ];
  return {
    visibility: { count: visibility, total: visibility === null ? null : 24, pct: null },
    top3: { count: args.top3 === undefined ? visibility : args.top3, total: 24, pct: null },
    searchScopes: scopes,
    topCompetitor: args.competitor === null
      ? null
      : { name: args.competitor ?? "원투 랩핑 PPF", responseCount: args.competitorCount ?? 4 },
    verifiedPageStatus: args.pageStatus ?? "complete",
    verifiedPageCount: args.pages === undefined ? 0 : args.pages,
  };
}

describe("plain Korean question-type labels and AI-answer counts", () => {
  it("turns all eight original intent IDs into understandable customer categories", () => {
    expect(ownerSearchContextLabel("comparison")).toBe("업체 비교");
    expect(ownerSearchContextLabel("discovery")).toBe("업체 찾아보기");
    expect(ownerSearchContextLabel("local")).toBe("지역에서 업체 찾기");
    expect(ownerSearchContextLabel("recommendation")).toBe("업체 추천");
    expect(ownerSearchContextLabel("service")).toBe("시공·서비스 문의");
    expect(ownerSearchContextLabel("review_quality")).toBe("업체 후기·평판");
    expect(ownerSearchContextLabel("trust")).toBe("전문성·신뢰도 확인");
    expect(ownerSearchContextLabel("price_value")).toBe("가격·가성비 비교");
  });

  it("clarifies that 2/3 means two confirmed answers out of three, not rank two", () => {
    expect(ownerSearchContextAnswerText(2, 3)).toBe("3개 답변 중 2개에서 등장");
    expect(ownerSearchContextAnswerText(1, 3)).toBe("3개 답변 중 1개에서 등장");
    expect(ownerSearchContextAnswerText(0, 3)).toBe("3개 답변 중 0개에서 등장");
    expect(ownerSearchContextAnswerText(3, 3)).toBe("3개 답변 중 3개에서 등장");
  });

  it("does not manufacture answer counts for invalid or future categories", () => {
    expect(ownerSearchContextAnswerText(1, 0)).toBe("확인 가능한 답변 없음");
    expect(ownerSearchContextAnswerText(4, 3)).toBe("확인 가능한 답변 없음");
    expect(ownerSearchContextAnswerText(-1, 3)).toBe("확인 가능한 답변 없음");
    expect(ownerSearchContextLabel("future-type")).toBe("기타 검색 질문");
  });
});

describe("10-second owner summary uses only existing exact observation values", () => {
  it("shows 3/24, core 0/8, custom 3/16 without expanding into four cards", () => {
    const s = fake();
    expect(compactSummaryCount(s.visibility)).toBe("3/24");
    expect(compactSummarySearchScopes(s)?.core.validCount).toBe(8);
    expect(compactSummarySearchScopes(s)?.custom.validCount).toBe(16);
    const items = buildCompactSummaryInsights(s);
    expect(items.map(x => x.id)).toEqual(["broad_scope_gap", "verified_page_zero"]);
    expect(items[0]?.title).toBe("넓은 범위 검색에서 확정 노출 0건");
    expect(items[0]?.evidence).toContain("넓은 범위 검색 0/8");
    expect(items[0]?.evidence).toContain("상세 조건 검색 3/16");
    expect(items[0]?.evidence).toContain("0/8");
    expect(items[0]?.evidence).toContain("3/16");
    expect(items[0]?.recommendedCheck).toContain("서비스 가능 지역");
    expect(items[1]?.recommendedCheck).toContain("실제 인용 페이지");
  });

  it("keeps 카스페이스 pattern truthful without duplicating page and competitor sections", () => {
    const s = fake({ visibility: 16, core: 0, custom: 16, pages: 5, competitor: "퀀텀팩토리 서초점", competitorCount: 6 });
    const items = buildCompactSummaryInsights(s);
    expect(items.map(x=>x.id)).toEqual(["broad_scope_gap", "repeated_competitor"]);
    expect(items[1]?.recommendedCheck).toContain("검색 질문");
  });

  it("zero visibility is not overstated as global unavailability", () => {
    const s = fake({ visibility: 0, custom: 0 });
    const items = buildCompactSummaryInsights(s);
    expect(items.map(x=>x.id)).toEqual(["zero_confirmed", "repeated_competitor"]);
    expect(items[0]?.evidence).toContain("전체 AI 검색에서 보이지 않는다는 뜻은 아닙니다");
    expect(items[0]?.recommendedCheck).toContain("공식 홈페이지");
  });

  it("fails closed for missing or incomplete Core and Custom scopes", () => {
    expect(compactSummarySearchScopes(fake({ includeScopes: false }))).toBeNull();
    const partial = fake();
    partial.searchScopes![0]!.validCount = 7;
    expect(compactSummarySearchScopes(partial)).toBeNull();
    expect(buildCompactSummaryInsights(partial).some(x=>x.id==="broad_scope_gap")).toBe(false);
  });

  it("never calls pending, unverified or unknown page counts verified zero", () => {
    for (const pageStatus of ["pending", "not_verified"] as const) {
      expect(buildCompactSummaryInsights(fake({ pageStatus, pages: 0 }))
        .some(x=>x.id==="verified_page_zero")).toBe(false);
    }
    expect(buildCompactSummaryInsights(fake({ pageStatus: "complete", pages: null }))
      .some(x=>x.id==="verified_page_zero")).toBe(false);
  });

  it("never fabricates two insights when valid evidence is insufficient", () => {
    expect(buildCompactSummaryInsights(fake({
      visibility: null, includeScopes: false, competitor: null, pages: null,
    }))).toEqual([]);
    expect(compactSummaryCount({ count: null, total: null, pct: null })).toBe("확인 불가");
    const one = buildCompactSummaryInsights(fake({
      visibility: 3, core: 2, custom: 1, pageStatus: "not_verified", pages: null,
      competitor: null, top3: 2,
    }));
    expect(one).toHaveLength(0);
  });

  it("keeps source evidence but avoids repeating ratio strings in the recommended checks", () => {
    const s = fake({ visibility: 16, core: 0, custom: 16, pages: 5, competitor: "퀀텀팩토리 서초점", competitorCount: 6 });
    const items = buildCompactSummaryInsights(s);
    expect(items).toHaveLength(2);
    expect(items[0]?.evidence).toContain("0/8");
    expect(items[0]?.recommendedCheck).not.toMatch(/16\/24|0\/8|16\/16/);
  });

  it("keeps input unchanged and does not manufacture causal attribution", () => {
    const s = fake();
    const before = JSON.stringify(s);
    expect(buildCompactSummaryInsights(s)).toEqual(buildCompactSummaryInsights(s));
    expect(JSON.stringify(s)).toBe(before);
    const items = buildCompactSummaryInsights(s);
    expect(items.every((item) => item.recommendedCheck.trim().length > 0)).toBe(true);
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items)).not.toMatch(/원인입니다|개선됩니다|보장합니다/);
  });
});
