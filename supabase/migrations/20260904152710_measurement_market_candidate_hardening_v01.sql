create or replace function public.resolve_measurement_market_profile_candidate_v01(
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_target record;
  v_identity_key text;
  v_result jsonb;
begin
  select b.* into v_target
  from public.businesses b
  where b.id=p_business_id and b.is_client_business=true and b.active=true;
  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_identity_key := public.get_benchmark_business_identity_key_v01(
    v_target.id,v_target.name,v_target.country_code,v_target.region,v_target.city,v_target.address
  );

  with same_real_business as (
    select b.id,b.name,b.category,b.aliases,b.region,b.city,b.address,
      concat_ws(' ',coalesce(b.name,''),coalesce(b.category,''),coalesce(array_to_string(b.aliases,' '),'')) as source_text
    from public.businesses b
    join public.organizations o on o.id=b.org_id
    where b.is_client_business=true and b.active=true
      and public.get_benchmark_business_identity_key_v01(b.id,b.name,b.country_code,b.region,b.city,b.address)=v_identity_key
      and (b.id=p_business_id or o.measurement_data_origin='internal_observation')
  ), taxonomy(key,label,pattern,is_broad,sort_order) as (
    values
      ('engine_oil','엔진오일 교환','(엔진\s*오일|엔진오일|오일\s*교환)',false,10),
      ('premium_lubricant','프리미엄 윤활유·합성유','(프리미엄\s*윤활유|윤활유|합성유|\mPAO\M)',false,20),
      ('tire','타이어','타이어',false,30),('wheel','휠','(^|[^가-힣])휠([^가-힣]|$)',false,40),
      ('tinting','썬팅·틴팅','(썬팅|틴팅)',false,50),('new_car_package','신차패키지','(신차\s*패키지|신차패키지)',false,60),
      ('ppf','PPF','(\mPPF\M|페인트\s*프로텍션)',false,70),('wrapping','랩핑·래핑','(랩핑|래핑|wrapping)',false,80),
      ('tuning','튜닝','튜닝',false,90),('electrical','자동차 전장','(전장|블랙박스|하이패스|카오디오|보조\s*배터리)',false,100),
      ('detailing','디테일링','디테일링',false,110),('car_wash','세차','세차',false,120),
      ('coating','자동차 코팅','(유리막|세라믹\s*코팅|자동차\s*코팅)',false,130),('dent','덴트','덴트',false,140),
      ('battery','배터리','배터리',false,150),('brake','브레이크','브레이크',false,160),
      ('suspension','서스펜션·쇼바','(서스펜션|쇼바)',false,170),('rent_car','렌터카','(렌터카|렌트카)',false,180),
      ('general_repair','자동차 일반 정비','(자동차\s*정비|경정비|정비소|카센터|공업사)',true,900)
  ), service_hits as (
    select t.key,t.label,t.is_broad,t.sort_order,
      count(*) filter(where s.source_text ~* t.pattern)::integer as registration_hits,
      bool_or(s.id=p_business_id and s.source_text ~* t.pattern) as target_registration_match
    from taxonomy t cross join same_real_business s
    group by t.key,t.label,t.is_broad,t.sort_order
  ), matched as (select * from service_hits where registration_hits>0),
  flags as (
    select exists(select 1 from matched where is_broad=false) as has_specific,
      count(*) filter(where is_broad=false)::integer as specific_count,
      count(*) filter(where is_broad=true)::integer as broad_count from matched
  ), core as (
    select m.* from matched m cross join flags f
    where (f.has_specific and m.is_broad=false) or (not f.has_specific and m.is_broad=true)
  ), adjacent as (
    select m.* from matched m cross join flags f where f.has_specific and m.is_broad=true
  ), reg_stats as (
    select count(*)::integer as registration_count,
      count(distinct regexp_replace(lower(coalesce(category,'')),'\s+','','g'))::integer as category_variant_count
    from same_real_business
  ), profile_stats as (
    select coalesce((select max(registration_hits) from core),0)::integer as max_core_registration_hits,
      coalesce((select count(*) from core),0)::integer as core_count,
      coalesce((select count(*) from adjacent),0)::integer as adjacent_count
  ), location_parts as (
    select coalesce(v_target.region,'') as region,coalesce(v_target.city,'') as city,
      regexp_split_to_array(trim(coalesce(v_target.city,'')),'\s+') as city_parts
  ), location_surface as (
    select nullif(trim(region),'') as region,nullif(trim(city),'') as city,
      case when array_length(city_parts,1)>=2 then city_parts[array_length(city_parts,1)]
           when array_length(city_parts,1)=1 and city_parts[1] ~ '(구|군)$' then city_parts[1] else null end as local_surface,
      case when array_length(city_parts,1)>=1 then regexp_replace(city_parts[1],'(특별자치시|특별시|광역시|시|군)$','') else null end as broader_surface
    from location_parts
  )
  select jsonb_build_object(
    'version','0.1','taxonomyVersion','automotive_v0.1','resolverVersion','0.1.1','businessIdentityVersion','0.1',
    'businessIdentityKey',v_identity_key,'sourceRegistrationCount',rs.registration_count,'categoryVariantCount',rs.category_variant_count,
    'inputSensitivityDetected',(rs.category_variant_count>1),'rawCategoryUsedAsSingleTruth',false,
    'evidenceMode','target_plus_internal_observation_registration_v0.1','crossCustomerFreeTextReuse',false,'webEvidencePending',true,
    'confidence',case when ps.core_count=0 then 'low' when rs.registration_count>=2 and ps.max_core_registration_hits>=2 then 'high' else 'medium' end,
    'coreServices',coalesce((select jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'registrationHits',c.registration_hits,'targetRegistrationMatch',c.target_registration_match) order by c.sort_order) from core c),'[]'::jsonb),
    'adjacentServices',coalesce((select jsonb_agg(jsonb_build_object('key',a.key,'label',a.label,'registrationHits',a.registration_hits,'targetRegistrationMatch',a.target_registration_match) order by a.sort_order) from adjacent a),'[]'::jsonb),
    'location',(select jsonb_build_object('region',ls.region,'city',ls.city,'localSurface',ls.local_surface,'broaderSurface',ls.broader_surface) from location_surface ls),
    'portfolioBlueprint',jsonb_build_object('questionCount',24,'intentCount',8,'slotsPerIntent',3,'layers',jsonb_build_array(
      jsonb_build_object('key','core_local','questionCount',8),jsonb_build_object('key','core_city','questionCount',8),
      jsonb_build_object('key','adjacent_or_core_expansion','questionCount',8,'fallbackToCore',(ps.adjacent_count=0))
    )),
    'limitations',jsonb_build_array(
      '현재 v0.1은 target 등록 정보와 internal_observation 등록 정보만 사용하는 dry-run 후보입니다.',
      '다른 customer_measurement 조직의 free-text 카테고리는 재사용하지 않습니다.',
      '공개 웹 근거 기반 서비스 검증은 다음 단계에서 추가합니다.',
      '현재 질문 Generator에는 아직 연결하지 않습니다.'
    )
  ) into v_result from reg_stats rs cross join profile_stats ps;
  return v_result;
end;
$function$;

create or replace function public.build_measurement_market_portfolio_candidate_v01(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_profile jsonb; v_core jsonb; v_adjacent jsonb; v_location jsonb; v_core_count integer; v_adjacent_count integer; v_result jsonb;
begin
  v_profile:=public.resolve_measurement_market_profile_candidate_v01(p_business_id);
  v_core:=coalesce(v_profile->'coreServices','[]'::jsonb); v_adjacent:=coalesce(v_profile->'adjacentServices','[]'::jsonb); v_location:=coalesce(v_profile->'location','{}'::jsonb);
  v_core_count:=jsonb_array_length(v_core); v_adjacent_count:=jsonb_array_length(v_adjacent);
  if v_core_count=0 then return jsonb_build_object('version','0.1','status','insufficient_profile','profile',v_profile,'slots','[]'::jsonb); end if;

  with intents(intent_key,intent_label,intent_order) as (
    values ('local','지역·접근성',1),('recommendation','추천',2),('service','서비스·작업',3),('review_quality','후기·평판',4),('trust','전문성·신뢰',5),('comparison','비교',6),('price_value','가격·가성비',7),('discovery','탐색·발견',8)
  ), layers(base_layer_key,slot_order) as (values ('core_local',1),('core_city',2),('third_market',3)),
  expanded as (
    select i.*,l.*,((i.intent_order-1+l.slot_order-1)%v_core_count) as core_idx,
      case when v_adjacent_count>0 then ((i.intent_order-1)%v_adjacent_count) else null end as adjacent_idx
    from intents i cross join layers l
  ), slots as (
    select row_number() over(order by intent_order,slot_order)::integer as portfolio_position,intent_key,intent_label,
      case when base_layer_key='third_market' and v_adjacent_count>0 then 'adjacent_city' when base_layer_key='third_market' then 'core_expansion' else base_layer_key end as layer_key,
      case when base_layer_key='core_local' then '핵심 전문시장 · 가까운 지역' when base_layer_key='core_city' then '핵심 전문시장 · 넓은 지역' when v_adjacent_count>0 then '인접/일반시장 · 넓은 지역' else '핵심 전문시장 · 추가 탐색' end as layer_label,
      case when base_layer_key='third_market' and v_adjacent_count>0 then v_adjacent->adjacent_idx->>'key' else v_core->core_idx->>'key' end as service_key,
      case when base_layer_key='third_market' and v_adjacent_count>0 then v_adjacent->adjacent_idx->>'label' else v_core->core_idx->>'label' end as service_label,
      case when base_layer_key='core_local' then 'local' else 'broader' end as location_scope,
      case when base_layer_key='core_local' then coalesce(v_location->>'localSurface',v_location->>'broaderSurface') else coalesce(v_location->>'broaderSurface',v_location->>'localSurface') end as location_surface,
      (base_layer_key='third_market' and v_adjacent_count=0) as adjacent_fallback_to_core
    from expanded
  ), summary as (
    select count(*)::integer as question_count,count(distinct intent_key)::integer as intent_count,
      count(*) filter(where layer_key='core_local')::integer as core_local_count,count(*) filter(where layer_key='core_city')::integer as core_city_count,
      count(*) filter(where layer_key='adjacent_city')::integer as adjacent_city_count,count(*) filter(where layer_key='core_expansion')::integer as core_expansion_count
    from slots
  )
  select jsonb_build_object(
    'version','0.1.1','status','candidate','portfolioType','coverage_balanced_diagnostic','populationWeighted',false,
    'claim','실제 검색 빈도 확률이 아니라 표준화된 시장 커버리지 진단 포트폴리오',
    'profileVersion',v_profile->>'version','taxonomyVersion',v_profile->>'taxonomyVersion','businessIdentityVersion',v_profile->>'businessIdentityVersion',
    'summary',jsonb_build_object('questionCount',s.question_count,'intentCount',s.intent_count,'slotsPerIntent',3,'coreLocalCount',s.core_local_count,'coreCityCount',s.core_city_count,'adjacentCityCount',s.adjacent_city_count,'coreExpansionCount',s.core_expansion_count),
    'slots',(select jsonb_agg(jsonb_build_object('position',portfolio_position,'intentType',intent_key,'intentLabel',intent_label,'marketLayer',layer_key,'marketLayerLabel',layer_label,'serviceKey',service_key,'serviceLabel',service_label,'locationScope',location_scope,'locationSurface',location_surface,'adjacentFallbackToCore',adjacent_fallback_to_core) order by portfolio_position) from slots),
    'limitations',jsonb_build_array('현재는 질문 문구를 생성하지 않는 shadow 포트폴리오입니다.','실제 AI 검색 빈도 분포를 추정한 가중치가 아닙니다.','현재 production 질문 Generator에는 연결하지 않습니다.')
  ) into v_result from summary s;
  return v_result;
end;
$function$;
