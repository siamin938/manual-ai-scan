# visibility-postprocess pipeline 0.1.1 sync (verifier v0.1.2)

Status: repo-side work done. The Edge Function body itself must be updated in
Supabase, because this project cannot create/deploy new Edge Function sources
from the repo.

## Canonical rule source

`src/lib/entity-verification.engine.server.ts` (`ENTITY_VERIFIER_ENGINE_VERSION = "0.1.2"`)
is the single source of truth for the verifier rules. It is a pure, server-only
module: no Supabase, no secrets, no network, no business-specific names/UUIDs.

## Required change inside `visibility-postprocess/index.ts`

1. Replace the inline v0.1.1 verifier block with a byte-equal copy of the pure
   engine above (types + `verifyEntityMention` + `buildRepeatCounts` +
   `buildEntityVerificationRows` + `summarizeEntityVerificationRows`).
   Do not re-derive the rules by hand and do not add name whitelists.
2. `VERIFIER_VERSION` must become `"0.1.2"` so rows are written with
   `verifier_version = '0.1.2'` (the deployed `entity-canonical-resolver`
   already reads `0.1.2`).
3. Repetition input: the verifier needs run-scoped repeat counts. Build them
   from the same mention set that is being verified:
   `const repeatCounts = buildRepeatCounts(mentions);` and pass
   `repeatCounts` into `buildEntityVerificationRows`.
4. `PIPELINE_VERSION` must become `"0.1.1"`. It is written into
   `system_events.metadata.pipeline_version` for
   `visibility_postprocess_started` / `visibility_postprocess_completed`.

## v0.1.2 rules recap (generic, never business-specific)

- Only `specific_business` candidates can be auto-confirmed.
- `medium` + strong signal (`BRANCH_MARKER`, `STRONG_BUSINESS_DESCRIPTOR`,
  `REGISTERED_BUSINESS_MATCH`) on a short proper-name phrase => confirmed.
- Parser `specific_business` without a strong signal => confirmed when the same
  normalized candidate repeats across >= 2 distinct measurements in scope
  (`REPEATED_ACROSS_RESPONSES`).
- `low` confidence and ambiguous / generic / service / list / non-business
  candidates are never promoted by repetition.
- Sentence-like, enumeration, heading/checklist, generic network and generic
  official-category filters are unchanged from v0.1.1.
- `PROBABLE_ONLY` is a needs_review *reason*, never an absolute downgrade.

## DB trigger

`trigger_visibility_postprocess()` now gates the postprocess dedupe on
`metadata->>'pipeline_version' = '0.1.1'` (migration
`..._visibility_postprocess_pipeline_0_1_1.sql`). Runs that only have a 0.1.0
completion event are therefore eligible for exactly one reprocess under the new
pipeline. The audit/standalone/experiment exclusions and the citation-sync call
are unchanged.

## Rerun order for an existing run (no new AI measurement calls)

1. `entity-verification` (or the Lovable server pipeline) — writes v0.1.2 rows.
2. `entity-canonical-resolver` — reads `verifier_version = '0.1.2'`.
3. `compute-profile-coverage`.
4. `compute-insights-v024` with body `{ run_id, dry_run: false }`.
5. `visibility-diagnostic` / `visibility-action-recommendations` are read-time
   and pick up the new canonical rows automatically.
