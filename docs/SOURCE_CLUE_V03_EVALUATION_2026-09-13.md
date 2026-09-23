# Source Clue v0.3 evaluation — 2026-09-13

Status: **validated candidate / not deployed**

## Problem

The diagnostic can show several major sources while `먼저 확인할 단서` remains empty.
The main structural cause is inconsistent attribution quality:

- current-run independent-site evidence uses filtered/verified attribution;
- historical domain ownership used raw attribution rows;
- one-off wrong cross-entity links can therefore make a real business-owned domain look shared.

A second issue exists for managed-profile sources: the live first-run profile clue requires 3 competitor responses even when the same significant competitor is already observed in 2 different responses and 2 different intents.

## Candidate policy

### Independent business site

A domain is a first-run independent-site clue only when all are true:

1. current and 90-day ownership both use `measurement_citation_attributions_actionable_v2`;
2. an entity-domain ownership link counts only after at least 2 distinct response links;
3. the current run has exactly one supported significant competitor for the domain;
4. that competitor appears in at least 2 responses and at least 2 intents;
5. the client business has 0 actionable links to the domain;
6. 90-day supported ownership has exactly one entity and it is the same current competitor;
7. the current run contains a root-homepage citation for that same competitor/domain;
8. known shared/profile/content/network source classes remain excluded from this independent-site path.

This intentionally ignores one-off foreign-entity attribution noise without lowering the evidence threshold.

### Managed profile

A shared managed-profile source is a first-run clue only when:

1. the competitor is already `core` or `notable` under the existing significance gate;
2. the **same competitor** is linked in at least 2 distinct responses;
3. those links span at least 2 distinct intents;
4. the client business has 0 actionable links to that managed-profile source.

This is not a generic `2 citations = recommendation` rule. Fragmented one-off links across different businesses do not qualify.

## AutoTree read-only evaluation

Applying the candidate policy to the latest AutoTree run without installing any DB function produced exactly:

| type | source | competitor responses | intents | supported competitor |
|---|---|---:|---:|---|
| independent site | `ykbro.co.kr` | 6 | 5 | YKBRO 일산 |
| independent site | `wraphub.kr` | 3 | 3 | WrapHub |
| independent site | `bewrap.co.kr` | 2 | 2 | 비랩팩토리 |
| managed profile | 당근 동네업체 | 2 | 2 | 비랩팩토리 |

Expected fail-closed exclusions in the same run:

- `xpelkorea.com`: multiple repeatedly supported branch identities -> brand/network domain, not an independent business site;
- `autocut.co.kr`: no qualifying root-homepage citation for the supported competitor;
- `welcar-care.co.kr`: multiple supported canonical identities remain; do not guess ownership until identity/canonicalization is cleaner.

## Implementation candidate

Migration:

`supabase/migrations/20260913145500_first_run_source_clue_consistency_v03.sql`

Adds only new candidate RPCs:

- `get_first_run_independent_site_observations_v03`
- `get_first_run_profile_source_observations_v02`

Existing production RPC definitions are not replaced by this foundation migration.
Both new functions are service-role-only.

## Regression

Entity Engine v2 CI after this change:

- Test files: 12/12 PASS
- Tests: 134/134 PASS
- New source-clue contract tests: 6/6 PASS

## Production boundary

Not yet performed:

- Production migration application;
- wiring the action-recommendation Edge path to the new RPCs / profile 2-response+2-intent gate;
- Edge deployment;
- main merge.

Those require a separate controlled production approval.
