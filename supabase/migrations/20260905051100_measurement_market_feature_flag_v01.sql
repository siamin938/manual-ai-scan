create table if not exists public.measurement_market_feature_flags (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  rollout_stage text not null default 'off',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint measurement_market_feature_flags_stage_ck check (rollout_stage in ('off','internal_pilot'))
);

alter table public.measurement_market_feature_flags enable row level security;
revoke all on table public.measurement_market_feature_flags from public;
grant select, insert, update, delete on table public.measurement_market_feature_flags to service_role;

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
  select o.measurement_data_origin into v_origin
  from public.organizations o
  where o.id=p_org_id;

  if v_origin is null then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  select f.enabled,f.rollout_stage into v_enabled,v_stage
  from public.measurement_market_feature_flags f
  where f.org_id=p_org_id;

  v_enabled := coalesce(v_enabled,false);
  v_stage := coalesce(v_stage,'off');

  if v_origin <> 'internal_observation' then
    v_enabled := false;
    v_stage := 'off';
  end if;

  return jsonb_build_object(
    'enabled',v_enabled,
    'rolloutStage',v_stage,
    'organizationOrigin',v_origin,
    'internalPilotAllowed',(v_origin='internal_observation')
  );
end;
$function$;

revoke all on function public.get_measurement_market_feature_flag_v01(uuid) from public;
grant execute on function public.get_measurement_market_feature_flag_v01(uuid) to service_role;
