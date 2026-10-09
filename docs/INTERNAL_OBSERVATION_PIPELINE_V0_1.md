# Internal Observation Pipeline v0.9.4 Recurring Discovery

Status: v0.8 unattended sequential measurement is validated. v0.9.1 public-web Discovery Preview, v0.9.2 persistent Review Queue, and v0.9.3 Guarded Promotion have passed live operator QA through one real 카포먼스 promotion into an existing-pipeline `pending` candidate, stopping before preparation. v0.9.4 Recurring Discovery infrastructure is implemented with disabled-by-default profiles, manual one-shot batch execution, new/changed/unchanged classification, persistent batch history, and an hourly global cron scaffold that remains OFF. No recurring paid web-search call is active until a separate explicit operator approval turns on the global cron gate.

## Goal

Build CHABOIM's internal automotive observation dataset without mixing research records
into customer organizations.

v0.3 includes:

1. operator-confirmed candidate intake
2. idempotent candidate queueing
3. standardized automotive category/service selection
4. read-only preparation preview before mutation
5. internal-observation organization guard
6. target business reuse/registration
7. deterministic Unified Diagnostic v0.2 question generation
8. atomic reuse/creation of one valid 24-question set
9. provider/credit readiness checks
10. operator-visible queue state

Preparation preview/prepare do **not** create a measurement run, enqueue jobs, or consume credits.

v0.2 added a separate execution-plan gate. Only an explicit per-item `측정 실행 승인` action may call the existing measurement path.

v0.3 reconciles the linked Run to a terminal pipeline state and requires the exact Run to be readable through the canonical Entity Facts v2 gateway before declaring the item complete. Web discovery and recurring scheduling remain out of scope.

## Boundary

Only organizations whose `measurement_data_origin = internal_observation` are eligible.

Customer organizations remain outside this pipeline.

Pipeline tables are service-role only. Authenticated operators reach them only through
server functions that first require `can_view_data_asset_admin_v01()`.

## State machine

```
pending
  -> preparing
      -> ready_to_measure
      -> blocked
      -> failed

ready_to_measure
  -> explicit execution approval
      -> measuring
          -> postprocessing
              -> completed
          -> failed
```

`postprocessing` means the Run has completed 24/24 with zero failed jobs but the exact linked Run is not yet readable through Entity Facts v2.

`cancelled` is reserved for operator cancellation.

No reconciliation path creates a replacement Run automatically.

## Candidate idempotency

The v0.1 idempotency surface is derived from:

- organization
- normalized business name
- region
- city
- service
- brand/model
- customer need

A repeated submission with the same surface reuses the existing queue item.

## Preparation preview gate

Before preparation, the operator must review a read-only preview.

The preview shows:

- whether the business will be created, reused, or blocked
- whether the unified question set will be created, reused, or blocked
- the current existing question count when a unified set exists
- all 24 questions that would be generated from the candidate inputs
- provider readiness
- measurement-credit balance
- current automatic-execution lock state

The UI no longer offers batch preparation. Each candidate is previewed and confirmed individually.

The preview does not create businesses, question sets, questions, measurement runs, jobs, or credit ledger entries.

## Input standardization

Internal candidates reuse the same automotive category options as the normal business-registration screen.

Primary service uses a controlled automotive service list. A free-text value is accepted only
through the explicit `기타 직접 입력` option.

This prevents avoidable variations such as `PPF`, `피피에프`, and arbitrary category spelling
from becoming the default internal research taxonomy.

## Business handling

Preparation uses an atomic database RPC.

- If the exact normalized business already exists in the internal organization, reuse it.
- If that business exists but is inactive, stop with `EXISTING_BUSINESS_INACTIVE`.
- Otherwise create a new active client business under the internal organization.
- Never auto-merge two different business names.
- Never reactivate an existing inactive business automatically.

This intentionally prefers false negatives/manual review over unsafe identity merging.

## Question contract

Questions reuse the production Unified Diagnostic v0.2 deterministic generator.

Required contract:

- exactly 24 active questions
- 8 allowed intents
- exactly 3 questions per intent
- target business name excluded from generated prompts
- public data class
- Core/Focus/Specific location resolution stays aligned with the existing customer path

If an active unified set already exists:

- valid 24-question contract -> reuse it
- invalid/incomplete contract -> stop with `EXISTING_UNIFIED_SET_INVALID`
- never rewrite an existing question set automatically

Business creation and question-set preparation are performed in one database transaction.

## Readiness gate

After preparation, CHABOIM checks:

- OpenAI provider enabled
- paid account confirmed
- terms reviewed
- automated benchmark approved
- measurement credit balance >= 1
- current queued/running standalone audit count
- pipeline execution settings

A candidate may reach `ready_to_measure` while `execution_enabled = false`.
That means the data contract is ready, not that AI execution is permitted.

## Execution gate v0.2

`internal_observation_pipeline_settings.execution_enabled` still defaults to `false` and controls future unattended automation, not the explicit one-item approval flow.

Guardrails:

- `daily_run_limit` default 5
- `concurrent_run_limit` default 1
- exact 24-question contract
- OpenAI provider readiness
- measurement credit >= 1
- organization daily request allowance
- organization monthly budget allowance
- no active same-condition draft/queued/running run
- current operator has owner/admin/analyst membership in the target internal organization

Before any side effect, the operator opens an execution plan showing:

- planned jobs/provider/repetitions
- estimated provider cost and internal max-cost reservation
- credit balance before/after
- daily requests current/projected/limit
- monthly actual+reserved/projected/budget
- pipeline daily executions
- active/concurrent runs
- same-condition active run status
- all current blockers

The plan receives a SHA-256 fingerprint over the execution-sensitive state. On `측정 실행 승인`, the server rebuilds the plan and requires an exact fingerprint match. A credit, budget, usage, concurrency, membership, question-set, or run-state change forces the operator to review a new plan.

The explicit approval path reuses `createCustomerMeasurementRun()`; it does not create a second enqueue implementation. Therefore existing customer measurement checks, `enqueue-run`, idempotency behavior, and the measurement-credit debit trigger remain the execution truth.

The pipeline item is claimed into `measuring` before invoking the existing run path so double-clicks cannot create two approvals. If run startup fails, the item is returned to `ready_to_measure` and the approval fields are cleared.

Automatic recurring execution remains OFF.

The existing credit trigger remains the cost fuse. Internal automation must never bypass it.

## Existing systems reused

The pipeline deliberately reuses:

- business normalization helpers
- Unified Diagnostic v0.2 generator
- question location resolver
- existing provider settings
- existing measurement credit account
- existing `internal_observation` data origin
- existing Entity Facts v2 downstream path (once runs are later enabled)

It does not introduce a second visibility parser or a second diagnostic truth model.

## Scheduler dry-run v0.4

v0.4 adds a read-only scheduler planner. It does not create runs, enqueue jobs, update queue items, or consume credits.

Selection policy is deterministic:

1. only `ready_to_measure` candidates
2. oldest `prepared_at` first
3. `created_at` as the stable tie-breaker

The dry-run evaluates the current internal organization state:

- daily pipeline run limit and runs already approved today
- active standalone runs and concurrent-run limit
- current measurement-credit balance
- current daily request usage/limit
- current monthly actual+reserved cost/budget
- provider readiness
- exact 24-question Unified Diagnostic contract
- active same-condition run conflicts

The planner simulates candidates in order. A planned candidate consumes one simulated credit,
24 simulated requests, one simulated daily pipeline slot, and its internal max-cost reservation.
Later candidates are excluded when a simulated limit would be exceeded.

`dispatchNow` is advisory only: it marks how many of today's planned candidates would fit in the
currently available concurrent slots. The remaining planned candidates represent a sequential
today-queue, not simultaneous execution.

Automatic execution remains OFF. The planner is intentionally side-effect free and is suitable for
verifying future scheduler policy before a cron/worker is allowed to execute anything.

## Guarded scheduler v0.5

v0.5 implements the execution engine behind the master switch while keeping that switch OFF.

The scheduler settings now keep an explicit `scheduler_actor_user_id`. The actor must remain a
write-role member (`owner/admin/analyst`) of the internal-observation organization.

Candidate claim is performed by the service-role-only
`claim_internal_observation_scheduler_candidate_v05()` RPC.

The claim is fail-closed and atomic:

- organization must be `internal_observation`
- `execution_enabled=true`
- supplied actor must exactly match the configured scheduler actor
- actor must still have a write role
- no pipeline item may be `measuring` or `postprocessing`
- no standalone audit Run may be `draft/queued/running`
- measurement credit must be >= 1
- today's pipeline approvals must remain below `daily_run_limit`
- exactly one oldest `ready_to_measure` item is selected with `FOR UPDATE SKIP LOCKED`

Before claim, the guarded tick runs v0.3 reconciliation and recomputes the v0.4 Dry-run plan.
After claim, the claimed item must still equal the first `planned && dispatchNow` Dry-run item.
If it differs, the claim is released without creating a Run.

The scheduler uses the same standalone audit measurement core as the customer/manual execution path.
There is no second Run insert or enqueue implementation. The trusted scheduler mode is limited to
`internal_observation` organizations and still requires the configured actor's write-role membership.

Execution sequence when the master switch is eventually enabled:

```
scheduler tick
  -> reconcile previous item
  -> recompute dry-run
  -> atomic claim exactly one oldest-ready item
  -> re-run the existing measurement checks/core
  -> link Run
  -> wait
  -> reconciliation reaches completed/failed
  -> only a later tick may claim the next item
```

If Run startup fails, the claim returns to `ready_to_measure` with an error for operator review.
The guarded scheduler never creates an immediate replacement Run and has no internal retry loop.

The `execution_enabled=false` path returns before claim and before scheduler metadata writes.
There is intentionally no UI control in v0.5 for enabling automatic execution.

## Scheduler operations v0.6

v0.6 adds the operator control plane without enabling unattended measurement.

Scheduler settings now expose:

- `scheduler_state = off | paused | running`
- `execution_enabled` as the hard execution fuse
- `scheduler_executor_ready`
- configured scheduler actor
- activated/paused/stopped timestamps

Database consistency requires `execution_enabled=true` only when `scheduler_state=running`.

### Two-step activation

Activation requires two explicit operator actions:

1. Create an activation request from the current dry-run plan.
2. Within 10 minutes, type the exact confirmation text `자동 실행 시작`.

The request stores a SHA-256 plan hash and plan snapshot. Final confirmation recomputes the
activation plan. Any change in credits, budget, usage, concurrency, candidate order, scheduler
actor, cron schedule, or safety blockers invalidates the request.

Activation is blocked when:

- executor readiness is false
- scheduler actor is missing
- cron scaffold is missing
- no candidate is currently planned
- no dispatch slot is available
- the current operator lacks a write role

The current environment intentionally has `scheduler_executor_ready=false`.

### Pause and stop

`pause` and `stop` both:

- set `execution_enabled=false`
- deactivate the scheduler cron job
- prevent the next candidate from being claimed
- do not cancel a Run that is already in progress

`paused` is resumable only through a new two-step activation request.
`off` also cancels any pending activation request.

### Cron scaffold

The migration creates the permanent cron job:

`internal-observation-scheduler-v06`

Schedule:

`*/2 * * * *`

The job is created **inactive**. It targets the future
`internal-observation-scheduler-tick` Edge Function using the existing Vault project URL,
publishable key, and internal cron secret.

The cron activation/deactivation RPC is service-role only.

Executor deployment and executor readiness are separate states. A deployed executor may still remain
blocked by `scheduler_executor_ready=false`, which prevents activation and candidate claim.

## Unattended executor v0.7

v0.7 adds the internal `internal-observation-scheduler-tick` Edge Function.

Authentication:

- platform JWT verification is disabled for this internal endpoint
- every request must provide the existing `x-internal-secret`
- secret comparison is constant-time
- the function uses service-role access only after the secret passes

The executor processes at most one candidate per eligible organization per tick.

Execution flow:

1. Read only organizations where `execution_enabled=true`, `scheduler_state=running`, and
   `scheduler_executor_ready=true`.
2. Reconcile any previous `measuring/postprocessing` item.
3. Re-read the execution fuse so pause/stop wins before claim.
4. Atomically claim one oldest eligible `ready_to_measure` candidate.
5. Re-check the exact Unified Diagnostic 24-question contract, OpenAI provider readiness,
   measurement credit, daily request allowance, monthly budget, daily pipeline limit, write-role
   scheduler actor, and absence of active standalone Runs.
6. Create one draft internal-observation Run and atomically link it to the claimed pipeline item.
7. Call the existing `enqueue-run` function using its narrow internal-scheduler authentication
   branch.
8. Existing `enqueue-run` remains the single job-generation path and the existing measurement
   credit trigger remains the credit-debit truth.
9. Existing measurement worker / postprocess / Entity Facts v2 watchdogs handle downstream work.
10. A later scheduler tick reconciles the exact linked Run before another candidate may be claimed.

### Enqueue-run internal branch

The normal customer path remains unchanged: a user bearer token must validate with Auth and the
user must have an organization write role.

The internal scheduler path additionally requires:

- valid `x-internal-secret`
- exact pipeline item id
- exact scheduler actor id
- pipeline item = `measuring`
- pipeline item linked to the exact Run
- scheduler settings = running + enabled + executor ready
- configured actor matches the supplied actor
- actor still has a write role
- organization and Run data origin = `internal_observation`
- standalone customer diagnostic scope

### Fail-closed startup policy

If a process crash leaves a claimed item without a Run for five minutes, unattended reconciliation
marks it failed with `SCHEDULER_STALE_CLAIM`. It does not release it for automatic retry.

If Run creation fails after claim, the item becomes terminal failed.

If enqueue returns an error:

- when no Job exists and Run is still draft, the Run is cancelled and the item becomes failed
- when Jobs exist or Run progressed beyond draft, the executor assumes the HTTP response may have
  been lost and preserves the Run/item for reconciliation

The executor never creates an immediate replacement Run and contains no retry loop.

### Deployment versus readiness

`scheduler_executor_deployed` records whether the Edge Function has been deployed and smoke-tested.

`scheduler_executor_ready` is a separate activation gate and remains false until an operator
explicitly approves the first enabled scheduler cycle.

A deployed but not-ready executor cannot be activated through the v0.6 control plane.

## v0.8 first enabled scheduler cycle validation

The first enabled unattended cycle was executed only after the operator explicitly:

1. marked the deployed executor ready
2. created a fresh activation request
3. confirmed the exact phrase `자동 실행 시작`
4. allowed the existing two-minute cron scaffold to become active

### Pilot candidates

The enabled-cycle order was deterministic and preserved oldest-ready-first policy:

1. 온카케어
2. 타이어365
3. 씽카스게러지 안산점

The intended contract was one active internal candidate at a time. A later candidate could not be claimed until the current item reached a terminal pipeline state through reconciliation.

### QA defect 1 — ambiguous pipeline `run_id` reference

The first live cron tick selected 온카케어, but Run creation failed before a Run was committed.

Observed database error:

`column reference "run_id" is ambiguous`

The ambiguity was inside `create_internal_observation_scheduler_run_v07()`, where the pipeline update used an unqualified `run_id` reference while the PL/pgSQL function also exposed a `run_id` output column.

Fail-closed behavior worked as designed:

- 온카케어 became terminal failed
- no measurement Run was created
- no measurement Job was created
- no measurement credit was consumed
- no replacement Run was created
- the scheduler was immediately paused before the next candidate could start

Fix:

- qualify the pipeline table as `i`
- require `i.run_id is null`
- add migration `20261005043117_fix_internal_observation_scheduler_run_id_ambiguity.sql`
- add regression coverage to the internal observation contract test
- validate the Run-creation function inside a transaction that was rolled back, proving the function could create/link a Run without leaving a real test Run behind

After explicit operator retry approval, 온카케어 was returned to `ready_to_measure` and a fresh two-step activation request was used. The successful retry created exactly one Run, exactly 24 Jobs, and consumed exactly one credit.

### Sequential dispatch proof

The enabled retry demonstrated the scheduler's intended serialization:

- 온카케어 started first
- 타이어365 remained `ready_to_measure` with no Run while 온카케어 was active
- 온카케어 reached 24/24, failed=0, and Entity Facts v2 ready before 타이어365 started
- 타이어365 then started on a later cron tick
- 씽카스게러지 안산점 remained `ready_to_measure` with no Run while 타이어365 was active
- 타이어365 reached 24/24, failed=0, and Entity Facts v2 ready before 씽카스게러지 안산점 started
- 씽카스게러지 안산점 then started on a later cron tick

Measurement-credit transitions were exact:

`10 -> 9 -> 8 -> 7`

No candidate consumed more than one credit.

### QA defect 2 — persisted canonical display versus brand-core key

씽카스게러지 안산점 itself completed normally:

- Run completed
- total Jobs = 24
- completed Jobs = 24
- failed Jobs = 0
- Entity Facts v2 aggregate existed
- `contract_ok=true`
- measurement_count = 24
- valid_measurement_count = 24
- observed-source aggregate existed
- competitor-source-clue aggregate existed

However, the pipeline was marked `ENTITY_FACTS_INVALID` by the customer read gateway.

Root cause:

The persisted canonicalization layer may intentionally merge a service-qualified display name into a shorter brand-core canonical key. In the observed failing case:

- canonical key: `auto:원투랩핑`
- persisted canonical display: `원투 랩핑 PPF`
- persisted DB brand core: `원투랩핑`

The read gateway previously required the normalized display surface to equal the auto-key suffix exactly, producing `원투랩핑ppf != 원투랩핑`, even though the database's canonicalization rule intentionally strips recognized trailing service terms such as PPF, film, wrapping, tinting, detailing, coating, and wash.

Fix:

- keep the auto-key suffix forbidden as a customer-visible fallback
- keep weaker mention/alias evidence on the existing exact-surface rule
- only for priority-1 persisted `canonical_display_name` evidence already bound to the exact stored canonical key, allow the same brand-core normalization contract used by `get_auto_business_brand_core_v01()`
- add regression coverage proving:
  - `auto:원투랩핑` + persisted `원투 랩핑 PPF` is accepted
  - the same loose surface from weaker mention evidence is still rejected
  - an unrelated persisted display name is still rejected

The gateway fix was committed at `829c7b22520abb786a378205486bff8f25fd3366`.

CI after the fix passed:

- Entity Engine v2
- Typecheck
- Application tests
- Edge regression
- PostgreSQL retention/comparison regression
- Production build

Lovable preview synchronized to the same final commit and reported ready with no preview error.

### No-remeasurement recovery

씽카스게러지 안산점 was **not** remeasured.

Before recovery, the exact existing Run was revalidated:

- exact pipeline Run = newest completed representative unified-diagnostic Run
- Run contract = completed 24/24, failed=0
- exactly one matching Entity Facts v2 aggregate
- aggregate = contract_ok, 24 measurements, 24 valid measurements
- matching observed-source aggregate exists
- matching competitor-source-clue aggregate exists

The pipeline item was then changed from the false-negative `failed / ENTITY_FACTS_INVALID` state to `completed` using the same existing Run. An audit event records that this was a no-remeasurement recovery after the read-gateway validation fix.

Measurement credits remained at 7.

### v0.8 acceptance result

PASS:

- two-step activation required
- plan hash matched at activation
- cron remained inactive before confirmation
- at most one candidate started per tick
- no second candidate started before the previous item reached terminal completion
- each successful candidate created exactly one Run
- each successful Run created exactly 24 Jobs
- each successful candidate consumed exactly one measurement credit
- failed startup did not consume a credit
- failed startup did not create a replacement Run
- pause stopped future claims without cancelling active work
- Entity Facts v2 exact-Run completion was required
- false-negative postprocessing failure was recovered without remeasurement
- all three pilot candidates ended completed

Final validation snapshot:

- 온카케어 = completed
- 타이어365 = completed
- 씽카스게러지 안산점 = completed
- active internal Runs = 0
- ready candidates = 0
- measurement credits = 7
- scheduler = RUNNING
- cron = active

The final scheduler/cron state is an operational snapshot, not a requirement for future development work. With zero ready candidates, no new measurement starts. Adding a new `ready_to_measure` candidate while the scheduler remains RUNNING makes it eligible for the next guarded tick.

## v0.9 candidate discovery design

v0.9 adds **candidate discovery**, not a second measurement engine.

The boundary is strict:

```
public-web / Work discovery
  -> discovery proposal
  -> operator review
  -> approved structured candidate
  -> existing internal observation candidate intake
  -> existing preview / preparation gates
  -> ready_to_measure
  -> existing guarded scheduler
```

A discovered entity must never jump directly from browser/Work output to measurement.

### v0.9 goals

1. reduce manual candidate research time
2. preserve public evidence supporting why a business was proposed
3. keep business identity review explicit
4. reuse the existing internal-observation candidate preparation path
5. prevent discovery automation from creating Runs, Jobs, or credit debits
6. keep Work/browser automation replaceable and outside the measurement truth path

### Discovery queue state model

Proposed state machine:

```
discovered
  -> needs_review
      -> approved
      -> rejected
      -> duplicate
      -> needs_identity_review

approved
  -> promoted_to_pipeline
```

`promoted_to_pipeline` means a structured proposal has been copied into the existing internal observation candidate intake surface. It does **not** mean the candidate has been prepared or measured.

### Proposed discovery record

A discovery record should remain separate from `internal_observation_pipeline_items`.

Minimum proposed fields:

- id
- org_id
- discovery_source = work | manual | web
- discovery_batch_id
- raw_name
- proposed_canonical_name
- category
- service
- region
- city
- website_url
- public_profile_urls
- source_evidence
- discovered_at
- review_status
- reviewed_by
- reviewed_at
- rejection_reason
- duplicate_business_id
- promoted_pipeline_item_id
- idempotency_fingerprint

Raw discovery evidence must be retained for review, but only approved structured fields may cross into the existing pipeline.

### Identity and duplicate gate

Before approval, v0.9 should compare a proposal against:

- existing internal-organization businesses
- existing discovery proposals
- existing pipeline candidates
- normalized business name
- region/city
- known public domain/profile URLs

The discovery layer may flag likely duplicates, but it must not auto-merge businesses.

Branch ambiguity should route to `needs_identity_review`, especially when:

- the same brand has multiple nearby branches
- the same domain represents many branches
- city/branch name is absent
- the public evidence does not clearly identify one physical business

### Operator review contract

Approval should require explicit confirmation of at least:

- canonical business name
- category
- primary service
- broad region
- city when applicable

Helpful but not mandatory enrichment:

- official/public website
- Naver/public profile URL
- brand/model specialization
- short evidence note

Approval still does not create a Run.

After approval, promotion should call the **existing** candidate-intake/idempotency path rather than inserting a second preparation implementation.

### Work/browser role

Work may:

- search public automotive businesses
- collect public homepage/profile URLs
- suggest category/service/region/city
- attach short public evidence supporting the suggestion
- identify possible duplicates for human review

Work must not:

- create a customer measurement Run
- enqueue measurement Jobs
- debit measurement credits
- mark a discovery proposal ready to measure
- choose a final business identity when evidence is ambiguous
- bypass Unified Diagnostic v0.2 preparation

### v0.9 sub-phases

#### v0.9.1 — read-only discovery preview

Implemented and deployed.

Input:

- target region/city
- automotive category/service
- optional brand/model focus
- desired candidate count (1-8)

Execution boundary:

- authenticated internal operator only
- internal-observation organization only
- OpenAI Responses API web search
- `store=false`
- provider-observed web-search source URLs are collected from the response
- a proposed evidence URL is accepted only when it matches a URL actually present in the provider search-source payload
- candidates without any verified public evidence URL are dropped
- existing business/pipeline names and public domains are read only for duplicate warnings

Output:

- candidate proposals
- verified public evidence URLs
- requested normalized category/service/region context
- duplicate warnings:
  - exact existing business
  - exact existing pipeline candidate
  - existing public-domain overlap

Safety:

- discovery result persistence = false
- business creation = 0
- pipeline item creation = 0
- question-set/question creation = 0
- Run creation = 0
- Job creation = 0
- measurement-credit debit = 0
- no `enqueue-run` path
- Preview explicitly states that candidates are not auto-registered

Implementation:

- Edge Function: `internal-observation-discovery-preview`
- server function: `getInternalObservationDiscoveryPreview`
- UI: internal observation operations screen, `Discovery v0.9.1 Preview`
- Edge platform auth: `verify_jwt=true`
- function body also re-validates the user and internal organization write role

Validation:

- Entity Engine v2 CI: PASS
- Typecheck: PASS
- Application tests: PASS
- Edge regression: PASS
- PostgreSQL retention/comparison regression: PASS
- Production build: PASS
- Lovable preview synchronized and ready
- deployed Edge Function: ACTIVE
- unauthenticated POST smoke: HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER`

Still required before calling v0.9.1 live-QA complete:

- log in as an authorized internal operator
- run one real Discovery Preview from the UI
- verify returned businesses and evidence URLs manually
- verify duplicate warnings against known internal businesses
- confirm pipeline rows, Runs, Jobs, and credit balance remain unchanged

#### v0.9.2 — persistent review queue

Implemented.

Discovery Preview results remain non-persistent by default. An operator must explicitly click
`검토 후보로 저장` for a candidate to enter the persistent review queue.

Storage:

- dedicated table: `internal_observation_discovery_candidates`
- RLS enabled
- authenticated/anon direct table privileges revoked
- service-role server functions only
- candidate-level idempotency key across org + business identity + region/city + service
- repeated discovery refreshes the same review item instead of creating a second row
- public evidence URLs and discovery query context retained
- duplicate signals retained without auto-merging
- future `promoted_pipeline_item_id` reserved for v0.9.3 and remains null in v0.9.2

Operator review states:

- `needs_review` — 검토 대기
- `approved` — 승인
- `rejected` — 제외
- `duplicate` — 중복
- `needs_identity_review` — 지점 확인 필요

The UI exposes a separate **Discovery Review Queue** with:

- explicit per-candidate save from the read-only preview
- evidence count and first public evidence link
- duplicate warning badges
- operator-controlled review status
- queue counts for total / needs review / approved

Safety boundary:

- saving a review candidate does not create or update a business
- review approval does not create a pipeline item
- review approval does not prepare Unified Diagnostic questions
- review approval does not create a Run or Job
- review approval does not debit a measurement credit
- no discovery-review code path calls `enqueue-run`
- no automatic promotion exists

Audit events:

- `internal_discovery_candidate_saved`
- `internal_discovery_candidate_seen_again`
- `internal_discovery_review_status_changed`

Database smoke validation was executed inside a rollback transaction and confirmed that
`needs_review -> approved` satisfies the review metadata contract while
`promoted_pipeline_item_id` remains null.

A separately persisted discovery-batch object is intentionally deferred until recurring discovery
(v0.9.4). v0.9.2 persists only operator-selected candidates plus their preview query/evidence context.

#### v0.9.3 — guarded promotion

Implemented; first real operator promotion still pending QA.

The manual candidate intake path and Discovery promotion both call the same shared
`enqueueInternalObservationCandidateCore()`. v0.9.3 does not maintain a second insert path.

Promotion flow:

1. Review Queue item must be `approved`
2. operator opens `승격 미리보기`
3. server recalculates a fresh plan from current DB state
4. plan rechecks:
   - review status
   - existing promotion link
   - retained public evidence
   - exact existing-business identity collisions
   - inactive exact business matches
   - existing candidate idempotency
5. server returns a SHA-256 plan hash and exact action:
   - `create_pending_candidate`
   - or `link_existing_candidate`
6. operator explicitly presses `기존 파이프라인으로 승격`
7. confirmation request recalculates the plan and requires the same hash
8. existing candidate-intake core creates/reuses the candidate
9. Review Queue row records the immutable pipeline link

Promotion metadata:

- `promoted_pipeline_item_id`
- `promoted_at`
- `promoted_by`
- unique promoted-pipeline-item index
- audit event `internal_discovery_candidate_promoted`

Promotion blockers:

- `REVIEW_NOT_APPROVED`
- `ALREADY_PROMOTED`
- `PUBLIC_EVIDENCE_MISSING`
- `BUSINESS_IDENTITY_AMBIGUOUS`
- `EXISTING_BUSINESS_INACTIVE`

Safety boundary:

- resulting new candidate status = `pending`
- no business is created during promotion
- no question set/question is created during promotion
- no preparation function is called
- no `ready_to_measure` mutation occurs
- no Run is created
- no Job is created
- no measurement credit is debited
- no `enqueue-run` path is reachable
- existing `준비 미리보기 -> 준비 실행` remains a separate operator step

A rollback-only database smoke validated that the promotion metadata contract accepts an approved
Review Queue item linked to a `pending` candidate with no Run/question-set/measurement approval,
then rolls both mutations back. After rollback the real 카포먼스 Review Queue item remained
unpromoted and the credit balance remained unchanged.

The first live QA should promote only **카포먼스 안산직영점**, verify exactly one pending candidate
or an idempotent existing-candidate link, and stop before preparation.

#### v0.9.4 — recurring discovery, still no recurring auto-approval

Implemented with the global recurring gate OFF.

Storage:

- `internal_observation_discovery_schedules`
- `internal_observation_discovery_batches`
- `internal_observation_discovery_batch_items`

A schedule stores:

- region/city
- automotive category/service
- optional brand/model focus
- desired candidate count
- daily or weekly cadence
- KST execution hour
- configured actor
- enabled/eligible state
- last batch status

A saved profile is disabled by default.

The UI supports:

- save a recurring-discovery profile from the current Discovery query
- mark a profile as eligible/ineligible for future recurring execution
- manually execute one batch for QA
- inspect recent batch result counts
- inspect recently new/changed candidate names
- see the separate global cron-gate state

Batch behavior:

1. run the public-web candidate search
2. validate provider-observed evidence URLs
3. compare each result to the persistent Review Queue
4. classify each candidate as:
   - `new`
   - `changed`
   - `unchanged`
5. insert new candidates as `needs_review`
6. refresh evidence for existing candidates
7. if an unpromoted previously reviewed candidate materially changes, return it to `needs_review`
8. never change a promoted candidate's review decision automatically
9. retain per-batch snapshots and counts

Recurring source is tagged `scheduled_web` separately from manual `web_preview`.

The global cron scaffold:

- job: `internal-observation-discovery-scheduler-v094`
- cadence: hourly due-check
- actual candidate-profile cadence is evaluated in KST
- global job is created **inactive**
- service-role-only getter/setter RPCs separate implementation from activation

Current live state after implementation:

- global recurring cron = OFF
- saved recurring profiles = 0
- recurring batches = 0
- paid recurring web-search calls = 0
- Review Queue remains unchanged
- 카포먼스 remains `pending`, not prepared
- measurement credits remain unchanged

Safety:

- no auto-approval
- no auto-promotion
- no business creation
- no question preparation
- no Run/Job creation
- no measurement-credit debit
- no measurement scheduler state mutation
- profile eligibility does not change the global cron gate
- manual `지금 1회 실행` is the only v0.9.4 paid search path before global-gate approval

Next live QA:

1. save one recurring profile using the already tested 안산 PPF conditions
2. keep the global gate OFF
3. manually run the profile once
4. verify new/changed/unchanged counts
5. verify Review Queue changes only
6. verify no pipeline/Run/credit side effects
7. only after that decide whether to enable recurring execution

### v0.9 acceptance criteria

v0.9 should not be considered complete until:

- the same public business discovered twice becomes one review candidate or an explicit duplicate
- an ambiguous branch never auto-merges
- a rejected candidate never enters the measurement pipeline
- approval alone does not create a Run
- promotion reuses the existing candidate idempotency path
- preparation still shows the existing 24-question preview
- discovery evidence remains inspectable after promotion
- Work/browser failure cannot alter scheduler state
- discovery cannot consume measurement credits
- no discovery code path can call `enqueue-run`

## Work / browser automation role

Work is not the measurement engine.

Future Work usage should be limited to candidate discovery/enrichment, for example:

- find candidate automotive businesses
- verify public homepage/profile URLs
- collect operator-review evidence for service/brand/model fields

Work output should land in a discovery/review queue. Only approved structured fields should
enter this pipeline.

## Next phases

### v0.2 - execution approval gate

Implemented:
- read-only execution plan
- credit/cost/budget/usage/concurrency/duplicate-run checks
- execution-sensitive plan fingerprint
- explicit per-item approval
- existing customer measurement/enqueue path reuse
- run id stored on the pipeline item
- no recurring automatic schedule

### v0.3 - terminal reconciliation

Implemented:
- observe linked Run status on each bounded internal overview refresh
- manual `상태 동기화` action
- `measuring -> postprocessing -> completed` flow
- terminal `failed` for cancelled/failed/incomplete Runs
- exact 24/24 and failed=0 requirement
- exact linked Run match through Entity Facts v2 read gateway
- transient `NO_V2_DATA`/read-check errors stay retryable as postprocessing
- completed items expose a read-only internal result summary
- no automatic replacement Run or retry

### v0.4 - scheduler dry-run

Implemented:
- read-only today-plan
- deterministic oldest-ready-first ordering
- cumulative credit/request/budget simulation
- daily pipeline slot accounting
- concurrent dispatch-now advisory
- exact candidate contract and same-condition-run validation
- no run/job/credit side effects

### v0.5 - guarded scheduler engine

Implemented:
- explicit configured scheduler actor
- service-role-only atomic oldest-ready claim
- sequential one-item execution contract
- v0.3 reconciliation before every guarded tick
- v0.4 Dry-run plan match before execution
- shared measurement core with customer/manual path
- no second Run/enqueue implementation
- claim release on startup failure
- no internal retry loop
- master switch OFF remains side-effect free
- no enable UI

Not enabled yet:
- recurring cron/worker
- master-switch ON
- automatic execution

### v0.6 - scheduler control plane

Implemented:
- OFF / PAUSED / RUNNING state model
- executor-readiness gate
- permanent inactive two-minute cron scaffold
- service-role-only cron activation control
- two-step activation request with 10-minute expiry
- exact confirmation phrase
- activation plan hash drift protection
- pause and stop semantics
- current Run is never force-cancelled by pause/stop
- activation audit events

Still intentionally disabled:
- executor readiness
- cron activation
- master switch ON

### v0.7 - unattended executor

Implemented in code:
- internal scheduler tick Edge Function
- existing internal cron-secret authentication
- exact running/enabled/executor-ready gate
- service-role-only v0.7 reconcile/claim/run RPCs
- oldest-ready atomic claim
- exact 24-question/provider/credit/usage/budget revalidation
- narrow internal scheduler authentication added to existing enqueue-run
- no second measurement-job generation path
- stale-claim terminal failure
- enqueue-response uncertainty preservation
- no replacement Run retry loop
- executor audit events
- separate deployed/readiness state

Deployment smoke test completed:
- `internal-observation-scheduler-tick` deployed with custom internal-secret auth
- unauthorized POST returned HTTP 403 `FORBIDDEN`
- authorized POST while master switch OFF returned HTTP 200 with `eligibleOrgs=0`
- no candidate was claimed
- no Run was created
- no measurement credit was consumed
- `scheduler_executor_deployed=true`
- `scheduler_executor_ready=false`
- cron remains inactive

Before marking the executor ready:
- review the first enabled cycle plan with the operator
- explicitly approve executor readiness
- create a fresh v0.6 activation request

### v0.8 - first enabled scheduler cycle

Validated:
- executor readiness explicitly approved
- fresh activation request + exact confirmation phrase
- cron activation
- first live startup failure remained fail-closed
- ambiguous SQL `run_id` defect fixed and regression-tested
- retry required explicit operator approval
- oldest-ready sequential dispatch confirmed across three candidates
- exact one Run / 24 Jobs / one credit per successful candidate
- next candidate blocked until prior terminal completion
- Entity Facts v2 false-negative read-gateway defect identified
- persisted brand-core display validation generalized without business hardcoding
- false-negative item recovered using the existing 24/24 Run without remeasurement
- all three pilot candidates completed
- credits ended at 7

### v0.9 - candidate discovery

Designed:
- separate discovery/review queue
- public evidence retention
- duplicate and branch-identity review gates
- explicit operator approval
- guarded promotion into the existing candidate-intake path
- no direct measurement from browser/Work output
- no discovery-triggered credit debit
- no second enqueue/measurement engine
- recurring discovery only after read-only preview, persistence, and guarded promotion are validated
