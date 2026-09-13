import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260913145500_first_run_source_clue_consistency_v03.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("first-run source clue v0.3 contract", () => {
  it("defines new independent-site and managed-profile RPC versions without replacing live v01/v02 functions", () => {
    expect(sql).toContain("get_first_run_independent_site_observations_v03");
    expect(sql).toContain("get_first_run_profile_source_observations_v02");
    expect(sql).not.toContain("create or replace function public.get_first_run_independent_site_observations_v01");
    expect(sql).not.toContain("create or replace function public.get_first_run_independent_site_observations_v02");
    expect(sql).not.toContain("create or replace function public.get_first_run_profile_source_observations_v01");
  });

  it("uses verified actionable attribution for both current evidence and 90-day ownership", () => {
    const normalized = compact(sql);
    expect(
      normalized.match(/from public\.measurement_citation_attributions_actionable_v2 a/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(normalized).toContain("a.created_at>=now()-interval '90 days'");
  });

  it("does not let a one-off foreign entity break domain ownership", () => {
    const normalized = compact(sql);
    expect(normalized).toContain(
      "having count(distinct a.measurement_id)>=2",
    );
    expect(normalized).toContain("o.supported_entity_count=1");
    expect(normalized).toContain("o.sole_supported_entity_key=g.competitor_key");
  });

  it("keeps independent-site candidates fail-closed on repeated current evidence and a root-homepage citation for the same entity", () => {
    const normalized = compact(sql);
    expect(normalized).toContain(
      "having count(distinct r.measurement_id)>=2 and count(distinct coalesce(r.intent_type,'other'))>=2",
    );
    expect(normalized).toContain("g.distinct_competitor_count=1");
    expect(normalized).toContain("g.client_response_count=0");
    expect(normalized).toContain("a.canonical_key=g.competitor_key");
    expect(normalized).toContain("in (g.domain,g.domain||'/')");
  });

  it("allows a managed-profile clue at two responses only when the same significant competitor spans two intents", () => {
    const profileStart = sql.indexOf(
      "create or replace function public.get_first_run_profile_source_observations_v02",
    );
    expect(profileStart).toBeGreaterThan(0);
    const profile = compact(sql.slice(profileStart));

    expect(profile).toContain("where s.tier in ('core','notable')");
    expect(profile).toContain(
      "group by r.source_key,r.canonical_key having count(distinct r.measurement_id)>=2 and count(distinct coalesce(r.intent_type,'other'))>=2",
    );
    expect(profile).toContain("g.competitor_response_count>=2");
    expect(profile).toContain("g.intent_count>=2");
    expect(profile).toContain("g.client_response_count=0");
  });

  it("keeps both candidate RPCs service-role only", () => {
    expect(sql).toContain(
      "revoke all on function public.get_first_run_independent_site_observations_v03(uuid,uuid,uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.get_first_run_independent_site_observations_v03(uuid,uuid,uuid) to service_role;",
    );
    expect(sql).toContain(
      "revoke all on function public.get_first_run_profile_source_observations_v02(uuid,uuid,uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.get_first_run_profile_source_observations_v02(uuid,uuid,uuid) to service_role;",
    );
  });
});
