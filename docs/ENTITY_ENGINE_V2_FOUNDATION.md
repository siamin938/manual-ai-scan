# CHABOIM Entity Engine v2 Foundation

Status: **foundation / non-production branch**  
Branch: `chore/entity-engine-v2-foundation`

## Why this exists

Repeated new-business rehearsals exposed different entity false positives even when previous regressions remained green. The common failure is not a single missing stop-word. It is an architectural coupling problem:

1. the parser identifies a candidate string;
2. evidence is collected from a broad recommendation slot;
3. the candidate can inherit address/phone/URL/location evidence that belongs to descendants or siblings;
4. downstream gates trust those parser-produced evidence booleans;
5. once canonicalized, citation attribution and significance amplify the false entity.

The `1순위로 문의해볼 곳` -> `로 문의해볼 곳` incident is the clearest reproduction: a section heading inherited structured evidence from real business rows beneath it.

## Confirmed structural problems

### 1. Candidate identity and evidence provenance are not bound together

Current v1 evidence is mostly boolean (`has_address`, `has_phone`, `has_url`, `has_location_context`, ...). It does not preserve *where* the evidence came from relative to the candidate.

A v2 decision must use scoped evidence such as:

- `same_table_row`
- `same_list_item`
- `same_heading_block`
- `same_sentence`
- `registered_exact_subspan`
- `citation_same_row`

Evidence from child rows, sibling sections, or unrelated later text must not confirm a parent heading.

### 2. Business truth is decided in too many layers

Current production behavior spreads `is this a real specific business?` decisions across:

- parser classification;
- postprocess verifier;
- DB evidence gates;
- special trigger guards;
- significance generic filters.

Defense in depth is useful, but the semantic decision must have one authority. v2 should make downstream layers consume a decision instead of independently re-deciding the same fact.

### 3. Registered-name substring matching can over-capture display text

Examples observed in stored data:

- `빠른 국산차 오일 교환:** 현대엑스티어 판교`
- `금촌·조리 쪽:** 타이어프로 봉일천점`
- `카스페이스 구로본점 패키지 구성`

These contain a real registered business, but the **whole phrase** must not become the canonical display name. v2 should extract the exact registered-business subspan and retain the surrounding text as criterion/heading context.

### 4. False entities are amplified downstream

A false confirmed entity can receive:

- canonical identity;
- citation attribution;
- competitor significance;
- source/action recommendations;
- customer-facing labels.

Therefore the highest-value fail-closed boundary is **before canonicalization**.

### 5. Existing regression gates are data-contract tests, not language-structure tests

Release gates v0.1-v0.3 protect important contracts such as temporal repeat semantics, independent-site ownership, compatible-run behavior, and known generic patterns. They do not prove that an unseen response structure is parsed correctly.

A Golden Corpus is required for response-structure regression.

## Production source-of-truth drift

At the foundation snapshot, several critical live Edge Functions are active in Supabase but do not have their current deployable source under `supabase/functions` on `main`:

- `process-measurement-job`
- `reparse-measurements`
- `visibility-postprocess`

This prevents GitHub/Codex/CI from being the complete review surface for the production entity engine.

`supabase/EDGE_RUNTIME_CONTRACT.json` records the current live version/hash/auth contract and known drift.

A separate deployment drift was observed for `create-organization-with-owner`: a manual `verify_jwt=true` deploy was later synchronized from GitHub as `verify_jwt=false` because the function had no explicit `config.toml` entry. The foundation branch adds the missing contract but **must not be merged casually**, because merging can trigger automatic deployment.

## v2 target architecture

```text
Provider response
    |
    v
Response Structure Parser
    - heading / paragraph / list item / table / row / cell
    - no business truth decision
    |
    v
Candidate Extractor
    - exact candidate span
    - structural parent/scope
    - embedded registered-name subspans
    |
    v
Business Identity Gate  <-- single semantic authority
    - confirmed_business
    - non_business / platform / brand_network
    - unresolved
    - scoped evidence provenance required
    |
    v
Canonical Resolver
    - only confirmed_business
    - decides same-real-business identity only
    |
    v
Significance
    - frequency/repeat only
    - does not reclassify entity truth
    |
    v
Citation Attribution
    - confirmed canonical entities only
    - structure-aware same-row/same-item/same-section attribution
```

## Golden Corpus v0.1

File: `tests/fixtures/entity-golden-corpus-v0.1.json`

It is sourced from real stored measurement responses and currently contains ten high-value cases covering:

- ranked section-heading fragment;
- generic chain heading with real child branches;
- generic comparison heading with real table rows;
- official-installer wording without unique identity;
- positive structured real business;
- registered business embedded in a descriptive heading;
- region-label + registered business;
- purpose-label + registered business;
- specific chain branch positive control;
- platform-affiliated shops.

The corpus deliberately contains both **false-positive controls and true-positive controls**. v2 is not allowed to improve precision by simply suppressing uncertain businesses.

## Required v2 invariants

1. No canonical entity may be created from a `forbiddenConfirmedSurface` in the Golden Corpus.
2. Every `requiredEntity` must be recoverable with the expected decision.
3. Structured evidence used to confirm a candidate must have an allowed provenance scope.
4. A registered exact subspan may be confirmed even when the larger line/heading is non-business context.
5. `brand_network` and `platform` must never enter competitor canonicalization as local businesses.
6. Significance must not contain its own semantic generic-phrase classifier after v2 is proven stable; until cutover, the existing filter remains as a safety net.
7. v2 runs shadow-only against historical stored responses before any customer-impacting cutover.

## Migration sequence

### P0-A — completed in this branch

- create non-production branch;
- add explicit Edge auth contracts to `supabase/config.toml`;
- add live runtime contract snapshot;
- add Golden Corpus v0.1;
- document v2 semantic contract.

### P0-B — next

Restore exact current live source snapshots for the three live-only critical functions into GitHub **without deploying them**. Verify their hashes/source content against Supabase before any refactor.

### P1

Add executable Golden Corpus tests around the current v1 parser and mark known failures explicitly. This establishes the baseline instead of hiding it.

### P2

Implement `entity-engine-v2` as a pure, side-effect-free module and replay all historical completed standalone audit responses. Store v1/v2 diffs as shadow evaluation only.

### P3

Review precision/recall deltas across business types. No threshold change and no production cutover until the Golden Corpus and historical replay pass.

### P4

Controlled cutover behind a feature flag/default-off path, followed by one fresh 24-question rehearsal and then a same-question-set repeat measurement.

## Non-goals

- no business-specific hardcoding;
- no new paid AI measurement for engine development;
- no Production publish from this branch;
- no broad parser/verifier/resolver rewrite in one deployment;
- no deletion of existing raw provider responses.
