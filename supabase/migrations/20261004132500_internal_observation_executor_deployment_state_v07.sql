alter table public.internal_observation_pipeline_settings
  add column if not exists scheduler_executor_deployed boolean not null default false;

comment on column public.internal_observation_pipeline_settings.scheduler_executor_deployed is
'Whether the unattended scheduler Edge Function has been deployed and smoke-tested. This does not enable execution; scheduler_executor_ready remains the activation gate.';
