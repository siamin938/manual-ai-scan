import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260914121818_first_run_source_clue_confirmed_alignment_v04.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("first-run source clue confirmed-alignment v0.4 contract", () => {
  it("adds new RPC versions without replacing the production v03/v02 contracts", () => {
    expect(sql).toContain("get_first_run_independent_site_observations_v04");
    expect(sql).toContain("get_first_run_profile_source_observations_v03");
    expect(sql).not.toContain(
      "create or replace function public.get_first_run_independent_site_observations_v03",
    );
    expect(sql).not.toContain(
      "create or replace function public.get_first_run_profile_source_observations_v02",
    );
  });

  it("requires the same canonical business to be confirmed in the same measurement for competitor evidence", () => {
    const normalized = compact(sql);
    expect(normalized).toContain("mm.count_as_confirmed_business=true");
    expect(normalized).toContain("c.measurement_id=a.measurement_id");
    expect(normalized).toContain("c.canonical_key=a.canonical_key");
    expect(normalized).toContain("c.source_run_id=a.source_run_id");
  });

  it("keeps client evidence on the existing actionable path instead of requiring canonicalization", () => {
    const normalized = compact(sql);
    expect(normalized).toContain(
      "when a.canonical_key='business:'||p_business_id::text then 'client'",
    );
  });

  it("fails closed on any second confirmed canonical entity in 90-day ownership", () => {
    const normalized = compact(sql);
    expect(normalized).toContain("o.confirmed_entity_count=1");
    expect(normalized).toContain("o.sole_confirmed_entity_key=g.competitor_key");
    expect(normalized).not.toContain(
      "having count(distinct a.measurement_id)>=2 ) , ownership as",
    );
  });

  it("returns measurement ids so the Edge layer can calculate an exact cross-site union", () => {
    const normalized = compact(sql);
    expect(normalized).toContain("measurement_ids jsonb");
    expect(normalized).toContain(
      "jsonb_agg(distinct to_jsonb(r.measurement_id)) filter(where r.entity_side='competitor') as measurement_ids",
    );
  });

  it("keeps both RPCs service-role only", () => {
    expect(sql).toContain(
      "revoke all on function public.get_first_run_independent_site_observations_v04(uuid,uuid,uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.get_first_run_independent_site_observations_v04(uuid,uuid,uuid) to service_role;",
    );
    expect(sql).toContain(
      "revoke all on function public.get_first_run_profile_source_observations_v03(uuid,uuid,uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.get_first_run_profile_source_observations_v03(uuid,uuid,uuid) to service_role;",
    );
  });
});
