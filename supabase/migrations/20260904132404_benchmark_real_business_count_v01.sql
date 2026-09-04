do $$
begin
  if to_regprocedure('public.get_global_high_visibility_source_patterns_legacy_v01(uuid,uuid)') is null then
    if to_regprocedure('public.get_global_high_visibility_source_patterns_v01(uuid,uuid)') is null then
      raise exception 'EXPECTED_BENCHMARK_FUNCTION_MISSING';
    end if;
    alter function public.get_global_high_visibility_source_patterns_v01(uuid,uuid)
      rename to get_global_high_visibility_source_patterns_legacy_v01;
  end if;
end $$;

create or replace function public.get_global_high_visibility_source_patterns_v01(
  p_requesting_org_id uuid,
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_result jsonb;
  v_global_count integer := 0;
  v_category_count integer := 0;
  v_target_category text;
begin
  v_result := public.get_global_high_visibility_source_patterns_legacy_v01(
    p_requesting_org_id,
    p_business_id
  );

  if v_result is null then
    return null;
  end if;

  select b.category into v_target_category
  from public.businesses b
  where b.id = p_business_id
    and b.org_id = p_requesting_org_id
    and b.is_client_business = true
    and b.active = true
  limit 1;

  with eligible_runs as (
    select
      r.id as run_id,
      b.category,
      public.get_benchmark_business_identity_key_v01(
        b.id,b.name,b.country_code,b.region,b.city,b.address
      ) as identity_key
    from public.measurement_runs r
    join public.businesses b
      on b.id=r.business_id
     and b.org_id=r.org_id
     and b.is_client_business=true
     and b.active=true
    join public.measurements m
      on m.run_id=r.id
     and m.org_id=r.org_id
    where r.run_type='audit'::public.run_type
      and r.phase='standalone'::public.run_phase
      and r.status='completed'::public.run_status
      and r.experiment_id is null
      and r.data_origin in ('internal_observation','customer_measurement')
      and coalesce(r.completed_at,r.created_at) >= now() - interval '90 days'
      and exists (
        select 1 from public.system_events se
        where se.org_id=r.org_id
          and se.run_id=r.id
          and se.event_type='visibility_postprocess_completed'
          and se.metadata->>'pipeline_version'='0.1.4'
          and se.metadata->>'verifier_version'='0.1.5'
      )
    group by r.id,b.id,b.name,b.country_code,b.region,b.city,b.address,b.category
    having count(*) filter (where m.valid) >= 24
  )
  select
    count(distinct identity_key)::integer,
    count(distinct identity_key) filter (where category is not distinct from v_target_category)::integer
  into v_global_count, v_category_count
  from eligible_runs;

  v_result := jsonb_set(
    v_result,
    '{benchmark,eligibleTargetBusinessCount}',
    to_jsonb(coalesce(v_global_count,0)),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{benchmark,businessIdentityVersion}',
    to_jsonb('0.1'::text),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{benchmark,includedDataOrigins}',
    '["internal_observation","customer_measurement"]'::jsonb,
    true
  );
  v_result := jsonb_set(
    v_result,
    '{categoryContext,eligibleTargetBusinessCount}',
    to_jsonb(coalesce(v_category_count,0)),
    true
  );

  return v_result;
end;
$function$;
