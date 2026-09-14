-- First-run source clue confirmed-alignment v0.4
-- Non-production candidate until explicitly applied.
--
-- Goals:
-- 1) Count competitor source evidence only when the same canonical business is
--    confirmed in the same measurement.
-- 2) Keep client-side source evidence on the existing actionable path so a
--    missing canonicalization does not create a false source-gap card.
-- 3) Make 90-day independent-site ownership fail closed when more than one
--    confirmed canonical entity is linked to the domain, even once.
-- 4) Return measurement ids for exact cross-site union counts in the Edge layer.

create or replace function public.get_first_run_independent_site_observations_v04(
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
  sample_questions jsonb,
  measurement_ids jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
with significant as (
  select s.canonical_key, s.name
  from public.get_competitor_significance_v01(p_org_id,p_business_id,p_run_id) s
  where s.tier in ('core','notable')
), valid_measurements as (
  select m.id, m.question_id
  from public.measurements m
  where m.org_id=p_org_id
    and m.run_id=p_run_id
    and m.valid=true
), current_rows as (
  select
    lower(a.domain) as domain,
    a.measurement_id,
    a.canonical_key,
    a.canonical_display_name,
    a.citation_url,
    q.intent_type,
    q.prompt_text,
    case
      when a.canonical_key='business:'||p_business_id::text then 'client'
      when sig.canonical_key is not null
       and exists (
         select 1
         from public.measurement_entity_canonicalizations c
         join public.measurement_mentions mm
           on mm.id=c.measurement_mention_id
          and mm.org_id=c.org_id
          and mm.measurement_id=c.measurement_id
          and mm.count_as_confirmed_business=true
         where c.org_id=a.org_id
           and c.business_id=a.business_id
           and c.source_run_id=a.source_run_id
           and c.measurement_id=a.measurement_id
           and c.canonical_key=a.canonical_key
       ) then 'competitor'
      else 'other'
    end as entity_side
  from public.measurement_citation_attributions_actionable_v2 a
  join valid_measurements vm on vm.id=a.measurement_id
  join public.questions q on q.id=vm.question_id and q.org_id=p_org_id
  left join significant sig on sig.canonical_key=a.canonical_key
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
    and a.attribution_version='0.1.0'
    and lower(coalesce(a.domain,''))<>''
    and not (
      lower(a.domain)='blog.naver.com'
      or lower(a.domain) like '%.tistory.com'
      or lower(a.domain)='cafe.naver.com'
      or lower(a.domain) in (
        'm.place.naver.com','place.naver.com','map.naver.com',
        'service.mycle.co.kr','play.mycle.co.kr','pf.kakao.com',
        'miso.kr','soomgo.com','placeview.co.kr','localview.co.kr',
        'fcmt.purpleo.co.kr','soonwidot.co.kr','oh-car.kr',
        'kumhotire.com','tstation.com','hankooktire.com',
        'youtube.com','youtu.be','newsis.com','v.daum.net',
        'n.news.naver.com','news.nate.com','yna.co.kr','wowtv.co.kr'
      )
      or lower(a.domain)='daangn.com'
      or lower(a.domain) like '%.daangn.com'
      or lower(a.domain) like '%.miso.kr'
      or lower(a.domain) like '%.soomgo.com'
      or lower(a.domain) like '%.oh-car.kr'
      or lower(a.domain) like '%.youtube.com'
    )
), current_supported_competitors as (
  select
    r.domain,
    r.canonical_key,
    count(distinct r.measurement_id)::integer as response_count,
    count(distinct coalesce(r.intent_type,'other'))::integer as intent_count
  from current_rows r
  where r.entity_side='competitor'
  group by r.domain,r.canonical_key
  having count(distinct r.measurement_id)>=2
     and count(distinct coalesce(r.intent_type,'other'))>=2
), current_eligible as (
  select r.*
  from current_rows r
  left join current_supported_competitors s
    on s.domain=r.domain
   and s.canonical_key=r.canonical_key
  where r.entity_side='client'
     or (r.entity_side='competitor' and s.canonical_key is not null)
), grouped as (
  select
    r.domain,
    max(r.canonical_key) filter(where r.entity_side='competitor') as competitor_key,
    count(distinct r.measurement_id) filter(where r.entity_side='competitor')::integer as competitor_response_count,
    count(distinct r.canonical_key) filter(where r.entity_side='competitor')::integer as distinct_competitor_count,
    count(distinct coalesce(r.intent_type,'other')) filter(where r.entity_side='competitor')::integer as intent_count,
    count(distinct r.prompt_text) filter(where r.entity_side='competitor')::integer as question_count,
    count(distinct r.measurement_id) filter(where r.entity_side='client')::integer as client_response_count,
    jsonb_agg(distinct jsonb_build_object('name',r.canonical_display_name,'url',r.citation_url))
      filter(where r.entity_side='competitor' and r.canonical_display_name is not null) as linked_competitors,
    jsonb_agg(distinct to_jsonb(r.prompt_text))
      filter(where r.entity_side='competitor' and r.prompt_text is not null) as sample_questions,
    jsonb_agg(distinct to_jsonb(r.measurement_id))
      filter(where r.entity_side='competitor') as measurement_ids
  from current_eligible r
  group by r.domain
), ownership_entity_support as (
  select
    lower(a.domain) as domain,
    a.canonical_key,
    count(distinct a.measurement_id)::integer as response_count
  from public.measurement_citation_attributions_actionable_v2 a
  where a.created_at>=now()-interval '90 days'
    and a.attribution_version='0.1.0'
    and a.domain is not null
    and a.canonical_key is not null
    and exists (
      select 1
      from public.measurement_entity_canonicalizations c
      join public.measurement_mentions mm
        on mm.id=c.measurement_mention_id
       and mm.org_id=c.org_id
       and mm.measurement_id=c.measurement_id
       and mm.count_as_confirmed_business=true
      where c.org_id=a.org_id
        and c.business_id=a.business_id
        and c.source_run_id=a.source_run_id
        and c.measurement_id=a.measurement_id
        and c.canonical_key=a.canonical_key
    )
  group by lower(a.domain),a.canonical_key
), ownership as (
  select
    o.domain,
    count(*)::integer as confirmed_entity_count,
    min(o.canonical_key) as sole_confirmed_entity_key
  from ownership_entity_support o
  group by o.domain
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
  coalesce(g.sample_questions,'[]'::jsonb),
  coalesce(g.measurement_ids,'[]'::jsonb)
from grouped g
join ownership o
  on o.domain=g.domain
 and o.confirmed_entity_count=1
 and o.sole_confirmed_entity_key=g.competitor_key
where g.competitor_response_count>=2
  and g.intent_count>=2
  and g.distinct_competitor_count=1
  and g.client_response_count=0
  and exists (
    select 1
    from current_eligible r
    where r.domain=g.domain
      and r.canonical_key=g.competitor_key
      and r.entity_side='competitor'
      and r.citation_url is not null
      and lower(
        regexp_replace(
          split_part(split_part(r.citation_url,'?',1),'#',1),
          '^https?://(www\.)?',
          '',
          'i'
        )
      ) in (g.domain,g.domain||'/')
  )
order by g.competitor_response_count desc,g.intent_count desc,g.domain;
$function$;

revoke all on function public.get_first_run_independent_site_observations_v04(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_first_run_independent_site_observations_v04(uuid,uuid,uuid) to service_role;


create or replace function public.get_first_run_profile_source_observations_v03(
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
with significant as (
  select s.canonical_key, s.name
  from public.get_competitor_significance_v01(p_org_id,p_business_id,p_run_id) s
  where s.tier in ('core','notable')
), valid_measurements as (
  select m.id, m.question_id
  from public.measurements m
  where m.org_id=p_org_id
    and m.run_id=p_run_id
    and m.valid=true
), rows as (
  select
    case
      when lower(a.domain) in ('m.place.naver.com','place.naver.com','map.naver.com') then 'naver_place'
      when lower(a.domain)='daangn.com' or lower(a.domain) like '%.daangn.com' then 'daangn'
      when lower(a.domain) in ('service.mycle.co.kr','play.mycle.co.kr') then 'mycle'
      when lower(a.domain)='pf.kakao.com' then 'kakao_channel'
      when lower(a.domain)='soomgo.com' or lower(a.domain) like '%.soomgo.com' then 'soomgo'
      when lower(a.domain)='miso.kr' or lower(a.domain) like '%.miso.kr' then 'miso'
      else null
    end as source_key,
    case
      when lower(a.domain) in ('m.place.naver.com','place.naver.com','map.naver.com') then '네이버 플레이스'
      when lower(a.domain)='daangn.com' or lower(a.domain) like '%.daangn.com' then '당근 동네업체'
      when lower(a.domain) in ('service.mycle.co.kr','play.mycle.co.kr') then '마이클'
      when lower(a.domain)='pf.kakao.com' then '카카오 채널'
      when lower(a.domain)='soomgo.com' or lower(a.domain) like '%.soomgo.com' then '숨고'
      when lower(a.domain)='miso.kr' or lower(a.domain) like '%.miso.kr' then '미소'
      else null
    end as source_name,
    'managed_profile'::text as source_group_key,
    lower(a.domain) as domain,
    a.measurement_id,
    a.canonical_key,
    a.canonical_display_name,
    a.citation_url,
    q.intent_type,
    q.prompt_text,
    case
      when a.canonical_key='business:'||p_business_id::text then 'client'
      when sig.canonical_key is not null
       and exists (
         select 1
         from public.measurement_entity_canonicalizations c
         join public.measurement_mentions mm
           on mm.id=c.measurement_mention_id
          and mm.org_id=c.org_id
          and mm.measurement_id=c.measurement_id
          and mm.count_as_confirmed_business=true
         where c.org_id=a.org_id
           and c.business_id=a.business_id
           and c.source_run_id=a.source_run_id
           and c.measurement_id=a.measurement_id
           and c.canonical_key=a.canonical_key
       ) then 'competitor'
      else 'other'
    end as entity_side
  from public.measurement_citation_attributions_actionable_v2 a
  join valid_measurements vm on vm.id=a.measurement_id
  join public.questions q on q.id=vm.question_id and q.org_id=p_org_id
  left join significant sig on sig.canonical_key=a.canonical_key
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and a.source_run_id=p_run_id
    and a.attribution_version='0.1.0'
), supported_competitors as (
  select
    r.source_key,
    r.canonical_key,
    count(distinct r.measurement_id)::integer as response_count,
    count(distinct coalesce(r.intent_type,'other'))::integer as intent_count
  from rows r
  where r.source_key is not null
    and r.entity_side='competitor'
  group by r.source_key,r.canonical_key
  having count(distinct r.measurement_id)>=2
     and count(distinct coalesce(r.intent_type,'other'))>=2
), eligible as (
  select r.*
  from rows r
  left join supported_competitors s
    on s.source_key=r.source_key
   and s.canonical_key=r.canonical_key
  where r.source_key is not null
    and (
      r.entity_side='client'
      or (r.entity_side='competitor' and s.canonical_key is not null)
    )
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
    jsonb_agg(distinct to_jsonb(r.prompt_text))
      filter(where r.entity_side='competitor' and r.prompt_text is not null) as sample_questions
  from eligible r
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
where g.competitor_response_count>=2
  and g.intent_count>=2
  and g.client_response_count=0
order by g.competitor_response_count desc,g.intent_count desc,g.source_name;
$function$;

revoke all on function public.get_first_run_profile_source_observations_v03(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_first_run_profile_source_observations_v03(uuid,uuid,uuid) to service_role;
