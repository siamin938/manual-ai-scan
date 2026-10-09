
create table if not exists public.internal_observation_discovery_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  enabled boolean not null default false,

  category text not null,
  service text not null,
  region text not null,
  city text null,
  brand_model text null,
  desired_count integer not null default 5
    check (desired_count between 1 and 8),

  cadence text not null default 'weekly'
    check (cadence in ('daily','weekly')),
  run_hour_kst integer not null default 9
    check (run_hour_kst between 0 and 23),
  weekday_iso integer null
    check (weekday_iso is null or weekday_iso between 1 and 7),

  query_fingerprint text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,

  last_started_at timestamptz null,
  last_completed_at timestamptz null,
  last_status text null
    check (last_status is null or last_status in ('completed','failed')),
  last_error_code text null,

  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, query_fingerprint),

  check (
    (cadence='daily' and weekday_iso is null)
    or
    (cadence='weekly' and weekday_iso is not null)
  )
);

create index if not exists internal_observation_discovery_schedules_due_idx
  on public.internal_observation_discovery_schedules(enabled, org_id, updated_at desc);

alter table public.internal_observation_discovery_schedules enable row level security;
revoke all on table public.internal_observation_discovery_schedules from public;
revoke all on table public.internal_observation_discovery_schedules from anon;
revoke all on table public.internal_observation_discovery_schedules from authenticated;
grant select, insert, update, delete on table public.internal_observation_discovery_schedules to service_role;

drop trigger if exists set_internal_observation_discovery_schedules_updated_at
  on public.internal_observation_discovery_schedules;
create trigger set_internal_observation_discovery_schedules_updated_at
before update on public.internal_observation_discovery_schedules
for each row execute function public.set_updated_at();

create table if not exists public.internal_observation_discovery_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid null references public.internal_observation_discovery_schedules(id) on delete set null,
  trigger_source text not null
    check (trigger_source in ('manual','scheduled')),
  status text not null
    check (status in ('running','completed','failed')),
  query_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(query_snapshot)='object'),

  provider text null,
  model text null,
  public_source_count integer null check (public_source_count is null or public_source_count >= 0),
  candidate_count integer null check (candidate_count is null or candidate_count >= 0),
  new_count integer null check (new_count is null or new_count >= 0),
  changed_count integer null check (changed_count is null or changed_count >= 0),
  unchanged_count integer null check (unchanged_count is null or unchanged_count >= 0),

  error_code text null,
  error_message text null,

  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists internal_observation_discovery_batches_org_started_idx
  on public.internal_observation_discovery_batches(org_id, started_at desc);
create index if not exists internal_observation_discovery_batches_schedule_started_idx
  on public.internal_observation_discovery_batches(schedule_id, started_at desc);

alter table public.internal_observation_discovery_batches enable row level security;
revoke all on table public.internal_observation_discovery_batches from public;
revoke all on table public.internal_observation_discovery_batches from anon;
revoke all on table public.internal_observation_discovery_batches from authenticated;
grant select, insert, update, delete on table public.internal_observation_discovery_batches to service_role;

create table if not exists public.internal_observation_discovery_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.internal_observation_discovery_batches(id) on delete cascade,
  review_candidate_id uuid null references public.internal_observation_discovery_candidates(id) on delete set null,
  classification text not null
    check (classification in ('new','changed','unchanged')),
  candidate_fingerprint text not null,
  business_name text not null,
  candidate_snapshot jsonb not null
    check (jsonb_typeof(candidate_snapshot)='object'),
  created_at timestamptz not null default now(),
  unique (batch_id, candidate_fingerprint)
);

create index if not exists internal_observation_discovery_batch_items_batch_idx
  on public.internal_observation_discovery_batch_items(batch_id, classification);

alter table public.internal_observation_discovery_batch_items enable row level security;
revoke all on table public.internal_observation_discovery_batch_items from public;
revoke all on table public.internal_observation_discovery_batch_items from anon;
revoke all on table public.internal_observation_discovery_batch_items from authenticated;
grant select, insert, update, delete on table public.internal_observation_discovery_batch_items to service_role;

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname='internal-observation-discovery-scheduler-v094'
  ) then
    perform cron.unschedule(
      (select jobid from cron.job where jobname='internal-observation-discovery-scheduler-v094' limit 1)
    );
  end if;

  perform cron.schedule(
    'internal-observation-discovery-scheduler-v094',
    '0 * * * *',
    $cmd$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name='ai_visibility_project_url'
          order by created_at desc
          limit 1
        ) || '/functions/v1/internal-observation-discovery-batch',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey',(
            select decrypted_secret
            from vault.decrypted_secrets
            where name='ai_visibility_publishable_key'
            order by created_at desc
            limit 1
          ),
          'x-internal-secret',(
            select decrypted_secret
            from vault.decrypted_secrets
            where name='ai_visibility_internal_cron_secret'
            order by created_at desc
            limit 1
          )
        ),
        body := '{"runDue":true}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cmd$
  );

  perform cron.alter_job(
    (select jobid from cron.job where jobname='internal-observation-discovery-scheduler-v094' limit 1),
    active := false
  );
end $$;

comment on table public.internal_observation_discovery_schedules is
  'v0.9.4 recurring discovery profiles. Global cron scaffold remains inactive until explicit operator approval.';
comment on table public.internal_observation_discovery_batches is
  'v0.9.4 discovery execution history. No approval, promotion, measurement, or credit side effects.';
comment on table public.internal_observation_discovery_batch_items is
  'Per-batch discovery classification: new/changed/unchanged relative to the persistent review queue.';
