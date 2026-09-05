alter table public.measurement_market_feature_flags
  drop constraint if exists measurement_market_feature_flags_stage_ck;

alter table public.measurement_market_feature_flags
  add constraint measurement_market_feature_flags_stage_ck
  check (rollout_stage in ('off','internal_pilot','new_business_first'));

create or replace function public.get_measurement_market_feature_flag_v01(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_origin text;
  v_enabled boolean := false;
  v_stage text := 'off';
begin
  select o.measurement_data_origin
    into v_origin
  from public.organizations o
  where o.id = p_org_id;

  if v_origin is null then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  select f.enabled, f.rollout_stage
    into v_enabled, v_stage
  from public.measurement_market_feature_flags f
  where f.org_id = p_org_id;

  v_enabled := coalesce(v_enabled, false);
  v_stage := coalesce(v_stage, 'off');

  if v_stage = 'internal_pilot' and v_origin <> 'internal_observation' then
    v_enabled := false;
    v_stage := 'off';
  elsif v_stage = 'new_business_first'
        and v_origin not in ('internal_observation','customer_measurement') then
    v_enabled := false;
    v_stage := 'off';
  elsif v_stage not in ('off','internal_pilot','new_business_first') then
    v_enabled := false;
    v_stage := 'off';
  end if;

  return jsonb_build_object(
    'enabled', v_enabled,
    'rolloutStage', v_stage,
    'organizationOrigin', v_origin,
    'internalPilotAllowed', (v_origin = 'internal_observation'),
    'newBusinessFirstAllowed', (v_origin in ('internal_observation','customer_measurement'))
  );
end;
$function$;

create or replace function public.get_measurement_market_generation_eligibility_v01(
  p_org_id uuid,
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_has_question_set boolean := false;
  v_has_measurement_run boolean := false;
begin
  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.org_id = p_org_id
      and b.is_client_business = true
      and b.active = true
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'business_not_available');
  end if;

  select exists (
    select 1
    from public.question_sets qs
    where qs.org_id = p_org_id
      and qs.business_id = p_business_id
  ) into v_has_question_set;

  select exists (
    select 1
    from public.measurement_runs mr
    where mr.org_id = p_org_id
      and mr.business_id = p_business_id
  ) into v_has_measurement_run;

  if v_has_question_set then
    return jsonb_build_object('eligible', false, 'reason', 'existing_question_set');
  end if;

  if v_has_measurement_run then
    return jsonb_build_object('eligible', false, 'reason', 'existing_measurement_run');
  end if;

  return jsonb_build_object('eligible', true, 'reason', 'first_generation');
end;
$function$;

revoke all on function public.get_measurement_market_generation_eligibility_v01(uuid, uuid) from public;
revoke execute on function public.get_measurement_market_generation_eligibility_v01(uuid, uuid) from anon, authenticated;
grant execute on function public.get_measurement_market_generation_eligibility_v01(uuid, uuid) to service_role;

revoke all on function public.get_measurement_market_feature_flag_v01(uuid) from public;
revoke execute on function public.get_measurement_market_feature_flag_v01(uuid) from anon, authenticated;
grant execute on function public.get_measurement_market_feature_flag_v01(uuid) to service_role;
