import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/measurement-credits.tsx"),
  "utf8",
);

describe("measurement credit admin search UX", () => {
  it("keeps the search input mounted while a debounced query refreshes", () => {
    expect(source).toContain("placeholderData: (previousData) => previousData");
    expect(source).toContain("overviewQuery.isPending && !overviewQuery.data");
    expect(source).not.toContain("if (overviewQuery.isLoading)");
  });

  it("debounces remote organization search without replacing the page", () => {
    expect(source).toContain(
      "setTimeout(() => setSearchQuery(searchInput.trim()), 400)",
    );
    expect(source).toContain('overviewQuery.isFetching && searchQuery');
    expect(source).toContain("결과 갱신 중");
  });
});
