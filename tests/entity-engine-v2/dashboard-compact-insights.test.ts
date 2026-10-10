import { describe, expect, it } from "vitest";
import {
  buildCompactSummaryInsights,
  compactSummaryCount,
  compactSummarySearchScopes,
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

describe("10-second owner summary uses only existing exact observation values", () => {
  it("shows 3/24, core 0/8, custom 3/16 without expanding into four cards", () => {
    const s = fake();
    expect(compactSummaryCount(s.visibility)).toBe("3/24");
    expect(compactSummarySearchScopes(s)?.core.validCount).toBe(8);
    expect(compactSummarySearchScopes(s)?.custom.validCount).toBe(16);
    const items = buildCompactSummaryInsights(s);
    expect(items.map(x => x.id)).toEqual(["broad_scope_gap", "verified_page_zero"]);
    expect(items[0]?.evidence).toContain("0/8");
    expect(items[0]?.evidence).toContain("3/16");
  });

  it("keeps 카스페이스 pattern truthful without duplicating page and competitor sections", () => {
    const s = fake({ visibility: 16, core: 0, custom: 16, pages: 5, competitor: "퀀텀팩토리 서초점", competitorCount: 6 });
    expect(buildCompactSummaryInsights(s).map(x=>x.id)).toEqual(["broad_scope_gap", "repeated_competitor"]);
  });

  it("zero visibility is not overstated as global unavailability", () => {
    const s = fake({ visibility: 0, custom: 0 });
    const items = buildCompactSummaryInsights(s);
    expect(items.map(x=>x.id)).toEqual(["zero_confirmed", "repeated_competitor"]);
    expect(items[0]?.evidence).toContain("전체 AI 검색에서 보이지 않는다는 뜻은 아닙니다");
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

  it("keeps input unchanged and does not manufacture causal attribution", () => {
    const s = fake();
    const before = JSON.stringify(s);
    expect(buildCompactSummaryInsights(s)).toEqual(buildCompactSummaryInsights(s));
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(buildCompactSummaryInsights(s))).not.toMatch(/원인입니다|개선됩니다|보장합니다/);
  });
});
