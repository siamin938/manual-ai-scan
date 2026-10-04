# Internal Observation Pipeline v0.1

Status: v0.1.1 implemented, measurement execution intentionally disabled.

## Goal

Build CHABOIM's internal automotive observation dataset without mixing research records
into customer organizations.

v0.1.1 automates:

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

v0.1 does **not** create a measurement run, enqueue jobs, consume credits, crawl the web,
or enable a recurring scheduler.

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
  -> (future explicit execution gate)
      -> measuring
      -> completed
```

`cancelled` is reserved for operator cancellation.

The current implementation stops at `ready_to_measure`.

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

## Execution fuse

`internal_observation_pipeline_settings.execution_enabled` defaults to `false`.

Additional future guardrails are already represented:

- `daily_run_limit` default 5
- `concurrent_run_limit` default 1

Turning this setting on is not implemented in v0.1.

Before automated execution is introduced, the execution layer must re-check:

1. internal-observation organization
2. provider readiness
3. measurement credit
4. daily request/monthly budget allowance
5. daily pipeline run limit
6. concurrent pipeline run limit
7. no active same-condition run
8. exact 24-question contract
9. idempotent run/enqueue contract

The existing credit trigger remains the cost fuse. Internal automation must not bypass it.

## Existing systems reused

v0.1 deliberately reuses:

- business normalization helpers
- Unified Diagnostic v0.2 generator
- question location resolver
- existing provider settings
- existing measurement credit account
- existing `internal_observation` data origin
- existing Entity Facts v2 downstream path (once runs are later enabled)

It does not introduce a second visibility parser or a second diagnostic truth model.

## Work / browser automation role

Work is not the measurement engine.

Future Work usage should be limited to candidate discovery/enrichment, for example:

- find candidate automotive businesses
- verify public homepage/profile URLs
- collect operator-review evidence for service/brand/model fields

Work output should land in a discovery/review queue. Only approved structured fields should
enter this pipeline.

## Next phases

### v0.2 - execution approval and dry-run plan

Add an operator action that previews:
- planned run
- expected jobs
- credit impact
- current budget/limits
- concurrency state

No automatic schedule yet.

### v0.3 - guarded measurement execution

After explicit product approval:
- create one internal observation standalone audit run
- reuse existing enqueue/worker/postprocess path
- preserve credit debit trigger
- store run id on the pipeline item
- reconcile terminal state back to `completed`/`failed`

### v0.4 - recurring scheduler

Only after v0.3 is stable:
- hourly/daily queue worker
- max daily runs
- max concurrent runs
- exponential retry
- stale claim recovery
- remeasurement cadence

### v0.5 - candidate discovery

Add external/Work discovery into a separate review queue.
Do not directly measure a browser-discovered entity before structured identity review.
