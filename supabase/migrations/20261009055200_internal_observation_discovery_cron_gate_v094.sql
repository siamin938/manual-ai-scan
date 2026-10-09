
create or replace function public.get_internal_observation_discovery_cron_state_v094()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (
      select jsonb_build_object(
        'job_exists', true,
        'active', j.active,
        'schedule', j.schedule
      )
      from cron.job j
      where j.jobname='internal-observation-discovery-scheduler-v094'
      limit 1
    ),
    jsonb_build_object(
      'job_exists', false,
      'active', false,
      'schedule', null
    )
  );
$function$;

revoke all on function public.get_internal_observation_discovery_cron_state_v094() from public;
revoke all on function public.get_internal_observation_discovery_cron_state_v094() from anon;
revoke all on function public.get_internal_observation_discovery_cron_state_v094() from authenticated;
grant execute on function public.get_internal_observation_discovery_cron_state_v094() to service_role;

create or replace function public.set_internal_observation_discovery_cron_active_v094(
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
  where j.jobname='internal-observation-discovery-scheduler-v094'
  limit 1;

  if v_job_id is null then
    return false;
  end if;

  perform cron.alter_job(v_job_id, active := p_active);
  return true;
end;
$function$;

revoke all on function public.set_internal_observation_discovery_cron_active_v094(boolean) from public;
revoke all on function public.set_internal_observation_discovery_cron_active_v094(boolean) from anon;
revoke all on function public.set_internal_observation_discovery_cron_active_v094(boolean) from authenticated;
grant execute on function public.set_internal_observation_discovery_cron_active_v094(boolean) to service_role;

comment on function public.set_internal_observation_discovery_cron_active_v094(boolean) is
  'Service-role-only v0.9.4 global recurring-discovery gate. UI must not enable without explicit operator approval.';
