create or replace view public.measurement_citation_attributions_actionable_v2 as
with base as (
  select
    a.id,
    a.org_id,
    a.business_id,
    a.source_run_id,
    a.measurement_id,
    a.measurement_mention_id,
    a.canonical_key,
    a.canonical_display_name,
    a.citation_url,
    a.domain,
    a.title,
    a.citation_start_index,
    a.citation_end_index,
    a.entity_start_index,
    a.entity_end_index,
    a.attribution_level,
    a.attribution_version,
    a.evidence,
    a.created_at,
    lower(coalesce(nullif(btrim(a.domain), ''), '(unknown)')) as domain_key,
    case
      when a.domain = 'blog.naver.com' or a.domain like '%.tistory.com' then 'blog'
      when a.domain = 'cafe.naver.com' then 'community'
      when a.domain in ('m.place.naver.com','place.naver.com','map.naver.com') then 'profile_map'
      when a.domain = 'oh-car.kr' or a.domain like '%.oh-car.kr' then 'auto_platform'
      when a.domain in ('youtube.com','youtu.be') or a.domain like '%.youtube.com' then 'video'
      when a.domain in ('newsis.com','v.daum.net','n.news.naver.com') then 'news'
      else 'other'
    end as source_group_key,
    case when a.canonical_key = 'business:' || a.business_id::text then 'client' else 'competitor' end as entity_side,
    case
      when a.attribution_level = 'direct' then 'direct'
      when a.attribution_level = 'section'
        and coalesce(nullif(a.evidence->>'distance_chars','')::integer,999999) <= 250 then 'near_section'
      else null
    end as evidence_tier,
    case
      when lower(coalesce(a.domain,'')) = 's3.amazonaws.com'
        or lower(coalesce(a.domain,'')) like '%.s3.amazonaws.com'
        or lower(coalesce(a.domain,'')) like '%.s3.%.amazonaws.com'
        or lower(coalesce(a.domain,'')) like '%.s3-%.amazonaws.com'
        or lower(coalesce(a.domain,'')) = 'storage.googleapis.com'
        or lower(coalesce(a.domain,'')) like '%.blob.core.windows.net'
        or lower(coalesce(a.domain,'')) like '%.r2.cloudflarestorage.com'
        or lower(coalesce(a.domain,'')) like '%.digitaloceanspaces.com'
      then true else false
    end as is_infrastructure_host,
    case
      when a.entity_end_index is not null
       and a.citation_start_index is not null
       and a.citation_start_index > a.entity_end_index
       and regexp_replace(
             substr(
               m.response_text,
               a.entity_end_index + 1,
               least(120, greatest(0, a.citation_start_index - a.entity_end_index))
             ),
             '^[[:space:]*_`~()\[\]{}<>:;,.!?—–-]+',
             ''
           ) ~ '^(보다|에[[:space:]]*비해|에[[:space:]]*비해서|와[[:space:]]*비교|과[[:space:]]*비교|대비해|대비해서)'
      then true else false
    end as is_comparative_target
  from public.measurement_citation_attributions a
  join public.measurements m
    on m.id = a.measurement_id
   and m.org_id = a.org_id
), support as (
  select
    b.org_id,
    b.business_id,
    b.source_run_id,
    b.attribution_version,
    b.domain_key,
    count(distinct b.measurement_id) filter (
      where b.entity_side='client' and b.evidence_tier='near_section' and not b.is_comparative_target
    ) as client_near_response_count,
    count(distinct b.measurement_id) filter (
      where b.entity_side='competitor' and b.evidence_tier='near_section' and not b.is_comparative_target
    ) as competitor_near_response_count
  from base b
  group by b.org_id,b.business_id,b.source_run_id,b.attribution_version,b.domain_key
)
select
  b.id,b.org_id,b.business_id,b.source_run_id,b.measurement_id,b.measurement_mention_id,
  b.canonical_key,b.canonical_display_name,b.citation_url,b.domain,b.title,
  b.citation_start_index,b.citation_end_index,b.entity_start_index,b.entity_end_index,
  b.attribution_level,b.attribution_version,b.evidence,b.created_at
from base b
join support s
  on s.org_id=b.org_id
 and s.business_id=b.business_id
 and s.source_run_id=b.source_run_id
 and s.attribution_version=b.attribution_version
 and s.domain_key=b.domain_key
where b.domain_key <> '(unknown)'
  and b.is_infrastructure_host = false
  and b.is_comparative_target = false
  and (
    b.evidence_tier='direct'
    or (
      b.evidence_tier='near_section'
      and b.source_group_key <> 'news'
      and (
        (b.entity_side='client' and s.client_near_response_count >= 2)
        or (b.entity_side='competitor' and s.competitor_near_response_count >= 2)
      )
    )
  );

create or replace view public.measurement_citation_attributions_actionable_v1 as
select
  id,org_id,business_id,source_run_id,measurement_id,measurement_mention_id,
  canonical_key,canonical_display_name,citation_url,domain,title,citation_start_index,
  citation_end_index,entity_start_index,entity_end_index,attribution_level,
  attribution_version,evidence,created_at
from public.measurement_citation_attributions_actionable_v2;
