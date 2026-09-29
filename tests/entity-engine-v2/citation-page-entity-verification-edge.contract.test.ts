import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/citation-page-entity-verification/index.ts",
  ),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260930003000_citation_page_entity_verifications_v01.sql",
  ),
  "utf8",
);

describe("Citation Page Entity Verification edge contract", () => {
  it("is run-scoped, v2-grounded and provider-free", () => {
    expect(source).toContain('"measurement_entity_facts_v2"');
    expect(source).toContain('"run_entity_fact_aggregates_v2"');
    expect(source).toContain('"measurement_citations"');
    expect(source).toContain("row.facts.targetSeen === true");
    expect(source).toContain("citation_page_entity_verifications");
    expect(source).toContain("x-visibility-postprocess-token");
    expect(source).toContain("SSRF_GUARD_VERSION");
    expect(source).not.toContain("api.openai.com");
    expect(source).not.toContain("PERPLEXITY_API_KEY");
    expect(source).not.toContain("GEMINI_API_KEY");
    expect(source).not.toContain("response_text");
  });

  it("keeps page verification advisory, versioned and append-only", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.citation_page_entity_verifications",
    );
    expect(migration).toContain(
      "verification_status IN ('confirmed','unresolved','unrelated')",
    );
    expect(migration).toContain(
      "citation_page_entity_verifications_immutable",
    );
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE");
    expect(migration).toContain(
      "trigger_citation_page_entity_verification_after_v2",
    );
    expect(migration).toContain(
      "entity_facts_v2_materialization_completed",
    );
    expect(migration).toContain(
      "entity_facts_v2_materialization_refreshed",
    );
  });
});
