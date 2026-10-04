# Internal Observation Pipeline v0.7 Unattended Executor

Status: v0.7 unattended executor implemented, deployed, and smoke-tested while OFF. Deployment and executor readiness are tracked separately. The master switch remains OFF, cron remains inactive, and scheduler_executor_ready remains false until explicit operator approval.

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

Only after explicit operator approval:
- mark executor ready
- create a fresh activation request
- confirm the activation phrase
- allow cron activation
- watch the first candidate from claim through Entity Facts v2 completion
- verify second candidate does not start before the first terminal state

### v0.9 - candidate discovery

Add external/Work discovery into a separate review queue.
Do not directly measure a browser-discovered entity before structured identity review.
