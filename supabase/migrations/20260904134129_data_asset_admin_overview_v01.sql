create or replace function public.get_data_asset_admin_overview_v01()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.org_id
    where om.user_id = v_uid
      and om.role = 'owner'::public.app_role
      and o.measurement_data_origin = 'internal_observation'
  ) into v_allowed;

  if not v_allowed then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  with run_stats as (
    select
      r.data_origin,
      count(*)::integer as run_count,
      count(*) filter (where r.status = 'completed'::public.run_status)::integer as completed_run_count,
      count(m.id) filter (where m.valid)::integer as valid_measurement_count,
      max(coalesce(r.completed_at,r.created_at)) filter (where r.status = 'completed'::public.run_status) as latest_completed_at,
      count(distinct public.get_benchmark_business_identity_key_v01(
        b.id,b.name,b.country_code,b.region,b.city,b.address
      )) filter (where b.is_client_business=true and b.active=true)::integer as real_business_count
    from public.measurement_runs r
    join public.businesses b on b.id=r.business_id and b.org_id=r.org_id
    left join public.measurements m on m.run_id=r.id and m.org_id=r.org_id
    where r.run_type='audit'::public.run_type
      and r.phase='standalone'::public.run_phase
      and r.experiment_id is null
    group by r.data_origin
  ), origin_rows as (
    select x.origin,
      coalesce(rs.run_count,0)::integer as run_count,
      coalesce(rs.completed_run_count,0)::integer as completed_run_count,
      coalesce(rs.valid_measurement_count,0)::integer as valid_measurement_count,
      coalesce(rs.real_business_count,0)::integer as real_business_count,
      rs.latest_completed_at,
      (select count(*)::integer from public.organizations o where o.measurement_data_origin=x.origin) as organization_count
    from (values ('internal_observation'::text),('customer_measurement'::text),('demo'::text)) x(origin)
    left join run_stats rs on rs.data_origin=x.origin
  ), benchmark_eligible as (
    select
      r.id as run_id,
      public.get_benchmark_business_identity_key_v01(
        b.id,b.name,b.country_code,b.region,b.city,b.address
      ) as identity_key,
      r.data_origin,
      coalesce(r.completed_at,r.created_at) as measured_at
    from public.measurement_runs r
    join public.businesses b
      on b.id=r.business_id and b.org_id=r.org_id
      and b.is_client_business=true and b.active=true
    join public.measurements m on m.run_id=r.id and m.org_id=r.org_id
    where r.run_type='audit'::public.run_type
      and r.phase='standalone'::public.run_phase
      and r.status='completed'::public.run_status
      and r.experiment_id is null
      and r.data_origin in ('internal_observation','customer_measurement')
      and coalesce(r.completed_at,r.created_at) >= now() - interval '90 days'
      and exists (
        select 1 from public.system_events se
        where se.org_id=r.org_id and se.run_id=r.id
          and se.event_type='visibility_postprocess_completed'
          and se.metadata->>'pipeline_version'='0.1.4'
          and se.metadata->>'verifier_version'='0.1.5'
      )
    group by r.id,b.id,b.name,b.country_code,b.region,b.city,b.address,r.data_origin,r.completed_at,r.created_at
    having count(*) filter (where m.valid) >= 24
  ), benchmark_summary as (
    select
      count(distinct run_id)::integer as eligible_run_count,
      count(distinct identity_key)::integer as real_business_count,
      count(distinct data_origin)::integer as contributing_origin_count,
      max(measured_at) as latest_measured_at
    from benchmark_eligible
  )
  select jsonb_build_object(
    'version','0.1',
    'generatedAt',now(),
    'origins',(
      select jsonb_agg(jsonb_build_object(
        'origin',origin,
        'organizationCount',organization_count,
        'runCount',run_count,
        'completedRunCount',completed_run_count,
        'validMeasurementCount',valid_measurement_count,
        'realBusinessCount',real_business_count,
        'latestCompletedAt',latest_completed_at
      ) order by case origin when 'internal_observation' then 1 when 'customer_measurement' then 2 else 3 end)
      from origin_rows
    ),
    'benchmark90d',(
      select jsonb_build_object(
        'eligibleRunCount',eligible_run_count,
        'realBusinessCount',real_business_count,
        'contributingOriginCount',contributing_origin_count,
        'latestMeasuredAt',latest_measured_at,
        'includedOrigins',jsonb_build_array('internal_observation','customer_measurement'),
        'businessIdentityVersion','0.1'
      ) from benchmark_summary
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_data_asset_admin_overview_v01() from public;
grant execute on function public.get_data_asset_admin_overview_v01() to authenticated;
