CREATE OR REPLACE FUNCTION public.apply_entity_evidence_gate_v02()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_name_key text;
  v_run_id uuid;
  v_job_id uuid;
  v_registered boolean := false;
  v_repeated boolean := false;
  v_descriptor boolean := false;
  v_citation_exact boolean := false;
  v_parser_confirmed boolean := false;
  v_strong_structured boolean := false;
  v_descriptive_generic boolean := false;
  v_evidence jsonb := '{}'::jsonb;
begin
  if new.verification_status <> 'confirmed_business'
     or new.verified_count_as_business is not true then
    return new;
  end if;

  select
    mm.display_name,
    m.run_id,
    m.job_id,
    (mm.matched_business_id is not null),
    (mm.entity_kind = 'specific_business'
      and mm.specificity = 'confirmed'
      and mm.count_as_confirmed_business is true
      and mm.resolution_confidence = 'high'),
    coalesce(mm.resolution_evidence, '{}'::jsonb)
  into
    v_name,
    v_run_id,
    v_job_id,
    v_registered,
    v_parser_confirmed,
    v_evidence
  from public.measurement_mentions mm
  join public.measurements m on m.id = mm.measurement_id
  where mm.id = new.measurement_mention_id
    and mm.org_id = new.org_id
    and m.org_id = new.org_id
  limit 1;

  if v_name is null then
    new.verification_status := 'needs_review';
    new.verified_count_as_business := false;
    if new.confidence = 'high' then new.confidence := 'medium'; end if;
    if not ('EVIDENCE_GATE_V02_INSUFFICIENT' = any(coalesce(new.reason_codes, '{}'::text[]))) then
      new.reason_codes := array_append(coalesce(new.reason_codes, '{}'::text[]), 'EVIDENCE_GATE_V02_INSUFFICIENT');
    end if;
    return new;
  end if;

  v_name_key := regexp_replace(lower(v_name), '[^0-9a-z가-힣]', '', 'g');
  v_descriptor := 'STRONG_BUSINESS_DESCRIPTOR' = any(coalesce(new.reason_codes, '{}'::text[]));

  /*
   * 설명형 일반 카테고리/섹션 제목이 하위 업체의 주소·전화·URL을
   * 빌려 specific_business로 승격되는 것을 fail-closed로 차단한다.
   * 특정 업체명 하드코딩이 아니라 일반적인 서술어 + 업종/유형 명사 구조만 본다.
   * 등록 업체 exact match는 이 차단의 대상이 아니다.
   */
  v_descriptive_generic :=
    v_name_key ~ '(체인점|프랜차이즈|카센터|카센타|정비소|정비센터|서비스센터|공업사|정비공장|정비업체|전문업체|업체|전문점)$'
    and v_name_key ~ '(가장|무난|일반|지역|동네|가까운|저렴|가성비|후기좋|후기많|평점좋|평점높|믿을만|전문적으로|선택지)';

  if v_descriptive_generic
     and not v_registered
     and not coalesce((v_evidence->>'canonical_name_match')::boolean, false) then
    new.verification_status := 'rejected_non_business';
    new.verified_entity_kind := 'generic_category';
    new.verified_count_as_business := false;
    new.confidence := 'high';
    new.reason_codes := array_remove(coalesce(new.reason_codes, '{}'::text[]), 'EVIDENCE_GATE_V01_PASS');
    new.reason_codes := array_remove(new.reason_codes, 'EVIDENCE_GATE_V02_PASS');
    if not ('EVIDENCE_GATE_V02_DESCRIPTIVE_GENERIC' = any(new.reason_codes)) then
      new.reason_codes := array_append(new.reason_codes, 'EVIDENCE_GATE_V02_DESCRIPTIVE_GENERIC');
    end if;
    return new;
  end if;

  select count(distinct mm2.measurement_id) >= 2
  into v_repeated
  from public.measurement_mentions mm2
  join public.measurements m2 on m2.id = mm2.measurement_id
  where mm2.org_id = new.org_id
    and m2.org_id = new.org_id
    and m2.run_id = v_run_id
    and regexp_replace(lower(mm2.display_name), '[^0-9a-z가-힣]', '', 'g') = v_name_key;

  v_strong_structured :=
    v_parser_confirmed
    and coalesce((v_evidence->>'has_url')::boolean, false)
    and (
      coalesce((v_evidence->>'has_phone')::boolean, false)
      or (
        coalesce((v_evidence->>'has_address')::boolean, false)
        and (
          coalesce((v_evidence->>'has_branch_marker')::boolean, false)
          or coalesce((v_evidence->>'has_business_descriptor')::boolean, false)
        )
      )
    )
    and (
      coalesce((v_evidence->>'has_location_context')::boolean, false)
      or coalesce((v_evidence->>'has_branch_marker')::boolean, false)
    )
    and not coalesce((v_evidence->>'is_pure_location')::boolean, false)
    and not coalesce((v_evidence->>'alias_collision')::boolean, false);

  if length(v_name_key) >= 4 then
    select exists (
      select 1
      from public.measurement_citations c
      where c.org_id = new.org_id
        and c.measurement_id = new.measurement_id
        and c.title is not null
        and regexp_replace(lower(c.title), '[^0-9a-z가-힣]', '', 'g') like '%' || v_name_key || '%'
    ) into v_citation_exact;

    if not v_citation_exact and v_job_id is not null then
      select exists (
        select 1
        from public.provider_payloads pp
        cross join lateral jsonb_path_query(
          pp.response_payload,
          '$.** ? (@.type == "url_citation").title'
        ) as jt(title_json)
        where pp.org_id = new.org_id
          and pp.job_id = v_job_id
          and regexp_replace(lower(trim(both '"' from jt.title_json::text)), '[^0-9a-z가-힣]', '', 'g') like '%' || v_name_key || '%'
      ) into v_citation_exact;
    end if;
  end if;

  if v_registered or v_repeated or v_citation_exact or (v_descriptor and v_parser_confirmed) or v_strong_structured then
    new.reason_codes := array_remove(coalesce(new.reason_codes, '{}'::text[]), 'EVIDENCE_GATE_V01_INSUFFICIENT');
    new.reason_codes := array_remove(new.reason_codes, 'EVIDENCE_GATE_V02_INSUFFICIENT');
    if v_strong_structured and not ('EVIDENCE_GATE_V02_STRONG_STRUCTURED' = any(new.reason_codes)) then
      new.reason_codes := array_append(new.reason_codes, 'EVIDENCE_GATE_V02_STRONG_STRUCTURED');
    end if;
    if not ('EVIDENCE_GATE_V02_PASS' = any(new.reason_codes)) then
      new.reason_codes := array_append(new.reason_codes, 'EVIDENCE_GATE_V02_PASS');
    end if;
    return new;
  end if;

  new.verification_status := 'needs_review';
  new.verified_count_as_business := false;
  if new.confidence = 'high' then new.confidence := 'medium'; end if;
  new.reason_codes := array_remove(coalesce(new.reason_codes, '{}'::text[]), 'EVIDENCE_GATE_V01_PASS');
  if not ('EVIDENCE_GATE_V02_INSUFFICIENT' = any(new.reason_codes)) then
    new.reason_codes := array_append(new.reason_codes, 'EVIDENCE_GATE_V02_INSUFFICIENT');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competitor_significance_v01(p_org_id uuid, p_business_id uuid, p_run_id uuid)
 RETURNS TABLE(canonical_key text, name text, tier text, significance_score integer, response_count integer, mention_count integer, question_count integer, intent_count integer, top3_response_count integer, citation_response_count integer, direct_citation_response_count integer, compatible_run_count integer, compatible_run_presence_count integer, prior_run_presence_count integer, repeat_response_count integer, is_new boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.canonical_key,
    s.name,
    case
      when s.response_count >= 3 and s.question_count >= 2 then 'core'
      when s.response_count >= 2 and s.prior_run_presence_count >= 1 then 'core'
      when s.response_count >= 2 then 'notable'
      when s.prior_run_presence_count >= 1 then 'notable'
      else 'watch'
    end as tier,
    s.significance_score,
    s.response_count,
    s.mention_count,
    s.question_count,
    s.intent_count,
    s.top3_response_count,
    s.citation_response_count,
    s.direct_citation_response_count,
    s.compatible_run_count,
    s.compatible_run_presence_count,
    s.prior_run_presence_count,
    s.repeat_response_count,
    s.is_new
  from public.get_competitor_significance_v02(p_org_id,p_business_id,p_run_id) s
  where regexp_replace(lower(s.name), '\s+', '', 'g') !~
    '(정비소|정비센터|서비스센터|공업사|카센터|카센타|전문점)(추천|추천순위|순위|비교|정리|목록|요약|결론|체크리스트)$'
    and not (
      regexp_replace(lower(s.name), '[^0-9a-z가-힣]', '', 'g') ~
        '(체인점|프랜차이즈|카센터|카센타|정비소|정비센터|서비스센터|공업사|정비공장|정비업체|전문업체|업체|전문점)$'
      and regexp_replace(lower(s.name), '[^0-9a-z가-힣]', '', 'g') ~
        '(가장|무난|일반|지역|동네|가까운|저렴|가성비|후기좋|후기많|평점좋|평점높|믿을만|전문적으로|선택지)'
    )
  order by
    case
      when s.response_count >= 3 and s.question_count >= 2 then 3
      when s.response_count >= 2 and s.prior_run_presence_count >= 1 then 3
      when s.response_count >= 2 then 2
      when s.prior_run_presence_count >= 1 then 2
      else 1
    end desc,
    s.significance_score desc,
    s.name asc;
$function$;
