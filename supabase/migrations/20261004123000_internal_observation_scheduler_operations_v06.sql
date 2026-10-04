alter table public.internal_observation_pipeline_settings
  add column if not exists scheduler_state text not null default 'off'
    check (scheduler_state in ('off','paused','running')),
  add column if not exists scheduler_executor_ready boolean not null default false,
  add column if not exists scheduler_activated_at timestamptz,
  add column if not exists scheduler_activated_by uuid references auth.users(id) on delete set null,
  add column if not exists scheduler_paused_at timestamptz,
  add column if not exists scheduler_stopped_at timestamptz;

update public.internal_observation_pipeline_settings
set scheduler_state = case when execution_enabled then 'running' else 'off' end,
    scheduler_executor_ready = false,
    updated_at = now();

alter table public.internal_observation_pipeline_settings
  drop constraint if exists internal_observation_pipeline_settings_execution_state_v06;

alter table public.internal_observation_pipeline_settings
  add constraint internal_observation_pipeline_settings_execution_state_v06
  check ((scheduler_state = 'running') = execution_enabled);

create table if not exists public.internal_observation_scheduler_activation_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','confirmed','cancelled','expired')),
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  plan_snapshot jsonb not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz
);

create index if not exists internal_observation_scheduler_activation_requests_org_status_idx
  on public.internal_observation_scheduler_activation_requests(org_id,status,requested_at desc);

create unique index if not exists internal_observation_scheduler_activation_requests_one_pending_idx
  on public.internal_observation_scheduler_activation_requests(org_id)
  where status='pending';

alter table public.internal_observation_scheduler_activation_requests enable row level security;
revoke all on table public.internal_observation_scheduler_activation_requests
  from public,anon,authenticated;
grant all on table public.internal_observation_scheduler_activation_requests to service_role;

comment on table public.internal_observation_scheduler_activation_requests is
'v0.6 two-step guarded scheduler activation requests. Service-role only; internal admin server functions mediate access.';

create or replace function public.set_internal_observation_scheduler_cron_active_v06(
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job_id bigint;
begin
  select j.jobid
    into v_job_id
  from cron.job j
  where j.jobname='internal-observation-scheduler-v06'
  limit 1;

  if v_job_id is null then
    return false;
  end if;

  perform cron.alter_job(job_id => v_job_id, active => p_active);
  return true;
end;
$function$;

revoke all on function public.set_internal_observation_scheduler_cron_active_v06(boolean) from public;
revoke all on function public.set_internal_observation_scheduler_cron_active_v06(boolean) from anon;
revoke all on function public.set_internal_observation_scheduler_cron_active_v06(boolean) from authenticated;
grant execute on function public.set_internal_observation_scheduler_cron_active_v06(boolean) to service_role;

create or replace function public.get_internal_observation_scheduler_cron_status_v06()
returns table(job_exists boolean, active boolean, schedule text)
language sql
security definer
set search_path to ''
as $function$
  select
    exists(select 1 from cron.job where jobname='internal-observation-scheduler-v06') as job_exists,
    coalesce((
      select j.active
      from cron.job j
      where j.jobname='internal-observation-scheduler-v06'
      limit 1
    ),false) as active,
    (
      select j.schedule
      from cron.job j
      where j.jobname='internal-observation-scheduler-v06'
      limit 1
    ) as schedule;
$function$;

revoke all on function public.get_internal_observation_scheduler_cron_status_v06() from public;
revoke all on function public.get_internal_observation_scheduler_cron_status_v06() from anon;
revoke all on function public.get_internal_observation_scheduler_cron_status_v06() from authenticated;
grant execute on function public.get_internal_observation_scheduler_cron_status_v06() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select j.jobid into v_job_id
  from cron.job j
  where j.jobname='internal-observation-scheduler-v06'
  limit 1;

  if v_job_id is null then
    select cron.schedule(
      'internal-observation-scheduler-v06',
      '*/2 * * * *',
      $cron$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name='ai_visibility_project_url'
            order by created_at desc
            limit 1
          ) || '/functions/v1/internal-observation-scheduler-tick',
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
          body := '{}'::jsonb,
          timeout_milliseconds := 120000
        );
      $cron$
    ) into v_job_id;
  end if;

  perform cron.alter_job(job_id => v_job_id, active => false);
end $$;

create or replace function public.claim_internal_observation_scheduler_candidate_v05(
  p_org_id uuid,
  p_actor_user_id uuid
)
returns table(
  item_id uuid,
  business_id uuid,
  question_set_id uuid,
  business_name text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item_id uuid;
begin
  if not exists (
    select 1
    from public.organizations o
    where o.id=p_org_id
      and o.measurement_data_origin='internal_observation'
  ) then
    return;
  end if;

  if not exists (
    select 1
    from public.internal_observation_pipeline_settings s
    where s.org_id=p_org_id
      and s.execution_enabled=true
      and s.scheduler_state='running'
      and s.scheduler_executor_ready=true
      and s.scheduler_actor_user_id=p_actor_user_id
  ) then
    return;
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.org_id=p_org_id
      and om.user_id=p_actor_user_id
      and om.role in ('owner'::public.app_role,'admin'::public.app_role,'analyst'::public.app_role)
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.internal_observation_pipeline_items i
    where i.org_id=p_org_id
      and i.status in ('measuring','postprocessing')
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.measurement_runs r
    where r.org_id=p_org_id
      and r.run_type='audit'
      and r.phase='standalone'
      and r.status in ('draft','queued','running')
  ) then
    return;
  end if;

  if coalesce((
    select c.balance
    from public.measurement_credit_accounts c
    where c.org_id=p_org_id
  ),0) < 1 then
    return;
  end if;

  if (
    select count(*)
    from public.internal_observation_pipeline_items i
    where i.org_id=p_org_id
      and i.measurement_approved_at >=
        (date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
  ) >= coalesce((
    select s.daily_run_limit
    from public.internal_observation_pipeline_settings s
    where s.org_id=p_org_id
  ),5) then
    return;
  end if;

  select i.id
    into v_item_id
  from public.internal_observation_pipeline_items i
  where i.org_id=p_org_id
    and i.status='ready_to_measure'
    and i.business_id is not null
    and i.question_set_id is not null
  order by i.prepared_at asc nulls last,i.created_at asc,i.id asc
  for update skip locked
  limit 1;

  if v_item_id is null then
    return;
  end if;

  update public.internal_observation_pipeline_items i
  set status='measuring',
      measurement_approved_at=now(),
      measurement_approved_by=p_actor_user_id,
      error_code=null,
      error_message=null,
      updated_at=now()
  where i.id=v_item_id
    and i.status='ready_to_measure';

  return query
  select i.id,i.business_id,i.question_set_id,i.business_name
  from public.internal_observation_pipeline_items i
  where i.id=v_item_id
    and i.status='measuring';
end;
$function$;

revoke all on function public.claim_internal_observation_scheduler_candidate_v05(uuid,uuid) from public;
revoke all on function public.claim_internal_observation_scheduler_candidate_v05(uuid,uuid) from anon;
revoke all on function public.claim_internal_observation_scheduler_candidate_v05(uuid,uuid) from authenticated;
grant execute on function public.claim_internal_observation_scheduler_candidate_v05(uuid,uuid) to service_role;
