create or replace function public.get_global_high_visibility_source_patterns_v02(
  p_requesting_org_id uuid,
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_result jsonb;
  v_threshold numeric := 20;
  v_target_category text;
  v_global_high_count integer := 0;
  v_category_high_count integer := 0;
  v_category_available boolean := false;
  v_global_groups jsonb := '[]'::jsonb;
  v_global_domains jsonb := '[]'::jsonb;
  v_category_groups jsonb := '[]'::jsonb;
  v_category_domains jsonb := '[]'::jsonb;
begin
  v_result := public.get_global_high_visibility_source_patterns_v01(
    p_requesting_org_id,
    p_business_id
  );

  if v_result is null then
    return null;
  end if;

  v_threshold := coalesce((v_result->'benchmark'->>'thresholdPct')::numeric, 20::numeric);
  v_global_high_count := coalesce((v_result->'benchmark'->>'highVisibilityEntityCount')::integer, 0);
  v_category_high_count := coalesce((v_result->'categoryContext'->>'highVisibilityEntityCount')::integer, 0);
  v_category_available := coalesce((v_result->'categoryContext'->>'available')::boolean, false);

  select b.category
  into v_target_category
  from public.businesses b
  where b.id = p_business_id
    and b.org_id = p_requesting_org_id
    and b.is_client_business = true
    and b.active = true
  limit 1;

  with eligible_runs as (
    select
      r.id as run_id,
      r.org_id,
      r.business_id,
      b.name as target_name,
      b.category,
      coalesce(r.completed_at, r.created_at) as measured_at,
      count(*) filter (where m.valid)::integer as valid_count
    from public.measurement_runs r
    join public.businesses b
      on b.id = r.business_id
     and b.org_id = r.org_id
     and b.is_client_business = true
     and b.active = true
    join public.measurements m
      on m.run_id = r.id
     and m.org_id = r.org_id
    where r.run_type = 'audit'::public.run_type
      and r.phase = 'standalone'::public.run_phase
      and r.status = 'completed'::public.run_status
      and r.experiment_id is null
      and r.data_origin in ('internal_observation','customer_measurement')
      and coalesce(r.completed_at, r.created_at) >= now() - interval '90 days'
      and exists (
        select 1
        from public.system_events se
        where se.org_id = r.org_id
          and se.run_id = r.id
          and se.event_type = 'visibility_postprocess_completed'
          and se.metadata->>'pipeline_version' = '0.1.4'
          and se.metadata->>'verifier_version' = '0.1.5'
      )
    group by r.id, r.org_id, r.business_id, b.name, b.category, r.completed_at, r.created_at
    having count(*) filter (where m.valid) >= 24
  ), client_pairs as (
    select
      er.run_id,
      er.org_id,
      er.business_id,
      er.category,
      'business:' || er.business_id::text as source_entity_key,
      regexp_replace(lower(er.target_name), '[^0-9a-z가-힣]', '', 'g') as benchmark_entity_key,
      count(distinct m.id) filter (where m.valid and m.was_client_mentioned)::integer as response_count,
      er.valid_count,
      er.measured_at
    from eligible_runs er
    join public.measurements m
      on m.run_id = er.run_id
     and m.org_id = er.org_id
    group by er.run_id, er.org_id, er.business_id, er.category, er.target_name, er.valid_count, er.measured_at
  ), competitor_pairs as (
    select
      er.run_id,
      er.org_id,
      er.business_id,
      er.category,
      c.canonical_key as source_entity_key,
      regexp_replace(lower(max(c.canonical_display_name)), '[^0-9a-z가-힣]', '', 'g') as benchmark_entity_key,
      count(distinct c.measurement_id)::integer as response_count,
      er.valid_count,
      er.measured_at
    from eligible_runs er
    join public.measurement_entity_canonicalizations c
      on c.org_id = er.org_id
     and c.business_id = er.business_id
     and c.source_run_id = er.run_id
    join public.measurements m
      on m.id = c.measurement_id
     and m.org_id = er.org_id
     and m.valid = true
    where c.canonical_key <> 'business:' || er.business_id::text
    group by er.run_id, er.org_id, er.business_id, er.category, c.canonical_key, er.valid_count, er.measured_at
  ), entity_run_pairs as (
    select
      cp.run_id, cp.org_id, cp.business_id, cp.category, cp.source_entity_key,
      cp.benchmark_entity_key, cp.response_count, cp.valid_count,
      round((100.0 * cp.response_count / nullif(cp.valid_count, 0))::numeric, 2) as visibility_rate_pct,
      cp.measured_at
    from client_pairs cp
    where cp.response_count > 0 and cp.benchmark_entity_key <> ''
    union all
    select
      cp.run_id, cp.org_id, cp.business_id, cp.category, cp.source_entity_key,
      cp.benchmark_entity_key, cp.response_count, cp.valid_count,
      round((100.0 * cp.response_count / nullif(cp.valid_count, 0))::numeric, 2) as visibility_rate_pct,
      cp.measured_at
    from competitor_pairs cp
    where cp.response_count > 0 and cp.benchmark_entity_key <> ''
  ), high_pairs as (
    select erp.*
    from entity_run_pairs erp
    where erp.visibility_rate_pct >= v_threshold
  ), raw_source_links as (
    select
      hp.benchmark_entity_key,
      hp.run_id,
      hp.org_id,
      hp.business_id,
      hp.category,
      a.measurement_id,
      lower(coalesce(nullif(a.domain, ''), '(unknown)')) as domain
    from high_pairs hp
    join public.measurement_citation_attributions_actionable_v2 a
      on a.org_id = hp.org_id
     and a.business_id = hp.business_id
     and a.source_run_id = hp.run_id
     and a.canonical_key = hp.source_entity_key
  ), domain_stats as (
    select
      rsl.domain,
      count(distinct rsl.benchmark_entity_key)::integer as high_entity_count,
      count(distinct (rsl.run_id::text || ':' || rsl.measurement_id::text))::integer as linked_response_count,
      count(*)::integer as citation_count
    from raw_source_links rsl
    group by rsl.domain
  ), classified_source_links as (
    select
      rsl.*,
      case
        when rsl.domain = 'blog.naver.com'
          or rsl.domain like '%.tistory.com' then 'blog'
        when rsl.domain = 'cafe.naver.com' then 'community'
        when rsl.domain in (
          'm.place.naver.com','place.naver.com','map.naver.com',
          'placeview.co.kr','localview.co.kr','daangn.com','soonwidot.co.kr',
          'play.mycle.co.kr','service.mycle.co.kr','pf.kakao.com',
          'fcmt.purpleo.co.kr','miso.kr','soomgo.com'
        )
          or rsl.domain like '%.daangn.com'
          or rsl.domain like '%.miso.kr'
          or rsl.domain like '%.soomgo.com' then 'profile_directory'
        when rsl.domain = 'oh-car.kr'
          or rsl.domain like '%.oh-car.kr' then 'auto_platform'
        when rsl.domain in ('news.nate.com','yna.co.kr','wowtv.co.kr','v.daum.net','n.news.naver.com','newsis.com') then 'news'
        when rsl.domain in ('youtube.com','youtu.be')
          or rsl.domain like '%.youtube.com' then 'video'
        when rsl.domain in ('kumhotire.com','tstation.com','hankooktire.com')
          or (
            ds.high_entity_count = 1
            and ds.linked_response_count >= 2
            and rsl.domain <> '(unknown)'
          ) then 'business_brand_site'
        else 'other'
      end as source_group_key
    from raw_source_links rsl
    join domain_stats ds on ds.domain = rsl.domain
  ), global_domain_stats as (
    select
      csl.domain,
      csl.source_group_key,
      count(distinct csl.benchmark_entity_key)::integer as high_entity_count,
      count(distinct (csl.run_id::text || ':' || csl.measurement_id::text))::integer as linked_response_count,
      count(*)::integer as citation_count
    from classified_source_links csl
    group by csl.domain, csl.source_group_key
  ), global_group_stats as (
    select
      csl.source_group_key,
      count(distinct csl.benchmark_entity_key)::integer as high_entity_count,
      count(distinct (csl.run_id::text || ':' || csl.measurement_id::text))::integer as linked_response_count,
      count(*)::integer as citation_count
    from classified_source_links csl
    group by csl.source_group_key
  ), target_latest as (
    select er.*
    from eligible_runs er
    where er.org_id = p_requesting_org_id
      and er.business_id = p_business_id
    order by er.measured_at desc
    limit 1
  ), target_source_domains as (
    select
      lower(coalesce(nullif(a.domain, ''), '(unknown)')) as domain,
      count(distinct a.measurement_id)::integer as response_count
    from target_latest tl
    join public.measurement_citation_attributions_actionable_v2 a
      on a.org_id = p_requesting_org_id
     and a.business_id = p_business_id
     and a.source_run_id = tl.run_id
     and a.canonical_key = 'business:' || p_business_id::text
    group by 1
  ), target_sources as (
    select
      tsd.domain,
      case
        when tsd.domain = 'blog.naver.com'
          or tsd.domain like '%.tistory.com' then 'blog'
        when tsd.domain = 'cafe.naver.com' then 'community'
        when tsd.domain in (
          'm.place.naver.com','place.naver.com','map.naver.com',
          'placeview.co.kr','localview.co.kr','daangn.com','soonwidot.co.kr',
          'play.mycle.co.kr','service.mycle.co.kr','pf.kakao.com',
          'fcmt.purpleo.co.kr','miso.kr','soomgo.com'
        )
          or tsd.domain like '%.daangn.com'
          or tsd.domain like '%.miso.kr'
          or tsd.domain like '%.soomgo.com' then 'profile_directory'
        when tsd.domain = 'oh-car.kr'
          or tsd.domain like '%.oh-car.kr' then 'auto_platform'
        when tsd.domain in ('news.nate.com','yna.co.kr','wowtv.co.kr','v.daum.net','n.news.naver.com','newsis.com') then 'news'
        when tsd.domain in ('youtube.com','youtu.be')
          or tsd.domain like '%.youtube.com' then 'video'
        when tsd.domain in ('kumhotire.com','tstation.com','hankooktire.com')
          or (
            coalesce(ds.high_entity_count, 0) = 1
            and coalesce(ds.linked_response_count, 0) >= 2
            and tsd.domain <> '(unknown)'
          ) then 'business_brand_site'
        else 'other'
      end as source_group_key,
      tsd.response_count
    from target_source_domains tsd
    left join domain_stats ds on ds.domain = tsd.domain
  ), category_entity_summary as (
    select
      erp.benchmark_entity_key,
      max(erp.visibility_rate_pct)::numeric as max_visibility_rate_pct
    from entity_run_pairs erp
    where erp.category is not distinct from v_target_category
    group by erp.benchmark_entity_key
  ), category_high_entities as (
    select ces.benchmark_entity_key
    from category_entity_summary ces
    where ces.max_visibility_rate_pct >= v_threshold
  ), category_source_links as (
    select csl.*
    from classified_source_links csl
    join category_high_entities che
      on che.benchmark_entity_key = csl.benchmark_entity_key
    where csl.category is not distinct from v_target_category
  ), category_group_stats as (
    select
      csl.source_group_key,
      count(distinct csl.benchmark_entity_key)::integer as high_entity_count,
      count(distinct (csl.run_id::text || ':' || csl.measurement_id::text))::integer as linked_response_count,
      count(*)::integer as citation_count
    from category_source_links csl
    group by csl.source_group_key
  ), category_domain_stats as (
    select
      csl.domain,
      csl.source_group_key,
      count(distinct csl.benchmark_entity_key)::integer as high_entity_count,
      count(distinct (csl.run_id::text || ':' || csl.measurement_id::text))::integer as linked_response_count,
      count(*)::integer as citation_count
    from category_source_links csl
    group by csl.domain, csl.source_group_key
  ), global_groups_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'key', g.source_group_key,
        'label', case g.source_group_key
          when 'blog' then '블로그'
          when 'community' then '커뮤니티'
          when 'profile_directory' then '업체 프로필·디렉터리'
          when 'auto_platform' then '자동차 전문 플랫폼'
          when 'news' then '언론·뉴스'
          when 'video' then '영상'
          when 'business_brand_site' then '업체·브랜드 홈페이지·독립 사이트'
          else '기타 독립·정보 사이트'
        end,
        'highEntityCount', g.high_entity_count,
        'highEntitySharePct', case when v_global_high_count > 0 then round((100.0 * g.high_entity_count / v_global_high_count)::numeric, 2) else 0 end,
        'linkedResponseCount', g.linked_response_count,
        'citationCount', g.citation_count,
        'targetResponseCount', coalesce(tg.response_count, 0),
        'targetHasSource', coalesce(tg.response_count, 0) > 0,
        'patternStrength', case
          when v_global_high_count >= 10 and g.high_entity_count >= 5 and (100.0 * g.high_entity_count / nullif(v_global_high_count,0)) >= 50 then 'established'
          when g.high_entity_count >= 3 then 'emerging'
          else 'early'
        end
      ) order by g.high_entity_count desc, g.linked_response_count desc, g.citation_count desc, g.source_group_key
    ), '[]'::jsonb) as value
    from global_group_stats g
    left join (
      select source_group_key, sum(response_count)::integer as response_count
      from target_sources
      group by source_group_key
    ) tg on tg.source_group_key = g.source_group_key
  ), global_domains_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'domain', d.domain,
        'groupKey', d.source_group_key,
        'highEntityCount', d.high_entity_count,
        'highEntitySharePct', case when v_global_high_count > 0 then round((100.0 * d.high_entity_count / v_global_high_count)::numeric, 2) else 0 end,
        'linkedResponseCount', d.linked_response_count,
        'citationCount', d.citation_count,
        'targetResponseCount', coalesce(ts.response_count, 0),
        'targetHasSource', coalesce(ts.response_count, 0) > 0
      ) order by d.high_entity_count desc, d.linked_response_count desc, d.citation_count desc, d.domain
    ), '[]'::jsonb) as value
    from (
      select *
      from global_domain_stats
      order by high_entity_count desc, linked_response_count desc, citation_count desc, domain
      limit 16
    ) d
    left join target_sources ts on ts.domain = d.domain
  ), category_groups_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'key', g.source_group_key,
        'label', case g.source_group_key
          when 'blog' then '블로그'
          when 'community' then '커뮤니티'
          when 'profile_directory' then '업체 프로필·디렉터리'
          when 'auto_platform' then '자동차 전문 플랫폼'
          when 'news' then '언론·뉴스'
          when 'video' then '영상'
          when 'business_brand_site' then '업체·브랜드 홈페이지·독립 사이트'
          else '기타 독립·정보 사이트'
        end,
        'highEntityCount', g.high_entity_count,
        'highEntitySharePct', case when v_category_high_count > 0 then round((100.0 * g.high_entity_count / v_category_high_count)::numeric, 2) else 0 end,
        'linkedResponseCount', g.linked_response_count,
        'citationCount', g.citation_count
      ) order by g.high_entity_count desc, g.linked_response_count desc, g.citation_count desc, g.source_group_key
    ), '[]'::jsonb) as value
    from category_group_stats g
  ), category_domains_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'domain', d.domain,
        'groupKey', d.source_group_key,
        'highEntityCount', d.high_entity_count,
        'highEntitySharePct', case when v_category_high_count > 0 then round((100.0 * d.high_entity_count / v_category_high_count)::numeric, 2) else 0 end,
        'linkedResponseCount', d.linked_response_count,
        'citationCount', d.citation_count
      ) order by d.high_entity_count desc, d.linked_response_count desc, d.citation_count desc, d.domain
    ), '[]'::jsonb) as value
    from (
      select *
      from category_domain_stats
      order by high_entity_count desc, linked_response_count desc, citation_count desc, domain
      limit 12
    ) d
  )
  select
    ggj.value,
    gdj.value,
    case when v_category_available then cgj.value else '[]'::jsonb end,
    case when v_category_available then cdj.value else '[]'::jsonb end
  into v_global_groups, v_global_domains, v_category_groups, v_category_domains
  from global_groups_json ggj
  cross join global_domains_json gdj
  cross join category_groups_json cgj
  cross join category_domains_json cdj;

  v_result := jsonb_set(v_result, '{version}', to_jsonb('2.0'::text), true);
  v_result := jsonb_set(v_result, '{benchmark,sourceGroupingVersion}', to_jsonb('0.2'::text), true);
  v_result := jsonb_set(v_result, '{sourceGroups}', coalesce(v_global_groups, '[]'::jsonb), true);
  v_result := jsonb_set(v_result, '{domains}', coalesce(v_global_domains, '[]'::jsonb), true);
  v_result := jsonb_set(v_result, '{categoryContext,sourceGroups}', coalesce(v_category_groups, '[]'::jsonb), true);
  v_result := jsonb_set(v_result, '{categoryContext,domains}', coalesce(v_category_domains, '[]'::jsonb), true);

  return v_result;
end;
$function$;

revoke all on function public.get_global_high_visibility_source_patterns_v02(uuid,uuid) from public;
revoke all on function public.get_global_high_visibility_source_patterns_v02(uuid,uuid) from anon;
revoke all on function public.get_global_high_visibility_source_patterns_v02(uuid,uuid) from authenticated;
grant execute on function public.get_global_high_visibility_source_patterns_v02(uuid,uuid) to service_role;

comment on function public.get_global_high_visibility_source_patterns_v02(uuid,uuid)
is 'CHABOIM global automotive visibility benchmark source grouping v0.2. Preserves v01 benchmark selection and recomputes source groups by unique benchmark entity with shared-platform correction and conservative business/brand site classification.';
