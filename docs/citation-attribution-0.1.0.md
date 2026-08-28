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
- `supabase/migrations/20260828140000_measurement_citation_attributions.sql` —
  idempotent repo copy of the production table/indexes/grants/RLS.

## Production automation (already applied in Supabase)
The pipeline runs automatically via the DB trigger
`trg_visibility_citation_attribution_after_postprocess` on
`public.system_events`, mirrored in
`supabase/migrations/20260828141500_trigger_visibility_citation_attribution_after_postprocess.sql`.
On a `visibility_postprocess_completed` insert it calls the Supabase Edge
Function `visibility-citation-attribution` with header
`x-visibility-postprocess-token` and body `{ "runId": ... }`, skipping runs that
already have a completed event at `attribution_version = '0.1.0'`.
No separate app endpoint is used; manual reprocessing goes through the
authenticated server function in `citation-attribution.functions.ts`.

## Not used for decisions
Attribution rows are display/verification only in 0.1.0. Insight, action
ranking and coverage logic are unchanged.
