# Internal Observation Pipeline v0.4 Dry-run

Status: v0.4 dry-run implemented. Automatic recurring execution remains disabled; the system now calculates the scheduler plan without creating runs.

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

### v0.5 - guarded recurring scheduler

Only after the dry-run plan is validated with multiple real candidates:
- hourly/daily worker
- automatic execution master switch remains explicit
- max daily runs
- max concurrent runs
- atomic candidate claim
- stale claim recovery
- no silent retry after a terminal failed run
- remeasurement cadence
- execution audit log

### v0.6 - candidate discovery

Add external/Work discovery into a separate review queue.
Do not directly measure a browser-discovered entity before structured identity review.
