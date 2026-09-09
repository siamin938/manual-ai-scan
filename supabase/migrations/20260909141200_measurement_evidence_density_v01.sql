create or replace function public.get_measurement_evidence_density_v01(
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
with valid as (
  select m.id
  from public.measurements m
  where m.org_id=p_org_id and m.run_id=p_run_id and m.valid=true
), competitor_rows as (
  select c.measurement_id,c.canonical_key
  from public.measurement_entity_canonicalizations c
  join public.measurement_mentions mm
    on mm.id=c.measurement_mention_id
   and mm.org_id=c.org_id
   and mm.count_as_confirmed_business=true
  join valid v on v.id=c.measurement_id
  where c.org_id=p_org_id
    and c.business_id=p_business_id
    and c.source_run_id=p_run_id
    and c.canonical_key <> 'business:'||p_business_id::text
), comp_stats as (
  select
    count(distinct measurement_id)::integer as competitor_bearing_response_count,
    count(distinct canonical_key)::integer as distinct_confirmed_competitor_count
  from competitor_rows
), sig as (
  select * from public.get_competitor_significance_v01(p_org_id,p_business_id,p_run_id)
), sig_stats as (
  select
    count(*) filter(where tier='core')::integer as core_count,
    count(*) filter(where tier='notable')::integer as notable_count,
    count(*) filter(where tier='watch')::integer as watch_count,
    coalesce(max(response_count),0)::integer as top_competitor_response_count
  from sig
), source_stats as (
  select
    count(distinct a.measurement_id)::integer as actionable_source_response_count,
    count(distinct lower(a.domain))::integer as actionable_domain_count
  from public.measurement_citation_attributions_actionable_v2 a
  join valid v on v.id=a.measurement_id
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
), totals as (
  select count(*)::integer as valid_count from valid
), metrics as (
  select
    t.valid_count,
    coalesce(c.competitor_bearing_response_count,0)::integer as competitor_bearing_response_count,
    coalesce(c.distinct_confirmed_competitor_count,0)::integer as distinct_confirmed_competitor_count,
    coalesce(sg.core_count,0)::integer as core_count,
    coalesce(sg.notable_count,0)::integer as notable_count,
    coalesce(sg.watch_count,0)::integer as watch_count,
    coalesce(sg.top_competitor_response_count,0)::integer as top_competitor_response_count,
    coalesce(ss.actionable_source_response_count,0)::integer as actionable_source_response_count,
    coalesce(ss.actionable_domain_count,0)::integer as actionable_domain_count
  from totals t cross join comp_stats c cross join sig_stats sg cross join source_stats ss
)
select jsonb_build_object(
  'version','0.1',
  'validCount',m.valid_count,
  'competitorBearingResponseCount',m.competitor_bearing_response_count,
  'competitorAnswerDensityPct',case when m.valid_count>0 then round((100.0*m.competitor_bearing_response_count/m.valid_count)::numeric,2) else 0 end,
  'distinctConfirmedCompetitorCount',m.distinct_confirmed_competitor_count,
  'coreCount',m.core_count,
  'notableCount',m.notable_count,
  'watchCount',m.watch_count,
  'significantCompetitorCount',m.core_count+m.notable_count,
  'topCompetitorResponseCount',m.top_competitor_response_count,
  'topCompetitorShareOfCompetitorAnswersPct',case when m.competitor_bearing_response_count>0 then round((100.0*m.top_competitor_response_count/m.competitor_bearing_response_count)::numeric,2) else 0 end,
  'actionableSourceResponseCount',m.actionable_source_response_count,
  'actionableSourceAnswerDensityPct',case when m.valid_count>0 then round((100.0*m.actionable_source_response_count/m.valid_count)::numeric,2) else 0 end,
  'actionableDomainCount',m.actionable_domain_count,
  'environment',case
    when m.valid_count<12 then 'insufficient'
    when m.competitor_bearing_response_count<=9 and (m.core_count+m.notable_count)<=2 and m.top_competitor_response_count<=2 then 'sparse'
    when (m.competitor_bearing_response_count>=14 and (m.core_count>=3 or m.top_competitor_response_count>=4))
      or (m.competitor_bearing_response_count>=12 and m.top_competitor_response_count>=8) then 'dense'
    else 'balanced'
  end,
  'mode','shadow'
)
from metrics m;
$function$;

revoke all on function public.get_measurement_evidence_density_v01(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_measurement_evidence_density_v01(uuid,uuid,uuid) to service_role;