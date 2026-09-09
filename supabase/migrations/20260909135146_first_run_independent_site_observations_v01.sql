create or replace function public.get_first_run_independent_site_observations_v01(
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
set search_path to ''
as $function$
with significant as (
  select s.canonical_key, s.name
  from public.get_competitor_significance_v01(p_org_id,p_business_id,p_run_id) s
  where s.tier in ('core','notable')
), valid_measurements as (
  select m.id, m.question_id, m.response_text
  from public.measurements m
  where m.org_id=p_org_id and m.run_id=p_run_id and m.valid=true
), base as (
  select
    lower(a.domain) as domain,
    a.measurement_id,
    a.canonical_key,
    a.canonical_display_name,
    a.citation_url,
    a.title,
    a.attribution_level,
    a.evidence,
    a.entity_end_index,
    a.citation_start_index,
    q.intent_type,
    q.prompt_text,
    vm.response_text,
    regexp_replace(lower(coalesce(a.canonical_display_name,'')),'[^0-9a-z가-힣]','','g') as entity_norm,
    regexp_replace(lower(coalesce(a.title,'')),'[^0-9a-z가-힣]','','g') as title_norm,
    case
      when a.canonical_key='business:'||p_business_id::text then 'client'
      when sig.canonical_key is not null then 'competitor'
      else 'other'
    end as entity_side
  from public.measurement_citation_attributions a
  join valid_measurements vm on vm.id=a.measurement_id
  join public.questions q on q.id=vm.question_id and q.org_id=p_org_id
  left join significant sig on sig.canonical_key=a.canonical_key
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
    and a.attribution_version='0.1.0'
    and lower(coalesce(a.domain,''))<>''
), accepted as (
  select b.*
  from base b
  where b.entity_side in ('client','competitor')
    and not (
      b.entity_end_index is not null
      and b.citation_start_index is not null
      and b.citation_start_index>b.entity_end_index
      and regexp_replace(
        substr(
          b.response_text,
          b.entity_end_index+1,
          least(120,greatest(0,b.citation_start_index-b.entity_end_index))
        ),
        '^[[:space:]*_`~()\\[\\]{}<>:;,.!?—–-]+',
        '',
        'g'
      ) ~ '^(보다|에[[:space:]]*비해|에[[:space:]]*비해서|와[[:space:]]*비교|과[[:space:]]*비교|대비해|대비해서)'
    )
    and (
      b.attribution_level='direct'
      or (
        b.attribution_level='section'
        and coalesce(nullif(b.evidence->>'distance_chars','')::integer,999999)<=350
        and char_length(b.entity_norm)>=4
        and b.title_norm like '%'||b.entity_norm||'%'
      )
    )
    and not (
      b.domain='blog.naver.com'
      or b.domain like '%.tistory.com'
      or b.domain='cafe.naver.com'
      or b.domain in (
        'm.place.naver.com','place.naver.com','map.naver.com',
        'service.mycle.co.kr','play.mycle.co.kr','pf.kakao.com',
        'miso.kr','soomgo.com','placeview.co.kr','localview.co.kr',
        'fcmt.purpleo.co.kr','soonwidot.co.kr','oh-car.kr',
        'kumhotire.com','tstation.com','hankooktire.com',
        'youtube.com','youtu.be','newsis.com','v.daum.net',
        'n.news.naver.com','news.nate.com','yna.co.kr','wowtv.co.kr'
      )
      or b.domain='daangn.com'
      or b.domain like '%.daangn.com'
      or b.domain like '%.miso.kr'
      or b.domain like '%.soomgo.com'
      or b.domain like '%.oh-car.kr'
      or b.domain like '%.youtube.com'
    )
), ownership as (
  select lower(a.domain) as domain,
         count(distinct a.canonical_key)::integer as distinct_entities
  from public.measurement_citation_attributions a
  where a.created_at>=now()-interval '90 days'
    and a.attribution_version='0.1.0'
    and a.domain is not null
    and a.canonical_key is not null
  group by lower(a.domain)
), grouped as (
  select
    a.domain,
    count(distinct a.measurement_id) filter(where a.entity_side='competitor')::integer as competitor_response_count,
    count(distinct a.canonical_key) filter(where a.entity_side='competitor')::integer as distinct_competitor_count,
    count(distinct coalesce(a.intent_type,'other')) filter(where a.entity_side='competitor')::integer as intent_count,
    count(distinct a.prompt_text) filter(where a.entity_side='competitor')::integer as question_count,
    count(distinct a.measurement_id) filter(where a.entity_side='client')::integer as client_response_count,
    jsonb_agg(distinct jsonb_build_object('name',a.canonical_display_name,'url',a.citation_url))
      filter(where a.entity_side='competitor' and a.canonical_display_name is not null) as linked_competitors,
    jsonb_agg(distinct to_jsonb(a.prompt_text))
      filter(where a.entity_side='competitor' and a.prompt_text is not null) as sample_questions
  from accepted a
  group by a.domain
)
select
  'independent_site:'||g.domain as source_key,
  g.domain as source_name,
  'independent_site'::text as source_group_key,
  g.competitor_response_count,
  g.distinct_competitor_count,
  g.intent_count,
  g.question_count,
  g.client_response_count,
  coalesce(g.linked_competitors,'[]'::jsonb),
  jsonb_build_array(g.domain),
  coalesce(g.sample_questions,'[]'::jsonb)
from grouped g
join ownership o on o.domain=g.domain and o.distinct_entities=1
where g.competitor_response_count>=2
  and g.intent_count>=2
  and g.distinct_competitor_count=1
  and g.client_response_count=0
order by g.competitor_response_count desc,g.intent_count desc,g.domain;
$function$;

revoke all on function public.get_first_run_independent_site_observations_v01(uuid,uuid,uuid) from public;
revoke all on function public.get_first_run_independent_site_observations_v01(uuid,uuid,uuid) from anon;
revoke all on function public.get_first_run_independent_site_observations_v01(uuid,uuid,uuid) from authenticated;
grant execute on function public.get_first_run_independent_site_observations_v01(uuid,uuid,uuid) to service_role;
