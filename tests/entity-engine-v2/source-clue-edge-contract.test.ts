import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EDGE = resolve(
  process.cwd(),
  "supabase/functions/visibility-action-recommendations-v2/index.ts",
);
const source = readFileSync(EDGE, "utf8");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("source clue Edge integration", () => {
  it("uses the reviewed independent-site v03 and profile v02 RPCs", () => {
    expect(source).toContain("get_first_run_independent_site_observations_v03");
    expect(source).toContain("get_first_run_profile_source_observations_v02");
    expect(source).not.toContain("get_first_run_independent_site_observations_v02\",{p_org_id");
    expect(source).not.toContain("get_first_run_profile_source_observations_v01\",{p_org_id");
  });

  it("allows two-response managed-profile clues only for one competitor across two intents", () => {
    const normalized = compact(source);
    expect(normalized).toContain(
      "competitorResponseCount<2||intentCount<2||distinctCompetitorCount!==1||clientResponseCount>0",
    );
  });

  it("keeps the customer-facing source clue filter version explicit", () => {
    expect(source).toContain('const FILTER_VERSION = "1.0";');
  });
});
