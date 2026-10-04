alter table public.internal_observation_pipeline_settings
  add column if not exists scheduler_actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists last_scheduler_tick_at timestamptz,
  add column if not exists last_scheduler_result text;

update public.internal_observation_pipeline_settings s
set scheduler_actor_user_id = candidate.user_id,
    updated_at = now()
from lateral (
  select om.user_id
  from public.organization_members om
  where om.org_id=s.org_id
    and om.role in ('owner'::public.app_role,'admin'::public.app_role,'analyst'::public.app_role)
  order by case when om.role='owner'::public.app_role then 0
                when om.role='admin'::public.app_role then 1
                else 2 end,
           om.created_at asc
  limit 1
) candidate
where s.scheduler_actor_user_id is null;

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

  -- Sequential contract: do not claim the next candidate until the previous
  -- pipeline item has reached completed/failed/cancelled after reconciliation.
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
        (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
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
  order by i.prepared_at asc nulls last, i.created_at asc, i.id asc
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

comment on function public.claim_internal_observation_scheduler_candidate_v05(uuid,uuid)
is 'v0.5 atomic oldest-ready scheduler claim. Requires internal_observation org, execution_enabled=true, configured write-role actor, no measuring/postprocessing item, no active standalone audit run, credit, and daily slot. Service-role only.';
