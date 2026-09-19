# P0 Historical Shadow Replay Contract — Phase 2C v0.1

Status: pure replay/aggregation contract only. No Production DB mutation, migration, Edge deploy, customer UI cutover, or paid/new AI measurement is part of this phase.

## Entry gate

Phase 2C starts only after Phase 2B Measurement Entity Facts v0.2 has:
- BLOCKER 0
- HIGH 0
- green Entity Engine v2 CI
- no Production cutover

Approved Phase 2B head for this Phase 2C branch:
`0fc9431d202542a778996de80850a1604cb3b869`

## Purpose

Historical replay must compare current customer-facing truth with proposed Measurement Entity Facts using only stored responses and stored evidence.

It must not force uncertain identity into a confident negative.

The replay pipeline is:

Stored completed standalone audit
→ replay-safe stored response/public identity evidence
→ Identity Gate
→ Target Equivalence
→ Measurement Entity Facts v0.2
→ Run Entity Facts Aggregate v0.1
→ current-vs-proposed diff
→ release gate

## No new AI calls

Historical replay uses only permanently stored data.

Forbidden:
- provider/API calls for new answers
- new paid measurements
- re-running customer questions against AI providers
- overwriting parser fields
- rewriting canonicalizations
- deleting historical rows

## Evidence ceiling

Replay may only use identity evidence actually persisted at the time of replay.

Current persisted business fields include:
- business UUID
- name / aliases
- address
- Naver Place URL when present
- website URL / official domains when present

Phone and an explicit branchIdentityKey are not currently persisted on `businesses`.

Therefore Phase 2A evidence paths that require missing evidence MUST remain unresolved. Historical replay must not manufacture phone, branch identity, Place ID, or official URLs.

Cross-org business rows may be used only as internal public-identity evidence candidates and MUST NOT become the target projection merely because the row exists.

Foreign business IDs must never be projected as the current target.

## Target-equivalence safety

Automatic equivalence remains exactly the approved Phase 2A contract.

Historical replay MUST NOT add weaker shortcuts such as:
- name similarity alone
- alias alone
- same address alone
- same district + brand
- cross-org record existence alone
- fuzzy branch match
- repeated appearance frequency

If stored evidence cannot satisfy a strong rule, the result is `unresolved`.

## Visibility bounds

A valid measurement has:
- `targetSeen=true`: confirmed mention
- `targetSeen=false`: confirmed absence
- `targetSeen=null`: unresolved target truth

Run-level replay MUST preserve uncertainty.

For valid measurements:

`visibility lower bound = confirmed mentions / valid measurements`

`visibility upper bound = (confirmed mentions + unresolved target measurements) / valid measurements`

Top3 uses the same rule, with unresolved measurements contributing only to the upper bound.

An unresolved measurement is never silently counted as a confident negative.

Example contract:
- valid measurements: 24
- confirmed target: 1
- unresolved target: 5

Result:
- visibility lower bound: 4.17%
- visibility upper bound: 25%

This is an uncertainty interval, not a claim that the true result is exactly 25%.

## Question consistency

Overview, question groups, and weak-question areas MUST read the same Measurement Entity Facts.

No question-group consumer may fall back to:
- `was_client_mentioned`
- `client_position`

Question status:
- covered: every valid observation for the question is confirmed target, no unresolved
- partial: at least one confirmed target but not fully covered
- unresolved: no confirmed target and at least one unresolved target observation
- missing: confirmed absence with no unresolved target observation

## Competitor consistency

Competitors are derived only from `confirmedOtherEntities`.

The current target canonical key is a contract violation if it appears in competitor input.

The aggregate must:
- exclude leaked self from competitor output
- emit `SELF_COMPETITOR_LEAK`
- fail the aggregate contract

Significance/ranking remains downstream and must not reclassify target/self identity.

## Source consistency

Target sources are derived from Phase 2B target source facts.

`sourceFactsStatus=partial` does not mean no source.

Run aggregation preserves:
- total responses containing a target source domain
- complete source-fact response count
- partial source-fact response count

Future source/action replay must not treat partial evidence as fully complete or as empty.

## Fact version consistency

One run-level aggregate must consume one fact version.

Mixing v1/v2 or multiple Measurement Entity Facts versions in one aggregate is a release-blocking contract error.

## Phase 2C release-block conditions

Historical replay must block progression toward cutover if it finds any of the following without an explicit, reviewed explanation:

- target self in competitor set
- unsafe overmerge
- rejected/non-business promoted to confirmed business
- registered canonical business ID changed unexpectedly
- existing normal business customer metrics changed without explainable identity evidence
- mixed fact version inside one consumer result
- raw data mutation
- cross-org identity leakage
- source/action disappearance without explainable source/identity status
- unresolved target truth converted to confident false
- parser truth used again as customer authority

## Known evidence-gap behavior

When two surfaces appear likely to represent the same physical business but the persisted strong identity evidence is insufficient, replay must remain unresolved.

For example, same address plus alias/cross-org row existence alone is not enough under the approved Phase 2A contract.

Phase 2C should expose this as an evidence gap instead of adding a weaker merge rule.

## Deferred

Not part of the first Phase 2C pure aggregate step:
- Production schema/materialization
- Edge cutover
- customer UI changes
- feature flag default-on
- canary measurement
- action/benchmark production cutover
- new identity evidence collection

Those follow only after historical replay and release-gate review.
