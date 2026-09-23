# P0 Entity Truth Phase 2A Brief

Repository: siamin938/manual-ai-scan
Branch: codex/p0-entity-truth-phase2a

## Purpose

This branch is based on Draft PR #1 Entity Engine v2 foundation head.
Phase 2A is TEST-FIRST PURE ENGINE ONLY.

The production issue is structural: customer-facing visibility, competitor, source, action and benchmark paths do not share one authoritative target identity truth. A recent rehearsal showed the same physical business surface split between the current target and an auto canonical entity, causing undercounted visibility and self-as-competitor behavior.

Do not solve this with business-specific hardcoding, blacklist terms, fuzzy name-only merges or one-off aliases.

## Hard safety constraints

Do NOT:
- modify Production DB
- apply migrations
- deploy Supabase Edge Functions
- change customer UI
- merge main
- merge Draft PR #1
- run new paid AI measurements
- mutate raw measurements/canonicalizations/attributions
- hardcode a specific business into production rules
- add blacklist/stop-word patches

## Reuse from existing foundation

Review and reuse the actual code in:
- supabase/functions/_shared/entity-engine-v2/response-structure.ts
- supabase/functions/_shared/entity-engine-v2/candidate-extractor.ts
- supabase/functions/_shared/entity-engine-v2/identity-gate.ts
- supabase/functions/_shared/entity-engine-v2/shadow-adapter.ts
- supabase/functions/_shared/entity-engine-v2/runtime-shadow.ts
- scripts/entity-v2-shadow-replay.ts
- scripts/entity-v2-historical-replay.live.ts
- tests/entity-engine-v2/*
- tests/fixtures/entity-golden-corpus-*.json

## Architecture rule

Business Identity Gate asks:
"Is this candidate a real specific business?"

Target Equivalence asks:
"Is this confirmed business the same physical business as the current measurement target?"

Do not mix those decisions.

## Phase 2A implementation

Implement a pure server-only Target Equivalence engine.

Suggested module:
supabase/functions/_shared/entity-engine-v2/target-equivalence.ts

The engine must be deterministic, side-effect-free, and must not perform external API calls.

### Decision

At minimum:
- equivalent
- distinct
- unresolved

If equivalent, projected canonical key MUST be:
business:<CURRENT TARGET BUSINESS ID>

Never project a foreign/cross-org business id.

## Evidence precedence

Automatic equivalent is allowed only for strong evidence:

A. exact canonical Naver Place ID

B. exact verified concrete official URL
   + compatible business/branch identity

C. explicit alias owned by the current target record

D. exact normalized FULL address
   + at least one additional strong evidence:
   - matching verified phone
   - explicit current-target-owned alias
   - matching canonical Naver Place ID
   - matching verified concrete official URL

Full address alone is NOT enough.

## Evidence that MUST NOT auto-merge

- name similarity alone
- brand core alone
- city/gu + brand
- same full address alone
- same root domain alone
- repeated frequency alone
- foreign/cross-org row existence alone
- fuzzy branch similarity alone

## Required adversarial negative fixtures

Executable tests must include:
- different businesses in the same building
- same brand, different branch
- same full address but different phone / Place ID / official URL
- chain branches sharing one root corporate domain
- same gu + same brand but different store
- nearly identical names but distinct businesses
- brand mention only
- generic service phrase

## Required positive fixtures

Use business names only in tests/fixtures, never in production rules.

Positive structures:
- current target exact name
- target name variant with same canonical Place ID
- target name variant with same full address + second strong evidence
- cross-org duplicate registered row with same strong public identity, projected to current target id

Expected:
equivalent -> business:<synthetic-current-target-id>

Negative:
same brand, different branch/address/Place identity -> never equivalent

## Existing regressions must remain green

Preserve existing Golden Corpus behavior including:
- registered business embedded in descriptive headings
- Hyundai XTeer Pangyo style registered exact subspans
- TirePro branch distinction
- Custom Garage positive business controls
- J Zone cross-script alias behavior
- generic headings
- official network descriptions
- platform descriptions

## Parser flags

measurements.was_client_mentioned and client_position are raw audit signals only.

Do NOT use raw parser flags as authoritative input to Target Equivalence.

Parser false positives and false negatives will be compared later in Measurement Entity Facts / historical replay.

## Deliverables for this phase only

Code:
- pure Target Equivalence engine
- normalization helpers if necessary
- positive fixtures
- adversarial negative fixtures
- unit tests
- property/adversarial tests if practical

Docs:
- evidence precedence contract synchronized with code

Do NOT yet create:
- Measurement Entity Facts DB schema
- migrations
- diagnostic changes
- significance changes
- source/action/benchmark changes
- UI changes
- production cutover

## Verification

Run:
- full existing tests
- Entity Engine v2 suite
- new Target Equivalence tests
- typecheck
- production build
- git diff check

Verify by diff that no Production DB/Edge/UI mutation path was changed.

If any existing test fails, do NOT weaken the rule just to make it green.
Report the failure and STOP.

## Final report

Report only:
1. files added/modified
2. decision/evidence contract
3. positive test results
4. adversarial negative test results
5. existing regression suite results
6. unresolved design questions
7. whether it is safe to proceed to Phase 2B Measurement Entity Facts
