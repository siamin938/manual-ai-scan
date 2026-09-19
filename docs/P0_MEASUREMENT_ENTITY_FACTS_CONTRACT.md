# P0 Measurement Entity Facts Contract — Phase 2B

Status: pure-engine contract only. No Production DB schema, migration, Edge, UI, consumer cutover, or new measurement is part of this phase.

## Purpose

Phase 2A decides whether a confirmed business is equivalent to the current target.

Phase 2B converts already-decided identity observations into one measurement-level customer-facing fact contract.

The goal is to stop visibility, Top3, question groups, competitor self-exclusion and target source linkage from independently reinterpreting raw parser fields or canonical keys.

## Authority rule

`measurements.was_client_mentioned` and `client_position` remain raw parser audit signals only.

They MUST NOT force:

- `targetSeen=true`
- `targetBestPosition`
- competitor inclusion/exclusion
- target source attribution

Authoritative customer-facing target presence comes only from:

1. `identityDecision = confirmed_business`
2. `equivalenceDecision = equivalent`
3. projected key exactly equals `business:<CURRENT TARGET BUSINESS ID>`

## Measurement fact output

The pure builder emits:

- `targetSeen: true | false | null`
- `targetBestPosition`
- `confirmedOtherEntityKeys`
- `targetCitationDomains`
- `targetAttributionLinks`
- unresolved identity counts
- versioned data-quality flags

No raw provider response or persisted v1 field is mutated.

## targetSeen semantics

### true

At least one confirmed entity has:

- Target Equivalence = `equivalent`
- projected canonical key = current target key

Multiple aliases/surfaces in one answer still count as one measurement-level target presence.

### false

No authoritative target-equivalent entity exists, and no unresolved target candidate can change that conclusion.

A raw parser positive alone does not change false to true.

### null

The measurement is not valid, or authoritative identity is incomplete in a way that could change target presence.

Examples:

- unresolved broad-recall target candidate
- an `equivalent` decision whose projected key violates the current-target contract

A null fact is not silently counted as a negative.

## Position semantics

`targetBestPosition` is the minimum valid 1-based position among authoritative target-equivalent observations.

Raw `client_position` is not used as a fallback.

If target is authoritatively present but no authoritative position exists:

- `targetSeen=true`
- `targetBestPosition=null`
- quality flag `target_position_missing`

## Parser quality comparison

Parser output is compared only after authoritative facts exist.

- raw false + authoritative true → `parser_false_negative`
- raw true + authoritative false → `parser_false_positive`
- authoritative null → no false-positive/false-negative label is forced

This preserves parser diagnostics without letting parser state control customer metrics.

## Competitor/self rule

Only confirmed businesses with:

- Target Equivalence = `distinct`
- a non-empty canonical key
- canonical key different from the current target key

enter `confirmedOtherEntityKeys`.

Rules:

- equivalent entities never enter other-entity keys
- unresolved entities never enter other-entity keys
- if a distinct entity somehow carries the current target key, it is blocked and flagged `self_key_leakage_blocked`
- distinct entities without a canonical key are excluded and flagged

Significance/ranking belongs downstream. This facts layer decides entity side only.

## Attribution rule

Target attribution is accepted only when its linked entity is:

- confirmed business
- Target Equivalence = equivalent
- projected to current target key

The stored URL is carried through as supplied. The facts engine does not invent URLs from domains or business names.

If attribution is linked to an unresolved target candidate, the target attribution is not accepted and a quality flag is emitted.

## Broad target-candidate signal

`isTargetCandidate` is recall-only metadata supplied upstream.

It may cause fail-closed `targetSeen=null` when equivalence remains unresolved.

It MUST NOT prove equivalence or target presence.

Its upstream generation contract must be separately reviewed before runtime cutover.

## Invalid measurements

Invalid measurements produce:

- `targetSeen=null`
- no competitor/source facts
- `invalid_measurement`

They do not contribute to customer-facing rate denominators in later aggregation.

## Invariants

1. RAW_PARSER_NOT_AUTHORITY  
   Toggling raw parser mention state does not change authoritative targetSeen for identical authoritative entities.

2. SELF_NOT_COMPETITOR  
   Equivalent/self keys cannot enter `confirmedOtherEntityKeys`.

3. BEST_POSITION  
   Multiple target-equivalent mentions collapse to one measurement fact with the minimum authoritative position.

4. FAIL_CLOSED  
   Unresolved target candidates and projection contract violations never become confident false.

5. SOURCE_TARGET_CONSISTENCY  
   Only authoritative target-equivalent entity links enter target attribution/source facts.

6. RAW_PRESERVATION  
   Builder is deterministic, side-effect-free, and input-immutable.

## Deferred to later phases

Not part of Phase 2B pure-engine work:

- DB schema/materialization
- migrations
- RLS
- diagnostic consumer changes
- significance changes
- source/action/benchmark changes
- historical replay against Production
- runtime feature flag
- customer UI
