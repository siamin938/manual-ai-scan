create or replace function public.get_measurement_evidence_density_router_v01(
  p_org_id uuid,
  p_business_id uuid,
  p_run_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with raw as (
  select public.get_measurement_evidence_density_v01(p_org_id,p_business_id,p_run_id) as density
), d as (
  select
    density,
    coalesce(density->>'environment','insufficient') as environment
  from raw
)
select jsonb_build_object(
  'version','0.1',
  'mode','shadow',
  'customerImpact',false,
  'environment',d.environment,
  'routeKey',case d.environment
    when 'sparse' then 'expand_verified_observation'
    when 'balanced' then 'standard_evidence_mix'
    when 'dense' then 'focus_strong_and_repeated'
    else 'hold_for_more_data'
  end,
  'density',d.density,
  'policy',jsonb_build_object(
    'hardGate','unchanged',
    'truthVerification','unchanged',
    'thresholdsRelaxed',false,
    'causeInferenceAllowed',false,
    'weakVerifiedSignalVisibility',case d.environment
      when 'sparse' then 'expanded'
      when 'balanced' then 'standard'
      else 'suppressed'
    end,
    'weakSignalActionCeiling',case d.environment
      when 'sparse' then 'observe_more'
      when 'balanced' then 'existing_policy_only'
      else 'not_applicable'
    end,
    'strongSignalVisibility',case d.environment
      when 'dense' then 'prioritized'
      when 'insufficient' then 'deferred'
      else 'standard'
    end,
    'repeatEvidencePreference',case d.environment
      when 'dense' then 'high'
      when 'balanced' then 'standard'
      when 'sparse' then 'standard'
      else 'deferred'
    end
  )
)
from d;
$function$;

revoke all on function public.get_measurement_evidence_density_router_v01(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_measurement_evidence_density_router_v01(uuid,uuid,uuid) to service_role;
