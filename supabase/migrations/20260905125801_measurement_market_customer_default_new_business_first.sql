create or replace function public.get_measurement_market_feature_flag_v01(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_origin text;
  v_enabled boolean;
  v_stage text;
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

  if not found then
    if v_origin = 'customer_measurement' then
      v_enabled := true;
      v_stage := 'new_business_first';
    else
      v_enabled := false;
      v_stage := 'off';
    end if;
  else
    v_enabled := coalesce(v_enabled, false);
    v_stage := coalesce(v_stage, 'off');
  end if;

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
    'newBusinessFirstAllowed', (v_origin in ('internal_observation','customer_measurement')),
    'defaultedForCustomer', (
      v_origin = 'customer_measurement'
      and not exists (
        select 1
        from public.measurement_market_feature_flags f
        where f.org_id = p_org_id
      )
    )
  );
end;
$function$;

revoke all on function public.get_measurement_market_feature_flag_v01(uuid) from public;
revoke execute on function public.get_measurement_market_feature_flag_v01(uuid) from anon, authenticated;
grant execute on function public.get_measurement_market_feature_flag_v01(uuid) to service_role;
