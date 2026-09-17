CREATE OR REPLACE FUNCTION public.get_compatible_audit_runs_v01(p_org_id uuid, p_business_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(run_id uuid, completed_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with latest as (
  select r.id, r.question_set_id, r.selected_providers, r.repetitions, r.data_origin
  from public.measurement_runs r
  where r.org_id = p_org_id
    and r.business_id = p_business_id
    and r.run_type = 'audit'::run_type
    and r.phase = 'standalone'::run_phase
    and r.status = 'completed'::run_status
    and r.experiment_id is null
  order by r.completed_at desc nulls last, r.created_at desc
  limit 1
), candidates as (
  select r.id, r.question_set_id, r.selected_providers, r.repetitions, r.data_origin, r.completed_at, r.created_at
  from public.measurement_runs r
  join latest l
    on l.question_set_id = r.question_set_id
   and l.data_origin = r.data_origin
  where r.org_id = p_org_id
    and r.business_id = p_business_id
    and r.run_type = 'audit'::run_type
    and r.phase = 'standalone'::run_phase
    and r.status = 'completed'::run_status
    and r.experiment_id is null
  order by r.completed_at desc nulls last, r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 20))
), job_contract as (
  select
    c.id as run_id,
    count(j.id)::integer as job_count,
    bool_and(rc.job_id is not null) as payload_complete,
    jsonb_agg(
      jsonb_build_object(
        'question_id', j.question_id,
        'provider', j.provider,
        'provider_model', j.provider_model,
        'repetition_no', j.repetition_no,
        'request_fingerprint', rc.request_fingerprint
      )
      order by j.question_id, j.provider, j.repetition_no
    ) as contract
  from candidates c
  join public.measurement_jobs j
    on j.org_id = p_org_id and j.run_id = c.id
  left join public.measurement_request_contracts rc
    on rc.org_id = p_org_id and rc.job_id = j.id
  group by c.id
), measurement_contract as (
  select
    c.id as run_id,
    count(m.id)::integer as measurement_count,
    array_agg(distinct m.parser_version order by m.parser_version) as parser_versions
  from candidates c
  join public.measurements m
    on m.org_id = p_org_id and m.run_id = c.id
  group by c.id
), base as (
  select
    c.*,
    jc.job_count,
    jc.payload_complete,
    jc.contract,
    mc.measurement_count,
    mc.parser_versions
  from candidates c
  join job_contract jc on jc.run_id = c.id
  join measurement_contract mc on mc.run_id = c.id
), latest_contract as (
  select b.*
  from base b
  join latest l on l.id = b.id
)
select b.id, b.completed_at, b.created_at
from base b
cross join latest_contract lc
where b.data_origin = lc.data_origin
  and b.selected_providers = lc.selected_providers
  and b.repetitions = lc.repetitions
  and b.job_count = lc.job_count
  and b.measurement_count = lc.measurement_count
  and b.parser_versions = lc.parser_versions
  and b.payload_complete = true
  and lc.payload_complete = true
  and b.contract = lc.contract
order by b.completed_at desc nulls last, b.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_competitor_significance_v02(p_org_id uuid, p_business_id uuid, p_run_id uuid)
 RETURNS TABLE(canonical_key text, name text, tier text, significance_score integer, response_count integer, mention_count integer, question_count integer, intent_count integer, top3_response_count integer, citation_response_count integer, direct_citation_response_count integer, compatible_run_count integer, compatible_run_presence_count integer, prior_run_presence_count integer, repeat_response_count integer, is_new boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with common_compatible as materialized (
  select run_id from public.get_compatible_audit_runs_v01(p_org_id,p_business_id,6)
), compatible_runs as (
  select run_id from common_compatible
  where exists (select 1 from common_compatible where run_id=p_run_id)
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


