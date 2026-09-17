# Source clues with missing comparison payloads

Status: **deployed with explicit user approval** on 2026-09-17. PR #1 remains Draft; do not merge. Authenticated customer-screen confirmation is pending.

## Confirmed production trace

Read-only checks on 2026-09-17 for 현대엑스티어 판교's September 9 completed audit:

- `get_compatible_audit_runs_v01(..., 6)` returns **zero rows**, not two.
- Both the September 8 and September 9 runs retain 24 jobs and 24 measurements, Parser 1.2.3, and the same question set.
- Neither run has matching `provider_payloads` rows. The compatibility RPC requires complete payloads, even for the latest run's self-match, so both are excluded.
- The current absence is confirmed. A payload purge function exists, but this investigation did not establish when or why those specific rows disappeared.
- The latest profile v03 RPC returns 마이클: 4 responses, 4 intents, 2 significant competitors, client 0.
- The latest content v01 RPC returns 티스토리: 3 responses, 3 intents, 1 competitor, client 0.
- The latest independent-site v04 RPC returns no rows.
- The previous run also has a profile row (5 responses, 3 intents, 3 competitors). This does **not** establish compatible repetition, and those counts are not mixed into the latest result.

The deployed legacy action function v17 validates JWT, membership and the active client business, then returns `ok:true, scope:null, recommendations:[]` when the common compatibility RPC returns no rows.

The deployed v33 wrapper derives `latestRunId` solely from that legacy scope. It therefore derives an empty ID. Its `!hasCompatibleRepeat` branch is entered, but the inner UUID check fails: **neither the profile nor content RPC is called**. Independent-site lookup also requires the missing ID.

The normal server DTO accepts this empty result. The display reducer receives an empty list. The UI's `isPreliminary = (scope?.repetitions ?? 0) < 2` then selects the existing "첫 측정" heading and empty state. The displayed wording is a consequence of null scope, not evidence that the two historical runs were deemed compatible.

Both the deployed legacy v17 and wrapper v33 were executed locally with the observed empty compatibility result and local authentication/DB fixtures. This reproduced `scope:null`, zero cards, and no profile RPC call. No authenticated production HTTP request was simulated or impersonated.

## Minimal change: filter 1.4

Only when the authorized legacy response has null scope **and** the common compatibility RPC is empty:

1. Select this organization's and business's latest completed standalone audit, excluding experiments. Use the same latest ordering as the common RPC: completion descending, nulls last, then creation descending.
2. Read the valid answer count and reuse the existing competitor significance RPC for the scope's competitor count.
3. Feed that one run into the existing first-run content/profile/independent-site RPC paths.
4. Return a one-run observation scope with a disclaimer explaining that compatibility with earlier runs cannot be verified. `repetitions:1` describes the evidence scope; it does not assert this was the business's first-ever measurement.

Database/lookup errors return an error; they are not converted into an empty-evidence success. A business with no completed audit keeps its existing no-measurement response.

The candidate initially retained v33 as the live contract. After explicit user approval, filter 1.4 was deployed as v34 and the live contract was updated to the verified deployed hash.

## Preserved behavior and remaining boundaries

- Existing non-null scopes, repeat aggregation, ranking and platform deduplication are unchanged.
- Compatibility still comes only from `get_compatible_audit_runs_v01`; missing request payloads never become proof of repeatability.
- Profile eligibility still comes from v03. No new threshold, entity rule or business exception is introduced.
- Homepage ownership, same-measurement confirmation and exact cross-site measurement union are unchanged; no new RPC or migration is needed.
- Legacy authentication must succeed before fallback DB reads. Every fallback read is scoped by organization and target run/business.
- Frontend files, legacy Edge v17, the measurement pipeline, Entity v2, `main`, and production data are unchanged. Only the v2 action Edge was deployed.
- The current UI uses "첫 측정" for preliminary evidence rather than lifetime run count. The candidate clarifies the recovered scope in the server disclaimer. A neutral section-title copy change can be handled with the next separately approved frontend publish.
- Actual compatible-repeat managed-profile support is a separate product change. It is not the cause of this incident, so its gate is not loosened in this patch.
- Long-term repeat comparison after request payload removal requires durable comparison evidence. This patch restores latest-run clues; it does not recreate missing comparison records.

## Verification

- 15 runtime regressions execute the candidate handler, real server DTO parser and existing UI display reducer with local fixtures.
- Cases cover missing payloads, latest/org/business/run filtering, no measurements, empty evidence, lookup failures, authorization failures, normal first-run and repeat paths, platform deduplication, and strict multi-owner homepage rejection.
- The actual read-only aggregate values from the latest production run yield two display cards locally: 마이클 first (4/24, 2 competitors), 티스토리 second (3/24, 1 competitor), preserving the saved links. The 4 and 3 are separate source counts and must not be added as a union.
- Local execution uses Node's TypeScript stripping with the same assertions; CI runs the committed Vitest/TypeScript implementation using the repository dependencies.
- Candidate validation used no provider call, measurement credit, historical Entity replay, production deploy, DDL or data modification. The later authorized Edge deployment is recorded below.

## Authorized deployment and post-deploy check

The user explicitly approved the Supabase-only deployment after clarification that no Lovable publish or main merge was required.

- Deployed only `visibility-action-recommendations-v2/index.ts` from commit `c7958a2b83741a9c086e0d2cc8f36500e725b9cb`.
- Production: **v34 / filter 1.4 / ACTIVE / verify_jwt=true**.
- Deployed at: 2026-09-17T12:55:49.364Z.
- Bundle SHA-256: `c54e80414fb5f24dea6b2c93cc6ba412469ae9720960b063559493949b400217`.
- Re-fetched deployed source matches the approved source (ignoring terminal newlines).
- Fresh read-only DB checks still return latest run `bad9250c-af54-4efc-9b82-c0eb9b551ffc`, 24 valid answers, zero compatible runs, profile 4 responses / 2 competitors, content 3 responses / 1 competitor, no independent sites. Service-role SELECT permissions for both fallback tables are present.
- Executing the re-fetched deployed source with those fresh DB snapshots locally passes the actual server DTO parser and existing display reducer with both expected cards and saved links.
- Approved source CI #121 succeeded. No DB writes, paid measurement, Entity historical replay, Lovable publish or main merge were performed.
- **Remaining verification:** refresh the authenticated customer screen and confirm the two cards. The checks above are deployed-source verification plus local execution with production snapshots, not an authenticated production HTTP/UI observation.
