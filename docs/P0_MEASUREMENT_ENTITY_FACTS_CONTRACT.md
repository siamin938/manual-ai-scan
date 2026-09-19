# P0 Measurement Entity Facts Contract — Phase 2B v0.2

Status: pure-engine contract only. No Production DB schema, migration, Edge, UI, consumer cutover, or new measurement is part of this phase.

## Purpose

Phase 2A decides whether a confirmed business is equivalent to the current target.

Phase 2B converts already-decided identity observations into one measurement-level authoritative fact contract so visibility, Top3, competitor self-exclusion, and source linkage do not independently reinterpret raw parser flags or canonical keys.

## Authority rule

`measurements.was_client_mentioned` and `client_position` remain raw parser audit signals only.

They MUST NOT force:
- `targetSeen=true`
- `targetBestPosition`
- competitor inclusion/exclusion
- target source attribution

Customer-facing entity truth is built only from versioned authoritative identity/equivalence observations.

## Required target context

`targetBusinessId` must be a UUID-shaped business identifier.

Missing, whitespace-only, or non-UUID target IDs fail closed:
- `targetSeen=null`
- no entity/source facts
- `invalid_target_business_id`

## Entity observation provenance

Every confirmed-business observation carries:
- `equivalenceDecision`
- `equivalenceVersion`
- `equivalenceReasons`
- `equivalenceEvidenceKinds`
- versioned target-candidate assessment

A confirmed-business row without equivalence version/reason provenance is an identity contract conflict and cannot become customer truth.

## Target-candidate assessment

The old recall-only boolean is not sufficient.

The contract is:

```ts
type TargetCandidateAssessment = {
  decision: "candidate" | "not_candidate" | "unknown";
  version: string;
  reasonCodes: string[];
  evidenceKinds?: string[];
  inputComplete: boolean;
};
```

For an unresolved confirmed business:
- trusted `candidate` → target presence remains unresolved
- trusted `not_candidate` → does not by itself block a confident negative
- `unknown`, incomplete input, missing version, or missing reason → fail closed and emit `target_candidate_provenance_incomplete`

The candidate assessment may prevent a false negative. It never proves target equivalence.

## Duplicate entityRef contract

`entityRef` is a unique identity observation reference.

- Semantically identical duplicate rows may be deduplicated.
- Conflicting rows sharing the same `entityRef` are a data-integrity conflict.
- Conflicting duplicates MUST NOT use first-row-wins or last-row-wins.
- They emit a `conflict` relation, flag `entity_ref_conflict`, and force `targetSeen=null`.

Results must be invariant to input array permutation.

## Measurement-level entity projection

The facts output includes a versioned relation for every unique `entityRef`:

```ts
entityRelations: Array<{
  entityRef: string;
  side: "target" | "other" | "unresolved" | "excluded" | "conflict";
  canonicalKey: string | null;
  bestPosition: number | null;
  identityDecision: IdentityDecisionV2 | null;
  equivalenceDecision: TargetEquivalenceDecision | null;
  equivalenceVersion: string | null;
  equivalenceEvidenceKinds: string[];
  targetCandidateDecision: TargetCandidateDecisionV2 | null;
  targetCandidateVersion: string | null;
  targetCandidateReasonCodes: string[];
  relationReasonCodes: string[];
}>
```

This mapping is the intended future join authority for competitor/source/action consumers. Those consumers must not re-run target/self classification.

## targetSeen semantics

### true

At least one conflict-free authoritative relation has:
- confirmed business identity
- `equivalenceDecision=equivalent`
- projected key exactly equal to `business:<CURRENT TARGET BUSINESS ID>`

### false

No target relation exists, no identity contract conflict exists, and no unresolved target candidate or incomplete target-candidate provenance could change the conclusion.

### null

Any of the following:
- invalid measurement
- invalid target business context
- conflicting duplicate `entityRef`
- equivalent projection mismatch
- distinct entity carrying the current target canonical key
- unresolved target candidate
- incomplete/unknown target-candidate provenance

A null measurement is not silently counted as a negative.

## Projection conflicts

These combinations are contract violations and fail closed:

- `equivalent` with a projected key other than current target
- `distinct` with canonical key equal to current target
- conflicting duplicate `entityRef`

Even if another normal target relation exists in the same measurement, an identity contract conflict makes the measurement target truth `null` until the bad input is resolved.

## Position semantics

`targetBestPosition` is the minimum valid 1-based integer position among authoritative target relations.

Raw `client_position` is never a fallback.

If target is authoritative but all authoritative positions are missing/invalid:
- `targetSeen=true`
- `targetBestPosition=null`
- `target_position_missing`

If raw parser says target was present and its valid position differs from authoritative best position:
- customer fact remains authoritative
- quality flag `parser_position_mismatch` is emitted

## Parser quality comparison

- raw false + authoritative true → `parser_false_negative`
- raw true + authoritative false → `parser_false_positive`
- authoritative null → no forced false-positive/false-negative label
- raw and authoritative valid positions differ → `parser_position_mismatch`

## Competitor/self rule

Only relations with:
- `side=other`
- non-empty canonical key
- canonical key different from current target

enter `confirmedOtherEntityKeys` / `confirmedOtherEntities`.

The facts builder deduplicates identical canonical keys and preserves minimum valid position.

Significance/ranking belongs downstream; entity side does not.

## Attribution contract

Attribution IDs must also be unique.

- Semantically identical duplicate attribution rows may dedupe.
- Conflicting rows sharing an attribution ID are rejected as a group.
- No first-row-wins behavior is permitted.
- Conflict emits `attribution_id_conflict`.
- Entity attribution uses `entityRelations`, not fresh identity classification.

Target attribution is accepted only when:
- relation side is `target`
- input URL provenance says `validated_http_https`
- stored URL parses as HTTP/HTTPS
- supplied domain exactly matches URL hostname after `www.` normalization

The original stored URL string is preserved exactly. The facts layer does not invent or reconstruct URLs.

Rejected/unverifiable source evidence makes `sourceFactsStatus=partial`.

## Source facts status

`sourceFactsStatus` is:
- `complete` when no source/identity quality issue affects source-side confidence
- `partial` when identity/source conflicts or validation failures exist

Downstream source/action consumers must not interpret partial as “no source”.

## Invalid measurements

Invalid measurements produce:
- `targetSeen=null`
- no competitor/source/entity-relation facts
- `invalid_measurement`
- `sourceFactsStatus=partial`

They do not contribute to later customer-facing denominators.

## Determinism

The pure builder must be:
- side-effect free
- input immutable
- repeat deterministic
- permutation-stable for semantically identical input sets
- deterministic on conflict: conflicts produce the same fail-closed result regardless of row ordering
- stable in quality-flag ordering for reproducible replay hashes

## Required invariants

1. RAW_PARSER_NOT_AUTHORITY
2. SELF_NOT_COMPETITOR
3. BEST_POSITION
4. FAIL_CLOSED_ON_IDENTITY_CONFLICT
5. TARGET_CANDIDATE_PROVENANCE_REQUIRED
6. ENTITY_RELATION_SINGLE_TRUTH
7. SOURCE_TARGET_CONSISTENCY
8. DUPLICATE_ENTITY_REF_ORDER_INDEPENDENT
9. DUPLICATE_ATTRIBUTION_ID_ORDER_INDEPENDENT
10. VALID_TARGET_CONTEXT_REQUIRED
11. RAW_PRESERVATION
12. STABLE_SERIALIZATION

## Synthetic run contract

A pure 24-measurement fixture with:
- 24 valid measurements
- 6 authoritative target-equivalent measurements
- raw parser positive on only 1 of those 6
- all 6 authoritative target positions <=3

must aggregate to:
- denominator 24
- authoritative target seen 6
- visibility 25%
- Top3 6
- current target key appearing as competitor 0

This is a contract fixture, not a claim about any Production business.

## Deferred to later phases

Not part of Phase 2B pure-engine work:
- DB schema/materialization
- migrations/RLS
- diagnostic consumer cutover
- significance/source/action/benchmark cutover
- historical replay against Production
- runtime feature flag
- customer UI
