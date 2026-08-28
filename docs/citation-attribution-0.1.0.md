# Citation attribution 0.1.0 (generic, business-agnostic)

## What it does
Links a business to a specific `url_citation` inside one AI answer using only
stored provider payloads. Never calls a provider.

- `direct` — the citation sits on the same markdown line / sentence / bullet /
  table row as an occurrence of that business, within 450 chars.
- `section` — the citation sits inside that business's section (heading, list
  or table block) but does not meet the `direct` bar.
- anything ambiguous produces no row. Answer-level co-occurrence stays in
  `measurement_citations` and remains the fallback display.

A section now also ends at the next heading or top-level numbered item, even
when no entity name matched there. Without this, an unmatched business block
could inherit the previous business's section.

## Repo pieces
- `src/lib/citation-attribution.engine.server.ts` — pure engine (source of truth,
  `CITATION_ATTRIBUTION_VERSION = "0.1.0"`).
- `src/lib/citation-attribution.server.ts` — scoped persistence (idempotent upsert).
- `src/lib/citation-attribution.functions.ts` — authenticated server function.
- `src/routes/api/public/citation-attribution.ts` — postprocess-token endpoint
  (`POST { run_id }`, header `x-postprocess-token`) for the Supabase pipeline.
- `supabase/migrations/20260828140000_measurement_citation_attributions.sql` —
  idempotent repo copy of the production table/indexes/grants/RLS.

## visibility-postprocess change still required (Supabase side)
This project cannot create or deploy Edge Function sources from the repo.
Inside `visibility-postprocess/index.ts`, after the existing citation-sync step
and only for standalone audit runs, add:

```ts
await fetch(`${APP_BASE_URL}/api/public/citation-attribution`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-postprocess-token": POSTPROCESS_TOKEN },
  body: JSON.stringify({ run_id: runId }),
});
```

Keep the existing pipeline order, experiment exclusions and
`PIPELINE_VERSION` gate. The endpoint is idempotent, so retries are safe.

## Not used for decisions
Attribution rows are display/verification only in 0.1.0. Insight, action
ranking and coverage logic are unchanged.
