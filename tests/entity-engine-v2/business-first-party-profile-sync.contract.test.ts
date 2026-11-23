import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001060000_sync_business_profile_first_party_sources_v01.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("business profile first-party registry sync contract", () => {
  it("keeps auto-managed registry rows separate from existing manual rows", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS managed_by");
    expect(migration).toContain("DEFAULT 'manual'");
    expect(migration).toContain("managed_by IN ('manual', 'business_profile')");
    expect(migration).toContain("managed_by = 'business_profile'");
    expect(migration).toContain("managed_by = 'manual'");
    expect(migration).toContain("business_first_party_sources_profile_slot_uq");
  });

  it("syncs all supported business-profile sources generically", () => {
    expect(migration).toContain("'owned_domain'");
    expect(migration).toContain("'naver_place'");
    expect(migration).toContain("'naver_blog'");
    expect(migration).toContain("'host_or_subdomain'");
    expect(migration).toContain("'exact_url'");
    expect(migration).toContain("'resource_prefix'");
    expect(migration).toContain(
      "AFTER INSERT OR UPDATE OF website_url, naver_place_url, active, org_id",
    );
    expect(migration).toContain(
      "sync_business_profile_first_party_sources_v01",
    );
  });

  it("fails closed for shared platform hosts instead of claiming the whole platform", () => {
    for (const host of [
      "blog.naver.com",
      "instagram.com",
      "youtube.com",
      "pf.kakao.com",
      "daangn.com",
      "mycle.co.kr",
      "tistory.com",
    ]) {
      expect(migration).toContain("'" + host + "'");
    }
    expect(migration).toContain(
      "NOT public.business_profile_is_shared_host_v01(v_website_host)",
    );
  });

  it("does not hardcode a customer or mutate manual registry rows during backfill", () => {
    expect(migration).not.toContain("커스텀개러지");
    expect(migration).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    );
    expect(migration).toContain(
      "Generic backfill: no business-specific ids. Existing manual rows are preserved.",
    );
    expect(migration).not.toContain("DELETE FROM public.business_first_party_sources");
  });

  it("keeps the synchronization server-controlled", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.sync_business_profile_first_party_sources_v01(uuid)",
    );
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });
});
