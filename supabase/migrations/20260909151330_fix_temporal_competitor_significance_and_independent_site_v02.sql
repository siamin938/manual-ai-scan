-- Reconstructed from the live Supabase definitions for migration 20260909151330.
-- Keep historical runs time-causal and harden independent-site observations
-- without changing existing customer data.

create or replace function public.get_competitor_significance_v02(
  p_org_id uuid,
  p_business_id uuid,
  p_run_id uuid
)
returns table(
  canonical_key text,
  name text,
  tier text,
  significance_score integer,
  response_count integer,
  mention_count integer,
  question_count integer,
  intent_count integer,
  top3_response_count integer,
  citation_response_count integer,
  direct_citation_response_count integer,
  compatible_run_count integer,
  compatible_run_presence_count integer,
  prior_run_presence_count integer,
  repeat_response_count integer,
  is_new boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
with current_run as (
  select
    r.id,
    r.question_set_id,
    r.data_origin,
    coalesce(r.completed_at,r.created_at) as measured_at
  from public.measurement_runs r
  where r.id=p_run_id
    and r.org_id=p_org_id
    and r.business_id=p_business_id
    and r.run_type='audit'::public.run_type
    and r.phase='standalone'::public.run_phase
    and r.status='completed'::public.run_status
    and r.experiment_id is null
), candidate_runs as (
  select r.id,r.completed_at,r.created_at
  from public.measurement_runs r
  join current_run cr
    on cr.question_set_id=r.question_set_id
   and cr.data_origin=r.data_origin
  where r.org_id=p_org_id
    and r.business_id=p_business_id
    and r.run_type='audit'::public.run_type
    and r.phase='standalone'::public.run_phase
    and r.status='completed'::public.run_status
    and r.experiment_id is null
    and coalesce(r.completed_at,r.created_at) <= cr.measured_at
  order by coalesce(r.completed_at,r.created_at) desc, r.id desc
  limit 6
), run_contracts as (
  select cr.id run_id,
    (select jsonb_agg(
      jsonb_build_object(
        'question_id',j.question_id,
        'provider',j.provider,
        'provider_model',j.provider_model,
        'repetition_no',j.repetition_no,
        'request',pp.request_payload_redacted
      ) order by j.question_id,j.provider,j.repetition_no)
      from public.measurement_jobs j
      join public.provider_payloads pp
        on pp.job_id=j.id and pp.org_id=p_org_id
      where j.org_id=p_org_id and j.run_id=cr.id
    ) jobs_contract,
    (select jsonb_agg(x.parser_version order by x.parser_version)
      from (
        select distinct m.parser_version
        from public.measurements m
        where m.org_id=p_org_id and m.run_id=cr.id
      ) x
    ) parser_contract
  from candidate_runs cr
), reference_contract as (
  select jobs_contract,parser_contract
  from run_contracts
  where run_id=p_run_id
    and jobs_contract is not null
    and parser_contract is not null
), compatible_runs as (
  select rc.run_id
  from run_contracts rc
  cross join reference_contract ref
  where rc.jobs_contract is not null
    and rc.parser_contract is not null
    and rc.jobs_contract=ref.jobs_contract
    and rc.parser_contract=ref.parser_contract
), compatible_summary as (
  select count(*)::integer compatible_run_count from compatible_runs
), valid_latest as (
  select m.id,m.question_id
  from public.measurements m
  where m.org_id=p_org_id
    and m.run_id=p_run_id
    and m.valid=true
), latest_stats as (
  select
    c.canonical_key,
    max(c.canonical_display_name)::text name,
    count(*)::integer mention_count,
    count(distinct c.measurement_id)::integer response_count,
    count(distinct m.question_id)::integer question_count,
    count(distinct coalesce(q.intent_type,'other'))::integer intent_count,
    count(distinct c.measurement_id) filter(where mm.position<=3)::integer top3_response_count
  from public.measurement_entity_canonicalizations c
  join valid_latest m on m.id=c.measurement_id
  join public.measurement_mentions mm
    on mm.id=c.measurement_mention_id
   and mm.org_id=p_org_id
   and mm.count_as_confirmed_business=true
  left join public.questions q
    on q.id=m.question_id and q.org_id=p_org_id
  where c.org_id=p_org_id
    and c.business_id=p_business_id
    and c.source_run_id=p_run_id
    and c.canonical_key<>'business:'||p_business_id::text
  group by c.canonical_key
), citation_stats as (
  select
    a.canonical_key,
    count(distinct a.measurement_id)::integer citation_response_count,
    count(distinct a.measurement_id) filter(where a.attribution_level='direct')::integer direct_citation_response_count
  from public.measurement_citation_attributions_actionable_v2 a
  join valid_latest v on v.id=a.measurement_id
  join public.measurement_mentions mm
    on mm.id=a.measurement_mention_id
   and mm.org_id=p_org_id
   and mm.count_as_confirmed_business=true
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
  group by a.canonical_key
), repeat_stats as (
  select
    c.canonical_key,
    count(distinct c.source_run_id)::integer compatible_run_presence_count,
    count(distinct c.source_run_id) filter(where c.source_run_id<>p_run_id)::integer prior_run_presence_count,
    count(distinct(c.source_run_id::text||':'||c.measurement_id::text))::integer repeat_response_count
  from public.measurement_entity_canonicalizations c
  join compatible_runs r on r.run_id=c.source_run_id
  join public.measurements m
    on m.id=c.measurement_id
   and m.org_id=p_org_id
   and m.valid=true
  join public.measurement_mentions mm
    on mm.id=c.measurement_mention_id
   and mm.org_id=p_org_id
   and mm.count_as_confirmed_business=true
  where c.org_id=p_org_id
    and c.business_id=p_business_id
    and c.canonical_key<>'business:'||p_business_id::text
  group by c.canonical_key
), scored as (
  select
    l.*,
    coalesce(cs.citation_response_count,0)::integer citation_response_count,
    coalesce(cs.direct_citation_response_count,0)::integer direct_citation_response_count,
    coalesce(csum.compatible_run_count,1)::integer compatible_run_count,
    coalesce(rs.compatible_run_presence_count,1)::integer compatible_run_presence_count,
    coalesce(rs.prior_run_presence_count,0)::integer prior_run_presence_count,
    coalesce(rs.repeat_response_count,l.response_count)::integer repeat_response_count,
    case
      when l.response_count>=3 and l.question_count>=2 then 'core'
      when l.response_count>=2 and coalesce(rs.prior_run_presence_count,0)>=1 then 'core'
      when l.response_count>=2 then 'notable'
      when coalesce(rs.prior_run_presence_count,0)>=1 then 'notable'
      else 'notable'
    end tier,
    (
      case
        when l.response_count>=3 and l.question_count>=2 then 3000
        when l.response_count>=2 and coalesce(rs.prior_run_presence_count,0)>=1 then 3000
        when l.response_count>=2 or coalesce(rs.prior_run_presence_count,0)>=1 then 2000
        else 1000
      end
      +least(l.response_count,10)*100
      +least(l.question_count,10)*20
      +least(l.intent_count,8)*10
      +least(l.top3_response_count,10)*15
      +least(coalesce(rs.prior_run_presence_count,0),5)*40
      +least(coalesce(cs.direct_citation_response_count,0),5)*10
      +least(coalesce(cs.citation_response_count,0),10)*3
    )::integer significance_score
  from latest_stats l
  left join citation_stats cs on cs.canonical_key=l.canonical_key
  left join repeat_stats rs on rs.canonical_key=l.canonical_key
  cross join compatible_summary csum
)
select
  s.canonical_key,s.name,s.tier,s.significance_score,s.response_count,s.mention_count,s.question_count,s.intent_count,
  s.top3_response_count,s.citation_response_count,s.direct_citation_response_count,s.compatible_run_count,
  s.compatible_run_presence_count,s.prior_run_presence_count,s.repeat_response_count,
  (s.compatible_run_count>1 and s.prior_run_presence_count=0) is_new
from scored s
order by case s.tier when 'core' then 3 when 'notable' then 2 else 1 end desc,
         s.significance_score desc,
         s.name asc;
$function$;

revoke all on function public.get_competitor_significance_v02(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_competitor_significance_v02(uuid,uuid,uuid) to service_role;

create or replace function public.get_first_run_independent_site_observations_v02(
  p_org_id uuid,
  p_business_id uuid,
  p_run_id uuid
)
returns table(
  source_key text,
  source_name text,
  source_group_key text,
  competitor_response_count integer,
  distinct_competitor_count integer,
  intent_count integer,
  question_count integer,
  client_response_count integer,
  linked_competitors jsonb,
  domains jsonb,
  sample_questions jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
select o.*
from public.get_first_run_independent_site_observations_v01(p_org_id,p_business_id,p_run_id) o
where exists (
  select 1
  from public.measurement_citation_attributions a
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
    and lower(a.domain)=lower(o.source_name)
    and a.citation_url is not null
    and lower(
      regexp_replace(
        split_part(split_part(a.citation_url,'?',1),'#',1),
        '^https?://(www\.)?',
        '',
        'i'
      )
    ) in (lower(o.source_name), lower(o.source_name)||'/')
);
$function$;

revoke all on function public.get_first_run_independent_site_observations_v02(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_first_run_independent_site_observations_v02(uuid,uuid,uuid) to service_role;

create or replace function public.get_repeat_independent_site_observations_v02(
  p_org_id uuid,
  p_business_id uuid
)
returns table(
  source_key text,
  source_name text,
  source_group_key text,
  competitor_response_count integer,
  distinct_competitor_count integer,
  intent_count integer,
  question_count integer,
  client_response_count integer,
  compatible_run_count integer,
  competitor_run_presence_count integer,
  client_run_presence_count integer,
  linked_competitors jsonb,
  domains jsonb,
  sample_questions jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
select o.*
from public.get_repeat_independent_site_observations_v01(p_org_id,p_business_id) o
where exists (
  select 1
  from public.measurement_citation_attributions a
  join public.get_compatible_audit_runs_v01(p_org_id,p_business_id,6) c
    on c.run_id=a.source_run_id
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and lower(a.domain)=lower(o.source_name)
    and a.citation_url is not null
    and lower(
      regexp_replace(
        split_part(split_part(a.citation_url,'?',1),'#',1),
        '^https?://(www\.)?',
        '',
        'i'
      )
    ) in (lower(o.source_name), lower(o.source_name)||'/')
);
$function$;

revoke all on function public.get_repeat_independent_site_observations_v02(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_repeat_independent_site_observations_v02(uuid,uuid) to service_role;
