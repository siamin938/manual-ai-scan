import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitActionOpportunityV1Items } from "../../src/lib/action-opportunity-v1.presentation";
import type { ActionOpportunityV1Item } from "../../src/lib/action-opportunity-v1.rules";

function item(rank: number, priority: "high" | "review"): ActionOpportunityV1Item {
  return {
    id: rank === 1 ? "core_exposure_gap" :
      rank === 2 ? "verified_citation_page_gap" :
      rank === 3 ? "repeated_competitor" : "competitor_source_difference",
    rank,
    priority,
    title: "관찰 " + rank,
    observation: "",
    whyItMatters: "",
    recommendedCheck: "",
    evidence: [],
    confidence: "high",
    scope: {
      kind: "exact_representative_run",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      measuredAt: "2026-10-05T00:00:00Z",
    },
    disclaimer: "인과관계가 아닙니다.",
  };
}

describe("Action Opportunity v1.0 internal preview presentation", () => {
  it("does not manufacture opportunities when data is empty", () => {
    expect(splitActionOpportunityV1Items([])).toEqual({ primary: [], additional: [] });
  });

  it("keeps one and two observations visible without creating a hidden section", () => {
    const rows = [item(1, "high"), item(2, "review")];
    expect(splitActionOpportunityV1Items(rows.slice(0, 1)).additional).toEqual([]);
    expect(splitActionOpportunityV1Items(rows).primary).toEqual(rows);
    expect(splitActionOpportunityV1Items(rows).additional).toEqual([]);
  });

  it("shows two first observations and keeps every supporting observation expandable", () => {
    const rows = Object.freeze([
      item(1, "high"),
      item(2, "review"),
      item(3, "review"),
      item(4, "review"),
    ]);
    const result = splitActionOpportunityV1Items(rows);
    expect(result.primary.map(row => row.rank)).toEqual([1, 2]);
    expect(result.additional.map(row => row.rank)).toEqual([3, 4]);
    expect([...result.primary, ...result.additional]).toEqual(rows);
    expect(rows.map(row => row.rank)).toEqual([1, 2, 3, 4]);
  });

  it("never invents a model confidence score or reorders the original evidence", () => {
    const rows = [item(1, "review"), item(2, "high"), item(3, "review")];
    const result = splitActionOpportunityV1Items(rows);
    expect(result.primary.map(row => row.priority)).toEqual(["review", "high"]);
    expect(result.additional[0]).toBe(rows[2]);
    expect(result.primary[0]?.scope.runId).toBe(rows[0]!.scope.runId);
  });

  it("keeps the extra cards accessible in admin-only native disclosure", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/internal-observation-pipeline.tsx"),
      "utf8",
    );
    const customer = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(route).toContain("splitActionOpportunityV1Items");
    expect(route).toContain("actionOpportunityPresentation.primary.map");
    expect(route).toContain("actionOpportunityPresentation.additional.map");
    expect(route).toContain("<details");
    expect(route).toContain("그 밖에 확인할 관찰");
    expect(route).toContain('className="group-open:hidden">펼쳐보기 ▾');
    expect(route).toContain('className="hidden group-open:inline">접기 ▴');
    expect(route).toContain('className="group rounded-lg border bg-background"');
    expect(route).toContain("ActionOpportunityV1AdminCard");
    expect(route).toContain("실제 인용된 페이지");
    expect(customer).not.toContain("splitActionOpportunityV1Items");
  });
});
