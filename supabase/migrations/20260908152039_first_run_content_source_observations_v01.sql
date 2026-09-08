create or replace function public.get_first_run_content_source_observations_v01(
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
set search_path to ''
as $function$
with significant as (
  select s.canonical_key, s.name
  from public.get_competitor_significance_v01(p_org_id,p_business_id,p_run_id) s
  where s.tier in ('core','notable')
), valid_measurements as (
  select m.id, m.question_id
  from public.measurements m
  where m.org_id=p_org_id and m.run_id=p_run_id and m.valid=true
), rows as (
  select
    case
      when lower(a.domain)='blog.naver.com' then 'naver_blog'
      when lower(a.domain) like '%.tistory.com' then 'tistory'
      when lower(a.domain) in ('youtube.com','youtu.be') or lower(a.domain) like '%.youtube.com' then 'youtube'
      else null
    end as source_key,
    case
      when lower(a.domain)='blog.naver.com' then '네이버 블로그'
      when lower(a.domain) like '%.tistory.com' then '티스토리'
      when lower(a.domain) in ('youtube.com','youtu.be') or lower(a.domain) like '%.youtube.com' then 'YouTube'
      else null
    end as source_name,
    'content'::text as source_group_key,
    lower(a.domain) as domain,
    a.measurement_id,
    a.canonical_key,
    a.canonical_display_name,
    a.citation_url,
    q.intent_type,
    q.prompt_text,
    case when a.canonical_key='business:'||p_business_id::text then 'client'
         when sig.canonical_key is not null then 'competitor'
         else 'other' end as entity_side
  from public.measurement_citation_attributions_actionable_v1 a
  join valid_measurements vm on vm.id=a.measurement_id
  join public.questions q on q.id=vm.question_id and q.org_id=p_org_id
  left join significant sig on sig.canonical_key=a.canonical_key
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
), grouped as (
  select
    r.source_key,
    max(r.source_name) as source_name,
    max(r.source_group_key) as source_group_key,
    count(distinct r.measurement_id) filter(where r.entity_side='competitor')::integer as competitor_response_count,
    count(distinct r.canonical_key) filter(where r.entity_side='competitor')::integer as distinct_competitor_count,
    count(distinct coalesce(r.intent_type,'other')) filter(where r.entity_side='competitor')::integer as intent_count,
    count(distinct r.prompt_text) filter(where r.entity_side='competitor')::integer as question_count,
    count(distinct r.measurement_id) filter(where r.entity_side='client')::integer as client_response_count,
    jsonb_agg(distinct jsonb_build_object('name',r.canonical_display_name,'url',r.citation_url))
      filter(where r.entity_side='competitor' and r.canonical_display_name is not null) as linked_competitors,
    jsonb_agg(distinct to_jsonb(r.domain)) filter(where r.domain is not null) as domains,
    jsonb_agg(distinct to_jsonb(r.prompt_text)) filter(where r.entity_side='competitor' and r.prompt_text is not null) as sample_questions
  from rows r
  where r.source_key is not null
  group by r.source_key
)
select
  g.source_key,
  g.source_name,
  g.source_group_key,
  g.competitor_response_count,
  g.distinct_competitor_count,
  g.intent_count,
  g.question_count,
  g.client_response_count,
  coalesce(g.linked_competitors,'[]'::jsonb),
  coalesce(g.domains,'[]'::jsonb),
  coalesce(g.sample_questions,'[]'::jsonb)
from grouped g
where g.competitor_response_count >= 3
  and g.intent_count >= 2
  and g.client_response_count = 0
order by g.competitor_response_count desc, g.intent_count desc, g.source_name;
$function$;

revoke all on function public.get_first_run_content_source_observations_v01(uuid,uuid,uuid) from public;
revoke all on function public.get_first_run_content_source_observations_v01(uuid,uuid,uuid) from anon;
revoke all on function public.get_first_run_content_source_observations_v01(uuid,uuid,uuid) from authenticated;
grant execute on function public.get_first_run_content_source_observations_v01(uuid,uuid,uuid) to service_role;
