import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EDGE = resolve(
  process.cwd(),
  "supabase/functions/visibility-action-recommendations-v2/index.ts",
);
const source = readFileSync(EDGE, "utf8");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("source clue Edge integration", () => {
  it("uses the confirmed-alignment independent-site v04 and profile v03 RPCs", () => {
    expect(source).toContain("get_first_run_independent_site_observations_v04");
    expect(source).toContain("get_first_run_profile_source_observations_v03");
    expect(source).not.toContain("get_first_run_independent_site_observations_v03\",{p_org_id");
    expect(source).not.toContain("get_first_run_profile_source_observations_v02\",{p_org_id");
  });

  it("allows managed-profile clues with one or more significant competitors across two intents", () => {
    const normalized = compact(source);
    const profileStart = normalized.indexOf("function buildfirstrunprofilerecommendation");
    const profileEnd = normalized.indexOf("function independentreferencegroup", profileStart);
    expect(profileStart).toBeGreaterThanOrEqual(0);
    expect(profileEnd).toBeGreaterThan(profileStart);
    const profileSource = normalized.slice(profileStart, profileEnd);
    expect(profileSource).toContain(
      "competitorresponsecount<2||intentcount<2||clientresponsecount>0",
    );
    expect(profileSource).not.toContain("distinctcompetitorcount!==1");
  });

  it("runs the verified v04 homepage fallback only after legacy shared-domain filtering", () => {
    const sharednessCall = source.indexOf("get_visibility_domain_sharedness_v01");
    const v04Call = source.indexOf("get_first_run_independent_site_observations_v04");

    expect(sharednessCall).toBeGreaterThan(0);
    expect(v04Call).toBeGreaterThan(sharednessCall);
    expect(source).toContain(
      "!recommendations.some(hasLegacyHomepageGroup)",
    );
  });

  it("bundles verified sites and uses the exact measurement-id union for the headline response count", () => {
    const normalized = compact(source);
    expect(source).toContain("buildFirstRunIndependentSiteBundleRecommendation");
    expect(source).toContain("measurementIds:stringArray(raw.measurement_ids)");
    expect(normalized).toContain(
      "responseids=[...new set(deduped.flatmap(row=>row.measurementids))]",
    );
    expect(normalized).toContain(
      "competitorresponsecount=responseids.length>0?responseids.length:math.max",
    );
    expect(source).toContain("검증된 경쟁업체 홈페이지·독립 사이트");
  });

  it("keeps the customer-facing source clue filter version explicit", () => {
    expect(source).toContain('const FILTER_VERSION = "1.5";');
  });
});
