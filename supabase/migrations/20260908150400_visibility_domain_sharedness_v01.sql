create or replace function public.get_visibility_domain_sharedness_v01(p_domains text[])
returns table(
  domain text,
  distinct_entity_keys integer,
  target_business_contexts integer,
  linked_response_count integer
)
language sql
stable
set search_path to ''
as $function$
with wanted as (
  select distinct lower(regexp_replace(trim(d), '^www\.', '')) as domain
  from unnest(coalesce(p_domains, '{}'::text[])) as d
  where d is not null and trim(d) <> ''
), scoped as (
  select
    lower(regexp_replace(coalesce(nullif(a.domain, ''), '(unknown)'), '^www\.', '')) as domain,
    a.canonical_key,
    a.business_id,
    a.source_run_id,
    a.measurement_id
  from public.measurement_citation_attributions_actionable_v1 a
  join public.measurement_runs r
    on r.id = a.source_run_id
   and r.org_id = a.org_id
   and r.business_id = a.business_id
  join wanted w
    on w.domain = lower(regexp_replace(coalesce(nullif(a.domain, ''), '(unknown)'), '^www\.', ''))
  where r.run_type = 'audit'::public.run_type
    and r.phase = 'standalone'::public.run_phase
    and r.status = 'completed'::public.run_status
    and r.experiment_id is null
    and r.data_origin in ('internal_observation','customer_measurement')
    and coalesce(r.completed_at, r.created_at) >= now() - interval '90 days'
)
select
  s.domain,
  count(distinct s.canonical_key)::integer as distinct_entity_keys,
  count(distinct s.business_id)::integer as target_business_contexts,
  count(distinct (s.source_run_id::text || ':' || s.measurement_id::text))::integer as linked_response_count
from scoped s
group by s.domain
order by s.domain;
$function$;

revoke all on function public.get_visibility_domain_sharedness_v01(text[]) from public;
revoke all on function public.get_visibility_domain_sharedness_v01(text[]) from anon;
revoke all on function public.get_visibility_domain_sharedness_v01(text[]) from authenticated;
grant execute on function public.get_visibility_domain_sharedness_v01(text[]) to service_role;

comment on function public.get_visibility_domain_sharedness_v01(text[])
is 'Returns 90-day cross-measurement domain sharedness signals for action recommendation precision. Service-role only; no business-specific hardcoding.';