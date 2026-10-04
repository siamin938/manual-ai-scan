alter table public.internal_observation_pipeline_items
  drop constraint if exists internal_observation_pipeline_items_status_check;

alter table public.internal_observation_pipeline_items
  add constraint internal_observation_pipeline_items_status_check
  check (status in (
    'pending',
    'preparing',
    'ready_to_measure',
    'blocked',
    'failed',
    'measuring',
    'postprocessing',
    'completed',
    'cancelled'
  ));

alter table public.internal_observation_pipeline_items
  add column if not exists reconciled_at timestamptz,
  add column if not exists entity_facts_ready_at timestamptz,
  add column if not exists terminal_at timestamptz;

comment on column public.internal_observation_pipeline_items.reconciled_at is
'Last time v0.3 terminal reconciliation inspected the linked measurement run.';

comment on column public.internal_observation_pipeline_items.entity_facts_ready_at is
'First reconciliation time when Entity Facts v2 for the exact linked run was readable through the canonical read gateway.';

comment on column public.internal_observation_pipeline_items.terminal_at is
'Time the pipeline item reached completed/failed/cancelled terminal state.';
